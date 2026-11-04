import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import supertest from "supertest";
import type * as schema from "../../src/database/schema";
import type { ParticipationsService } from "../../src/participations/participations.service";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Guarda executada ANTES de importar AppModule/providers; nunca consulta .env ou banco remoto.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test" || url.search || url.hash || !url.username) throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 8, connectionTimeoutMillis: 2000, statement_timeout: 20000, lock_timeout: 16000 });
let app: INestApplication, database: NodePgDatabase<typeof schema>, participations: ParticipationsService, queues: QueueEntryService;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
let fingerprint: typeof import("../../src/events/admin-close.service").closeFingerprint;
const operation = "admin_close_event", reason = "Encerramento autorizado pela organização";
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[], games: [] as string[] };
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { AppModule } = await import("../../src/app.module"), { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ParticipationsService } = await import("../../src/participations/participations.service"), { QueueEntryService } = await import("../../src/events/queue-entry.service");
  fingerprint = (await import("../../src/events/admin-close.service")).closeFingerprint;
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now() - 120000, ttlSeconds: 1 } : undefined);
  app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE); participations = app.get(ParticipationsService); queues = app.get(QueueEntryService);
});
after(async () => {
  const errors: unknown[] = [];
  try {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("DELETE FROM audit_logs WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
      await c.query("DELETE FROM games WHERE id=ANY($1::uuid[])", [ids.games]);
      await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
      await c.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [ids.versions]); await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  } catch (e) { errors.push(e); }
  for (const r of await Promise.allSettled([app?.close(), pool.end()])) if (r.status === "rejected") errors.push(r.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.8 falhou.");
});
async function account() {
  const userId = randomUUID(), sessionId = randomUUID(); ids.users.push(userId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Pessoa privada E088',$2,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, `${userId}@example.test`]);
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`, [sessionId, userId]);
  return { userId, sessionId, token: signAccess(userId, sessionId) };
}
async function grant(userId: string, eventId: string | null) {
  const roleId = randomUUID(); await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())", [roleId, userId, eventId ? "staff" : "admin", eventId]); return roleId;
}
async function admin() {
  const a = await account(), roleId = await grant(a.userId, null); await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1", [a.sessionId]); return { ...a, roleId };
}
interface Context { eventId: string; experienceId: string; stationId: string; admin: Awaited<ReturnType<typeof admin>>; staff: Awaited<ReturnType<typeof account>> }
async function context(): Promise<Context> {
  const eventId = randomUUID(), experienceId = randomUUID(), stationId = randomUUID(); ids.events.push(eventId);
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
    VALUES($1,'E088 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,9007199254741000,clock_timestamp(),clock_timestamp())`, [eventId, `E088-${eventId.toUpperCase()}`]);
  const actor = await admin(), staff = await account(); await grant(staff.userId, eventId);
  await pool.query("INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at) VALUES($1,$2,'Experiência E088',9007199254741000,clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação E088','available',clock_timestamp(),clock_timestamp())", [stationId, experienceId]);
  return { eventId, experienceId, stationId, admin: actor, staff };
}
async function proposal(c: Context, minutes = 120, margin = 30) {
  const r = (await pool.query("SELECT date_trunc('milliseconds',clock_timestamp()) + $1::int*interval '1 minute' AS at", [minutes])).rows[0].at as Date;
  return { officialEndsAt: r.toISOString(), operationalDeadlineAt: new Date(r.getTime() + margin * 60000).toISOString(), reason };
}
const route = (c: Context) => `/api/v1/admin/events/${c.eventId}/schedule`;
const patch = (c: Context, body: object, key: string = randomUUID(), actor: { token: string } = c.admin) => supertest(app.getHttpServer()).patch(route(c)).set("Authorization", `Bearer ${actor.token}`).set("Idempotency-Key", key).send(body);
const external = (c: Context) => supertest(app.getHttpServer()).patch(`/api/v1/admin/events/${c.eventId}/external-queue`).set("Authorization", `Bearer ${c.admin.token}`).set("Idempotency-Key", randomUUID()).send({ enabled: false, reason });
const station = (c: Context) => supertest(app.getHttpServer()).patch(`/api/v1/staff/events/${c.eventId}/stations/${c.stationId}/availability`).set("Authorization", `Bearer ${c.admin.token}`).send({ availability: "unavailable" });
async function person(c: Context, status: "waiting" | "active" | "finished" | "canceled" = "active") {
  const a = await account(), participationId = randomUUID(), terminal = status === "finished" || status === "canceled";
  const order = status === "waiting" ? (await pool.query("UPDATE events SET external_last_order=external_last_order+1 WHERE id=$1 RETURNING external_last_order::text AS n", [c.eventId])).rows[0].n : null;
  await pool.query(`INSERT INTO participations(id,user_id,event_id,status,external_queue_order,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4::varchar(20),$5,clock_timestamp(),CASE WHEN $6::boolean THEN clock_timestamp() END,
      CASE WHEN $7::boolean THEN clock_timestamp() END,CASE WHEN $7::boolean THEN 'fixture_terminal' END)`, [participationId, a.userId, c.eventId, status, order, status === "active", terminal]);
  return { ...a, participationId };
}
async function readyEntrant() {
  const a = await account(), version = randomUUID(), game = randomUUID(); ids.versions.push(version); ids.games.push(game);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [version, `e88-${version}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [a.userId, version]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [game, `E088-${game}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [a.userId, game]); return a;
}
const admit = (c: Context, a: { userId: string }) => participations.createParticipation({ userId: a.userId, eventId: c.eventId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
const join = (c: Context, a: { userId: string; participationId: string }) => queues.joinExperienceQueue({ userId: a.userId, participationId: a.participationId, experienceId: c.experienceId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
const audit = async (c: Context) => (await pool.query("SELECT * FROM audit_logs WHERE event_id=$1 AND action='event_admin_closed' ORDER BY occurred_at,id", [c.eventId])).rows;
async function state(c: Context) {
  return (await pool.query(`SELECT jsonb_build_object(
    'event',(SELECT to_jsonb(e)||jsonb_build_object('external_last_order',e.external_last_order::text) FROM events e WHERE e.id=$1),
    'people',(SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('external_queue_order',p.external_queue_order::text) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
    'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.participation_id) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.event_id=$1),
    'experiences',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('last_queue_order',e.last_queue_order::text) ORDER BY e.id) FROM experiences e WHERE e.event_id=$1),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
    'queues',(SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('queue_order',q.queue_order::text) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
    'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
    'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_logs a WHERE a.event_id=$1),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=$2 AND i.operation=$3)) AS value`, [c.eventId, c.admin.userId, operation])).rows[0].value;
}
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.status, status); assert.equal(r.body.code, code);
  assert.match(r.headers["content-type"], /application\/problem\+json/); assert.equal(JSON.stringify(r.body).includes("@example.test"), false);
}
async function blocked(pid: number) {
  const until = Date.now() + 6000;
  while (Date.now() < until) { if ((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid])).rows[0].n > 0) return; await new Promise(done => setTimeout(done, 20)); }
  throw new Error("Espera real pelo lock não observada.");
}
async function ordered<A, B>(first: () => PromiseLike<A>, second: () => PromiseLike<B>, whileBlocked?: (pid: number) => Promise<void>): Promise<[A, B]> {
  const original = database.transaction.bind(database) as typeof database.transaction; let ready!: (pid: number) => void, release!: () => void;
  const reached = new Promise<number>(yes => { ready = yes; }), gate = new Promise<void>(yes => { release = yes; });
  database.transaction = (callback, config) => original(async tx => { const value = await callback(tx); ready((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); await gate; return value; }, config);
  let a: Promise<A> | undefined, b: Promise<B> | undefined;
  try {
    a = Promise.resolve(first()); a.catch(() => undefined); const pid = await Promise.race([reached, a.then(() => { throw new Error("Primeira operação não manteve tx."); })]);
    database.transaction = original; b = Promise.resolve(second()); b.catch(() => undefined); await blocked(pid); await whileBlocked?.(pid); release(); return await Promise.all([a, b]);
  } finally { database.transaction = original; release(); await Promise.allSettled([a, b]); }
}
async function lockWait(c: Context, request: () => PromiseLike<supertest.Response>, change: (client: PoolClient, pid: number) => Promise<void>, lock: "event" | "role" | "account" | "participation" | "station" = "event") {
  const client = await pool.connect(); let pending: Promise<supertest.Response> | undefined;
  try {
    await client.query("BEGIN");
    if (lock === "event") await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [c.eventId]);
    if (lock === "role") await client.query("SELECT id FROM user_roles WHERE id=$1 FOR UPDATE", [c.admin.roleId]);
    if (lock === "account") await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [c.admin.userId]);
    if (lock === "participation") await client.query("SELECT id FROM participations WHERE event_id=$1 ORDER BY id FOR UPDATE", [c.eventId]);
    if (lock === "station") await client.query("SELECT id FROM stations WHERE id=$1 FOR UPDATE", [c.stationId]);
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = Promise.resolve(request()); pending.catch(() => undefined); await blocked(pid); await change(client, pid); await client.query("COMMIT"); return await pending;
  } finally { await client.query("ROLLBACK"); await Promise.allSettled([pending]); client.release(); }
}
async function waitPast(at: string, pid: number) {
  assert.equal((await pool.query('SELECT clock_timestamp()<$1::timestamptz AS "beforeCut"', [at])).rows[0].beforeCut, true, "Espera precisa começar antes do corte.");
  const until = Date.now() + 14000; let crossed = false;
  while (Date.now() < until) { if ((await pool.query("SELECT clock_timestamp()>=$1::timestamptz AS ended", [at])).rows[0].ended) { crossed = true; break; } await new Promise(done => setTimeout(done, 100)); }
  assert.equal(crossed, true); await blocked(pid);
}

const closeRoute = (c: Context) => `/api/v1/admin/events/${c.eventId}/close`;
const immediate = () => ({ mode: "immediate" as const, reason });
async function controlled(seconds = 1800) {
  const at = (await pool.query("SELECT date_trunc('milliseconds',clock_timestamp())+$1::int*interval '1 second' AS at", [seconds])).rows[0].at as Date;
  return { mode: "controlled" as const, reason, controlledUntilAt: at.toISOString() };
}
const close = (c: Context, body: object = immediate(), key: string = randomUUID(), actor: { token: string } = c.admin) => supertest(app.getHttpServer()).post(closeRoute(c)).set("Authorization", `Bearer ${actor.token}`).set("Idempotency-Key", key).send(body);
const call = (c: Context) => supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`).set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID()).send({});
const resolve = (c: Context, session: string, action: "complete" | "absent") => supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/service-sessions/${session}/${action}`).set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID()).send({});
const withdraw = (c: Context, p: Awaited<ReturnType<typeof person>>, entry: string) => supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/queue-entries/${entry}/withdraw`).set("Authorization", `Bearer ${p.token}`).set("Idempotency-Key", randomUUID()).send({});
async function queued(c: Context) { const p = await person(c), q = await join(c, p); assert.equal(q.kind, "created"); if (q.kind !== "created") assert.fail(); return { p, entry: q.queueEntryId }; }
async function called(c: Context) { const q = await queued(c), r = await call(c); assert.equal(r.status, 201, JSON.stringify(r.body)); return { ...q, session: r.body.serviceSession.id as string }; }
async function rich(c: Context) {
  const outside = await person(c, "waiting"), idle = await person(c), history = await called(c); assert.equal((await resolve(c, history.session, "complete")).status, 200);
  const pending = await called(c), waiting = await queued(c); await person(c, "finished"); await person(c, "canceled");
  const v = randomUUID(); ids.versions.push(v); await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [v, `e88-${v}`]);
  for (const p of [outside, idle]) await pool.query("INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at) VALUES($1,$2,'{\"private\":\"E088_PRIVATE\"}','[]',clock_timestamp())", [p.participationId, v]);
  return { outside, idle, history, pending, waiting };
}
async function assertNoOpen(c: Context) {
  const r = (await pool.query(`SELECT
    (SELECT count(*)::int FROM participations WHERE event_id=$1 AND (status IN ('waiting','active') OR current_queue_entry_id IS NOT NULL)) AS people,
    (SELECT count(*)::int FROM queue_entries WHERE event_id=$1 AND status IN ('waiting','called')) AS queues,
    (SELECT count(*)::int FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=$1 AND s.status='pending') AS pending,
    (SELECT count(*)::int FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE p.event_id=$1) AS evaluations`, [c.eventId])).rows[0];
  assert.deepEqual(r, { people: 0, queues: 0, pending: 0, evaluations: 0 });
}
test("E08.8 PostgreSQL imediato encerra tudo atomicamente sem alterar completed/histórico/snapshots/outro evento", async () => {
  const c = await context(), other = await context(), data = await rich(c); await rich(other); const before = await state(c), otherBefore = await state(other), r = await close(c); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["closureMode", "effectiveOperationalDeadlineAt", "eventId", "externalWaitingFinalized", "newEntriesClosedAt", "status"]); assert.equal(r.body.status, "closed"); assert.equal(r.body.closureMode, "immediate"); assert.equal(r.body.externalWaitingFinalized, 1); assert.equal(r.body.newEntriesClosedAt, r.body.effectiveOperationalDeadlineAt); assert.match(r.body.newEntriesClosedAt, /\.\d{6}Z$/);
  await assertNoOpen(c); const after = await state(c); for (const key of ["snapshots", "experiences", "stations"]) assert.deepEqual(after[key], before[key]); assert.deepEqual(await state(other), otherBefore);
  for (const p of before.people) { const next = after.people.find((n: { id: string }) => n.id === p.id); if (["finished", "canceled"].includes(p.status)) assert.deepEqual(next, p); else { assert.equal(next.status, "finished"); assert.equal(next.finish_reason, "admin_immediate"); assert.equal(next.current_queue_entry_id, null); assert.equal(Date.parse(next.finished_at), Date.parse(r.body.newEntriesClosedAt)); assert.equal(next.external_queue_order, p.external_queue_order); assert.equal(next.arena_entered_at, p.arena_entered_at); } }
  for (const s of before.services) { const next = after.services.find((n: { id: string }) => n.id === s.id); if (s.status !== "pending") assert.deepEqual(next, s); else { assert.equal(next.status, "canceled"); assert.equal(next.cancel_reason, "admin_immediate"); assert.equal(next.resolved_by_user_id, c.admin.userId); } }
  assert.equal(after.services.find((s: { id: string }) => s.id === data.history.session).status, "completed");
  const exact = (await pool.query(`SELECT
    NOT EXISTS(SELECT 1 FROM participations p JOIN events e ON e.id=p.event_id WHERE p.event_id=$1 AND p.finish_reason='admin_immediate' AND p.finished_at<>e.closure_requested_at) AS people,
    NOT EXISTS(SELECT 1 FROM queue_entries q JOIN events e ON e.id=q.event_id WHERE q.event_id=$1 AND q.close_reason='admin_immediate' AND q.closed_at<>e.closure_requested_at) AS queues,
    NOT EXISTS(SELECT 1 FROM service_sessions s JOIN experiences x ON x.id=s.experience_id JOIN events e ON e.id=x.event_id WHERE e.id=$1 AND s.cancel_reason='admin_immediate' AND s.resolved_at<>e.closure_requested_at) AS services`, [c.eventId])).rows[0]; assert.deepEqual(exact, { people: true, queues: true, services: true });
  const a = (await audit(c))[0]; assert.equal((await audit(c)).length, 1); assert.equal(a.actor_user_id, c.admin.userId); assert.equal(a.reason, reason); assert.equal(a.origin, "user"); assert.equal(a.category, "event"); assert.equal(a.metadata.before.status, "open"); assert.equal(a.metadata.after.status, "closed"); assert.equal(a.metadata.externalWaitingFinalized, 1);
  assert.equal((await pool.query("SELECT occurred_at=$2::timestamptz AS exact FROM audit_logs WHERE id=$1", [a.id, r.body.newEntriesClosedAt])).rows[0].exact, true);
});
test("E08.8 PostgreSQL controlado fecha waiting externas e preserva active com/sem fila e pending", async () => {
  const c = await context(), data = await rich(c), before = await state(c), body = await controlled(), r = await close(c, body); assert.equal(r.status, 200); assert.equal(r.body.status, "closing"); assert.equal(r.body.externalWaitingFinalized, 1); assert.equal(Date.parse(r.body.effectiveOperationalDeadlineAt), Date.parse(body.controlledUntilAt));
  const after = await state(c); for (const key of ["queues", "services", "snapshots", "experiences", "stations"]) assert.deepEqual(after[key], before[key]);
  for (const p of before.people) { const next = after.people.find((n: { id: string }) => n.id === p.id); if (p.status !== "waiting") assert.deepEqual(next, p); else { assert.equal(next.status, "finished"); assert.equal(next.finish_reason, "admin_controlled_external_wait_closed"); assert.equal(next.arena_entered_at, null); } }
  assert.equal(after.people.find((p: { id: string }) => p.id === data.idle.participationId).status, "active");
  const entrant = await readyEntrant(), denied = await admit(c, entrant); assert.equal(denied.kind, "blocked"); if (denied.kind !== "blocked") assert.fail(); assert.deepEqual(denied.eligibility.blockingReasons, ["EVENT_REGISTRATION_CLOSED"]);
  const newEntry = await join(c, data.idle); assert.equal(newEntry.kind, "event_closed"); problem(await external(c), 409, "EVENT_REGISTRATION_CLOSED"); problem(await patch(c, await proposal(c)), 409, "EVENT_TIME_CHANGE_CLOSED");
  assert.equal((await resolve(c, data.pending.session, "complete")).status, 200); const residual = await call(c); assert.equal(residual.status, 201);
  const absent = await resolve(c, residual.body.serviceSession.id, "absent"); assert.equal(absent.status, 200); assert.equal(absent.body.requeued, false); assert.equal(absent.body.newQueueEntry, null);
  assert.equal((await state(c)).people.find((p: { id: string }) => p.id === data.idle.participationId).status, "active");
});
for (const mode of ["immediate", "controlled"] as const) test(`E08.8 PostgreSQL ${mode} pode encerrar evento sem prontidão/antes do início`, async () => {
  const c = await context(); await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1", [c.eventId]); await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]); await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE event_id=$1", [c.eventId]);
  const r = await close(c, mode === "immediate" ? immediate() : await controlled()); assert.equal(r.status, 200); assert.equal(r.body.externalWaitingFinalized, 0);
});
test("E08.8 PostgreSQL imediato após prazo operacional preserva deadline efetivo mínimo", async () => {
  const c = await context(); await person(c); await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',operational_deadline_at=clock_timestamp()-interval '10 minutes' WHERE id=$1", [c.eventId]); const r = await close(c); assert.equal(r.status, 200); assert.ok(Date.parse(r.body.effectiveOperationalDeadlineAt) < Date.parse(r.body.newEntriesClosedAt)); await assertNoOpen(c);
});
test("E08.8 PostgreSQL prazos controlados passado/igual/agora/além de hora ou limite original são recusados", async () => {
  for (const seconds of [-1, 0, 3601, 7200]) { const c = await context(), before = await state(c); problem(await close(c, await controlled(seconds)), 409, "CLOSURE_DEADLINE_INVALID"); assert.deepEqual(await state(c), before); }
  const c = await context(); await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '5 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [c.eventId]); const before = await state(c); problem(await close(c, await controlled()), 409, "CLOSURE_DEADLINE_INVALID"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL controlado aceita limite original exato e limite de uma hora", async () => {
  for (const boundary of ["original", "hour"]) { const c = await context(); if (boundary === "original") await pool.query("UPDATE events SET official_ends_at=date_trunc('milliseconds',clock_timestamp())+interval '20 minutes',operational_deadline_at=date_trunc('milliseconds',clock_timestamp())+interval '30 minutes' WHERE id=$1", [c.eventId]);
    const until = boundary === "original" ? ((await pool.query("SELECT operational_deadline_at FROM events WHERE id=$1", [c.eventId])).rows[0].operational_deadline_at as Date).toISOString() : (await controlled(3600)).controlledUntilAt;
    const r = await close(c, { mode: "controlled", controlledUntilAt: until, reason }); assert.equal(r.status, 200); assert.equal(Date.parse(r.body.effectiveOperationalDeadlineAt), Date.parse(until)); }
});
test("E08.8 PostgreSQL auth atual exige Admin global/TOTP/conta e sessão ativos", async () => {
  for (const mode of ["participant", "staff", "role", "2fa", "inactive", "revoked", "expired"]) { const c = await context(), a = mode === "participant" ? await account() : mode === "staff" ? c.staff : c.admin;
    if (mode === "role") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]);
    if (mode === "2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [a.sessionId]);
    if (mode === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [a.userId]);
    if (mode === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [a.sessionId]);
    if (mode === "expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [a.sessionId]);
    const before = await state(c); problem(await close(c, immediate(), randomUUID(), a), ["participant", "staff", "role"].includes(mode) ? 403 : 401,
      ["participant", "staff", "role"].includes(mode) ? "ADMIN_REQUIRED" : mode === "2fa" ? "ADMIN_2FA_REQUIRED" : mode === "inactive" ? "ACCOUNT_DEACTIVATED" : mode === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED"); assert.deepEqual(await state(c), before); }
});
test("E08.8 PostgreSQL Bearer/token/sessão/UUID/recurso inválidos usam RFC 7807", async () => {
  const c = await context(), before = await state(c); problem(await supertest(app.getHttpServer()).post(closeRoute(c)).send(immediate()), 401, "MISSING_ACCESS_TOKEN");
  problem(await close(c, immediate(), randomUUID(), { token: "invalid" }), 401, "INVALID_ACCESS_TOKEN"); problem(await close(c, immediate(), randomUUID(), { token: signAccess(c.admin.userId, c.admin.sessionId, true) }), 401, "ACCESS_TOKEN_EXPIRED");
  problem(await close(c, immediate(), randomUUID(), { token: signAccess(c.admin.userId, randomUUID()) }), 401, "INVALID_SESSION");
  problem(await close({ ...c, eventId: "bad" }), 400, "VALIDATION_ERROR"); problem(await close({ ...c, eventId: randomUUID() }), 404, "RESOURCE_NOT_FOUND"); problem(await close({ ...c, eventId: randomUUID() }, immediate(), randomUUID(), c.staff), 403, "ADMIN_REQUIRED"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL body, modo, reason, prazo e header estritos antes de efeitos", async () => {
  const c = await context(), before = await state(c), req = () => supertest(app.getHttpServer()).post(closeRoute(c)).set("Authorization", `Bearer ${c.admin.token}`).set("Idempotency-Key", randomUUID());
  problem(await req(), 400, "VALIDATION_ERROR"); problem(await req().type("application/json").send("{bad"), 400, "BAD_REQUEST");
  for (const body of [{}, [], { mode: "bad", reason }, { mode: "controlled", reason }, { ...immediate(), controlledUntilAt: "2026-11-05T19:00:00Z" }, { ...immediate(), reason: " " }, { ...immediate(), reason: "x\u0000y" }, { ...immediate(), reason: "x".repeat(501) },
    ...["bad", "2026-02-30T00:00:00Z", "2026-11-05T19:00:00", "2026-11-05T19:00:00.1234Z"].map(controlledUntilAt => ({ mode: "controlled", reason, controlledUntilAt })),
    ...["userId", "status", "closureRequestedAt", "adminDeadlineAt", "queueAcceptingEntries"].map(key => ({ ...immediate(), [key]: "private" }))]) problem(await req().send(body), 400, "VALIDATION_ERROR");
  problem(await req().type("text/plain").send(JSON.stringify(immediate())), 400, "VALIDATION_ERROR");
  problem(await supertest(app.getHttpServer()).post(closeRoute(c)).set("Authorization", `Bearer ${c.admin.token}`).send(immediate()), 400, "VALIDATION_ERROR");
  for (const key of ["", " ", "x".repeat(129)]) problem(await req().set("Idempotency-Key", key).send(immediate()), 400, "VALIDATION_ERROR"); problem(await req().set({ "Idempotency-Key": ["a", "b"] }).send(immediate()), 400, "VALIDATION_ERROR"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL resposta mínima não vaza motivo/identidade/snapshot e audita trim", async () => {
  const c = await context(); await rich(c); const r = await close(c, { ...immediate(), reason: ` ${reason} ` }); assert.equal(r.status, 200); assert.equal((await audit(c))[0].reason, reason);
  for (const secret of [reason, c.admin.userId, c.admin.sessionId, "E088_PRIVATE", "Pessoa privada", "@example.test", "metadata", "before"]) assert.equal(JSON.stringify(r.body).includes(secret), false);
});
for (const mode of ["closing", "closed", "stale-controlled", "stale-immediate"]) test(`E08.8 PostgreSQL evento ${mode} não aceita outra intenção`, async () => {
  const c = await context(); if (mode === "closing" || mode === "closed") await pool.query("UPDATE events SET status=$2::varchar(20) WHERE id=$1", [c.eventId, mode]);
  else await pool.query(`UPDATE events SET closure_mode=$2::varchar(20),closure_requested_at=statement_timestamp()-interval '1 minute',
    admin_deadline_at=CASE WHEN $2::varchar(20)='immediate' THEN statement_timestamp()-interval '1 minute' ELSE statement_timestamp()+interval '20 minutes' END WHERE id=$1`, [c.eventId, mode === "stale-immediate" ? "immediate" : "controlled"]);
  const before = await state(c); problem(await close(c), 409, "EVENT_ALREADY_CLOSED"); problem(await close(c, await controlled()), 409, "EVENT_ALREADY_CLOSED"); assert.deepEqual(await state(c), before);
});
for (const mode of ["immediate", "controlled"] as const) test(`E08.8 PostgreSQL retry ${mode} conserva resposta e efeito único após prazo técnico vencido`, async () => {
  const c = await context(); await rich(c); const body = mode === "immediate" ? immediate() : await controlled(), key = randomUUID(), first = await close(c, body, key); assert.equal(first.status, 200);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 hour' WHERE actor_user_id=$1 AND operation=$2", [c.admin.userId, operation]); const before = await state(c), retry = await close(c, body, key); assert.equal(retry.status, 200); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 1);
});
test("E08.8 PostgreSQL replay controlado após estado posterior não reaplica limpeza ou prazo", async () => {
  const c = await context(), data = await rich(c), body = await controlled(), key = randomUUID(), first = await close(c, body, key); assert.equal(first.status, 200); assert.equal((await resolve(c, data.pending.session, "complete")).status, 200);
  // Estado posterior de fixture, sem implementar job ou segunda intenção fora do escopo.
  await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]); const before = await state(c), retry = await close(c, body, key); assert.equal(retry.status, 200); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL segunda intenção controlada distinta não encurta nem converte fechamento", async () => {
  const c = await context(), body = await controlled(), key = randomUUID(); assert.equal((await close(c, body, key)).status, 200); const before = await state(c);
  problem(await close(c, await controlled(600)), 409, "EVENT_ALREADY_CLOSED"); problem(await close(c), 409, "EVENT_ALREADY_CLOSED"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL conflitos de chave incluem modo/prazo/motivo/evento e normalização preserva intenção", async () => {
  const c = await context(), body = await controlled(), key = randomUUID(), first = await close(c, body, key); assert.equal(first.status, 200);
  const before = await state(c); for (const value of [immediate(), { ...body, reason: "outro" }, { ...body, controlledUntilAt: new Date(Date.parse(body.controlledUntilAt) + 1).toISOString() }]) problem(await close(c, value, key), 409, "IDEMPOTENCY_KEY_REUSED");
  const other = { ...await context(), admin: c.admin }, otherBefore = await state(other); problem(await close(other, body, key), 409, "IDEMPOTENCY_KEY_REUSED"); assert.deepEqual(await state(other), otherBefore);
  const retry = await close(c, { ...body, reason: ` ${reason} `, controlledUntilAt: body.controlledUntilAt.replace("Z", "+00:00") }, key); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL namespace/atores não compartilham intenção e replay exige autorização atual", async () => {
  const c = await context(), key = randomUUID(), body = immediate(); assert.equal((await supertest(app.getHttpServer()).patch(`/api/v1/admin/events/${c.eventId}/external-queue`).set("Authorization", `Bearer ${c.admin.token}`).set("Idempotency-Key", key).send({ enabled: false, reason })).status, 200);
  assert.equal((await close(c, body, key)).status, 200); const other = await admin(); problem(await close(c, body, key, other), 409, "EVENT_ALREADY_CLOSED");
  for (const mode of ["2fa", "role"]) { if (mode === "2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [c.admin.sessionId]); else { await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1", [c.admin.sessionId]); await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]); }
    const before = await state(c); problem(await close(c, body, key), mode === "role" ? 403 : 401, mode === "role" ? "ADMIN_REQUIRED" : "ADMIN_2FA_REQUIRED"); assert.deepEqual(await state(c), before); }
});
test("E08.8 PostgreSQL in_progress e recusa de prazo não deixam novas reservas parciais", async () => {
  const c = await context(), key = randomUUID(); await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 hour')`, [randomUUID(), c.admin.userId, operation, key, fingerprint(c.eventId, immediate())]);
  const before = await state(c); problem(await close(c, immediate(), key), 409, "IDEMPOTENCY_IN_PROGRESS"); assert.deepEqual(await state(c), before);
  const newKey = randomUUID(); problem(await close(c, await controlled(-1), newKey), 409, "CLOSURE_DEADLINE_INVALID"); assert.equal((await close(c, immediate(), newKey)).status, 200);
});
test("E08.8 PostgreSQL falhas SQL reais em cada fase revertem corte, pessoas, filas, serviços, auditoria e intenção", async () => {
  const dialect = new PgDialect();
  for (const phase of ["event", "services", "queues", "people", "audit", "complete"]) {
    const c = await context(); await rich(c); const key = randomUUID(), before = await state(c), original = database.transaction.bind(database) as typeof database.transaction; let reached = false;
    database.transaction = (callback, config) => original(async tx => { const execute = tx.execute.bind(tx); tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
      const q = args[0], text = typeof q === "string" ? q : dialect.sqlToQuery(q.getSQL()).sql, result = await execute(...args);
      const current = text.includes("WITH decision AS MATERIALIZED") ? "event" : text.includes("UPDATE service_sessions") ? "services" : text.includes("UPDATE queue_entries") ? "queues" : text.includes("WITH targets AS MATERIALIZED") ? "people" : text.includes("INSERT INTO audit_logs") ? "audit" : "";
      if (current === phase) { assert.ok(result.rows.length > 0); reached = true; await execute(sql`SELECT 1/0`); } return result;
    }) as typeof tx.execute;
      const value = await callback(tx);
      if (phase === "complete") {
        // O query builder de conclusão não passa por tx.execute. Provar o estado
        // persistido nesta execução, dentro do mesmo tx e antes do COMMIT.
        const intent = (await execute<{ status: string; httpStatus: number; resultReference: string; resultPayload: unknown }>(sql`
          SELECT status,http_status AS "httpStatus",result_reference AS "resultReference",result_payload AS "resultPayload"
          FROM idempotency_operations WHERE actor_user_id=${c.admin.userId} AND operation=${operation} AND idempotency_key=${key}`)).rows;
        assert.equal(intent.length, 1); assert.equal(intent[0].status, "completed"); assert.equal(intent[0].httpStatus, 200); assert.equal(intent[0].resultReference, c.eventId);
        const completed: unknown = value;
        assert.ok(completed && typeof completed === "object" && !Array.isArray(completed) && "kind" in completed
          && "eventId" in completed && "status" in completed && "closureMode" in completed && "externalWaitingFinalized" in completed);
        assert.equal(completed.kind, "completed"); assert.equal(completed.eventId, c.eventId); assert.equal(completed.status, "closed"); assert.equal(completed.closureMode, "immediate"); assert.equal(completed.externalWaitingFinalized, 1);
        const { kind, ...payload } = completed; assert.equal(kind, "completed"); assert.deepEqual(intent[0].resultPayload, payload);
        const effects = (await execute<{ eventClosed: boolean; finalized: number; openPeople: number; pointers: number; openQueues: number; pending: number; canceled: number; completed: number; audits: number }>(sql`
          SELECT (SELECT status='closed' AND closure_mode='immediate' AND closure_requested_at IS NOT NULL
              AND admin_deadline_at=closure_requested_at FROM events WHERE id=${c.eventId}) AS "eventClosed",
            (SELECT count(*)::int FROM participations WHERE event_id=${c.eventId} AND status='finished' AND finish_reason='admin_immediate') AS finalized,
            (SELECT count(*)::int FROM participations WHERE event_id=${c.eventId} AND status IN ('waiting','active')) AS "openPeople",
            (SELECT count(*)::int FROM participations WHERE event_id=${c.eventId} AND current_queue_entry_id IS NOT NULL) AS pointers,
            (SELECT count(*)::int FROM queue_entries WHERE event_id=${c.eventId} AND status IN ('waiting','called')) AS "openQueues",
            (SELECT count(*)::int FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${c.eventId} AND s.status='pending') AS pending,
            (SELECT count(*)::int FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${c.eventId} AND s.status='canceled' AND s.cancel_reason='admin_immediate') AS canceled,
            (SELECT count(*)::int FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${c.eventId} AND s.status='completed') AS completed,
            (SELECT count(*)::int FROM audit_logs WHERE event_id=${c.eventId} AND action='event_admin_closed') AS audits`)).rows;
        assert.deepEqual(effects, [{ eventClosed: true, finalized: 5, openPeople: 0, pointers: 0, openQueues: 0, pending: 0, canceled: 1, completed: 1, audits: 1 }]);
        reached = true; await execute(sql`SELECT 1/0`);
      }
      return value;
    }, config);
    try { problem(await close(c, immediate(), key), 500, "INTERNAL_SERVER_ERROR"); } finally { database.transaction = original; }
    assert.equal(reached, true); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 0);
  }
});
test("E08.8 PostgreSQL retries concorrentes retornam exatamente a mesma resposta e uma auditoria", async () => {
  const c = await context(); await rich(c); const body = immediate(), key = randomUUID(), [a, b] = await ordered(() => close(c, body, key), () => close(c, body, key)); assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(a.body, b.body); assert.equal((await audit(c)).length, 1); await assertNoOpen(c);
});
test("E08.8 PostgreSQL intenções concorrentes distintas não inventam encurtamento controlado", async () => {
  const c = await context(), body = await controlled(), [a, b] = await ordered(() => close(c, body), () => close(c));
  assert.equal(a.status, 200); problem(b, 409, "EVENT_ALREADY_CLOSED"); assert.equal((await audit(c)).length, 1);
});
for (const mode of ["immediate", "controlled"] as const) for (const first of ["close", "operation"] as const) for (const name of ["E03", "E07.1", "E07.4", "E07.5", "E07.6", "E07.3", "E08.5", "E08.6", "E08.7"] as const) test(`E08.8 PostgreSQL ${mode}, ${name}, ${first} primeiro serializa efeitos`, async () => {
  const c = await context(), entrant = name === "E03" ? await readyEntrant() : undefined;
  const pending = name === "E07.5" || name === "E07.6" ? await called(c) : undefined;
  const waiting = name === "E07.4" || name === "E07.3" ? await queued(c) : undefined;
  const idle = name === "E07.1" ? await person(c) : undefined;
  if (name === "E08.6") await person(c, "waiting");
  const schedule = name === "E08.7" ? await proposal(c) : undefined;
  const body = mode === "immediate" ? immediate() : await controlled();
  const operationRequest = async (): Promise<string> => {
    if (name === "E03") { assert.ok(entrant); const r = await admit(c, entrant); if (first === "close") { assert.equal(r.kind, "blocked"); if (r.kind !== "blocked") assert.fail(); assert.deepEqual(r.eligibility.blockingReasons, ["EVENT_REGISTRATION_CLOSED"]); } return r.kind; }
    if (name === "E07.1") { assert.ok(idle); return (await join(c, idle)).kind; }
    let r: supertest.Response;
    if (name === "E07.4") r = await call(c);
    else if (name === "E07.5" || name === "E07.6") { assert.ok(pending); r = await resolve(c, pending.session, name === "E07.5" ? "complete" : "absent"); if (name === "E07.6" && first === "close" && mode === "controlled") { assert.equal(r.body.requeued, false); assert.equal(r.body.newQueueEntry, null); } }
    else if (name === "E07.3") { assert.ok(waiting); r = await withdraw(c, waiting.p, waiting.entry); }
    else if (name === "E08.5") r = await station(c);
    else if (name === "E08.6") r = await external(c);
    else { assert.ok(schedule); r = await patch(c, schedule); }
    if (r.status >= 400) { assert.equal(r.status, 409, JSON.stringify(r.body)); assert.match(r.headers["content-type"], /application\/problem\+json/); return r.body.code as string; }
    return String(r.status);
  };
  let result: supertest.Response, code: string;
  if (first === "close") [result, code] = await ordered(() => close(c, body), operationRequest);
  else [code, result] = await ordered(operationRequest, () => close(c, body));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const success = { E03: "created", "E07.1": "created", "E07.4": "201", "E07.5": "200", "E07.6": "200", "E07.3": "200", "E08.5": "200", "E08.6": "200", "E08.7": "200" };
  const afterImmediate = { E03: "blocked", "E07.1": "participation_not_active", "E07.4": "EVENT_OPERATION_ENDED", "E07.5": "SERVICE_NOT_PENDING", "E07.6": "SERVICE_NOT_PENDING", "E07.3": "PARTICIPATION_NOT_ACTIVE", "E08.5": "EVENT_OPERATION_ENDED", "E08.6": "EVENT_REGISTRATION_CLOSED", "E08.7": "EVENT_TIME_CHANGE_CLOSED" };
  const afterControlled = { ...success, E03: "blocked", "E07.1": "event_closed", "E08.6": "EVENT_REGISTRATION_CLOSED", "E08.7": "EVENT_TIME_CHANGE_CLOSED" };
  assert.equal(code, first === "operation" ? success[name] : mode === "immediate" ? afterImmediate[name] : afterControlled[name]);
  assert.equal((await audit(c)).length, 1);
  if (mode === "immediate") await assertNoOpen(c);
  const after = await state(c);
  if (pending && name === "E07.5") assert.equal(after.services.find((s: { id: string }) => s.id === pending.session).status, first === "operation" || mode === "controlled" ? "completed" : "canceled");
  if (pending && name === "E07.6") assert.equal(after.services.find((s: { id: string }) => s.id === pending.session).status, first === "operation" || mode === "controlled" ? "absent" : "canceled");
  if (name === "E08.6") { assert.equal(after.event.external_queue_enabled, first !== "operation"); assert.equal(result.body.externalWaitingFinalized, first === "operation" ? 0 : 1); }
  if (mode === "controlled" && name === "E07.4") assert.equal(after.services[0].status, "pending");
});
test("E08.8 PostgreSQL revalida conta/Admin/sessão/2FA após espera em participação", async () => {
  for (const change of ["inactive", "role", "revoked", "expired", "2fa"]) { const c = await context(); await rich(c); const before = await state(c), r = await lockWait(c, () => close(c), async () => {
    if (change === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [c.admin.userId]);
    if (change === "role") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]);
    if (change === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.sessionId]);
    if (change === "expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [c.admin.sessionId]);
    if (change === "2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [c.admin.sessionId]);
  }, "participation"); problem(r, change === "role" ? 403 : 401, change === "role" ? "ADMIN_REQUIRED" : change === "inactive" ? "ACCOUNT_DEACTIVATED" : change === "revoked" ? "SESSION_REVOKED" : change === "expired" ? "SESSION_EXPIRED" : "ADMIN_2FA_REQUIRED"); assert.deepEqual(await state(c), before); }
});
test("E08.8 PostgreSQL revogação antes da concessão prevalece; fechamento vencedor retém autorização", async () => {
  const c = await context(), r = await lockWait(c, () => close(c), async client => { await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]); }, "role"); problem(r, 403, "ADMIN_REQUIRED"); assert.equal((await audit(c)).length, 0);
  const other = await context(), key = randomUUID(), [done] = await ordered(() => close(other, immediate(), key), () => pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [other.admin.roleId])); assert.equal(done.status, 200); problem(await close(other, immediate(), key), 403, "ADMIN_REQUIRED");
});
for (const lock of ["event", "station", "participation"] as const) test(`E08.8 PostgreSQL prazo controlado expira durante lock de ${lock} e não é efetivado`, async () => {
  const c = await context(); await person(c, "waiting"); const body = await controlled(10), before = await state(c), r = await lockWait(c, () => close(c, body), async (_client, pid) => { await waitPast(body.controlledUntilAt, pid); }, lock); problem(r, 409, "CLOSURE_DEADLINE_INVALID"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL sessão expira enquanto espera lock de estação e não confirma encerramento", async () => {
  const c = await context(); await rich(c); const until = (await pool.query("UPDATE sessions SET expires_at=date_trunc('milliseconds',clock_timestamp())+interval '10 seconds' WHERE id=$1 RETURNING expires_at", [c.admin.sessionId])).rows[0].expires_at as Date;
  const before = await state(c), r = await lockWait(c, () => close(c), async (_client, pid) => { await waitPast(until.toISOString(), pid); }, "station"); problem(r, 401, "SESSION_EXPIRED"); assert.deepEqual(await state(c), before);
});
test("E08.8 PostgreSQL controlado vencido bloqueia residual mas não executa job de limpeza", async () => {
  const c = await context(), data = await called(c), body = await controlled(10), r = await close(c, body); assert.equal(r.status, 200);
  // Aguarda relógio real sem executar limpeza fora da task.
  const until = Date.now() + 14000; let expired = false; while (Date.now() < until) { if ((await pool.query("SELECT clock_timestamp()>=$1::timestamptz AS ended", [body.controlledUntilAt])).rows[0].ended) { expired = true; break; } await new Promise(done => setTimeout(done, 100)); } assert.equal(expired, true);
  const before = await state(c); problem(await resolve(c, data.session, "complete"), 409, "EVENT_OPERATION_ENDED"); assert.deepEqual(await state(c), before); assert.equal(before.people[0].status, "active"); assert.equal(before.services[0].status, "pending");
});
