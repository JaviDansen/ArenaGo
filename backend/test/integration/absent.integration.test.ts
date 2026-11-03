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
import type { AbsentService } from "../../src/events/absent.service";
import type { AbsentServiceInput, AbsentServiceResult } from "../../src/events/absent.types";
import type { CallNextService } from "../../src/events/call-next.service";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Mesmo preflight E07.4/E07.5, antes de configuração/serviços. Nunca carregar arquivos .env.
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
let makeAbsent: (db: Database) => AbsentService;
let absence: AbsentService;
let makeComplete: (db: Database) => CompleteService;
let makeCall: (db: Database) => CallNextService;
let makeWithdrawal: (db: Database) => QueueWithdrawalService;
let completion: CompleteService, caller: CallNextService, joining: QueueEntryService;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;

before(async () => {
  assert.equal((await fixturePool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { AbsentService } = await import("../../src/events/absent.service");
  makeAbsent = db => new AbsentService(db); absence = makeAbsent(database);
  const { CompleteService } = await import("../../src/events/complete.service");
  const { CallNextService } = await import("../../src/events/call-next.service");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { QueueWithdrawalService } = await import("../../src/events/queue-withdrawal.service");
  const { EventsService } = await import("../../src/events/events.service");
  makeComplete = db => new CompleteService(db); makeCall = db => new CallNextService(db);
  makeWithdrawal = db => new QueueWithdrawalService(db);
  completion = makeComplete(database); caller = makeCall(database);
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
  if (errors.length) throw new AggregateError(errors, "Falha na limpeza E07.6.");
});
async function user() {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E076 privado',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
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
    status,external_queue_enabled,created_at,updated_at) VALUES($1,'E076 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E076-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const staffUserId = await user(); await staff(staffUserId, eventId);
  const experienceId = randomUUID(), stationId = randomUUID();
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E076 experiência',$3,clock_timestamp(),clock_timestamp())`, [experienceId, eventId, baseOrder.toString()]);
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E076 estação','available',clock_timestamp(),clock_timestamp())`, [stationId, experienceId]);
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
function intent(c: Pick<Context, "eventId" | "staffUserId" | "serviceSessionId">): AbsentServiceInput {
  return { eventId: c.eventId, staffUserId: c.staffUserId, serviceSessionId: c.serviceSessionId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function exit(c: Context) {
  const p = c.people[0]; return { userId: p.userId, participationId: p.participationId, queueEntryId: p.queueEntryId,
    idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function absent(result: AbsentServiceResult) { assert.ok(result.kind === "absent", JSON.stringify(result)); return result; }
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
  let pending: Promise<AbsentServiceResult> | undefined;
  try {
    await blocker.query("BEGIN"); await mutation(blocker);
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const waiterPid = (await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = makeAbsent(drizzle(waiter, { schema })).absent(intent(c)); pending.catch(() => undefined);
    await waitBlocked(waiterPid, blockerPid); await check(waiterPid);
    await blocker.query("COMMIT"); return await pending;
  } finally { await blocker.query("ROLLBACK"); await Promise.allSettled([pending]); blocker.release(); waiter.release(); }
}

async function assertAbsence(c: Context, request: AbsentServiceInput, result: ReturnType<typeof absent>) {
  const row = (await fixturePool.query(`SELECT s.status,s.resolved_by_user_id,s.cancel_reason,q.status AS entry,q.close_reason,
    q.queue_order::text,(q.closed_at=s.resolved_at) AS same_time,p.status AS participation,p.current_queue_entry_id,
    x.last_queue_order::text,(SELECT count(*)::int FROM service_sessions WHERE station_id=s.station_id AND status='pending') AS pending,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=$2 AND i.operation='absent_service_session'
      AND i.idempotency_key=$3 AND i.status='completed' AND i.result_reference=s.id) AS intentions
    FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id
    JOIN experiences x ON x.id=q.experience_id WHERE s.id=$1`, [c.serviceSessionId, request.staffUserId, request.idempotencyKey])).rows[0];
  assert.equal(row.status, "absent"); assert.equal(row.resolved_by_user_id, request.staffUserId); assert.equal(row.cancel_reason, null);
  assert.equal(row.entry, "closed"); assert.equal(row.close_reason, "absent"); assert.equal(row.same_time, true);
  assert.equal(row.queue_order, c.people[0].queueOrder); assert.equal(row.participation, "active"); assert.equal(row.pending, 0); assert.equal(row.intentions, 1);
  assert.equal(row.current_queue_entry_id, result.newQueueEntry?.id ?? null);
  assert.equal(row.last_queue_order, (baseOrder + BigInt(c.people.length) + (result.requeued ? 1n : 0n)).toString());
  if (result.requeued) {
    const fresh = (await fixturePool.query("SELECT status,queue_order::text,experience_id,participation_id FROM queue_entries WHERE id=$1", [result.newQueueEntry.id])).rows[0];
    assert.equal(fresh.status, "waiting"); assert.equal(fresh.queue_order, result.newQueueEntry.queueOrder);
    assert.equal(fresh.experience_id, c.experienceId); assert.equal(fresh.participation_id, c.people[0].participationId);
    assert.notEqual(result.newQueueEntry.id, c.people[0].queueEntryId);
  }
}
test("E07.6 ausência normal reentra no fim FIFO com ID novo, ponteiro e timestamp exatos", async () => {
  const c = await context(3), request = intent(c), result = absent(await absence.absent(request));
  assert.ok(result.requeued); assert.equal(result.newQueueEntry.queueOrder, (baseOrder + 4n).toString());
  assert.equal(result.newQueueEntry.position, 3); await assertAbsence(c, request, result);
  const { QueueStateService } = await import("../../src/events/queue-state.service");
  const state = await new QueueStateService(database).getParticipationQueue(c.people[0].userId, c.people[0].participationId);
  assert.ok(state.kind === "ok" && state.currentQueueEntry?.status === "waiting");
  assert.equal(state.currentQueueEntry.id, result.newQueueEntry.id); assert.equal(state.currentQueueEntry.position, 3);
  assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "available");
});
test("E07.6 corte oficial/Admin e fila pausada resolvem absent sem reentrada nem incremento", async () => {
  for (const mode of ["official", "admin", "paused"]) {
    const c = await context(2);
    if (mode === "official") await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "paused") await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
    const request = intent(c), result = absent(await absence.absent(request));
    assert.equal(result.requeued, false); assert.equal(result.newQueueEntry, null); await assertAbsence(c, request, result);
  }
});
test("E07.6 configuração sem prontidão ou experiência sem estação disponível impedem só reentrada", async () => {
  for (const mode of ["name", "station"]) {
    const c = await context();
    if (mode === "name") await fixturePool.query("UPDATE events SET name='' WHERE id=$1", [c.eventId]);
    else await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
    const request = intent(c), result = absent(await absence.absent(request)); assert.equal(result.requeued, false); await assertAbsence(c, request, result);
    if (mode === "station") assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "unavailable");
  }
});
test("E07.6 outra estação disponível na mesma experiência permite reentrada sem alterar estação original", async () => {
  const c = await context(), station = randomUUID();
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'Testemunha','available',clock_timestamp(),clock_timestamp())`, [station, c.experienceId]);
  const request = intent(c), result = absent(await absence.absent(request)); assert.equal(result.requeued, true); await assertAbsence(c, request, result);
  assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "unavailable");
});
test("E07.6 retries sequenciais/concorrentes geram exatamente uma nova entrada", async () => {
  const c = await context(2), request = intent(c);
  const [a, b] = await race(held(db => makeAbsent(db).absent(request)), db => makeAbsent(db).absent(request));
  const result = absent(a); assert.deepEqual(b, { ...a, kind: "replay" }); assert.deepEqual(await absence.absent(request), b);
  await assertAbsence(c, request, result);
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM queue_entries WHERE participation_id=$1", [c.people[0].participationId])).rows[0].n, 2);
});
test("E07.6 duas intenções concorrentes sobre a mesma sessão só resolvem uma vez", async () => {
  const c = await context(), request = intent(c), other = intent(c);
  const [a, b] = await race(held(db => makeAbsent(db).absent(request)), db => makeAbsent(db).absent(other));
  await assertAbsence(c, request, absent(a)); assert.deepEqual(b, { kind: "service_not_pending" });
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [c.staffUserId, other.idempotencyKey])).rows[0].n, 0);
});
test("E07.6 replay antigo não afeta reentrada já chamada nem cria nova tentativa", async () => {
  const c = await context(), request = intent(c), result = absent(await absence.absent(request)); assert.ok(result.requeued);
  const next = await call(c); assert.equal(next.queueEntryId, result.newQueueEntry.id);
  const before = await state(c);
  assert.deepEqual(await absence.absent(request), { ...result, kind: "replay" }); assert.equal(await state(c), before);
  assert.deepEqual(await absence.absent(intent(c)), { kind: "service_not_pending" });
  assert.deepEqual(await absence.absent({ ...request, serviceSessionId: next.id }), { kind: "request_conflict" }); assert.equal(await state(c), before);
});
test("E07.6 replay sem reentrada persiste mesmo após encerramento e exige autorização atual", async () => {
  const c = await context(), request = intent(c);
  await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
  const result = absent(await absence.absent(request)); assert.equal(result.requeued, false);
  await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
  await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture' WHERE id=$1", [c.people[0].participationId]);
  const before = await state(c);
  assert.deepEqual(await absence.absent(request), { ...result, kind: "replay" }); assert.equal(await state(c), before);
  await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId]);
  assert.deepEqual(await absence.absent(request), { kind: "staff_event_forbidden" });
});
test("E07.6 nega Admin isolado e Staff alheio/revogado/inativo/não verificado", async () => {
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
    assert.deepEqual(await absence.absent({ ...intent(c), staffUserId: actor }), { kind: "staff_event_forbidden" }); assert.equal(await state(c), before);
    assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1", [actor])).rows[0].n, 0);
  }
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), c.staffUserId]);
  absent(await absence.absent(intent(c)));
});
test("E07.6 sessões ausentes/alheias e evento ausente são bloqueados sem escrita", async () => {
  const c = await context(), other = await context(), before = await state(c);
  for (const serviceSessionId of [randomUUID(), other.serviceSessionId]) assert.deepEqual(await absence.absent({ ...intent(c), serviceSessionId }), { kind: "service_not_found" });
  assert.deepEqual(await absence.absent({ ...intent(c), eventId: randomUUID() }), { kind: "staff_event_forbidden" }); assert.equal(await state(c), before);
});
test("E07.6 pending com vínculos/ponteiro/estados incoerentes falha sem efeito", async () => {
  const { AbsentServiceIntegrityError } = await import("../../src/events/absent.service");
  for (const mode of ["entry", "pointer", "person", "experience"]) {
    const c = await context();
    if (mode === "entry") await fixturePool.query("UPDATE queue_entries SET status='waiting' WHERE id=$1", [c.people[0].queueEntryId]);
    if (mode === "pointer") await fixturePool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.people[0].participationId]);
    if (mode === "person") await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture' WHERE id=$1", [c.people[0].participationId]);
    if (mode === "experience") {
      // Estação existente e livre de outra experiência: isola a FK sem disputar o unique de pending.
      const other = await context(), foreignStationId = randomUUID();
      await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
        VALUES($1,$2,'FK isolada','available',clock_timestamp(),clock_timestamp())`, [foreignStationId, other.experienceId]);
      assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM service_sessions WHERE station_id=$1 AND status='pending'", [foreignStationId])).rows[0].n, 0);
      await assert.rejects(fixturePool.query("UPDATE service_sessions SET station_id=$2 WHERE id=$1", [c.serviceSessionId, foreignStationId]),
        { code: "23503", constraint: "fk_service_sessions_station_experience" });
    }
    const before = await state(c);
    if (mode !== "experience") await assert.rejects(absence.absent(intent(c)), AbsentServiceIntegrityError);
    assert.equal(await state(c), before);
  }
});
test("E07.6 prazo operacional/Admin, imediato, closed e antes do início não registram ausência", async () => {
  for (const mode of ["operational", "admin", "immediate", "closed", "not_started"]) {
    const c = await context();
    if (mode === "operational") await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '2 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "immediate") await fixturePool.query("UPDATE events SET closure_mode='immediate',closure_requested_at=statement_timestamp(),admin_deadline_at=statement_timestamp() WHERE id=$1", [c.eventId]);
    if (mode === "closed") await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    if (mode === "not_started") await fixturePool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes' WHERE id=$1", [c.eventId]);
    const before = await state(c); assert.deepEqual(await absence.absent(intent(c)), { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  }
});
for (const administrative of [false, true]) {
  test(`E07.6 prazo ${administrative ? "administrativo" : "operacional"} vencido durante lock impede ausência`, async () => {
    const c = await context();
    if (administrative) await fixturePool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '2 seconds' WHERE id=$1`, [c.eventId]);
    else await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '2 seconds' WHERE id=$1`, [c.eventId]);
    const before = await state(c), column = administrative ? "admin_deadline_at" : "operational_deadline_at";
    const result = await structuralRace(c, client => client.query("SELECT id FROM service_sessions WHERE id=$1 FOR UPDATE", [c.serviceSessionId]), async pid => {
      assert.equal((await fixturePool.query(`SELECT a.xact_start < e.${column} AS before_cut FROM pg_stat_activity a, events e WHERE a.pid=$1 AND e.id=$2`, [pid, c.eventId])).rows[0].before_cut, true);
      const until = Date.now()+4000;
      while (!(await fixturePool.query(`SELECT clock_timestamp() >= ${column} AS ended FROM events WHERE id=$1`, [c.eventId])).rows[0].ended) {
        assert.ok(Date.now()<until); await new Promise(yes => setTimeout(yes, 20));
      }
    });
    assert.deepEqual(result, { kind: "event_operation_ended" }); assert.equal(await state(c), before);
  });
}
test("E07.6 corte oficial entre resolver ausência e INSERT impede reentrada tardia", async () => {
  const c = await context(), request = intent(c);
  await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()+interval '2 seconds',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [c.eventId]);
  let signal!: () => void, reject!: (error: unknown) => void, release!: () => void;
  const reached = new Promise<void>((yes, no) => { signal=yes; reject=no; }), gate = new Promise<void>(yes => { release=yes; });
  const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
    database.transaction(tx => callback(new Proxy(tx, { get(target, key) {
      if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
        const result = await target.execute(query);
        if (result.rows.some(row => row.id === c.people[0].queueEntryId)) {
          assert.equal((await target.execute<{ beforeCut: boolean }>(sql`SELECT clock_timestamp()<official_ends_at AS "beforeCut" FROM events WHERE id=${c.eventId}`)).rows[0].beforeCut, true);
          signal(); await gate;
        }
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } })), config) } as Database;
  const pending = makeAbsent(db).absent(request); pending.catch(reject);
  try {
    await reached; const until = Date.now()+4000;
    while (!(await fixturePool.query("SELECT clock_timestamp()>=official_ends_at AS ended FROM events WHERE id=$1", [c.eventId])).rows[0].ended) {
      assert.ok(Date.now()<until); await new Promise(yes => setTimeout(yes, 20));
    }
    release(); const result = absent(await pending); assert.equal(result.requeued, false); await assertAbsence(c, request, result);
  } finally { release(); await Promise.allSettled([pending]); }
});
test("E07.6 ausência vence conclusão E07.5 e preserva nova waiting", async () => {
  const c = await context(), request = intent(c);
  const [a, b] = await race(held(db => makeAbsent(db).absent(request)), db => makeComplete(db).complete(intent(c)));
  await assertAbsence(c, request, absent(a)); assert.deepEqual(b, { kind: "service_not_pending" });
});
test("E07.6 conclusão E07.5 vence e não pode ser substituída por absent", async () => {
  const c = await context();
  const [a, b] = await race(held(db => makeComplete(db).complete(intent(c))), db => makeAbsent(db).absent(intent(c)));
  assert.equal(a.kind, "completed"); assert.deepEqual(b, { kind: "service_not_pending" });
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM queue_entries WHERE participation_id=$1", [c.people[0].participationId])).rows[0].n, 1);
});
test("E07.6 ausência vence E07.3 antiga sem cancelar a nova entrada", async () => {
  const c = await context(), request = intent(c);
  const [a, b] = await race(held(db => makeAbsent(db).absent(request)), db => makeWithdrawal(db).withdrawExperienceQueue(exit(c)));
  await assertAbsence(c, request, absent(a)); assert.deepEqual(b, { kind: "entry_not_current" });
});
test("E07.6 E07.3 vence e canceled não vira absent", async () => {
  const c = await context();
  const [a, b] = await race(held(db => makeWithdrawal(db).withdrawExperienceQueue(exit(c))), db => makeAbsent(db).absent(intent(c)));
  assert.equal(a.kind, "withdrawn"); assert.deepEqual(b, { kind: "service_not_pending" });
  assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0].status, "canceled");
});
test("E07.6 ausência libera estação para E07.4 concorrente respeitando o próximo FIFO", async () => {
  const c = await context(2), request = intent(c);
  const [a, b] = await race(held(db => makeAbsent(db).absent(request)), db => call(c, makeCall(db)));
  assert.ok(absent(a).requeued); assert.equal(b.queueEntryId, c.people[1].queueEntryId);
  assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE id=$1", [b.id])).rows[0].status, "pending");
});
test("E07.6 E07.4 em outra estação vence mutex e ausência reentra atrás de quem ainda aguarda", async () => {
  const c = await context(3), stationId = randomUUID();
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'Segunda','available',clock_timestamp(),clock_timestamp())`, [stationId, c.experienceId]);
  const request = intent(c);
  const [a, b] = await race(held(db => call({ ...c, stationId }, makeCall(db))), db => makeAbsent(db).absent(request));
  assert.equal(a.queueEntryId, c.people[1].queueEntryId); const result = absent(b); assert.ok(result.requeued);
  assert.equal(result.newQueueEntry.position, 2); await assertAbsence(c, request, result);
});
test("E07.6 preserva conclusões anteriores e nunca conta absent como completed", async () => {
  const c = await context(); assert.equal((await completion.complete(intent(c))).kind, "completed");
  const previous = (await fixturePool.query("SELECT to_jsonb(s)::text AS value FROM service_sessions s WHERE id=$1", [c.serviceSessionId])).rows[0].value;
  const fresh = await enter(c.people[0], c.experienceId), next = await call(c);
  assert.equal(next.queueEntryId, fresh.queueEntryId);
  absent(await absence.absent({ ...intent(c), serviceSessionId: next.id }));
  assert.equal((await fixturePool.query("SELECT to_jsonb(s)::text AS value FROM service_sessions s WHERE id=$1", [c.serviceSessionId])).rows[0].value, previous);
  assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.participation_id=$1 AND s.status='completed'", [c.people[0].participationId])).rows[0].n, 1);
});
test("E07.6 reserva in_progress e fingerprint em outro evento não escrevem domínio", async () => {
  const c = await context(), other = await context(), request = intent(c);
  await staff(c.staffUserId, other.eventId); absent(await absence.absent(request));
  assert.deepEqual(await absence.absent({ ...request, eventId: other.eventId, serviceSessionId: other.serviceSessionId }), { kind: "request_conflict" });
  const { createAbsentServiceFingerprint } = await import("../../src/events/absent.service");
  const progress = intent(other);
  await fixturePool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,'absent_service_session',$3,$4,'in_progress',clock_timestamp(),$5)`, [randomUUID(), other.staffUserId, progress.idempotencyKey,
    createAbsentServiceFingerprint(other.eventId, other.serviceSessionId), progress.expiresAt]);
  const before = await state(other); assert.deepEqual(await absence.absent(progress), { kind: "in_progress" }); assert.equal(await state(other), before);
});
test("E07.6 encerramento/revogação concorrentes são revalidados após esperar locks", async () => {
  for (const mode of ["closed", "revoked", "inactive"]) {
    const c = await context();
    const result = await structuralRace(c, client => mode === "closed" ? client.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId])
      : mode === "revoked" ? client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId])
        : client.query("UPDATE users SET is_active=false WHERE id=$1", [c.staffUserId]));
    assert.deepEqual(result, { kind: mode === "closed" ? "event_operation_ended" : "staff_event_forbidden" });
    assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0].status, "pending");
  }
});
test("E07.6 falhas após cada escrita revertem ausência, contador, nova fila, ponteiro e idempotência", async () => {
  for (const stage of ["resolve", "close", "insert", "pointer", "complete"]) {
    const c = await context(), request = intent(c), before = await state(c), marker = new Error(`E076_AFTER_${stage}`);
    let reached = false;
    const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
      database.transaction(async tx => {
        const verify = async () => {
          const r = (await tx.execute<{ status: string; entry: string; pointer: string | null; entries: number; last: string }>(sql`
            SELECT s.status,q.status AS entry,p.current_queue_entry_id AS pointer,x.last_queue_order::text AS last,
              (SELECT count(*)::int FROM queue_entries WHERE participation_id=p.id) AS entries
            FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id
            JOIN experiences x ON x.id=q.experience_id WHERE s.id=${c.serviceSessionId}`)).rows[0];
          const inserted = ["insert", "pointer", "complete"].includes(stage);
          assert.equal(r.status, "absent"); assert.equal(r.entry, stage === "resolve" ? "called" : "closed");
          assert.equal(r.entries, inserted ? 2 : 1); assert.equal(r.last, (baseOrder+(inserted ? 2n : 1n)).toString());
          if (["pointer", "complete"].includes(stage)) { assert.ok(r.pointer); assert.notEqual(r.pointer, c.people[0].queueEntryId); }
          else assert.equal(r.pointer, c.people[0].queueEntryId);
          reached=true; throw marker;
        };
        const proxy = new Proxy(tx, { get(target, key) {
          if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await target.execute(query);
            if (result.rows.length && ((stage === "resolve" && "resolvedAtMs" in result.rows[0])
              || (stage === "close" && result.rows[0].id === c.people[0].queueEntryId)
              || (stage === "insert" && "queueOrder" in result.rows[0])
              || (stage === "pointer" && result.rows[0].id === c.people[0].participationId))) await verify();
            return result;
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await callback(proxy);
        if (stage === "complete") {
          assert.equal((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM idempotency_operations
            WHERE actor_user_id=${c.staffUserId} AND operation='absent_service_session' AND status='completed'`)).rows[0].n, 1);
          await verify();
        }
        return result;
      }, config) } as Database;
    await assert.rejects(makeAbsent(db).absent(request), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause=cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(reached, true); assert.equal(await state(c), before);
    await assertAbsence(c, request, absent(await absence.absent(request)));
  }
});

