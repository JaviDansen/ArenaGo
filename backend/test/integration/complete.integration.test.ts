import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { CompleteService } from "../../src/events/complete.service";
import type { CompleteServiceInput, CompleteServiceResult } from "../../src/events/complete.types";
import type { CallNextService } from "../../src/events/call-next.service";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Mesmo preflight E07.4, antes de configuração/serviços. Nunca carregar arquivos .env.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), u = new URL(value);
  if (u.hostname !== "127.0.0.1" || u.port !== "55432" || u.pathname !== "/arenago_events_test"
    || u.search || u.hash || !u.username) throw new Error(`${name}: destino local explícito obrigatório, sem parâmetros.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
const config = { connectionString: urls[2], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000, lock_timeout: 8000 };
const servicePool = new Pool(config), fixturePool = new Pool(config);
const database = drizzle(servicePool, { schema });
type Database = NodePgDatabase<typeof schema>;
let makeComplete: (db: Database) => CompleteService;
let makeCall: (db: Database) => CallNextService;
let makeWithdrawal: (db: Database) => QueueWithdrawalService;
let completion: CompleteService, caller: CallNextService, joining: QueueEntryService, withdrawal: QueueWithdrawalService;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;

before(async () => {
  assert.equal((await fixturePool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { CompleteService } = await import("../../src/events/complete.service");
  const { CallNextService } = await import("../../src/events/call-next.service");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { QueueWithdrawalService } = await import("../../src/events/queue-withdrawal.service");
  const { EventsService } = await import("../../src/events/events.service");
  makeComplete = db => new CompleteService(db); makeCall = db => new CallNextService(db);
  makeWithdrawal = db => new QueueWithdrawalService(db);
  completion = makeComplete(database); caller = makeCall(database); withdrawal = makeWithdrawal(database);
  joining = new QueueEntryService(database, new EventsService(database));
});
after(async () => {
  const errors: unknown[] = [];
  try {
    const c = await fixturePool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM stations s USING experiences x WHERE s.experience_id=x.id AND x.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  } catch (e) { errors.push(e); }
  for (const result of await Promise.allSettled([servicePool.end(), fixturePool.end()])) if (result.status === "rejected") errors.push(result.reason);
  if (errors.length) throw new AggregateError(errors, "Falha na limpeza E07.5.");
});
async function user() {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E075 privado',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  ids.users.push(id); return id;
}
async function staff(userId: string, eventId: string) {
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), userId, eventId]);
}
async function enter(p: { userId: string; participationId: string }, experienceId: string) {
  const result = await joining.joinExperienceQueue({ ...p, experienceId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
  assert.ok(result.kind === "created"); return result;
}
async function person(eventId: string, experienceId: string) {
  const userId = await user(), participationId = randomUUID();
  await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at)
    VALUES($1,$2,$3,'active',clock_timestamp(),clock_timestamp())`, [participationId, userId, eventId]);
  const entry = await enter({ userId, participationId }, experienceId);
  return { userId, participationId, queueEntryId: entry.queueEntryId, queueOrder: entry.queueOrder };
}
async function context(count = 1) {
  const eventId = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,
    status,external_queue_enabled,created_at,updated_at) VALUES($1,'E075 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E075-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const staffUserId = await user(); await staff(staffUserId, eventId);
  const experienceId = randomUUID(), stationId = randomUUID();
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E075 experiência',$3,clock_timestamp(),clock_timestamp())`, [experienceId, eventId, baseOrder.toString()]);
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E075 estação','available',clock_timestamp(),clock_timestamp())`, [stationId, experienceId]);
  const people = [];
  for (let n = 0; n < count; n++) people.push(await person(eventId, experienceId));
  const c = { eventId, staffUserId, experienceId, stationId, people };
  return { ...c, serviceSessionId: (await call(c)).id };
}
type Context = Awaited<ReturnType<typeof context>>;
async function call(c: { eventId: string; staffUserId: string; experienceId: string; stationId: string }, service = caller) {
  const result = await service.callNext({ ...c, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
  assert.ok(result.kind === "created", JSON.stringify(result)); return result.serviceSession;
}
function intent(c: Pick<Context, "eventId" | "staffUserId" | "serviceSessionId">): CompleteServiceInput {
  return { eventId: c.eventId, staffUserId: c.staffUserId, serviceSessionId: c.serviceSessionId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function exit(c: Context) {
  const p = c.people[0]; return { userId: p.userId, participationId: p.participationId, queueEntryId: p.queueEntryId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function completed(result: CompleteServiceResult) { assert.ok(result.kind === "completed", JSON.stringify(result)); return result; }
async function state(c: Context) {
  return (await fixturePool.query(`SELECT jsonb_build_object(
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
    'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=$1),
    'stations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM stations t JOIN experiences x ON x.id=t.experience_id WHERE x.event_id=$1),
    'experiences',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM experiences x WHERE x.event_id=$1),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=$2)
    )::text AS value`, [c.eventId, c.staffUserId])).rows[0].value as string;
}
async function assertCompleted(c: Context, request: CompleteServiceInput) {
  const r = (await fixturePool.query(`SELECT s.status,s.resolved_by_user_id,s.cancel_reason,
    (s.resolved_at=q.closed_at) AS same_time,q.status AS entry,q.close_reason,q.queue_order::text,
    p.status AS participation,p.current_queue_entry_id,t.availability,x.last_queue_order::text,
    (SELECT count(*)::int FROM service_sessions WHERE station_id=t.id AND status='pending') AS pending,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=$2 AND i.operation='complete_service_session'
      AND i.idempotency_key=$3 AND i.result_reference=s.id AND i.status='completed') AS intentions
    FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id
    JOIN stations t ON t.id=s.station_id JOIN experiences x ON x.id=s.experience_id WHERE s.id=$1`, [c.serviceSessionId, request.staffUserId, request.idempotencyKey])).rows[0];
  assert.equal(r.status, "completed"); assert.equal(r.resolved_by_user_id, request.staffUserId); assert.equal(r.cancel_reason, null);
  assert.equal(r.same_time, true); assert.equal(r.entry, "closed"); assert.equal(r.close_reason, "completed");
  assert.equal(r.participation, "active"); assert.equal(r.current_queue_entry_id, null); assert.equal(r.pending, 0);
  assert.equal(r.queue_order, c.people[0].queueOrder); assert.equal(r.last_queue_order, (baseOrder + BigInt(c.people.length)).toString());
  assert.equal(r.intentions, 1);
}
/** Barreira após os efeitos do escritor real, antes do commit. */
function held<T>(action: (db: Database) => Promise<T>) {
  let signal!: (pid: number) => void, reject!: (e: unknown) => void, release!: () => void;
  const reached = new Promise<number>((yes, no) => { signal = yes; reject = no; });
  const gate = new Promise<void>(yes => { release = yes; });
  const db = { transaction: <R>(callback: (tx: DatabaseTransactionExecutor) => Promise<R>, config?: Parameters<Database["transaction"]>[1]) =>
    database.transaction(async tx => {
      const result = await callback(tx);
      signal((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      await gate; return result;
    }, config) } as Database;
  const promise = action(db); promise.catch(reject); return { promise, reached, release };
}
async function waitBlocked(waiter: number, blocker: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const r = await fixturePool.query(`SELECT 1 FROM pg_stat_activity
      WHERE pid=$1 AND state='active' AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))`, [waiter, blocker]);
    if (r.rowCount) return;
    await new Promise(yes => setTimeout(yes, 20));
  }
  throw new Error("Não foi observada espera real entre os PIDs.");
}
async function race<T, U>(first: ReturnType<typeof held<T>>, second: (db: Database) => Promise<U>) {
  let c: PoolClient | undefined, pending: Promise<U> | undefined;
  try {
    const blocker = await first.reached; c = await servicePool.connect();
    const waiter = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = second(drizzle(c, { schema })); pending.catch(() => undefined);
    await waitBlocked(waiter, blocker); first.release(); return await Promise.all([first.promise, pending]);
  } finally { first.release(); await Promise.allSettled([first.promise, pending]); c?.release(); }
}
async function structuralRace(c: Context, mutation: (client: PoolClient) => Promise<unknown>,
  check: (waiterPid: number) => Promise<void> = async () => undefined) {
  const blocker = await fixturePool.connect(), waiter = await servicePool.connect();
  let pending: Promise<CompleteServiceResult> | undefined;
  try {
    await blocker.query("BEGIN"); await mutation(blocker);
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const waiterPid = (await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = makeComplete(drizzle(waiter, { schema })).complete(intent(c)); pending.catch(() => undefined);
    await waitBlocked(waiterPid, blockerPid); await check(waiterPid);
    await blocker.query("COMMIT"); return await pending;
  } finally { await blocker.query("ROLLBACK"); await Promise.allSettled([pending]); blocker.release(); waiter.release(); }
}

test("E07.5 conclusão normal fecha entrada com timestamp exato, mantém active e não autochama", async () => {
  const c = await context(2), request = intent(c);
  const result = completed(await completion.complete(request));
  assert.equal(result.serviceSession.id, c.serviceSessionId); assert.ok(result.serviceSession.resolvedAt instanceof Date);
  await assertCompleted(c, request);
  assert.equal((await fixturePool.query("SELECT status FROM queue_entries WHERE id=$1", [c.people[1].queueEntryId])).rows[0].status, "waiting");
  assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "available");
});
test("E07.5 retry sequencial/concorrente retorna uma única conclusão", async () => {
  const c = await context(), request = intent(c);
  const [a, b] = await race(held(db => makeComplete(db).complete(request)), db => makeComplete(db).complete(request));
  completed(a); assert.deepEqual(b, { ...a, kind: "replay" }); assert.deepEqual(await completion.complete(request), b);
  await assertCompleted(c, request);
});
test("E07.5 chaves diferentes concorrentes não sobrescrevem resolução vencedora", async () => {
  const c = await context(), a = intent(c), b = intent(c);
  const [first, second] = await race(held(db => makeComplete(db).complete(a)), db => makeComplete(db).complete(b));
  completed(first); assert.deepEqual(second, { kind: "service_not_pending" }); await assertCompleted(c, a);
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [c.staffUserId, b.idempotencyKey])).rows[0].n, 0);
});
test("E07.5 nega Admin isolado e Staff alheio/revogado/inativo/sem e-mail verificado", async () => {
  const c = await context(), other = await context();
  for (const mode of ["admin", "other_event", "revoked", "inactive", "unverified"]) {
    const actor = await user();
    if (mode === "admin") await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), actor]);
    else {
      await staff(actor, mode === "other_event" ? other.eventId : c.eventId);
      if (mode === "revoked") await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [actor]);
      if (mode === "inactive") await fixturePool.query("UPDATE users SET is_active=false WHERE id=$1", [actor]);
      if (mode === "unverified") await fixturePool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [actor]);
    }
    const before = await state(c);
    assert.deepEqual(await completion.complete({ ...intent(c), staffUserId: actor }), { kind: "staff_event_forbidden" });
    assert.equal(await state(c), before);
    assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1", [actor])).rows[0].n, 0);
  }
});
test("E07.5 Admin com concessão Staff vigente pode concluir", async () => {
  const c = await context();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), c.staffUserId]);
  completed(await completion.complete(intent(c)));
});
test("E07.5 sessão inexistente/de outro evento não altera domínio nem revela ao não autorizado", async () => {
  const c = await context(), other = await context(), before = await state(c);
  for (const id of [randomUUID(), other.serviceSessionId]) assert.deepEqual(await completion.complete({ ...intent(c), serviceSessionId: id }), { kind: "service_not_found" });
  const actor = await user();
  assert.deepEqual(await completion.complete({ ...intent(c), staffUserId: actor, serviceSessionId: randomUUID() }), { kind: "staff_event_forbidden" });
  assert.equal(await state(c), before);
});
test("E07.5 completed/absent/canceled nunca são concluídos por uma nova intenção", async () => {
  for (const status of ["completed", "absent", "canceled"]) {
    const c = await context();
    if (status === "completed") completed(await completion.complete(intent(c)));
    else if (status === "canceled") assert.equal((await withdrawal.withdrawExperienceQueue(exit(c))).kind, "withdrawn");
    else {
      // Apenas fixture da ausência futura: após o corte de entradas, sem reentrada.
      await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [c.eventId]);
      const client = await fixturePool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM events WHERE id=$1 FOR SHARE", [c.eventId]);
        await client.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
        await client.query("SELECT id FROM stations WHERE id=$1 FOR UPDATE", [c.stationId]);
        await client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [c.people[0].participationId]);
        await client.query("SELECT id FROM queue_entries WHERE id=$1 FOR UPDATE", [c.people[0].queueEntryId]);
        await client.query("UPDATE service_sessions SET status='absent',resolved_at=clock_timestamp(),resolved_by_user_id=$2 WHERE id=$1 AND status='pending'", [c.serviceSessionId, c.staffUserId]);
        await client.query("UPDATE queue_entries q SET status='closed',closed_at=s.resolved_at,close_reason='absent' FROM service_sessions s WHERE q.id=s.queue_entry_id AND s.id=$1", [c.serviceSessionId]);
        await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.people[0].participationId]);
        await client.query("COMMIT");
      } finally { await client.query("ROLLBACK"); client.release(); }
    }
    const before = await state(c);
    assert.deepEqual(await completion.complete(intent(c)), { kind: "service_not_pending" }); assert.equal(await state(c), before);
  }
});
test("E07.5 pending com entrada/participação/ponteiro incoerentes falha sem efeito", async () => {
  const { CompleteServiceIntegrityError } = await import("../../src/events/complete.service");
  for (const mode of ["entry", "pointer", "person"]) {
    const c = await context();
    if (mode === "entry") await fixturePool.query("UPDATE queue_entries SET status='waiting' WHERE id=$1", [c.people[0].queueEntryId]);
    if (mode === "pointer") await fixturePool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.people[0].participationId]);
    if (mode === "person") await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture' WHERE id=$1", [c.people[0].participationId]);
    const before = await state(c);
    await assert.rejects(completion.complete(intent(c)), CompleteServiceIntegrityError); assert.equal(await state(c), before);
  }
});
test("E07.5 corte operacional/admin, imediato, closed e antes do início bloqueiam pending", async () => {
  for (const mode of ["operational", "admin", "immediate", "closed", "not_started"]) {
    const c = await context();
    if (mode === "operational") await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '2 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "immediate") await fixturePool.query("UPDATE events SET closure_mode='immediate',closure_requested_at=statement_timestamp(),admin_deadline_at=statement_timestamp() WHERE id=$1", [c.eventId]);
    if (mode === "closed") await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    if (mode === "not_started") await fixturePool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes' WHERE id=$1", [c.eventId]);
    const before = await state(c);
    assert.deepEqual(await completion.complete(intent(c)), { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  }
});
test("E07.5 conclui na janela residual com fila pausada sem alterar disponibilidade", async () => {
  const c = await context();
  await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes',
    status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1`, [c.eventId]);
  await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  const request = intent(c); completed(await completion.complete(request)); await assertCompleted(c, request);
  assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "unavailable");
});
for (const administrative of [false, true]) {
  test(`E07.5 prazo ${administrative ? "administrativo" : "operacional"} alcançado durante lock da sessão impede conclusão`, async () => {
    const c = await context();
    if (administrative) await fixturePool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '2 seconds' WHERE id=$1`, [c.eventId]);
    else await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '2 seconds' WHERE id=$1`, [c.eventId]);
    const before = await state(c), column = administrative ? "admin_deadline_at" : "operational_deadline_at";
    const result = await structuralRace(c, client => client.query("SELECT id FROM service_sessions WHERE id=$1 FOR UPDATE", [c.serviceSessionId]), async pid => {
      const start = await fixturePool.query(`SELECT a.xact_start < e.${column} AS before_cut FROM pg_stat_activity a, events e WHERE a.pid=$1 AND e.id=$2`, [pid, c.eventId]);
      assert.equal(start.rows[0].before_cut, true);
      const until = Date.now() + 4000;
      while (true) {
        const r = await fixturePool.query(`SELECT clock_timestamp() >= ${column} AS ended FROM events WHERE id=$1`, [c.eventId]);
        if (r.rows[0].ended) break;
        assert.ok(Date.now() < until, "Prazo DB não alcançado."); await new Promise(yes => setTimeout(yes, 20));
      }
    });
    assert.deepEqual(result, { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  });
}
test("E07.5 encerramento/revogação concorrentes são revalidados após espera", async () => {
  for (const mode of ["closed", "revoked", "inactive"]) {
    const c = await context();
    const result = await structuralRace(c, client => mode === "closed"
      ? client.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId])
      : mode === "revoked" ? client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId])
        : client.query("UPDATE users SET is_active=false WHERE id=$1", [c.staffUserId]));
    assert.deepEqual(result, { kind: mode === "closed" ? "event_operation_ended" : "staff_event_forbidden" });
    assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0].status, "pending");
  }
});
test("E07.5 conclusão vence E07.3: desistência não cancela completed", async () => {
  const c = await context(), request = intent(c);
  const [a, b] = await race(held(db => makeComplete(db).complete(request)), db => makeWithdrawal(db).withdrawExperienceQueue(exit(c)));
  completed(a); assert.deepEqual(b, { kind: "entry_not_current" }); await assertCompleted(c, request);
});
test("E07.5 E07.3 vence: canceled não pode virar completed", async () => {
  const c = await context();
  const [a, b] = await race(held(db => makeWithdrawal(db).withdrawExperienceQueue(exit(c))), db => makeComplete(db).complete(intent(c)));
  assert.equal(a.kind, "withdrawn"); assert.deepEqual(b, { kind: "service_not_pending" });
  const r = (await fixturePool.query("SELECT status,cancel_reason FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0];
  assert.equal(r.status, "canceled"); assert.equal(r.cancel_reason, "participant_queue_withdrawal");
});
test("E07.5 libera estação para E07.4 concorrente sem alterar conclusão anterior", async () => {
  const c = await context(2), request = intent(c);
  const [a, b] = await race(held(db => makeComplete(db).complete(request)), db => call(c, makeCall(db)));
  completed(a); assert.equal(b.queueEntryId, c.people[1].queueEntryId);
  const before = await state(c); assert.equal((await completion.complete(request)).kind, "replay"); assert.equal(await state(c), before);
  assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE id=$1", [b.id])).rows[0].status, "pending");
});
test("E07.5 nova E07.1 mantém FIFO e replay antigo preserva ponteiro/atendimento posteriores", async () => {
  const c = await context(2), request = intent(c), original = completed(await completion.complete(request));
  const old = (await fixturePool.query("SELECT to_jsonb(s)::text AS value FROM service_sessions s WHERE id=$1", [c.serviceSessionId])).rows[0].value;
  const next = await enter(c.people[0], c.experienceId);
  assert.equal(next.queueOrder, (baseOrder + 3n).toString());
  const second = await call(c); assert.equal(second.queueEntryId, c.people[1].queueEntryId);
  completed(await completion.complete({ ...intent(c), serviceSessionId: second.id }));
  const third = await call(c); assert.equal(third.queueEntryId, next.queueEntryId);
  const before = await state(c);
  assert.deepEqual(await completion.complete(request), { ...original, kind: "replay" }); assert.equal(await state(c), before);
  assert.equal((await fixturePool.query("SELECT to_jsonb(s)::text AS value FROM service_sessions s WHERE id=$1", [c.serviceSessionId])).rows[0].value, old);
  assert.deepEqual(await completion.complete({ ...request, serviceSessionId: third.id }), { kind: "request_conflict" });
  assert.equal((await fixturePool.query("SELECT current_queue_entry_id FROM participations WHERE id=$1", [c.people[0].participationId])).rows[0].current_queue_entry_id, next.queueEntryId);
});
test("E07.5 fingerprint inclui evento e reserva in_progress não resolve sessão", async () => {
  const c = await context(), other = await context(), request = intent(c);
  await staff(c.staffUserId, other.eventId); completed(await completion.complete(request));
  const before = await state(other);
  assert.deepEqual(await completion.complete({ ...request, eventId: other.eventId, serviceSessionId: other.serviceSessionId }), { kind: "request_conflict" });
  const { createCompleteServiceFingerprint } = await import("../../src/events/complete.service");
  const progress = intent(other);
  await fixturePool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,'complete_service_session',$3,$4,'in_progress',clock_timestamp(),$5)`, [randomUUID(), other.staffUserId, progress.idempotencyKey,
    createCompleteServiceFingerprint(other.eventId, other.serviceSessionId), progress.expiresAt]);
  assert.deepEqual(await completion.complete(progress), { kind: "in_progress" });
  // A única diferença esperada é a reserva explicitamente criada pela fixture.
  await fixturePool.query("DELETE FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [other.staffUserId, progress.idempotencyKey]);
  assert.equal(await state(other), before);
});
test("E07.5 replay após evento/participação encerrados exige autorização atual", async () => {
  const c = await context(), request = intent(c), original = completed(await completion.complete(request));
  await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
  await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture' WHERE id=$1", [c.people[0].participationId]);
  const before = await state(c);
  assert.deepEqual(await completion.complete(request), { ...original, kind: "replay" }); assert.equal(await state(c), before);
  await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId]);
  assert.deepEqual(await completion.complete(request), { kind: "staff_event_forbidden" });
});
test("E07.5 falhas após resolver/fechar/limpar/concluir idempotência revertem tudo e permitem retry", async () => {
  for (const stage of ["resolve", "close", "clear", "complete"]) {
    const c = await context(), request = intent(c), before = await state(c), marker = new Error(`E075_AFTER_${stage}`);
    let reached = false;
    const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
      database.transaction(async tx => {
        const verifyPartial = async () => {
          const r = (await tx.execute<{ status: string; entry: string; pointer: string | null }>(sql`SELECT s.status,q.status AS entry,p.current_queue_entry_id AS pointer
            FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id WHERE s.id=${c.serviceSessionId}`)).rows[0];
          assert.equal(r.status, "completed"); assert.equal(r.entry, stage === "resolve" ? "called" : "closed");
          assert.equal(r.pointer, stage === "clear" || stage === "complete" ? null : c.people[0].queueEntryId);
          reached = true; throw marker;
        };
        const proxy = new Proxy(tx, { get(target, key) {
          if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await target.execute(query);
            if (result.rows.length && ((stage === "resolve" && "resolvedAtMs" in result.rows[0])
              || (stage === "close" && result.rows[0].id === c.people[0].queueEntryId)
              || (stage === "clear" && result.rows[0].id === c.people[0].participationId))) await verifyPartial();
            return result;
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await callback(proxy);
        if (stage === "complete") {
          const r = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM idempotency_operations
            WHERE actor_user_id=${c.staffUserId} AND operation='complete_service_session' AND status='completed'`);
          assert.equal(r.rows[0].n, 1); await verifyPartial();
        }
        return result;
      }, config) } as Database;
    await assert.rejects(makeComplete(db).complete(request), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(reached, true); assert.equal(await state(c), before); completed(await completion.complete(request)); await assertCompleted(c, request);
  }
});
