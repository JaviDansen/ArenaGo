import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolClient, QueryResult } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { JoinExperienceQueueInput, JoinExperienceQueueResult } from "../../src/events/queue-entry.types";
import { assertSafeTestDatabase } from "./test-db-guard";

// Preflight ANTES de importar serviços que importam database.module/environment.
// Sem fallback para .env, PGHOST ou qualquer outro banco. Query params são proibidos.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test"
    || url.search || url.hash || !url.username) {
    throw new Error(`${name} exige credenciais explícitas e exatamente 127.0.0.1:55432/arenago_events_test, sem parâmetros.`);
  }
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas devem ser idênticas.");
process.env.DOTENV_CONFIG_PATH = "NUL";

const appName = `arena-e071-${randomUUID()}`;
const servicePool = new Pool({ connectionString: urls[2], application_name: appName, max: 8,
  connectionTimeoutMillis: 2000, statement_timeout: 10000, lock_timeout: 8000 });
const fixturePool = new Pool({ connectionString: urls[2], application_name: `${appName}-fixtures`, max: 4,
  connectionTimeoutMillis: 2000, statement_timeout: 10000, lock_timeout: 8000 });
const database = drizzle(servicePool, { schema });
let service: QueueEntryService;
let makeService: (db: NodePgDatabase<typeof schema>) => QueueEntryService;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;

before(async () => {
  const check = await fixturePool.query("SELECT current_database() AS name");
  assert.equal(check.rows[0].name, "arenago_events_test");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { EventsService } = await import("../../src/events/events.service");
  makeService = db => new QueueEntryService(db, new EventsService(db));
  service = makeService(database);
});

after(async () => {
  const errors: unknown[] = [];
  try {
    if (ids.events.length || ids.users.length) await cleanup();
  } catch (error) { errors.push(error); }
  const closed = await Promise.allSettled([servicePool.end(), fixturePool.end()]);
  for (const result of closed) if (result.status === "rejected") errors.push(result.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza E07.1 falhou.");
});

async function cleanup() {
  const c = await fixturePool.connect();
  try {
    await c.query("BEGIN");
    await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM user_roles WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
    await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
    await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}

async function user() {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E071 fixture',$2,'fixture',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  ids.users.push(id); return id;
}

async function participant(eventId: string, status: "active" | "waiting" | "finished" | "canceled" = "active") {
  const userId = await user(); const participationId = randomUUID();
  const terminal = status === "finished" || status === "canceled";
  await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4,clock_timestamp(),CASE WHEN $4::varchar='active' THEN clock_timestamp() END,
      CASE WHEN $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'fixture_terminal' END)`,
  [participationId, userId, eventId, status, terminal]);
  return { userId, participationId };
}

async function experience(eventId: string) {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E071 experience',$3,clock_timestamp(),clock_timestamp())`, [id, eventId, baseOrder.toString()]);
  return id;
}
async function station(experienceId: string) {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E071 station','available',clock_timestamp(),clock_timestamp())`, [id, experienceId]);
  return id;
}
async function context() {
  const eventId = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,
    operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E071 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`,
  [eventId, `E071-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const p = await participant(eventId); const staffId = await user(); const roleId = randomUUID();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [roleId, staffId, eventId]);
  const experienceId = await experience(eventId); const stationId = await station(experienceId);
  return { eventId, ...p, staffId, roleId, experienceId, stationId };
}
type Context = Awaited<ReturnType<typeof context>>;
function intent(c: Pick<Context, "userId" | "participationId" | "experienceId">): JoinExperienceQueueInput {
  return { userId: c.userId, participationId: c.participationId, experienceId: c.experienceId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01T00:00:00Z") };
}
function created(result: JoinExperienceQueueResult) {
  assert.equal(result.kind, "created");
  if (result.kind !== "created") assert.fail(JSON.stringify(result));
  return result;
}
async function snapshot() {
  const result = await fixturePool.query(`SELECT jsonb_build_object(
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM events e WHERE e.id=ANY($1::uuid[])),
    'experiences',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM experiences e WHERE e.event_id=ANY($1::uuid[])),
    'participations',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM participations p WHERE p.event_id=ANY($1::uuid[])),
    'entries',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') FROM queue_entries q WHERE q.event_id=ANY($1::uuid[])),
    'stations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM user_roles r WHERE r.event_id=ANY($1::uuid[])),
    'services',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=ANY($1::uuid[])),
    'idempotency',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[]))
    )::text AS state`, [ids.events, ids.users]);
  return result.rows[0].state as string;
}
async function blocked(input: JoinExperienceQueueInput, kind: JoinExperienceQueueResult["kind"]) {
  const before = await snapshot();
  assert.equal((await service.joinExperienceQueue(input)).kind, kind);
  assert.equal(await snapshot(), before, "Bloqueio não deixa reserva, contador, ponteiro ou entrada.");
}
async function waitForLock(applicationName = appName, expected?: { waiterPid: number; blockerPid: number }) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await fixturePool.query(`SELECT pid FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND state='active'
        AND ($2::int IS NULL OR pid=$2)
        AND ($3::int IS NULL OR $3=ANY(pg_blocking_pids(pid)))`,
    [applicationName, expected?.waiterPid ?? null, expected?.blockerPid ?? null]);
    if (result.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Não foi observada espera real por lock PostgreSQL: ${JSON.stringify(expected ?? applicationName)}.`);
}
async function beginLock(query: string, values: string[]): Promise<PoolClient> {
  const c = await fixturePool.connect();
  try { await c.query("BEGIN"); await c.query(query, values); return c; }
  catch (error) { await c.query("ROLLBACK"); c.release(); throw error; }
}
function holdBeforeCommit() {
  let signal!: (pid: number) => void; let reject!: (error: unknown) => void; let release!: () => void;
  const reached = new Promise<number>((resolve, no) => { signal = resolve; reject = no; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const db = {
    transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) =>
      database.transaction(async tx => {
        try {
          const result = await callback(tx);
          const identity = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
          signal(identity.rows[0].pid);
          await gate;
          return result;
        }
        catch (error) { reject(error); throw error; }
      }, config),
  } as typeof database;
  return { service: makeService(db), reached, release };
}

/** Mantém o primeiro efeito sem commit até observar o segundo PID bloqueado por ele. */
async function overlapJoins(firstInput: JoinExperienceQueueInput, secondInput: JoinExperienceQueueInput) {
  const secondClient = await servicePool.connect();
  const hold = holdBeforeCommit();
  let first: Promise<JoinExperienceQueueResult> | undefined;
  let second: Promise<JoinExperienceQueueResult> | undefined;
  try {
    const identity = await secondClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const waiterPid = identity.rows[0].pid;
    first = hold.service.joinExperienceQueue(firstInput);
    first.catch(() => undefined);
    const blockerPid = await hold.reached;
    assert.notEqual(waiterPid, blockerPid, "As duas operações precisam usar backends independentes.");
    second = makeService(drizzle(secondClient, { schema })).joinExperienceQueue(secondInput);
    second.catch(() => undefined);
    // Se a segunda terminar sem aguardar, esta verificação falha em vez de aceitar execução serial.
    await waitForLock(appName, { waiterPid, blockerPid });
    hold.release();
    return await Promise.all([first, second]);
  } finally {
    hold.release();
    // Drenar as operações antes de devolver o cliente e antes da limpeza de fixtures,
    // inclusive quando a observação da espera ou uma das operações falhar.
    await Promise.allSettled([first, second].filter((p): p is Promise<JoinExperienceQueueResult> => p !== undefined));
    secondClient.release();
  }
}

async function assertSingleJoin(c: Context, request: JoinExperienceQueueInput, entryId: string, rejectedKey?: string, unusedExperience?: string) {
  const result = await fixturePool.query(`SELECT p.current_queue_entry_id,
    (SELECT count(*)::int FROM queue_entries q WHERE q.participation_id=p.id) AS entries,
    (SELECT count(*)::int FROM queue_entries q WHERE q.participation_id=p.id AND q.status IN ('waiting','called')) AS current_entries,
    e.last_queue_order::text,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=p.user_id AND i.operation='join_experience_queue') AS intents,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=p.user_id AND i.idempotency_key=$2
      AND i.operation='join_experience_queue' AND i.status='completed' AND i.result_reference=p.current_queue_entry_id) AS completed,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=p.user_id AND i.idempotency_key=$3
      AND i.operation='join_experience_queue') AS rejected_intents
    FROM participations p JOIN experiences e ON e.id=$4 WHERE p.id=$1`,
  [c.participationId, request.idempotencyKey, rejectedKey ?? null, c.experienceId]);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { current_queue_entry_id: entryId,
    entries: 1, current_entries: 1, last_queue_order: (baseOrder+1n).toString(), intents: 1, completed: 1, rejected_intents: 0 });
  if (unusedExperience) {
    const other = await fixturePool.query(`SELECT last_queue_order::text,
      (SELECT count(*)::int FROM queue_entries WHERE experience_id=$1) AS entries FROM experiences WHERE id=$1`, [unusedExperience]);
    assert.deepEqual(other.rows[0], { last_queue_order: baseOrder.toString(), entries: 0 });
  }
}

test("E07.1 ingresso válido preserva bigint, ponteiro e resposta idempotente no mesmo commit", async () => {
  const c = await context(); const request = intent(c);
  const result = created(await service.joinExperienceQueue(request));
  assert.equal(result.queueOrder, (baseOrder + 1n).toString());
  assert.equal(result.status, "waiting"); assert.ok(Number.isFinite(result.enteredAt.getTime()));
  const persisted = await fixturePool.query(`SELECT q.*,p.current_queue_entry_id,e.last_queue_order::text,
    i.result_reference,i.result_payload,i.status AS idem_status FROM queue_entries q
    JOIN participations p ON p.id=q.participation_id JOIN experiences e ON e.id=q.experience_id
    JOIN idempotency_operations i ON i.actor_user_id=p.user_id AND i.idempotency_key=$2 WHERE q.id=$1`, [result.queueEntryId, request.idempotencyKey]);
  assert.equal(persisted.rows.length, 1); const row = persisted.rows[0];
  assert.equal(row.current_queue_entry_id, result.queueEntryId); assert.equal(row.queue_order, result.queueOrder);
  assert.equal(row.last_queue_order, result.queueOrder); assert.equal(row.result_reference, result.queueEntryId);
  assert.equal(row.result_payload.queueOrder, result.queueOrder); assert.equal(row.idem_status, "completed");
  assert.deepEqual(row.entered_at, result.enteredAt);
});

test("E07.1 experiências têm contadores independentes; várias estações compartilham uma fila", async () => {
  const c = await context(); await station(c.experienceId);
  const secondExperience = await experience(c.eventId); await station(secondExperience);
  const second = await participant(c.eventId); const third = await participant(c.eventId);
  const a = created(await service.joinExperienceQueue(intent(c)));
  const b = created(await service.joinExperienceQueue(intent({ ...second, experienceId: c.experienceId })));
  const other = created(await service.joinExperienceQueue(intent({ ...third, experienceId: secondExperience })));
  assert.equal(BigInt(b.queueOrder), BigInt(a.queueOrder) + 1n);
  assert.equal(other.queueOrder, a.queueOrder);
  await station(c.experienceId);
  const fourth = await participant(c.eventId);
  const d = created(await service.joinExperienceQueue(intent({ ...fourth, experienceId: c.experienceId })));
  assert.equal(BigInt(d.queueOrder), BigInt(b.queueOrder) + 1n);
  const count = await fixturePool.query("SELECT count(*)::int AS n FROM queue_entries WHERE experience_id=$1", [c.experienceId]);
  assert.equal(count.rows[0].n, 3);
});

test("E07.1 FIFO concorrente em conexões independentes segue serialização da experiência", async () => {
  const c = await context(); const hold = holdBeforeCommit();
  const first = hold.service.joinExperienceQueue(intent(c));
  first.catch(() => undefined);
  const people = await Promise.all(Array.from({ length: 4 }, () => participant(c.eventId)));
  let others: Promise<JoinExperienceQueueResult[]> | undefined;
  try {
    await hold.reached;
    others = Promise.all(people.map(p => service.joinExperienceQueue(intent({ ...p, experienceId: c.experienceId }))));
    others.catch(() => undefined); await waitForLock();
  } finally { hold.release(); }
  const winner = created(await first);
  const rest = (await others!).map(created);
  const orders = [winner, ...rest].map(r => BigInt(r.queueOrder)).sort((a,b) => a < b ? -1 : 1);
  assert.deepEqual(orders, Array.from({ length: 5 }, (_,i) => baseOrder + BigInt(i + 1)));
  assert.equal(BigInt(winner.queueOrder), orders[0]);
});

test("E07.1 duplo clique concorrente e retry retornam uma entrada e um incremento", async () => {
  const c = await context(); const request = intent(c);
  const [a, b] = await overlapJoins(request, request);
  assert.equal(a.kind, "created"); assert.equal(b.kind, "replay");
  assert.deepEqual({ ...a, kind: "same" }, { ...b, kind: "same" });
  await assertSingleJoin(c, request, created(a).queueEntryId);
  const before = await snapshot(); assert.equal((await service.joinExperienceQueue(request)).kind, "replay");
  assert.equal(await snapshot(), before);
  const other = await experience(c.eventId); await station(other);
  await blocked({ ...request, experienceId: other }, "request_conflict");
});

test("E07.1 chaves diferentes concorrentes na mesma participação não criam segunda fila", async () => {
  for (const differentExperience of [false, true]) {
    const c = await context(); const other = await experience(c.eventId); await station(other);
    const firstInput = intent(c);
    const secondInput = intent({ ...c, experienceId: differentExperience ? other : c.experienceId });
    const [first, second] = await overlapJoins(firstInput, secondInput);
    const entry = created(first); assert.equal(second.kind, "queue_occupied");
    await assertSingleJoin(c, firstInput, entry.queueEntryId, secondInput.idempotencyKey, other);
  }
});

test("E07.1 entrada waiting ou called bloqueia qualquer experiência sem gravações", async () => {
  for (const status of ["waiting", "called"]) {
    const c = await context(); const other = await experience(c.eventId); await station(other);
    const entry = created(await service.joinExperienceQueue(intent(c)));
    if (status === "called") await fixturePool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [entry.queueEntryId]);
    await blocked(intent({ ...c, experienceId: other }), "queue_occupied");
    await blocked(intent(c), "queue_occupied");
  }
});

test("E07.1 participação externa/terminal, inexistente ou alheia não permite ingresso", async () => {
  const c = await context();
  for (const status of ["waiting", "finished", "canceled"] as const) {
    const p = await participant(c.eventId, status);
    await blocked(intent({ ...p, experienceId: c.experienceId }), "participation_not_active");
  }
  await blocked({ ...intent(c), participationId: randomUUID() }, "access_denied");
  const other = await user(); await blocked({ ...intent(c), userId: other }, "access_denied");
});

test("E07.1 experiência inexistente ou de outro evento é negada sem revelar filas", async () => {
  const c = await context(); const other = await context();
  await blocked({ ...intent(c), experienceId: randomUUID() }, "access_denied");
  await blocked({ ...intent(c), experienceId: other.experienceId }, "access_denied");
});

test("E07.1 fila pausada e perda de capacidade individual preservam entradas existentes", async () => {
  const c = await context(); const existing = created(await service.joinExperienceQueue(intent(c)));
  const p = await participant(c.eventId);
  await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
  await blocked(intent({ ...p, experienceId: c.experienceId }), "queue_closed");
  await fixturePool.query("UPDATE experiences SET queue_accepting_entries=true WHERE id=$1", [c.experienceId]);
  const other = await experience(c.eventId); await station(other);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  await blocked(intent({ ...p, experienceId: c.experienceId }), "experience_unavailable");
  const entry = await fixturePool.query("SELECT status FROM queue_entries WHERE id=$1", [existing.queueEntryId]);
  assert.equal(entry.rows[0].status, "waiting");
  created(await service.joinExperienceQueue(intent({ ...p, experienceId: other })));
});

test("E07.1 sem capacidade global, Staff revogado/inativo/não verificado/de outro evento", async () => {
  for (const mode of ["stations", "revoked", "inactive", "unverified", "other_event"]) {
    const c = await context();
    if (mode === "stations") await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
    if (mode === "revoked") await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
    if (mode === "inactive") await fixturePool.query("UPDATE users SET is_active=false WHERE id=$1", [c.staffId]);
    if (mode === "unverified") await fixturePool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [c.staffId]);
    if (mode === "other_event") {
      const other = await context();
      await fixturePool.query("UPDATE user_roles SET event_id=$2 WHERE id=$1", [c.roleId, other.eventId]);
    }
    await blocked(intent(c), "event_unavailable");
  }
});

test("E07.1 início, configuração, corte oficial, administrativo e estado operacional", async () => {
  for (const mode of ["not_started", "official", "admin", "closing", "closed", "configuration"]) {
    const c = await context();
    if (mode === "not_started") await fixturePool.query(`UPDATE events SET starts_at=clock_timestamp()+interval '1 hour',
      official_ends_at=clock_timestamp()+interval '2 hours',operational_deadline_at=clock_timestamp()+interval '150 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "official") await fixturePool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 second',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
    if (mode === "admin") await fixturePool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',
      admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "closing" || mode === "closed") await fixturePool.query("UPDATE events SET status=$2 WHERE id=$1", [c.eventId, mode]);
    if (mode === "configuration") await fixturePool.query("UPDATE events SET name=' ' WHERE id=$1", [c.eventId]);
    await blocked(intent(c), mode === "configuration" ? "event_unavailable" : "event_closed");
  }
});

test("E07.1 corte atingido DURANTE espera na experiência usa clock_timestamp após lock", async () => {
  const c = await context();
  await fixturePool.query("UPDATE events SET official_ends_at=clock_timestamp()+interval '1 second',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
  const before = await snapshot(); const lock = await beginLock("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
  const pending = service.joinExperienceQueue(intent(c)); pending.catch(() => undefined);
  try {
    await waitForLock();
    await fixturePool.query("SELECT pg_sleep(greatest(0,EXTRACT(EPOCH FROM official_ends_at-clock_timestamp()))::double precision+0.05) FROM events WHERE id=$1", [c.eventId]);
  } finally { await lock.query("ROLLBACK"); lock.release(); }
  assert.equal((await pending).kind, "event_closed"); assert.equal(await snapshot(), before);
});

test("E07.1 capacidade removida durante espera é reavaliada após commit concorrente", async () => {
  for (const resource of ["station", "role", "staff_user"]) {
    const c = await context(); const other = await experience(c.eventId); await station(other);
    const query = resource === "station" ? "SELECT id FROM stations WHERE id=$1 FOR UPDATE"
      : resource === "role" ? "SELECT id FROM user_roles WHERE id=$1 FOR UPDATE" : "SELECT id FROM users WHERE id=$1 FOR UPDATE";
    const lock = await beginLock(query, [resource === "station" ? c.stationId : resource === "role" ? c.roleId : c.staffId]);
    const pending = service.joinExperienceQueue(intent(c)); pending.catch(() => undefined);
    try {
      await waitForLock();
      if (resource === "station") await lock.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
      if (resource === "role") await lock.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
      if (resource === "staff_user") await lock.query("UPDATE users SET is_active=false WHERE id=$1", [c.staffId]);
      await lock.query("COMMIT");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    const result = await pending;
    assert.equal(result.kind, resource === "station" ? "experience_unavailable" : "event_unavailable");
    const before = await snapshot(); await blocked(intent(c), result.kind); assert.equal(await snapshot(), before);
    const check = await fixturePool.query("SELECT last_queue_order::text FROM experiences WHERE id=$1", [c.experienceId]);
    assert.equal(check.rows[0].last_queue_order, baseOrder.toString());
  }
});

test("E07.1 experiências distintas avançam sem lock exclusivo global no evento", async () => {
  const c = await context(); const other = await experience(c.eventId); await station(other); const p = await participant(c.eventId);
  const hold = holdBeforeCommit(); const pending = hold.service.joinExperienceQueue(intent(c)); pending.catch(() => undefined);
  let independent: Promise<JoinExperienceQueueResult> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await hold.reached;
    independent = service.joinExperienceQueue(intent({ ...p, experienceId: other }));
    independent.catch(() => undefined);
    const result = await Promise.race([independent, new Promise<never>((_,reject) => {
      timer = setTimeout(() => reject(new Error("Experiência independente bloqueada pelo evento.")), 3000);
    })]);
    created(result);
  } finally { if (timer) clearTimeout(timer); hold.release(); await pending; if (independent) await independent; }
});

test("E07.1 locks de capacidade seguram updates até o ingresso confirmar, sem proibir revogação", async () => {
  for (const resource of ["station", "role", "staff_user"]) {
    const c = await context(); const hold = holdBeforeCommit();
    const pending = hold.service.joinExperienceQueue(intent(c)); pending.catch(() => undefined);
    const writer = await fixturePool.connect(); let changing: Promise<QueryResult> | undefined;
    try {
      await hold.reached;
      const query = resource === "station" ? "UPDATE stations SET availability='unavailable' WHERE id=$1"
        : resource === "role" ? "UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1"
          : "UPDATE users SET is_active=false WHERE id=$1";
      changing = writer.query(query, [resource === "station" ? c.stationId : resource === "role" ? c.roleId : c.staffId]);
      changing.catch(() => undefined);
      await waitForLock(`${appName}-fixtures`);
    } finally { hold.release(); await pending; if (changing) await changing; writer.release(); }
    const result = created(await pending);
    const q = await fixturePool.query("SELECT status FROM queue_entries WHERE id=$1", [result.queueEntryId]);
    assert.equal(q.rows[0].status, "waiting");
  }
});

test("E07.1 falha intermediária reverte contador, fila, ponteiro e reserva no PostgreSQL", async () => {
  for (const stage of ["counter", "entry", "all_writes"] as const) {
    const c = await context(); const request = intent(c); const before = await snapshot();
    let reached: typeof stage | undefined;
    const marker = new Error(`E071_FAILURE_${stage}`);
    async function inject(tx: DatabaseTransactionExecutor) {
      const state = await tx.execute<{
        order: string; entries: number; pointer: string | null; entryId: string | null;
        status: string; reference: string | null;
      }>(sql`SELECT e.last_queue_order::text AS "order", p.current_queue_entry_id AS pointer,
        (SELECT count(*)::int FROM queue_entries q WHERE q.participation_id=p.id) AS entries,
        (SELECT q.id FROM queue_entries q WHERE q.participation_id=p.id) AS "entryId",
        i.status, i.result_reference AS reference
        FROM experiences e JOIN participations p ON p.id=${c.participationId}
        JOIN idempotency_operations i ON i.actor_user_id=p.user_id
          AND i.operation='join_experience_queue' AND i.idempotency_key=${request.idempotencyKey}
        WHERE e.id=${c.experienceId}`);
      assert.equal(state.rows.length, 1);
      const row = state.rows[0];
      assert.equal(row.order, (baseOrder+1n).toString());
      assert.equal(row.entries, stage === "counter" ? 0 : 1);
      if (stage === "counter") {
        assert.equal(row.pointer, null); assert.equal(row.entryId, null);
      } else {
        assert.equal(typeof row.entryId, "string"); assert.equal(row.pointer, row.entryId);
      }
      assert.equal(row.status, stage === "all_writes" ? "completed" : "in_progress");
      assert.equal(row.reference, stage === "all_writes" ? row.entryId : null);
      assert.equal(reached, undefined, "Uma fase não pode ser injetada duas vezes.");
      reached = stage;
      throw marker;
    }
    const db = {
      transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) =>
        database.transaction(async tx => {
          const proxy = new Proxy(tx, { get(target, key) {
            if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
              const result = await target.execute(query);
              // Verificar o estado real no tx antes de lançar o marcador exato.
              // entry é posterior ao INSERT e à escrita do ponteiro, antes da conclusão idempotente.
              if (stage === "counter" && result.rows.some(r => "queueOrder" in r)) await inject(target);
              if (stage === "entry" && result.rowCount === 1 && !result.rows.length) await inject(target);
              return result;
            };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          } });
          await callback(proxy);
          if (stage === "all_writes") await inject(tx);
          throw new Error(`Fase esperada não foi alcançada: ${stage}`);
        }, config),
    } as unknown as typeof database;
    await assert.rejects(makeService(db).joinExperienceQueue(request), (error: Error) => {
      let cause: unknown = error;
      while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(reached, stage, "O teste precisa alcançar sua própria fase de injeção.");
      assert.equal(cause, marker, "Somente o marcador exato desta fase pode satisfazer o teste.");
      return true;
    });
    assert.equal(reached, stage);
    assert.equal(await snapshot(), before);
    const retry = created(await service.joinExperienceQueue(request));
    await assertSingleJoin(c, request, retry.queueEntryId);
  }
});

test("E07.1 corte oficial após avaliação favorável é rejeitado pelo UPDATE decisivo real", async () => {
  const c = await context(); const request = intent(c); const before = await snapshot();
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { EventsService } = await import("../../src/events/events.service");
  const events = new EventsService(database);
  const evaluate = events.evaluateEventAvailabilityById.bind(events);
  let favorableEvaluation = false; let crossedCutoff = false;
  events.evaluateEventAvailabilityById = async (eventId, at, executor) => {
    assert.equal(eventId, c.eventId); assert.ok(executor); assert.notEqual(executor, database);
    // Configurar APENAS a fixture na conexão corrente após os locks, antes da
    // avaliação real. O corte é posterior ao instante at recebido do PostgreSQL,
    // independentemente da demora de agendamento no Node. Esta alteração também
    // deve sumir no rollback; não simula um escritor Admin atravessando o lock do evento.
    const cutoff = new Date(at.getTime()+250);
    await executor.execute(sql`UPDATE events SET official_ends_at=${cutoff},
      operational_deadline_at=${new Date(cutoff.getTime()+30*60_000)} WHERE id=${eventId}`);
    const availability = await evaluate(eventId, at, executor);
    assert.ok(availability.eventExists && availability.eventAcceptingNewEntries,
      "A avaliação preliminar real precisa permitir ingresso no instante at.");
    favorableEvaluation = true;
    // Esperar o prazo do próprio banco, não um atraso fixo usado como prova de corrida.
    await executor.execute(sql`SELECT pg_sleep(GREATEST(0,
      EXTRACT(EPOCH FROM official_ends_at-clock_timestamp()))::double precision+0.001)
      FROM events WHERE id=${eventId}`);
    const clock = await executor.execute<{ crossed: boolean }>(sql`
      SELECT clock_timestamp() >= official_ends_at AS crossed FROM events WHERE id=${eventId}
    `);
    assert.equal(clock.rows[0].crossed, true);
    crossedCutoff = true;
    return availability;
  };
  const guardedService = new QueueEntryService(database, events);
  assert.deepEqual(await guardedService.joinExperienceQueue(request), { kind: "event_closed", missing: ["EVENT_ENTRY_CLOSED"] });
  assert.equal(favorableEvaluation, true); assert.equal(crossedCutoff, true);
  assert.equal(await snapshot(), before, "Inclusive o ajuste temporário da fixture e a reserva devem ser revertidos.");
  const retry = created(await service.joinExperienceQueue(request));
  await assertSingleJoin(c, request, retry.queueEntryId);
});

test("E07.1 nova intenção após encerramento histórico recebe nova ordem; retry antigo é histórico", async () => {
  const c = await context(); const request = intent(c); const original = created(await service.joinExperienceQueue(request));
  const lock = await beginLock("SELECT id FROM events WHERE id=$1 FOR SHARE", [c.eventId]);
  try {
    await lock.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
    await lock.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [c.participationId]);
    await lock.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_completed' WHERE id=$1", [original.queueEntryId]);
    await lock.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.participationId]);
    await lock.query("COMMIT");
  } finally { await lock.query("ROLLBACK"); lock.release(); }
  const next = created(await service.joinExperienceQueue(intent(c)));
  assert.notEqual(next.queueEntryId, original.queueEntryId); assert.equal(BigInt(next.queueOrder), BigInt(original.queueOrder)+1n);
  const before = await snapshot(); const replay = await service.joinExperienceQueue(request);
  assert.deepEqual({ ...replay, kind: "same" }, { ...original, kind: "same" }); assert.equal(await snapshot(), before);
});

test("E07.1 ingresso não altera outro evento/experiência/participação", async () => {
  const c = await context(); const other = await context(); const otherExperience = await experience(c.eventId);
  await station(otherExperience); const untouched = await participant(c.eventId);
  const readUntouched = async () => (await fixturePool.query(`SELECT jsonb_build_object(
    'other_event',(SELECT to_jsonb(e) FROM events e WHERE id=$1),
    'other_experience',(SELECT to_jsonb(e) FROM experiences e WHERE id=$2),
    'other_participation',(SELECT to_jsonb(p) FROM participations p WHERE id=$3))::text AS state`,
  [other.eventId, otherExperience, untouched.participationId])).rows[0].state;
  const before = await readUntouched(); created(await service.joinExperienceQueue(intent(c)));
  assert.equal(await readUntouched(), before);
});

test("E07.1 estação available ocupada continua admitindo na fila compartilhada", async () => {
  const c = await context(); const current = created(await service.joinExperienceQueue(intent(c)));
  await fixturePool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [current.queueEntryId]);
  await fixturePool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),'pending')`,
  [randomUUID(), current.queueEntryId, c.experienceId, c.stationId, c.staffId]);
  const p = await participant(c.eventId);
  const next = created(await service.joinExperienceQueue(intent({ ...p, experienceId: c.experienceId })));
  assert.equal(BigInt(next.queueOrder), BigInt(current.queueOrder)+1n);
});

test("E07.1 fechamento administrativo e fila pausada durante espera são revalidados", async () => {
  for (const mode of ["event", "experience"]) {
    const c = await context();
    const lock = await beginLock(mode === "event" ? "SELECT id FROM events WHERE id=$1 FOR UPDATE"
      : "SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [mode === "event" ? c.eventId : c.experienceId]);
    const pending = service.joinExperienceQueue(intent(c)); pending.catch(() => undefined);
    try {
      await waitForLock();
      if (mode === "event") await lock.query(`UPDATE events SET closure_mode='controlled',status='closing',
        closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1`, [c.eventId]);
      else await lock.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
      await lock.query("COMMIT");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    assert.equal((await pending).kind, mode === "event" ? "event_closed" : "queue_closed");
    const check = await fixturePool.query(`SELECT e.last_queue_order::text,
      (SELECT count(*)::int FROM queue_entries q WHERE q.experience_id=e.id) AS entries,
      (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=$2) AS intents
      FROM experiences e WHERE e.id=$1`, [c.experienceId, c.userId]);
    assert.deepEqual(check.rows[0], { last_queue_order: baseOrder.toString(), entries: 0, intents: 0 });
  }
});
