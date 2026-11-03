import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { CallNextService } from "../../src/events/call-next.service";
import type { CallNextInput, CallNextResult } from "../../src/events/call-next.types";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Preflight antes de importar configuração/serviços. Nenhum fallback para .env.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]);
  const u = new URL(value);
  if (u.hostname !== "127.0.0.1" || u.port !== "55432" || u.pathname !== "/arenago_events_test"
    || u.search || u.hash || !u.username) throw new Error(`${name}: destino local explícito obrigatório, sem parâmetros.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
const config = { connectionString: urls[2], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000, lock_timeout: 8000 };
const servicePool = new Pool(config);
const fixturePool = new Pool(config);
const database = drizzle(servicePool, { schema });
type Database = NodePgDatabase<typeof schema>;
let makeCall: (db: Database) => CallNextService;
let makeWithdrawal: (db: Database) => QueueWithdrawalService;
let caller: CallNextService;
let joining: QueueEntryService;
let withdrawal: QueueWithdrawalService;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;

before(async () => {
  assert.equal((await fixturePool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { CallNextService } = await import("../../src/events/call-next.service");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { QueueWithdrawalService } = await import("../../src/events/queue-withdrawal.service");
  const { EventsService } = await import("../../src/events/events.service");
  makeCall = db => new CallNextService(db); makeWithdrawal = db => new QueueWithdrawalService(db);
  caller = makeCall(database); withdrawal = makeWithdrawal(database);
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
  if (errors.length) throw new AggregateError(errors, "Falha na limpeza E07.4.");
});

async function user() {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E074 privado',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  ids.users.push(id); return id;
}
async function staff(userId: string, eventId: string) {
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), userId, eventId]);
}
async function experience(eventId: string) {
  const experienceId = randomUUID();
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E074 experiência',$3,clock_timestamp(),clock_timestamp())`, [experienceId, eventId, baseOrder.toString()]);
  const stations: string[] = [];
  for (let n = 1; n <= 2; n++) {
    const id = randomUUID(); stations.push(id);
    await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
      VALUES($1,$2,$3,'available',clock_timestamp(),clock_timestamp())`, [id, experienceId, `Estação ${n}`]);
  }
  return { experienceId, stationId: stations[0], secondStationId: stations[1] };
}
async function person(eventId: string, experienceId: string) {
  const userId = await user(), participationId = randomUUID();
  await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at)
    VALUES($1,$2,$3,'active',clock_timestamp(),clock_timestamp())`, [participationId, userId, eventId]);
  const result = await joining.joinExperienceQueue({ userId, participationId, experienceId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
  assert.ok(result.kind === "created");
  return { userId, participationId, queueEntryId: result.queueEntryId, queueOrder: result.queueOrder };
}
async function context(count = 1) {
  const eventId = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,
    status,external_queue_enabled,created_at,updated_at) VALUES($1,'E074 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E074-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const staffUserId = await user(); await staff(staffUserId, eventId);
  const x = await experience(eventId), people = [];
  for (let n = 0; n < count; n++) people.push(await person(eventId, x.experienceId));
  return { eventId, staffUserId, ...x, people };
}
type Context = Awaited<ReturnType<typeof context>>;
function intent(c: Omit<Context, "people" | "secondStationId">): CallNextInput {
  return { staffUserId: c.staffUserId, eventId: c.eventId, experienceId: c.experienceId, stationId: c.stationId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function withdrawalIntent(p: Context["people"][number]) {
  return { userId: p.userId, participationId: p.participationId, queueEntryId: p.queueEntryId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function created(result: CallNextResult) { assert.ok(result.kind === "created", JSON.stringify(result)); return result.serviceSession; }
async function state(c: Context) {
  return (await fixturePool.query(`SELECT jsonb_build_object(
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
    'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=$1),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=$2)
    )::text AS value`, [c.eventId, c.staffUserId])).rows[0].value as string;
}
async function assertPending(c: Context, sessionId: string, entryId: string) {
  const r = (await fixturePool.query(`SELECT s.status,s.queue_entry_id,s.called_by_user_id,s.resolved_at,
    q.status AS entry,p.status AS participation,p.current_queue_entry_id,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.result_reference=s.id AND i.status='completed') AS intentions
    FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id WHERE s.id=$1`, [sessionId])).rows[0];
  assert.equal(r.status, "pending"); assert.equal(r.queue_entry_id, entryId); assert.equal(r.called_by_user_id, c.staffUserId);
  assert.equal(r.resolved_at, null); assert.equal(r.entry, "called"); assert.equal(r.participation, "active");
  assert.equal(r.current_queue_entry_id, entryId); assert.equal(r.intentions, 1);
}

/** Retém o escritor real depois de seus efeitos e antes do commit. */
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
  const promise = action(db); promise.catch(reject);
  return { promise, reached, release };
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
    await waitBlocked(waiter, blocker); first.release();
    return await Promise.all([first.promise, pending]);
  } finally { first.release(); await Promise.allSettled([first.promise, pending]); c?.release(); }
}

test("E07.4 FIFO real E07.1, bigint e atomicidade sem alterar contador/ponteiros", async () => {
  const c = await context(3);
  const a = created(await caller.callNext(intent(c)));
  const b = created(await caller.callNext({ ...intent(c), stationId: c.secondStationId }));
  assert.equal(a.queueEntryId, c.people[0].queueEntryId); assert.equal(b.queueEntryId, c.people[1].queueEntryId);
  await assertPending(c, a.id, a.queueEntryId); await assertPending(c, b.id, b.queueEntryId);
  const x = await fixturePool.query("SELECT last_queue_order::text AS value FROM experiences WHERE id=$1", [c.experienceId]);
  assert.equal(x.rows[0].value, (baseOrder + 3n).toString());
  const untouched = await fixturePool.query("SELECT status,queue_order::text FROM queue_entries WHERE id=$1", [c.people[2].queueEntryId]);
  assert.equal(untouched.rows[0].status, "waiting"); assert.equal(untouched.rows[0].queue_order, c.people[2].queueOrder);
});
test("E07.4 duas estações concorrentes chamam pessoas distintas em FIFO", async () => {
  const c = await context(2);
  const [a, b] = await race(held(db => makeCall(db).callNext(intent(c))), db => makeCall(db).callNext({ ...intent(c), stationId: c.secondStationId }));
  assert.equal(created(a).queueEntryId, c.people[0].queueEntryId); assert.equal(created(b).queueEntryId, c.people[1].queueEntryId);
  assert.notEqual(created(a).id, created(b).id);
});
test("E07.4 mesma estação concorrente com chaves diferentes só cria um pending", async () => {
  const c = await context(2);
  const [a, b] = await race(held(db => makeCall(db).callNext(intent(c))), db => makeCall(db).callNext(intent(c)));
  created(a); assert.deepEqual(b, { kind: "station_has_pending_call" });
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM service_sessions WHERE station_id=$1", [c.stationId])).rows[0].n, 1);
});
test("E07.4 retry sequencial e concorrente reproduz resposta sem segunda chamada", async () => {
  const c = await context(2), request = intent(c);
  const [a, b] = await race(held(db => makeCall(db).callNext(request)), db => makeCall(db).callNext(request));
  created(a); assert.deepEqual(b, { ...a, kind: "replay" });
  assert.deepEqual(await caller.callNext(request), b);
});
test("E07.4 reserva in_progress existente não cria atendimento", async () => {
  const c = await context(), request = intent(c);
  const { createCallNextFingerprint } = await import("../../src/events/call-next.service");
  await fixturePool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,'call_next',$3,$4,'in_progress',clock_timestamp(),$5)`, [randomUUID(), c.staffUserId, request.idempotencyKey,
    createCallNextFingerprint(c.eventId, c.experienceId, c.stationId), request.expiresAt]);
  const before = await state(c);
  assert.deepEqual(await caller.callNext(request), { kind: "in_progress" }); assert.equal(await state(c), before);
});
test("E07.4 chave em outra estação/experiência/evento conflita e ator tem namespace próprio", async () => {
  const c = await context(2), other = await context(), request = intent(c);
  created(await caller.callNext(request));
  const x = await experience(c.eventId); await staff(c.staffUserId, other.eventId);
  for (const changes of [{ stationId: c.secondStationId }, { ...x }, { eventId: other.eventId, experienceId: other.experienceId, stationId: other.stationId }]) {
    assert.deepEqual(await caller.callNext({ ...request, ...changes }), { kind: "request_conflict" });
  }
  const secondStaff = await user(); await staff(secondStaff, c.eventId);
  const b = created(await caller.callNext({ ...request, staffUserId: secondStaff, stationId: c.secondStationId }));
  assert.equal(b.queueEntryId, c.people[1].queueEntryId);
});
test("E07.4 fila vazia/estação indisponível não deixam reserva e chave pode ser reutilizada", async () => {
  const c = await context(0), request = intent(c), before = await state(c);
  assert.deepEqual(await caller.callNext(request), { kind: "queue_empty" }); assert.equal(await state(c), before);
  await person(c.eventId, c.experienceId);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  const waiting = await state(c);
  assert.deepEqual(await caller.callNext(request), { kind: "station_unavailable" }); assert.equal(await state(c), waiting);
  await fixturePool.query("UPDATE stations SET availability='available' WHERE id=$1", [c.stationId]);
  created(await caller.callNext(request));
});
test("E07.4 nega Admin isolado, Staff alheio/revogado/inativo/não verificado", async () => {
  for (const mode of ["admin", "other_event", "revoked", "inactive", "unverified"]) {
    const c = await context(), before = await state(c);
    const actor = await user();
    if (mode === "admin") await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), actor]);
    else {
      const eventId = mode === "other_event" ? (await context(0)).eventId : c.eventId;
      await staff(actor, eventId);
      if (mode === "revoked") await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [actor]);
      if (mode === "inactive") await fixturePool.query("UPDATE users SET is_active=false WHERE id=$1", [actor]);
      if (mode === "unverified") await fixturePool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [actor]);
    }
    assert.deepEqual(await caller.callNext({ ...intent(c), staffUserId: actor }), { kind: "staff_event_forbidden" });
    assert.equal(await state(c), before);
  }
});
test("E07.4 Admin também atribuído como Staff pode operar", async () => {
  const c = await context();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), c.staffUserId]);
  created(await caller.callNext(intent(c)));
});
test("E07.4 revalida vínculos de evento/experiência/estação e IDs inexistentes", async () => {
  const c = await context(), other = await context(), before = await state(c);
  for (const changes of [{ eventId: randomUUID() }, { experienceId: randomUUID() }, { stationId: randomUUID() },
    { experienceId: other.experienceId }, { stationId: other.stationId }]) {
    assert.deepEqual(await caller.callNext({ ...intent(c), ...changes }), { kind: "staff_event_forbidden" });
    assert.equal(await state(c), before);
  }
});
test("E07.4 permite espera preexistente após corte oficial e fechamento controlado com fila pausada", async () => {
  for (const controlled of [false, true]) {
    const c = await context();
    await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',
      operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [c.eventId]);
    if (controlled) await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',
      closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1`, [c.eventId]);
    await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
    assert.equal(created(await caller.callNext(intent(c))).queueEntryId, c.people[0].queueEntryId);
  }
});
test("E07.4 bloqueia antes do início, prazo operacional/admin, fechamento imediato e closed", async () => {
  for (const mode of ["not_started", "operational", "admin", "immediate", "closed"]) {
    const c = await context();
    if (mode === "not_started") await fixturePool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes' WHERE id=$1", [c.eventId]);
    if (mode === "operational") await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '2 minutes',
      operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',
      closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "immediate") await fixturePool.query(`UPDATE events SET closure_mode='immediate',
      closure_requested_at=statement_timestamp(),admin_deadline_at=statement_timestamp() WHERE id=$1`, [c.eventId]);
    if (mode === "closed") await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    const before = await state(c);
    assert.deepEqual(await caller.callNext(intent(c)), { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  }
});
test("E07.4 replay após desistência/encerramento é histórico, mas exige Staff ainda autorizado", async () => {
  const c = await context(), request = intent(c), a = await caller.callNext(request); created(a);
  assert.equal((await withdrawal.withdrawExperienceQueue(withdrawalIntent(c.people[0]))).kind, "withdrawn");
  await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  const before = await state(c);
  assert.deepEqual(await caller.callNext(request), { ...a, kind: "replay" }); assert.equal(await state(c), before);
  await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId]);
  assert.deepEqual(await caller.callNext(request), { kind: "staff_event_forbidden" });
});

test("E07.4 chamada vence E07.3: desistência cancela exatamente o pending criado", async () => {
  const c = await context(), request = intent(c), exit = withdrawalIntent(c.people[0]);
  const [a, b] = await race(held(db => makeCall(db).callNext(request)), db => makeWithdrawal(db).withdrawExperienceQueue(exit));
  const session = created(a); assert.ok(b.kind === "withdrawn"); assert.equal(b.serviceSession?.id, session.id);
  assert.equal(b.serviceSession?.status, "canceled");
  const next = await joining.joinExperienceQueue({ userId: c.people[0].userId, participationId: c.people[0].participationId,
    experienceId: c.experienceId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
  assert.ok(next.kind === "created"); const pending = created(await caller.callNext(intent(c)));
  assert.equal(pending.queueEntryId, next.queueEntryId);
  assert.equal((await withdrawal.withdrawExperienceQueue(exit)).kind, "replay");
  await assertPending(c, pending.id, next.queueEntryId);
});
test("E07.4 E07.3 vence: chamada seleciona o próximo waiting sem cancelar outra pessoa", async () => {
  const c = await context(2);
  const [a, b] = await race(held(db => makeWithdrawal(db).withdrawExperienceQueue(withdrawalIntent(c.people[0]))), db => makeCall(db).callNext(intent(c)));
  assert.equal(a.kind, "withdrawn"); const session = created(b); assert.equal(session.queueEntryId, c.people[1].queueEntryId);
  await assertPending(c, session.id, session.queueEntryId);
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM service_sessions WHERE queue_entry_id=$1", [c.people[0].queueEntryId])).rows[0].n, 0);
});
test("E07.4 experiências distintas operam sem lock exclusivo global do evento", async () => {
  const c = await context(), x = await experience(c.eventId), p = await person(c.eventId, x.experienceId);
  const first = held(db => makeCall(db).callNext(intent(c)));
  let timer: ReturnType<typeof setTimeout> | undefined, pending: Promise<CallNextResult> | undefined;
  try {
    await first.reached;
    pending = caller.callNext({ ...intent(c), ...x });
    const second = await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Outra experiência bloqueada.")), 3000); })]);
    assert.equal(created(second).queueEntryId, p.queueEntryId);
  } finally { clearTimeout(timer); first.release(); await Promise.allSettled([first.promise, pending]); }
});

/** Escritor estrutural de fixture, sem serviço Admin/disponibilidade novo. */
async function structuralRace(c: Context, mutation: (client: PoolClient) => Promise<unknown>,
  check: (pending: Promise<CallNextResult>) => Promise<void> = async () => undefined) {
  const blocker = await fixturePool.connect(), waiter = await servicePool.connect();
  let pending: Promise<CallNextResult> | undefined;
  try {
    await blocker.query("BEGIN"); await mutation(blocker);
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const waiterPid = (await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = makeCall(drizzle(waiter, { schema })).callNext(intent(c)); pending.catch(() => undefined);
    await waitBlocked(waiterPid, blockerPid); await check(pending);
    await blocker.query("COMMIT"); return await pending;
  } finally { await blocker.query("ROLLBACK"); await Promise.allSettled([pending]); blocker.release(); waiter.release(); }
}
test("E07.4 primeiro participante bloqueado é aguardado sem furar FIFO", async () => {
  const c = await context(2);
  const result = await structuralRace(c, client => client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [c.people[0].participationId]));
  assert.equal(created(result).queueEntryId, c.people[0].queueEntryId);
  assert.equal((await fixturePool.query("SELECT status FROM queue_entries WHERE id=$1", [c.people[1].queueEntryId])).rows[0].status, "waiting");
});
test("E07.4 disponibilidade e encerramento são revalidados depois da espera", async () => {
  const c = await context();
  assert.deepEqual(await structuralRace(c, client => client.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId])), { kind: "station_unavailable" });
  const d = await context();
  assert.deepEqual(await structuralRace(d, client => client.query("UPDATE events SET status='closed' WHERE id=$1", [d.eventId])), { kind: "event_operation_ended" });
});
test("E07.4 conta e concessão são revalidadas após revogação concorrente", async () => {
  for (const role of [true, false]) {
    const c = await context();
    const result = await structuralRace(c, client => role
      ? client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId])
      : client.query("UPDATE users SET is_active=false WHERE id=$1", [c.staffUserId]));
    assert.deepEqual(result, { kind: "staff_event_forbidden" });
  }
});
for (const administrative of [false, true]) {
  test(`E07.4 prazo ${administrative ? "administrativo" : "operacional"} atingido esperando participação impede INSERT`, async () => {
    const c = await context();
    if (administrative) await fixturePool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp(),
      admin_deadline_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`, [c.eventId]);
    else await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',
      operational_deadline_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`, [c.eventId]);
    const before = await state(c);
    const result = await structuralRace(c, client => client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [c.people[0].participationId]), async () => {
      // Prova de transação iniciada ANTES do corte, e relógio DB depois dele.
      const column = administrative ? sql`admin_deadline_at` : sql`operational_deadline_at`;
      const start = await database.execute<{ beforeCut: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a, events e
        WHERE e.id=${c.eventId} AND a.query LIKE '%FROM participations WHERE id=%' AND a.wait_event_type='Lock'
          AND a.xact_start < e.${column}) AS "beforeCut"`);
      assert.equal(start.rows[0].beforeCut, true);
      const until = Date.now() + 4000;
      while (true) {
        const r = await database.execute<{ ended: boolean }>(sql`SELECT clock_timestamp() >= ${column} AS ended FROM events WHERE id=${c.eventId}`);
        if (r.rows[0].ended) break;
        assert.ok(Date.now() < until, "Prazo DB não foi atingido."); await new Promise(yes => setTimeout(yes, 20));
      }
    });
    assert.deepEqual(result, { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  });
}
test("E07.4 falhas após INSERT/called/idempotência restauram estado e permitem retry", async () => {
  for (const stage of ["insert", "entry", "complete"]) {
    const c = await context(), request = intent(c), before = await state(c);
    const marker = new Error(`E074_AFTER_${stage}`); let reached = false;
    const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
      database.transaction(async tx => {
        const proxy = new Proxy(tx, { get(target, key) {
          if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await target.execute(query);
            if (result.rows.length && ((stage === "insert" && "calledAtMs" in result.rows[0]) || (stage === "entry" && result.rows[0].id === c.people[0].queueEntryId))) {
              reached = true; throw marker;
            }
            return result;
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await callback(proxy);
        if (stage === "complete") {
          const row = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM idempotency_operations
            WHERE actor_user_id=${c.staffUserId} AND operation='call_next' AND status='completed'`);
          assert.equal(row.rows[0].n, 1); reached = true; throw marker;
        }
        return result;
      }, config) } as Database;
    await assert.rejects(makeCall(db).callNext(request), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(reached, true); assert.equal(await state(c), before);
    created(await caller.callNext(request));
  }
});
