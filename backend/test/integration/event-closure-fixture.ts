import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
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
if (process.env.NODE_ENV !== "test") throw new Error("NODE_ENV=test obrigatorio.");
process.env.EVENT_CLOSURE_JOB_TEST_ENABLED = "false";
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60";
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 8, connectionTimeoutMillis: 2000, statement_timeout: 20000, lock_timeout: 16000 });
let app: INestApplication, database: NodePgDatabase<typeof schema>, participations: ParticipationsService, queues: QueueEntryService;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
const operation = "admin_close_event", reason = "Encerramento autorizado pela organização";
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[], games: [] as string[] };
export async function setup() {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { AppModule } = await import("../../src/app.module"), { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ParticipationsService } = await import("../../src/participations/participations.service"), { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now() - 120000, ttlSeconds: 1 } : undefined);
  app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE); participations = app.get(ParticipationsService); queues = app.get(QueueEntryService);
}
export async function cleanup() {
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
      await c.query("DELETE FROM evaluations v USING participations p WHERE v.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [ids.events]);
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
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.9 falhou.");
}
export async function bareEvent() {
  const id = randomUUID(); ids.events.push(id);
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E089 vazio',$2,'America/Sao_Paulo',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '30 minutes','scheduled',true,clock_timestamp(),clock_timestamp())`, [id, `E089-${id.toUpperCase()}`]);
  return id;
}
async function account() {
  const userId = randomUUID(), sessionId = randomUUID(); ids.users.push(userId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Pessoa privada E089',$2,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, `${userId}@example.test`]);
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
    VALUES($1,'E089 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,9007199254741000,clock_timestamp(),clock_timestamp())`, [eventId, `E089-${eventId.toUpperCase()}`]);
  const actor = await admin(), staff = await account(); await grant(staff.userId, eventId);
  await pool.query("INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at) VALUES($1,$2,'Experiência E089',9007199254741000,clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação E089','available',clock_timestamp(),clock_timestamp())", [stationId, experienceId]);
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
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [version, `e89-${version}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [a.userId, version]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [game, `E089-${game}`]);
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
  const v = randomUUID(); ids.versions.push(v); await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [v, `e89-${v}`]);
  for (const p of [outside, idle]) await pool.query("INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at) VALUES($1,$2,'{\"private\":\"E089_PRIVATE\"}','[]',clock_timestamp())", [p.participationId, v]);
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

export { app, pool, database, account, admin, context, person, readyEntrant, admit, join, audit, state, blocked, ordered, lockWait, waitPast, proposal, patch, external, station, close, immediate, controlled, call, resolve, withdraw, queued, called, rich, assertNoOpen };
export type { Context };
