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
import type { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Preflight antes de importar environment/módulos; nunca carrega .env ou aceita banco remoto.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), u = new URL(value);
  if (u.hostname !== "127.0.0.1" || u.port !== "55432" || u.pathname !== "/arenago_events_test"
    || u.search || u.hash || !u.username) throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
type Database = NodePgDatabase<typeof schema>;
let app: INestApplication, database: Database, joining: QueueEntryService, withdrawal: QueueWithdrawalService;
let makeJoining: (db: Database) => QueueEntryService, makeWithdrawal: (db: Database) => QueueWithdrawalService;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
const ids = { events: [] as string[], users: [] as string[] };
const baseOrder = 9007199254741000n;
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { EventsModule } = await import("../../src/events/events.module");
  const { EventsService } = await import("../../src/events/events.service");
  const { ProblemDetailsExceptionFilter } = await import("../../src/common/errors/problem-details.filter");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { QueueWithdrawalService } = await import("../../src/events/queue-withdrawal.service");
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now()-120000, ttlSeconds: 1 } : undefined);
  @Module({ imports: [EventsModule], providers: [{ provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter }] })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE); joining = app.get(QueueEntryService); withdrawal = app.get(QueueWithdrawalService);
  makeJoining = db => new QueueEntryService(db, new EventsService(db)); makeWithdrawal = db => new QueueWithdrawalService(db);
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
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.2 falhou.");
});
async function user() {
  const id = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E082 privado',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  ids.users.push(id); return id;
}
async function session(userId: string, secondFactor = false) {
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,admin_2fa_verified_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),CASE WHEN $3 THEN clock_timestamp() END,clock_timestamp())`, [sessionId, userId, secondFactor]);
  return { sessionId, token: signAccess(userId, sessionId) };
}
async function context(count = 1) {
  const eventId = randomUUID(), experienceId = randomUUID(), stationId = randomUUID();
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E082 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E082-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const staffUserId = await user();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), staffUserId, eventId]);
  const staff = await session(staffUserId);
  await pool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E082 experiência',$3,clock_timestamp(),clock_timestamp())`, [experienceId, eventId, baseOrder.toString()]);
  await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E082 estação','available',clock_timestamp(),clock_timestamp())`, [stationId, experienceId]);
  const people = [];
  for (let n=0;n<count;n++) {
    const userId = await user(), participationId = randomUUID();
    await pool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at)
      VALUES($1,$2,$3,'active',clock_timestamp(),clock_timestamp())`, [participationId, userId, eventId]);
    people.push({ userId, participationId, ...await session(userId) });
  }
  return { eventId, experienceId, stationId, staffUserId, staff, people };
}
type Context = Awaited<ReturnType<typeof context>>;
type Person = Context["people"][number];
const root = (p: Person) => `/api/v1/participations/${p.participationId}`;
const join = (c: Context, p = c.people[0], key = randomUUID(), experienceId = c.experienceId) =>
  supertest(app.getHttpServer()).post(`${root(p)}/queue-entries`).set("Authorization", `Bearer ${p.token}`).set("Idempotency-Key", key).send({ experienceId });
const get = (p: Person) => supertest(app.getHttpServer()).get(`${root(p)}/queue`).set("Authorization", `Bearer ${p.token}`);
const withdraw = (p: Person, entryId: string, key = randomUUID()) => supertest(app.getHttpServer()).post(`${root(p)}/queue-entries/${entryId}/withdraw`).set("Authorization", `Bearer ${p.token}`).set("Idempotency-Key", key);
const call = (c: Context) => supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`).set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID());
const resolve = (c: Context, sessionId: string, op: "complete" | "absent") => supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/service-sessions/${sessionId}/${op}`).set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID());
async function enter(c: Context, p = c.people[0]) { const r = await join(c, p); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.queueEntryId as string; }
async function state(c: Context) {
  return (await pool.query(`SELECT jsonb_build_object(
    'event',(SELECT to_jsonb(e) FROM events e WHERE e.id=$1),
    'accounts',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM users u WHERE u.id=ANY($2::uuid[])),
    'authSessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sessions s WHERE s.user_id=ANY($2::uuid[])),
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

test("E08.2 PostgreSQL HTTP ingresso 201 persiste titular, ordem exata e TTL próprio", async () => {
  const c = await context(), r = await join(c); assert.equal(r.status, 201);
  assert.equal(r.body.queueOrder, (baseOrder+1n).toString()); assert.equal(r.body.participationId, c.people[0].participationId);
  assert.match(r.body.enteredAt, /Z$/); assert.equal("position" in r.body, false); assert.equal("kind" in r.body, false);
  const row = (await pool.query(`SELECT p.status,p.current_queue_entry_id,q.queue_order::text,
    i.expires_at > i.created_at+interval '50 seconds' AND i.expires_at < i.created_at+interval '70 seconds' AS ttl
    FROM participations p JOIN queue_entries q ON q.id=p.current_queue_entry_id
    JOIN idempotency_operations i ON i.actor_user_id=p.user_id AND i.operation='join_experience_queue'
    WHERE p.id=$1`, [c.people[0].participationId])).rows[0];
  assert.equal(row.status, "active"); assert.equal(row.current_queue_entry_id, r.body.queueEntryId); assert.equal(row.queue_order, r.body.queueOrder); assert.equal(row.ttl, true);
});
test("E08.2 PostgreSQL HTTP autenticação ausente, expirada e revogada bloqueia as três rotas", async () => {
  const c = await context(), p = c.people[0], entryId = await enter(c);
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='test' WHERE id=$1", [p.sessionId]);
  const before = await state(c);
  for (const token of [undefined, p.token, signAccess(p.userId, p.sessionId, true)]) {
    for (const r of [supertest(app.getHttpServer()).post(`${root(p)}/queue-entries`).send({ experienceId: c.experienceId }),
      supertest(app.getHttpServer()).get(`${root(p)}/queue`), supertest(app.getHttpServer()).post(`${root(p)}/queue-entries/${entryId}/withdraw`)]) {
      if (token) r.set("Authorization", `Bearer ${token}`); problem(await r, 401);
    }
  }
  assert.equal(await state(c), before);
});
test("E08.2 PostgreSQL HTTP inexistência e titularidade alheia são indistinguíveis", async () => {
  const c = await context(2), entryId = await enter(c, c.people[1]), before = await state(c);
  const responses: supertest.Response[] = [];
  for (const participationId of [randomUUID(), c.people[1].participationId]) {
    const p = { ...c.people[0], participationId };
    for (const r of [await join(c, p), await get(p), await withdraw(p, entryId)]) { problem(r, 404, "RESOURCE_NOT_FOUND"); responses.push(r); }
  }
  for (const r of responses) assert.deepEqual(r.body, responses[0].body);
  assert.equal(await state(c), before);
});
test("E08.2 PostgreSQL HTTP participação não ativa não ingressa e GET não fabrica fila", async () => {
  for (const status of ["waiting", "finished", "canceled"]) {
    const c = await context(), p = c.people[0];
    // O mesmo parâmetro deve ter um único tipo na atribuição e nos CASEs (status é varchar(20)).
    await pool.query(`UPDATE participations SET status=$2::varchar(20),arena_entered_at=NULL,
      finished_at=CASE WHEN $2::varchar(20) IN ('finished','canceled') THEN clock_timestamp() END,
      finish_reason=CASE WHEN $2::varchar(20) IN ('finished','canceled') THEN 'test' END WHERE id=$1`, [p.participationId, status]);
    const before = await state(c); problem(await join(c), 409, "PARTICIPATION_NOT_ACTIVE");
    const r = await get(p); assert.equal(r.status, 200); assert.equal(r.body.currentQueueEntry, null); assert.equal(await state(c), before);
  }
});
test("E08.2 PostgreSQL HTTP experiência de outro evento ou ausente tem bloqueio neutro", async () => {
  const c = await context(), other = await context(), before = await state(c);
  const a = await join(c, c.people[0], randomUUID(), other.experienceId), b = await join(c, c.people[0], randomUUID(), randomUUID());
  problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body); assert.equal(await state(c), before);
});
test("E08.2 PostgreSQL HTTP fila pausada, estação indisponível e prontidão bloqueiam ingresso", async () => {
  for (const mode of ["paused", "station", "experience", "staff", "readiness"]) {
    const c = await context();
    if (mode === "paused") await pool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
    if (mode === "station" || mode === "experience") await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
    if (mode === "experience") {
      const otherExperience = randomUUID();
      await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'E082 disponível',clock_timestamp(),clock_timestamp())", [otherExperience, c.eventId]);
      await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Outra','available',clock_timestamp(),clock_timestamp())", [randomUUID(), otherExperience]);
    }
    if (mode === "staff") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1", [c.staffUserId]);
    if (mode === "readiness") await pool.query("UPDATE events SET timezone='invalid/timezone' WHERE id=$1", [c.eventId]);
    const before = await state(c); problem(await join(c), 409, mode === "paused" ? "EXPERIENCE_QUEUE_CLOSED" : mode === "experience" ? "EXPERIENCE_UNAVAILABLE" : "EVENT_UNAVAILABLE");
    assert.equal(await state(c), before);
  }
});
test("E08.2 PostgreSQL HTTP cortes oficial e administrativo impedem novas entradas", async () => {
  for (const mode of ["official", "admin"]) {
    const c = await context();
    if (mode === "official") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
    else await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
    const before = await state(c); problem(await join(c), 409, "EVENT_REGISTRATION_CLOSED"); assert.equal(await state(c), before);
  }
});
test("E08.2 PostgreSQL HTTP dois ingressos concorrentes mantêm uma única fila interna", async () => {
  const c = await context(), r = await concurrent(c, [() => join(c), () => join(c)]);
  assert.deepEqual(r.map(x => x.status).sort(), [201, 409]); problem(r.find(x => x.status === 409)!, 409, "ALREADY_IN_INTERNAL_QUEUE");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM queue_entries WHERE participation_id=$1", [c.people[0].participationId])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT last_queue_order::text AS n FROM experiences WHERE id=$1", [c.experienceId])).rows[0].n, (baseOrder+1n).toString());
});
test("E08.2 PostgreSQL HTTP retries concorrentes da mesma intenção retornam o mesmo 201", async () => {
  const c = await context(), key = randomUUID(), r = await concurrent(c, [() => join(c, c.people[0], key), () => join(c, c.people[0], key)]);
  assert.deepEqual(r.map(x => x.status), [201, 201]); assert.deepEqual(r[0].body, r[1].body);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM queue_entries WHERE event_id=$1", [c.eventId])).rows[0].n, 1);
});
test("E08.2 PostgreSQL HTTP replay persistente não expira e chave de outro payload conflita", async () => {
  const c = await context(), p = c.people[0], key = randomUUID(), first = await join(c, p, key); assert.equal(first.status, 201);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_user_id=$1 AND operation='join_experience_queue'", [p.userId]);
  const otherExperience = randomUUID(), otherStation = randomUUID();
  await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'E082 outra',clock_timestamp(),clock_timestamp())", [otherExperience, c.eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Outra','available',clock_timestamp(),clock_timestamp())", [otherStation, otherExperience]);
  const before = await state(c), replay = await join(c, p, key); assert.equal(replay.status, 201); assert.deepEqual(replay.body, first.body);
  problem(await join(c, p, key, otherExperience), 409, "IDEMPOTENCY_REQUEST_CONFLICT"); assert.equal(await state(c), before);
});
test("E08.2 PostgreSQL HTTP posição muda com desistência e chamada sem renumerar ordens", async () => {
  const c = await context(3), entries: string[] = [];
  for (const p of c.people) entries.push(await enter(c, p));
  let r = await get(c.people[2]); assert.equal(r.body.currentQueueEntry.position, 3); const order = r.body.currentQueueEntry.queueOrder;
  assert.equal((await withdraw(c.people[0], entries[0])).status, 200);
  r = await get(c.people[2]); assert.equal(r.body.currentQueueEntry.position, 2); assert.equal(r.body.currentQueueEntry.queueOrder, order);
  const called = await call(c); assert.equal(called.status, 201); assert.equal(called.body.serviceSession.queueEntryId, entries[1]);
  r = await get(c.people[2]); assert.equal(r.body.currentQueueEntry.position, 1); assert.equal(r.body.currentQueueEntry.queueOrder, order);
});
test("E08.2 PostgreSQL HTTP estado called mostra apenas atendimento e estação corretos", async () => {
  const c = await context(), entry = await enter(c), called = await call(c); assert.equal(called.status, 201);
  const r = await get(c.people[0]); assert.equal(r.status, 200); assert.match(r.body.observedAt, /Z$/);
  assert.equal(r.body.currentQueueEntry.id, entry); assert.equal(r.body.currentQueueEntry.status, "called"); assert.equal(r.body.currentQueueEntry.position, null);
  assert.deepEqual(r.body.currentQueueEntry.serviceSession, { id: called.body.serviceSession.id, status: "pending", calledAt: called.body.serviceSession.calledAt, station: { id: c.stationId, label: "E082 estação" } });
  assert.equal(JSON.stringify(r.body).includes(c.staffUserId), false); assert.equal(JSON.stringify(r.body).includes("@example.test"), false);
});
test("E08.2 PostgreSQL HTTP GET vazio/waiting/called não escreve nem reserva idempotência", async () => {
  const c = await context();
  for (const mode of ["empty", "waiting", "called"]) {
    if (mode === "waiting") await enter(c);
    if (mode === "called") assert.equal((await call(c)).status, 201);
    const before = await state(c);
    for (let n=0;n<2;n++) { const r = await get(c.people[0]); assert.equal(r.status, 200); assert.equal(r.body.currentQueueEntry?.status ?? "empty", mode); }
    assert.equal(await state(c), before);
  }
});
test("E08.2 PostgreSQL HTTP desistência waiting mantém active e preserva contador/histórico", async () => {
  const c = await context(), entry = await enter(c), r = await withdraw(c.people[0], entry); assert.equal(r.status, 200);
  assert.equal(r.body.status, "closed"); assert.equal(r.body.serviceSession, null); assert.match(r.body.closedAt, /Z$/);
  const row = (await pool.query(`SELECT p.status,p.current_queue_entry_id,q.close_reason,q.queue_order::text,x.last_queue_order::text
    FROM participations p JOIN queue_entries q ON q.participation_id=p.id JOIN experiences x ON x.id=q.experience_id WHERE q.id=$1`, [entry])).rows[0];
  assert.equal(row.status, "active"); assert.equal(row.current_queue_entry_id, null); assert.equal(row.close_reason, "participant_queue_withdrawal");
  assert.equal(row.queue_order, (baseOrder+1n).toString()); assert.equal(row.last_queue_order, row.queue_order);
  assert.equal((await get(c.people[0])).body.currentQueueEntry, null);
});
test("E08.2 PostgreSQL HTTP desistência called cancela pending atomicamente sem conclusão/ausência", async () => {
  const c = await context(), entry = await enter(c), called = await call(c); assert.equal(called.status, 201);
  const r = await withdraw(c.people[0], entry).send({}); assert.equal(r.status, 200); assert.equal(r.body.serviceSession.status, "canceled");
  const row = (await pool.query(`SELECT s.status,s.cancel_reason,s.resolved_by_user_id,(s.resolved_at=q.closed_at) AS same_time,
    p.status AS participant_status,p.current_queue_entry_id,t.availability FROM service_sessions s
    JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id JOIN stations t ON t.id=s.station_id WHERE s.id=$1`, [called.body.serviceSession.id])).rows[0];
  assert.equal(row.status, "canceled"); assert.equal(row.cancel_reason, "participant_queue_withdrawal"); assert.equal(row.resolved_by_user_id, c.people[0].userId);
  assert.equal(row.same_time, true); assert.equal(row.participant_status, "active"); assert.equal(row.current_queue_entry_id, null); assert.equal(row.availability, "available");
});
test("E08.2 PostgreSQL HTTP nova tentativa tem outro ID/ordem e replays antigos não a alteram", async () => {
  const c = await context(), p = c.people[0], joinKey = randomUUID(), leaveKey = randomUUID(), first = await join(c, p, joinKey);
  assert.equal(first.status, 201); const left = await withdraw(p, first.body.queueEntryId, leaveKey); assert.equal(left.status, 200);
  const next = await join(c); assert.equal(next.status, 201); assert.notEqual(next.body.queueEntryId, first.body.queueEntryId); assert.equal(next.body.queueOrder, (baseOrder+2n).toString());
  assert.equal((await call(c)).status, 201);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_user_id=$1", [p.userId]);
  const before = await state(c), oldJoin = await join(c, p, joinKey), oldLeave = await withdraw(p, first.body.queueEntryId, leaveKey);
  assert.equal(oldJoin.status, 201); assert.deepEqual(oldJoin.body, first.body); assert.equal(oldLeave.status, 200); assert.deepEqual(oldLeave.body, left.body);
  problem(await withdraw(p, first.body.queueEntryId), 409, "QUEUE_ENTRY_NOT_CURRENT");
  problem(await withdraw(p, next.body.queueEntryId, leaveKey), 409, "IDEMPOTENCY_REQUEST_CONFLICT"); assert.equal(await state(c), before);
  const current = (await get(p)).body.currentQueueEntry;
  assert.equal(current.id, next.body.queueEntryId); assert.equal(current.status, "called"); assert.equal(current.serviceSession.status, "pending");
});
test("E08.2 PostgreSQL HTTP desistência residual permite corte de ingresso mas respeita fim operacional", async () => {
  const c = await context(), entry = await enter(c);
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
  assert.equal((await withdraw(c.people[0], entry)).status, 200); problem(await join(c), 409, "EVENT_REGISTRATION_CLOSED");
  for (const mode of ["operational", "admin"]) {
    const ended = await context(), current = await enter(ended);
    if (mode === "operational") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '2 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [ended.eventId]);
    else await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '2 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [ended.eventId]);
    const before = await state(ended); problem(await withdraw(ended.people[0], current), 409, "EVENT_OPERATION_ENDED");
    const projected = await get(ended.people[0]); assert.equal(projected.status, 200); assert.equal(projected.body.currentQueueEntry, null); assert.equal(await state(ended), before);
  }
});
test("E08.2 PostgreSQL HTTP desistência concorrente com chamada Staff preserva resultado terminal", async () => {
  const c = await context(), entry = await enter(c), r = await concurrent(c, [() => withdraw(c.people[0], entry), () => call(c)]);
  assert.equal(r[0].status, 200); assert.ok([201,409].includes(r[1].status));
  if (r[1].status === 409) problem(r[1], 409, "QUEUE_EMPTY");
  const sessions = (await pool.query("SELECT status FROM service_sessions WHERE queue_entry_id=$1", [entry])).rows;
  if (r[1].status === 201) { assert.equal(sessions.length, 1); assert.equal(sessions[0].status, "canceled"); } else assert.equal(sessions.length, 0);
  assert.equal((await get(c.people[0])).body.currentQueueEntry, null);
});
test("E08.2 PostgreSQL HTTP desistência concorrente com conclusão/ausência preserva o vencedor", async () => {
  for (const op of ["complete", "absent"] as const) {
    const c = await context(), entry = await enter(c), called = await call(c); assert.equal(called.status, 201);
    const r = await concurrent(c, [() => withdraw(c.people[0], entry), () => resolve(c, called.body.serviceSession.id, op)]);
    assert.deepEqual(r.map(x => x.status).sort(), [200,409]);
    const row = (await pool.query("SELECT status FROM service_sessions WHERE id=$1", [called.body.serviceSession.id])).rows[0];
    assert.equal(row.status, r[0].status === 200 ? "canceled" : op === "complete" ? "completed" : "absent");
    if (r[0].status === 409) problem(r[0], 409, "QUEUE_ENTRY_NOT_CURRENT"); else problem(r[1], 409, "SERVICE_NOT_PENDING");
    const current = (await get(c.people[0])).body.currentQueueEntry;
    if (r[1].status === 200 && op === "absent") { assert.notEqual(current.id, entry); assert.equal(current.status, "waiting"); } else assert.equal(current, null);
    assert.equal((await pool.query("SELECT status FROM participations WHERE id=$1", [c.people[0].participationId])).rows[0].status, "active");
  }
});
test("E08.2 PostgreSQL HTTP Admin como jogador não precisa de papel Staff", async () => {
  const c = await context(), p = c.people[0];
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'admin',NULL,clock_timestamp())", [randomUUID(), p.userId]);
  // context() já criou a única sessão não revogada permitida para este usuário.
  problem(await get(p), 401, "ADMIN_2FA_REQUIRED");
  const verified = await pool.query(`UPDATE sessions SET admin_2fa_verified_at=clock_timestamp()
    WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id,admin_2fa_verified_at`, [p.sessionId, p.userId]);
  assert.equal(verified.rowCount, 1); assert.equal(verified.rows[0].id, p.sessionId); assert.ok(verified.rows[0].admin_2fa_verified_at);
  const entry = await enter(c); assert.equal((await get(p)).status, 200); assert.equal((await withdraw(p, entry)).status, 200);
});
test("E08.2 PostgreSQL HTTP erro após escritas de ingresso faz rollback integral e permite retry", async () => {
  const c = await context(), before = await state(c), key = randomUUID(), original = joining.joinExperienceQueueAuthenticated.bind(joining); let reached = false;
  const failingDb = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
    database.transaction(async tx => {
      await callback(tx);
      const row = (await tx.execute<{ pointer: string | null }>(sql`SELECT current_queue_entry_id AS pointer FROM participations WHERE id=${c.people[0].participationId}`)).rows[0];
      assert.ok(row.pointer); reached = true; throw new Error("E082_PRIVATE_ROLLBACK");
    }, config) } as unknown as Database;
  joining.joinExperienceQueueAuthenticated = (input, context) => makeJoining(failingDb).joinExperienceQueueAuthenticated(input, context);
  try { const r = await join(c, c.people[0], key); problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(reached, true); assert.equal(await state(c), before); }
  finally { joining.joinExperienceQueueAuthenticated = original; }
  assert.equal((await join(c, c.people[0], key)).status, 201);
});
test("E08.2 PostgreSQL HTTP erro após desistência waiting/called reverte efeitos e idempotência", async () => {
  for (const called of [false,true]) {
    const c = await context(), entry = await enter(c); if (called) assert.equal((await call(c)).status, 201);
    const before = await state(c), key = randomUUID(), original = withdrawal.withdrawExperienceQueueAuthenticated.bind(withdrawal); let reached = false;
    const failingDb = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<Database["transaction"]>[1]) =>
      database.transaction(async tx => {
        await callback(tx);
        const row = (await tx.execute<{ pointer: string | null; status: string; sessionStatus: string | null }>(sql`SELECT p.current_queue_entry_id AS pointer,q.status,s.status AS "sessionStatus"
          FROM participations p JOIN queue_entries q ON q.participation_id=p.id LEFT JOIN service_sessions s ON s.queue_entry_id=q.id WHERE q.id=${entry}`)).rows[0];
        assert.equal(row.pointer, null); assert.equal(row.status, "closed"); assert.equal(row.sessionStatus, called ? "canceled" : null);
        reached = true; throw new Error("E082_PRIVATE_ROLLBACK");
      }, config) } as unknown as Database;
    withdrawal.withdrawExperienceQueueAuthenticated = (input, context) => makeWithdrawal(failingDb).withdrawExperienceQueueAuthenticated(input, context);
    try { const r = await withdraw(c.people[0], entry, key); problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(reached, true); assert.equal(await state(c), before); }
    finally { withdrawal.withdrawExperienceQueueAuthenticated = original; }
    assert.equal((await withdraw(c.people[0], entry, key)).status, 200);
  }
});
