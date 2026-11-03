import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import supertest from "supertest";
import type * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { CallNextService } from "../../src/events/call-next.service";
import type { CompleteService } from "../../src/events/complete.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Preflight antes de importar módulos/configuração; nenhuma URL vem de .env.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), u = new URL(value);
  if (u.hostname !== "127.0.0.1" || u.port !== "55432" || u.pathname !== "/arenago_events_test"
    || u.search || u.hash || !u.username) throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60"; // Valor explícito exclusivo desta suíte.
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60"; // EventsModule também instancia as rotas E08.2.
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
type Database = NodePgDatabase<typeof schema>;
let app: INestApplication, database: Database, joining: QueueEntryService, caller: CallNextService, completion: CompleteService;
let makeCompletion: (db: Database) => CompleteService;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string, signTemp: (userId: string) => string;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { EventsModule } = await import("../../src/events/events.module");
  const { ProblemDetailsExceptionFilter } = await import("../../src/common/errors/problem-details.filter");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { CallNextService } = await import("../../src/events/call-next.service");
  const { CompleteService } = await import("../../src/events/complete.service");
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now()-120000, ttlSeconds: 1 } : undefined);
  signTemp = tokens.signTempTwoFactorToken;
  @Module({ imports: [EventsModule], providers: [{ provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter }] })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE); joining = app.get(QueueEntryService); caller = app.get(CallNextService); completion = app.get(CompleteService);
  makeCompletion = db => new CompleteService(db);
});
after(async () => {
  const errors: unknown[] = [];
  try {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM stations s USING experiences x WHERE s.experience_id=x.id AND x.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  } catch (e) { errors.push(e); }
  for (const r of await Promise.allSettled([app?.close(), pool.end()])) if (r.status === "rejected") errors.push(r.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.1 falhou.");
});
async function user() {
  const id = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E081 privado',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  ids.users.push(id); return id;
}
async function grant(userId: string, eventId: string | null) {
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())", [randomUUID(), userId, eventId ? "staff" : "admin", eventId]);
}
async function session(userId: string, secondFactor = false) {
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,admin_2fa_verified_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),CASE WHEN $3 THEN clock_timestamp() END,clock_timestamp())`, [sessionId, userId, secondFactor]);
  return { sessionId, token: signAccess(userId, sessionId) };
}
async function enter(p: { userId: string; participationId: string }, experienceId: string) {
  const result = await joining.joinExperienceQueue({ ...p, experienceId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now()+60000) });
  assert.ok(result.kind === "created"); return result;
}
async function context(pending = false, count = 2) {
  const eventId = randomUUID(), experienceId = randomUUID(), stationId = randomUUID(), secondStationId = randomUUID();
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E081 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E081-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const staffUserId = await user(); await grant(staffUserId, eventId); const auth = await session(staffUserId);
  await pool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E081 experiência',$3,clock_timestamp(),clock_timestamp())`, [experienceId, eventId, baseOrder.toString()]);
  for (const id of [stationId, secondStationId]) await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E081 estação','available',clock_timestamp(),clock_timestamp())`, [id, experienceId]);
  const people = [];
  for (let n=0;n<count;n++) {
    const userId = await user(), participationId = randomUUID();
    await pool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at)
      VALUES($1,$2,$3,'active',clock_timestamp(),clock_timestamp())`, [participationId, userId, eventId]);
    const q = await enter({ userId, participationId }, experienceId); people.push({ userId, participationId, queueEntryId: q.queueEntryId });
  }
  let serviceSessionId: string = randomUUID();
  if (pending) {
    const r = await caller.callNext({ staffUserId, eventId, experienceId, stationId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now()+60000) });
    assert.ok(r.kind === "created"); serviceSessionId = r.serviceSession.id;
  }
  return { staffUserId, eventId, experienceId, stationId, secondStationId, people, serviceSessionId, ...auth };
}
type Context = Awaited<ReturnType<typeof context>>;
type Operation = "call-next" | "complete" | "absent";
function route(c: Context, operation: Operation) {
  const base = `/api/v1/staff/events/${c.eventId}`;
  return operation === "call-next" ? `${base}/experiences/${c.experienceId}/stations/${c.stationId}/call-next` : `${base}/service-sessions/${c.serviceSessionId}/${operation}`;
}
const post = (c: Context, op: Operation, key: string = randomUUID()) => supertest(app.getHttpServer()).post(route(c, op)).set("Authorization", `Bearer ${c.token}`).set("Idempotency-Key", key);
async function state(c: Context) {
  return (await pool.query(`SELECT jsonb_build_object(
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
    'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=$1),
    'experiences',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM experiences x WHERE x.event_id=$1),
    'stations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM stations t JOIN experiences x ON x.id=t.experience_id WHERE x.event_id=$1),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[])))::text AS value`, [c.eventId, ids.users])).rows[0].value as string;
}
function problem(r: supertest.Response, status: number, code?: string) {
  assert.equal(r.status, status, JSON.stringify(r.body)); assert.match(r.headers["content-type"], /application\/problem\+json/);
  assert.equal(r.body.status, status); assert.match(r.body.type, /^https:\/\/arenago.com.br\/problems\//);
  if (code) assert.equal(r.body.code, code);
  assert.equal(JSON.stringify(r.body).includes("@example.test"), false);
}
async function blocked(blockerPid: number, expected: number) {
  const until = Date.now()+6000;
  while (Date.now()<until) {
    const r = await pool.query(`WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)))
      SELECT count(DISTINCT pid)::int AS n FROM blocked`, [blockerPid]);
    if (r.rows[0].n >= expected) return;
    await new Promise(yes => setTimeout(yes, 20));
  }
  throw new Error("Não foi observado bloqueio HTTP real pelos locks de domínio.");
}
async function concurrent(c: Context, actions: Array<() => PromiseLike<supertest.Response>>) {
  const client = await pool.connect(); const pending: Array<Promise<supertest.Response>> = [];
  try {
    await client.query("BEGIN"); await client.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    for (const action of actions) { const p = Promise.resolve(action()); p.catch(() => undefined); pending.push(p); }
    await blocked(pid, actions.length); await client.query("COMMIT"); return await Promise.all(pending);
  } finally { await client.query("ROLLBACK"); await Promise.allSettled(pending); client.release(); }
}

test("E08.1 PostgreSQL HTTP sem autenticação não produz alterações", async () => {
  const c = await context(true), before = await state(c);
  for (const op of ["call-next", "complete", "absent"] as const) problem(await supertest(app.getHttpServer()).post(route(c, op)).send({}), 401);
  assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP rejeita token inválido/expirado, tempToken, sessão revogada/expirada e Admin sem 2FA", async () => {
  const c = await context(true), before = await state(c);
  for (const token of ["invalid", signAccess(c.staffUserId, c.sessionId, true), signTemp(c.staffUserId)]) problem(await post(c, "complete").set("Authorization", `Bearer ${token}`).send({}), 401);
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [c.sessionId]);
  problem(await post(c, "complete").send({}), 401, "SESSION_REVOKED");
  const other = await user(); await grant(other, null); const auth = await session(other);
  problem(await post({ ...c, ...auth }, "complete").send({}), 401, "ADMIN_2FA_REQUIRED");
  const expired = await user(), exp = await session(expired);
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [exp.sessionId]);
  problem(await post({ ...c, ...exp }, "complete").send({}), 401, "SESSION_EXPIRED"); assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP Staff vigente e verificado do evento; Admin isolado não opera", async () => {
  const c = await context(true), other = await context();
  for (const mode of ["participant", "other_event", "revoked", "unverified", "admin", "inactive"]) {
    const actor = await user();
    if (mode === "admin") await grant(actor, null);
    else if (mode !== "participant") await grant(actor, mode === "other_event" ? other.eventId : c.eventId);
    if (mode === "revoked") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [actor]);
    if (mode === "unverified") await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [actor]);
    if (mode === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [actor]);
    const auth = await session(actor, mode === "admin"), before = await state(c);
    for (const op of ["call-next", "complete", "absent"] as const) problem(await post({ ...c, ...auth }, op).send({}), mode === "inactive" ? 401 : 403);
    assert.equal(await state(c), before);
  }
});
test("E08.1 PostgreSQL HTTP valida todos os UUIDs antes dos serviços", async () => {
  const c = await context(true), before = await state(c);
  for (const [op, field] of [["call-next", "eventId"], ["call-next", "experienceId"], ["call-next", "stationId"], ["complete", "serviceSessionId"], ["absent", "serviceSessionId"]] as const) {
    problem(await post({ ...c, [field]: "invalid" }, op).send({}), 400);
  }
  assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP exige header único e válido sem deixar reserva parcial", async () => {
  const c = await context(true), before = await state(c);
  for (const op of ["call-next", "complete", "absent"] as const) {
    problem(await supertest(app.getHttpServer()).post(route(c, op)).set("Authorization", `Bearer ${c.token}`).send({}), 400);
    for (const key of ["", " ", "x".repeat(129)]) problem(await post(c, op, key).send({}), 400);
    problem(await post(c, op).set({ "Idempotency-Key": ["a", "b"] }).send({}), 400);
  }
  assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP rejeita corpo com ator, expiração, estado, timestamps e ordem", async () => {
  const c = await context(true), before = await state(c);
  for (const op of ["call-next", "complete", "absent"] as const) {
    for (const body of [{ staffUserId: c.staffUserId }, { expiresAt: "2099-01-01" }, { status: "completed" }, { resolvedAt: "2099-01-01" }, { queueOrder: "1" }, []]) problem(await post(c, op).send(body), 400);
    problem(await post(c, op).type("text/plain").send("forbidden"), 400);
    problem(await post(c, op).type("application/json").send("{invalid"), 400);
  }
  assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP chamada 201 persiste autoria autenticada e JSON mínimo", async () => {
  const c = await context(), r = await post(c, "call-next").send({}); assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body), ["serviceSession"]); assert.equal(r.body.serviceSession.queueEntryId, c.people[0].queueEntryId);
  assert.match(r.body.serviceSession.calledAt, /^\d{4}-\d{2}-\d{2}T.*Z$/); assert.equal(r.body.serviceSession.status, "pending");
  const s = (await pool.query("SELECT called_by_user_id,status FROM service_sessions WHERE id=$1", [r.body.serviceSession.id])).rows[0];
  assert.equal(s.called_by_user_id, c.staffUserId); assert.equal(s.status, "pending");
});
test("E08.1 PostgreSQL HTTP conclusão 200 mantém active e libera somente o ponteiro", async () => {
  const c = await context(true), r = await post(c, "complete").send({}); assert.equal(r.status, 200);
  assert.equal(r.body.serviceSession.status, "completed"); assert.match(r.body.serviceSession.resolvedAt, /Z$/);
  const s = (await pool.query(`SELECT s.resolved_by_user_id,q.close_reason,(s.resolved_at=q.closed_at) AS same_time,
    p.status,p.current_queue_entry_id,t.availability FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id
    JOIN participations p ON p.id=q.participation_id JOIN stations t ON t.id=s.station_id WHERE s.id=$1`, [c.serviceSessionId])).rows[0];
  assert.equal(s.resolved_by_user_id, c.staffUserId); assert.equal(s.close_reason, "completed"); assert.equal(s.same_time, true);
  assert.equal(s.status, "active"); assert.equal(s.current_queue_entry_id, null); assert.equal(s.availability, "available");
});
test("E08.1 PostgreSQL HTTP ausência 200 reentra no fim FIFO com bigint decimal", async () => {
  const c = await context(true, 3), r = await post(c, "absent").send({}); assert.equal(r.status, 200);
  assert.equal(r.body.requeued, true); assert.equal(r.body.newQueueEntry.queueOrder, (baseOrder+4n).toString()); assert.equal(r.body.newQueueEntry.position, 3);
  assert.notEqual(r.body.newQueueEntry.id, c.people[0].queueEntryId);
  assert.equal((await pool.query("SELECT current_queue_entry_id FROM participations WHERE id=$1", [c.people[0].participationId])).rows[0].current_queue_entry_id, r.body.newQueueEntry.id);
  assert.equal((await pool.query("SELECT status FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0].status, "absent");
});
test("E08.1 PostgreSQL HTTP ausência após corte oficial/Admin ou fila pausada não reentra", async () => {
  for (const mode of ["official", "admin", "paused"]) {
    const c = await context(true);
    if (mode === "official") await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await pool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1`, [c.eventId]);
    if (mode === "paused") await pool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
    const r = await post(c, "absent").send({}); assert.equal(r.status, 200); assert.equal(r.body.requeued, false); assert.equal(r.body.newQueueEntry, null);
  }
});
test("E08.1 PostgreSQL HTTP replay da chamada mantém 201 inclusive após expiresAt vencido", async () => {
  const c = await context(), key = randomUUID(), a = await post(c, "call-next", key).send({}); assert.equal(a.status, 201);
  const expiry = (await pool.query(`SELECT expires_at > created_at+interval '50 seconds' AND expires_at < created_at+interval '70 seconds' AS configured
    FROM idempotency_operations WHERE actor_user_id=$1 AND operation='call_next' AND idempotency_key=$2`, [c.staffUserId, key])).rows[0]; assert.equal(expiry.configured, true);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_user_id=$1 AND operation='call_next' AND idempotency_key=$2", [c.staffUserId, key]);
  const before = await state(c), b = await post(c, "call-next", key).send({}); assert.equal(b.status, 201); assert.deepEqual(b.body, a.body); assert.equal(await state(c), before);
  problem(await post({ ...c, stationId: c.secondStationId }, "call-next", key).send({}), 409, "IDEMPOTENCY_REQUEST_CONFLICT");
});
test("E08.1 PostgreSQL HTTP replay de complete/absent não altera tentativas posteriores", async () => {
  for (const op of ["complete", "absent"] as const) {
    const c = await context(true), key = randomUUID(), a = await post(c, op, key).send({}); assert.equal(a.status, 200);
    if (op === "complete") await enter(c.people[0], c.experienceId);
    assert.equal((await post(c, "call-next").send({})).status, 201);
    const before = await state(c), b = await post(c, op, key).send({}); assert.equal(b.status, 200); assert.deepEqual(b.body, a.body); assert.equal(await state(c), before);
  }
});
test("E08.1 PostgreSQL HTTP recursos de outro evento não revelam dados ou autorizam operação", async () => {
  const c = await context(true), other = await context(true), before = await state(c);
  problem(await post({ ...c, experienceId: other.experienceId, stationId: other.stationId }, "call-next").send({}), 403, "STAFF_EVENT_FORBIDDEN");
  problem(await post({ ...c, stationId: other.stationId }, "call-next").send({}), 403);
  for (const op of ["complete", "absent"] as const) for (const serviceSessionId of [other.serviceSessionId, randomUUID()]) problem(await post({ ...c, serviceSessionId }, op).send({}), 404, "SERVICE_NOT_FOUND");
  assert.equal(await state(c), before);
});
test("E08.1 PostgreSQL HTTP conflitos de estação/fila/estado são 409 sem efeito parcial", async () => {
  const c = await context(true), before = await state(c); problem(await post(c, "call-next").send({}), 409, "STATION_HAS_PENDING_CALL"); assert.equal(await state(c), before);
  await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.secondStationId]);
  problem(await post({ ...c, stationId: c.secondStationId }, "call-next").send({}), 409, "STATION_UNAVAILABLE");
  assert.equal((await post(c, "complete").send({})).status, 200); const terminal = await state(c);
  for (const op of ["complete", "absent"] as const) problem(await post(c, op).send({}), 409, "SERVICE_NOT_PENDING"); assert.equal(await state(c), terminal);
  const empty = await context(false, 0); problem(await post(empty, "call-next").send({}), 409, "QUEUE_EMPTY");
});
test("E08.1 PostgreSQL HTTP prazos operacional/Admin e encerramento bloqueiam as três rotas", async () => {
  for (const mode of ["operational", "admin", "closed"]) {
    const c = await context(true);
    if (mode === "operational") await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '2 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "admin") await pool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "closed") await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    const before = await state(c); for (const op of ["call-next", "complete", "absent"] as const) problem(await post(c, op).send({}), 409, "EVENT_OPERATION_ENDED"); assert.equal(await state(c), before);
  }
});
test("E08.1 PostgreSQL HTTP concorrente em duas estações respeita o mutex FIFO real", async () => {
  const c = await context(), r = await concurrent(c, [() => post(c, "call-next").send({}), () => post({ ...c, stationId: c.secondStationId }, "call-next").send({})]);
  assert.deepEqual(r.map(x => x.status), [201, 201]); assert.deepEqual(new Set(r.map(x => x.body.serviceSession.queueEntryId)), new Set(c.people.map(p => p.queueEntryId)));
});
test("E08.1 PostgreSQL HTTP retries concorrentes criam somente um atendimento", async () => {
  const c = await context(), key = randomUUID(), r = await concurrent(c, [() => post(c, "call-next", key).send({}), () => post(c, "call-next", key).send({})]);
  assert.deepEqual(r.map(x => x.status), [201, 201]); assert.deepEqual(r[0].body, r[1].body);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM service_sessions WHERE station_id=$1", [c.stationId])).rows[0].n, 1);
});
test("E08.1 PostgreSQL HTTP complete contra absent mantém exatamente um resultado terminal", async () => {
  const c = await context(true), r = await concurrent(c, [() => post(c, "complete").send({}), () => post(c, "absent").send({})]);
  assert.deepEqual(r.map(x => x.status).sort(), [200, 409]);
  const winner = r.find(x => x.status === 200)!.body.serviceSession.status;
  assert.equal((await pool.query("SELECT status FROM service_sessions WHERE id=$1", [c.serviceSessionId])).rows[0].status, winner);
});
test("E08.1 PostgreSQL HTTP revalida prazo depois de esperar experiência", async () => {
  const c = await context(true), client = await pool.connect(); let pending: Promise<supertest.Response> | undefined;
  await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '4 seconds' WHERE id=$1`, [c.eventId]);
  const before = await state(c);
  try {
    await client.query("BEGIN"); await client.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = Promise.resolve(post(c, "complete").send({})); pending.catch(() => undefined); await blocked(pid, 1);
    assert.equal((await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a, events e WHERE e.id=$1 AND $2=ANY(pg_blocking_pids(a.pid)) AND a.xact_start<e.operational_deadline_at) AS started`, [c.eventId, pid])).rows[0].started, true);
    const until = Date.now()+6000;
    while (!(await pool.query("SELECT clock_timestamp()>=operational_deadline_at AS ended FROM events WHERE id=$1", [c.eventId])).rows[0].ended) {
      assert.ok(Date.now()<until); await new Promise(yes => setTimeout(yes, 20));
    }
    await client.query("COMMIT"); problem(await pending, 409, "EVENT_OPERATION_ENDED"); assert.equal(await state(c), before);
  } finally { await client.query("ROLLBACK"); await Promise.allSettled([pending]); client.release(); }
});
test("E08.1 PostgreSQL HTTP erro após as escritas reais faz rollback e permite retry", async () => {
  const c = await context(true), before = await state(c), key = randomUUID(), original = completion.complete.bind(completion);
  let reached = false;
  const failingDb = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
    database.transaction(async tx => {
      await callback(tx);
      const row = (await tx.execute<{ status: string; pointer: string | null }>(sql`SELECT s.status,p.current_queue_entry_id AS pointer
        FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id WHERE s.id=${c.serviceSessionId}`)).rows[0];
      assert.equal(row.status, "completed"); assert.equal(row.pointer, null); reached = true; throw new Error("E081_ROLLBACK_PRIVATE");
    }, config) } as unknown as Database;
  completion.complete = input => makeCompletion(failingDb).complete(input);
  try {
    const r = await post(c, "complete", key).send({}); problem(r, 500, "INTERNAL_SERVER_ERROR");
    assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(reached, true); assert.equal(await state(c), before);
  } finally { completion.complete = original; }
  assert.equal((await post(c, "complete", key).send({})).status, 200);
});
