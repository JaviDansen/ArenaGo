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
let fingerprint: (eventId: string, official: string, operational: string, reason: string) => string;
const operation = "admin_update_event_schedule", reason = "Programação autorizada pela organização";
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[], games: [] as string[] };
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { AppModule } = await import("../../src/app.module"), { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ParticipationsService } = await import("../../src/participations/participations.service"), { QueueEntryService } = await import("../../src/events/queue-entry.service");
  fingerprint = (await import("../../src/events/admin-schedule.service")).scheduleFingerprint;
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
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.7 falhou.");
});
async function account() {
  const userId = randomUUID(), sessionId = randomUUID(); ids.users.push(userId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Pessoa privada E087',$2,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, `${userId}@example.test`]);
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
    VALUES($1,'E087 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,9007199254741000,clock_timestamp(),clock_timestamp())`, [eventId, `E087-${eventId.toUpperCase()}`]);
  const actor = await admin(), staff = await account(); await grant(staff.userId, eventId);
  await pool.query("INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at) VALUES($1,$2,'Experiência E087',9007199254741000,clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação E087','available',clock_timestamp(),clock_timestamp())", [stationId, experienceId]);
  return { eventId, experienceId, stationId, admin: actor, staff };
}
async function proposal(c: Context, minutes = 120, margin = 30) {
  const r = (await pool.query("SELECT date_trunc('milliseconds',clock_timestamp()) + $1::int*interval '1 minute' AS at", [minutes])).rows[0].at as Date;
  return { officialEndsAt: r.toISOString(), operationalDeadlineAt: new Date(r.getTime() + margin * 60000).toISOString(), reason };
}
type Proposal = Awaited<ReturnType<typeof proposal>>;
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
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [version, `e87-${version}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [a.userId, version]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [game, `E087-${game}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [a.userId, game]); return a;
}
const admit = (c: Context, a: { userId: string }) => participations.createParticipation({ userId: a.userId, eventId: c.eventId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
const join = (c: Context, a: { userId: string; participationId: string }) => queues.joinExperienceQueue({ userId: a.userId, participationId: a.participationId, experienceId: c.experienceId, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
const audit = async (c: Context) => (await pool.query("SELECT * FROM audit_logs WHERE event_id=$1 AND action='event_schedule_changed' ORDER BY occurred_at,id", [c.eventId])).rows;
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
async function lockWait(c: Context, request: () => PromiseLike<supertest.Response>, change: (client: PoolClient, pid: number) => Promise<void>, lock: "event" | "role" | "account" = "event") {
  const client = await pool.connect(); let pending: Promise<supertest.Response> | undefined;
  try {
    await client.query("BEGIN");
    if (lock === "event") await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [c.eventId]);
    if (lock === "role") await client.query("SELECT id FROM user_roles WHERE id=$1 FOR UPDATE", [c.admin.roleId]);
    if (lock === "account") await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [c.admin.userId]);
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

test("E08.7 PostgreSQL HTTP altera os dois horários e audita antes/depois com instante exato", async () => {
  const c = await context(), body = await proposal(c), before = await state(c), r = await patch(c, body); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["changedAt", "eventId", "officialEndsAt", "operationalDeadlineAt"]); assert.equal(r.body.officialEndsAt, body.officialEndsAt); assert.equal(r.body.operationalDeadlineAt, body.operationalDeadlineAt); assert.match(r.body.changedAt, /\.\d{6}Z$/);
  const exact = (await pool.query("SELECT official_ends_at=$2::timestamptz AND operational_deadline_at=$3::timestamptz AS pair,updated_at=$4::timestamptz AS instant FROM events WHERE id=$1", [c.eventId, body.officialEndsAt, body.operationalDeadlineAt, r.body.changedAt])).rows[0]; assert.deepEqual(exact, { pair: true, instant: true });
  const rows = await audit(c); assert.equal(rows.length, 1); const a = rows[0]; assert.equal(a.actor_user_id, c.admin.userId); assert.equal(a.event_id, c.eventId); assert.equal(a.reason, reason); assert.equal(a.origin, "user"); assert.equal(a.category, "event");
  assert.deepEqual(a.metadata.before, { officialEndsAt: before.event.official_ends_at, operationalDeadlineAt: before.event.operational_deadline_at });
  assert.equal(Date.parse(a.metadata.after.officialEndsAt), Date.parse(body.officialEndsAt)); assert.equal(Date.parse(a.metadata.after.operationalDeadlineAt), Date.parse(body.operationalDeadlineAt));
  assert.equal((await pool.query("SELECT occurred_at=$2::timestamptz AS exact FROM audit_logs WHERE id=$1", [a.id, r.body.changedAt])).rows[0].exact, true);
});
test("E08.7 PostgreSQL HTTP permite antes do início e durante evento sem exigir prontidão", async () => {
  for (const mode of ["before", "during", "not-ready"]) {
    const c = await context(); if (mode === "before") await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1", [c.eventId]);
    if (mode === "not-ready") { await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]); await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE event_id=$1", [c.eventId]); }
    assert.equal((await patch(c, await proposal(c))).status, 200); assert.equal((await audit(c)).length, 1);
  }
});
for (const margin of [0, 60]) test(`E08.7 PostgreSQL HTTP aceita margem de ${margin} minutos inclusive`, async () => {
  const c = await context(), body = await proposal(c, 120, margin), r = await patch(c, body); assert.equal(r.status, 200); assert.equal(Date.parse(r.body.operationalDeadlineAt) - Date.parse(r.body.officialEndsAt), margin * 60000);
});
for (const margin of [-1, 61]) test(`E08.7 PostgreSQL HTTP rejeita margem de ${margin} minutos sem efeitos`, async () => {
  const c = await context(), before = await state(c); problem(await patch(c, await proposal(c, 120, margin)), 400, "VALIDATION_ERROR"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP novo oficial anterior/igual ao início ou já atingido é 400", async () => {
  for (const mode of ["before", "equal", "past"]) {
    const c = await context(), body = await proposal(c); const start = (await pool.query("SELECT starts_at FROM events WHERE id=$1", [c.eventId])).rows[0].starts_at as Date;
    // Início de fixture em milissegundos exatos para provar igualdade, não arredondamento do driver.
    await pool.query("UPDATE events SET starts_at=$2::timestamptz WHERE id=$1", [c.eventId, start.toISOString()]);
    const at = mode === "past" ? (await proposal(c, -1)).officialEndsAt : new Date(start.getTime() - (mode === "before" ? 1 : 0)).toISOString();
    const before = await state(c); problem(await patch(c, { ...body, officialEndsAt: at, operationalDeadlineAt: at }), 400, "VALIDATION_ERROR"); assert.deepEqual(await state(c), before);
  }
});
test("E08.7 PostgreSQL HTTP corte vigente atingido não pode ser prorrogado com status open", async () => {
  const c = await context(); await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
  const before = await state(c); problem(await patch(c, await proposal(c)), 409, "EVENT_TIME_CHANGE_CLOSED"); assert.deepEqual(await state(c), before);
});
for (const mode of ["closing", "closed", "stale-controlled", "stale-immediate"]) test(`E08.7 PostgreSQL HTTP ${mode} impede alteração sem reabertura`, async () => {
  const c = await context();
  if (mode === "closing" || mode === "closed") await pool.query("UPDATE events SET status=$2 WHERE id=$1", [c.eventId, mode]);
  else await pool.query(`UPDATE events SET status='open',closure_mode=$2::varchar(20),closure_requested_at=statement_timestamp()-interval '1 minute',
    admin_deadline_at=CASE WHEN $2::varchar(20)='immediate' THEN statement_timestamp()-interval '1 minute' ELSE statement_timestamp()+interval '20 minutes' END WHERE id=$1`, [c.eventId, mode === "stale-immediate" ? "immediate" : "controlled"]);
  const before = await state(c); problem(await patch(c, await proposal(c)), 409, "EVENT_TIME_CHANGE_CLOSED"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP exige Admin global ativo e segundo fator", async () => {
  for (const mode of ["participant", "staff", "revoked", "2fa", "inactive"]) {
    const c = await context(), a = mode === "participant" || mode === "staff" ? await account() : c.admin;
    if (mode === "staff") await grant(a.userId, c.eventId);
    if (mode === "revoked") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]);
    if (mode === "2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [a.sessionId]);
    if (mode === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [a.userId]);
    const before = await state(c); problem(await patch(c, await proposal(c), randomUUID(), a), mode === "2fa" || mode === "inactive" ? 401 : 403,
      mode === "2fa" ? "ADMIN_2FA_REQUIRED" : mode === "inactive" ? "ACCOUNT_DEACTIVATED" : "ADMIN_REQUIRED"); assert.deepEqual(await state(c), before);
  }
});
test("E08.7 PostgreSQL HTTP Bearer e sessão ausentes/inválidos/expirados/revogados", async () => {
  const c = await context(), body = await proposal(c), before = await state(c);
  problem(await supertest(app.getHttpServer()).patch(route(c)).send(body), 401, "MISSING_ACCESS_TOKEN");
  for (const token of ["invalid", signAccess(c.admin.userId, c.admin.sessionId, true)]) { const r = await patch(c, body, randomUUID(), { token }); assert.equal(r.status, 401); assert.match(r.headers["content-type"], /application\/problem\+json/); }
  problem(await patch(c, body, randomUUID(), { token: signAccess(c.admin.userId, randomUUID()) }), 401, "INVALID_SESSION");
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [c.admin.sessionId]); problem(await patch(c, body), 401, "SESSION_EXPIRED");
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour',revoked_at=clock_timestamp() WHERE id=$1", [c.admin.sessionId]); problem(await patch(c, body), 401, "SESSION_REVOKED"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP UUID inválido e evento ausente após autorização", async () => {
  const c = await context(), body = await proposal(c);
  problem(await patch({ ...c, eventId: "bad" }, body), 400, "VALIDATION_ERROR"); problem(await patch({ ...c, eventId: randomUUID() }, body), 404, "RESOURCE_NOT_FOUND");
  problem(await patch({ ...c, eventId: randomUUID() }, body, randomUUID(), await account()), 403, "ADMIN_REQUIRED"); assert.equal((await audit(c)).length, 0);
});
test("E08.7 PostgreSQL HTTP body estrito, timestamps inequívocos e controles recusados", async () => {
  const c = await context(), body = await proposal(c), before = await state(c), req = () => supertest(app.getHttpServer()).patch(route(c)).set("Authorization", `Bearer ${c.admin.token}`).set("Idempotency-Key", randomUUID());
  problem(await req(), 400, "VALIDATION_ERROR"); problem(await req().type("application/json").send("{bad"), 400, "BAD_REQUEST");
  for (const value of [{}, [], { officialEndsAt: body.officialEndsAt, reason }, { operationalDeadlineAt: body.operationalDeadlineAt, reason }, { ...body, reason: " " }, { ...body, reason: "x".repeat(501) }, { ...body, reason: "x\u0000y" },
    ...["bad", "2026-02-30T12:00:00Z", "2026-11-05T12:00:00", "2026-11-05T12:00:00.1234Z", "2026-11-05T12:00:00-00:00"].map(officialEndsAt => ({ ...body, officialEndsAt })),
    ...["startsAt", "adminDeadlineAt", "closureRequestedAt", "closureMode", "status", "externalQueueEnabled", "queueAcceptingEntries", "userId", "expiresAt"].map(key => ({ ...body, [key]: "private" }))]) problem(await req().send(value), 400, "VALIDATION_ERROR");
  problem(await req().type("text/plain").send(JSON.stringify(body)), 400, "VALIDATION_ERROR"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP chave única e obrigatória, resposta mínima e reason normalizada", async () => {
  const c = await context(), body = await proposal(c), req = () => supertest(app.getHttpServer()).patch(route(c)).set("Authorization", `Bearer ${c.admin.token}`);
  problem(await req().send(body), 400, "VALIDATION_ERROR"); for (const key of ["", " ", "x".repeat(129)]) problem(await req().set("Idempotency-Key", key).send(body), 400, "VALIDATION_ERROR");
  problem(await req().set({ "Idempotency-Key": ["a", "b"] }).send(body), 400, "VALIDATION_ERROR");
  const r = await patch(c, { ...body, reason: ` ${reason} ` }); assert.equal(r.status, 200); assert.equal((await audit(c))[0].reason, reason);
  for (const secret of [reason, c.admin.userId, c.admin.sessionId, "Pessoa privada E087", "@example.test", "fixture-private-hash", "before", "metadata"]) assert.equal(JSON.stringify(r.body).includes(secret), false);
});
test("E08.7 PostgreSQL HTTP preserva filas, serviços, snapshots, contadores e outros eventos", async () => {
  const c = await context(), other = await context(); for (const status of ["waiting", "finished", "canceled"] as const) await person(c, status);
  const p = await person(c); assert.equal((await join(c, p)).kind, "created");
  const call = await supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`).set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID()).send({}); assert.equal(call.status, 201, JSON.stringify(call.body));
  const entrant = await readyEntrant(); assert.equal((await admit(c, entrant)).kind, "created");
  const before = await state(c), otherBefore = await state(other), r = await patch(c, await proposal(c)); assert.equal(r.status, 200); const after = await state(c);
  for (const key of ["people", "snapshots", "experiences", "stations", "queues", "services"]) assert.deepEqual(after[key], before[key], key);
  const oldEvent = { ...before.event }, newEvent = { ...after.event };
  for (const key of ["official_ends_at", "operational_deadline_at", "updated_at"]) { delete oldEvent[key]; delete newEvent[key]; }
  assert.deepEqual(newEvent, oldEvent); assert.deepEqual(await state(other), otherBefore);
});
test("E08.7 PostgreSQL HTTP no-op persiste intenção sem UPDATE/auditoria inclusive após corte", async () => {
  const c = await context(), body = await proposal(c); await pool.query("UPDATE events SET official_ends_at=$2,operational_deadline_at=$3 WHERE id=$1", [c.eventId, body.officialEndsAt, body.operationalDeadlineAt]);
  const before = await state(c), key = randomUUID(), first = await patch(c, body, key); assert.equal(first.status, 200); assert.equal(first.body.changedAt, undefined); assert.equal((await audit(c)).length, 0); assert.deepEqual((await state(c)).event, before.event);
  await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]); const closed = (await state(c)).event; assert.equal((await patch(c, body)).status, 200); assert.deepEqual((await state(c)).event, closed);
  assert.equal((await pool.query("SELECT status FROM idempotency_operations WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3", [c.admin.userId, operation, key])).rows[0].status, "completed");
});
test("E08.7 PostgreSQL HTTP retry reproduz resposta e microssegundos sem nova auditoria", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), first = await patch(c, body, key), before = await state(c); assert.equal(first.status, 200);
  const retry = await patch(c, body, key); assert.equal(retry.status, 200); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 1);
});
test("E08.7 PostgreSQL HTTP replay antigo após alteração posterior e fechamento não reaplica horários", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), first = await patch(c, body, key); assert.equal(first.status, 200); assert.equal((await patch(c, await proposal(c, 180))).status, 200);
  await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]); const before = await state(c), retry = await patch(c, body, key); assert.equal(retry.status, 200); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 2);
});
test("E08.7 PostgreSQL HTTP replay de no-op histórico não altera intenção posterior", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(); await pool.query("UPDATE events SET official_ends_at=$2,operational_deadline_at=$3 WHERE id=$1", [c.eventId, body.officialEndsAt, body.operationalDeadlineAt]);
  const first = await patch(c, body, key); assert.equal(first.status, 200); assert.equal(first.body.changedAt, undefined); assert.equal((await patch(c, await proposal(c, 180))).status, 200);
  const before = await state(c), retry = await patch(c, body, key); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP mesma chave com outro horário, reason ou evento conflita", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(); assert.equal((await patch(c, body, key)).status, 200); const before = await state(c);
  for (const value of [{ ...body, officialEndsAt: new Date(Date.parse(body.officialEndsAt) + 1).toISOString() }, { ...body, operationalDeadlineAt: body.officialEndsAt }, { ...body, reason: "Outro motivo" }]) problem(await patch(c, value, key), 409, "IDEMPOTENCY_KEY_REUSED");
  const other = { ...await context(), admin: c.admin }, otherBefore = await state(other); problem(await patch(other, body, key), 409, "IDEMPOTENCY_KEY_REUSED"); assert.deepEqual(await state(other), otherBefore); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP fusos equivalentes e trim representam a mesma intenção", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), first = await patch(c, body, key); assert.equal(first.status, 200);
  const retry = await patch(c, { ...body, officialEndsAt: body.officialEndsAt.replace("Z", "+00:00"), reason: ` ${reason} ` }, key); assert.equal(retry.status, 200); assert.deepEqual(retry.body, first.body); assert.equal((await audit(c)).length, 1);
});
test("E08.7 PostgreSQL HTTP expires_at vencido mantém replay e isolamento de namespace E08.6", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), first = await patch(c, body, key); assert.equal(first.status, 200);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 hour' WHERE actor_user_id=$1 AND operation=$2", [c.admin.userId, operation]);
  assert.equal((await supertest(app.getHttpServer()).patch(`/api/v1/admin/events/${c.eventId}/external-queue`).set("Authorization", `Bearer ${c.admin.token}`).set("Idempotency-Key", key).send({ enabled: false, reason })).status, 200);
  assert.equal((await patch(c, await proposal(c, 180))).status, 200); const before = await state(c), retry = await patch(c, body, key); assert.deepEqual(retry.body, first.body); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL HTTP Admins diferentes podem usar mesma chave sem compartilhar intenção", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), other = await admin(); assert.equal((await patch(c, body, key)).status, 200); assert.equal((await patch(c, await proposal(c, 180), key, other)).status, 200);
  assert.deepEqual(new Set((await audit(c)).map(row => row.actor_user_id)), new Set([c.admin.userId, other.userId]));
});
test("E08.7 PostgreSQL HTTP replay revalida Admin e sessão atuais", async () => {
  for (const mode of ["role", "2fa", "session"]) {
    const c = await context(), body = await proposal(c), key = randomUUID(); assert.equal((await patch(c, body, key)).status, 200);
    if (mode === "role") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]);
    else await pool.query(mode === "2fa" ? "UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1" : "UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.sessionId]);
    const before = await state(c); problem(await patch(c, body, key), mode === "role" ? 403 : 401, mode === "role" ? "ADMIN_REQUIRED" : mode === "2fa" ? "ADMIN_2FA_REQUIRED" : "SESSION_REVOKED"); assert.deepEqual(await state(c), before);
  }
});
test("E08.7 PostgreSQL HTTP intenção in_progress não executa e recusa não consome chave nova", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(); await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 hour')`, [randomUUID(), c.admin.userId, operation, key, fingerprint(c.eventId, body.officialEndsAt, body.operationalDeadlineAt, reason)]);
  const before = await state(c); problem(await patch(c, body, key), 409, "IDEMPOTENCY_IN_PROGRESS"); assert.deepEqual(await state(c), before);
  const retryKey = randomUUID(), invalid = await proposal(c, -1, 0); problem(await patch(c, invalid, retryKey), 400, "VALIDATION_ERROR"); assert.equal((await patch(c, body, retryKey)).status, 200);
});
test("E08.7 PostgreSQL falhas SQL na auditoria e após conclusão revertem horários/reserva/auditoria", async () => {
  const dialect = new PgDialect();
  for (const phase of ["audit", "after-audit", "after-completion"]) {
    const c = await context(), body = await proposal(c), before = await state(c), original = database.transaction.bind(database) as typeof database.transaction; let reached = false;
    database.transaction = (callback, config) => original(async tx => {
      const execute = tx.execute.bind(tx); tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
        const q = args[0], text = typeof q === "string" ? q : dialect.sqlToQuery(q.getSQL()).sql;
        if (text.includes("INSERT INTO audit_logs") && phase === "audit") {
          assert.equal((await execute<{ changed: boolean }>(sql`SELECT official_ends_at=${body.officialEndsAt}::timestamptz AS changed FROM events WHERE id=${c.eventId}`)).rows[0].changed, true); reached = true; await execute(sql`SELECT 1/0`);
        }
        const result = await execute(...args); if (text.includes("INSERT INTO audit_logs") && phase === "after-audit") { reached = true; await execute(sql`SELECT 1/0`); } return result;
      }) as typeof tx.execute;
      const value = await callback(tx); if (phase === "after-completion") {
        assert.equal((await execute<{ status: string }>(sql`SELECT status FROM idempotency_operations WHERE actor_user_id=${c.admin.userId} AND operation=${operation}`)).rows[0].status, "completed"); reached = true; await execute(sql`SELECT 1/0`);
      } return value;
    }, config);
    try { problem(await patch(c, body), 500, "INTERNAL_SERVER_ERROR"); } finally { database.transaction = original; }
    assert.equal(reached, true); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 0);
  }
});
for (const reverse of [false, true]) test(`E08.7 PostgreSQL mudanças distintas concorrentes, ordem ${reverse}, são serializadas`, async () => {
  const c = await context(), a = await proposal(c, reverse ? 180 : 120), b = await proposal(c, reverse ? 120 : 180);
  const [first, second] = await ordered(() => patch(c, a), () => patch(c, b)); assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal((await state(c)).event.official_ends_at, (await pool.query("SELECT to_jsonb($1::timestamptz) AS value", [b.officialEndsAt])).rows[0].value); assert.equal((await audit(c)).length, 2);
});
test("E08.7 PostgreSQL retries concorrentes da mesma intenção têm resposta e auditoria únicas", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), [a, b] = await ordered(() => patch(c, body, key), () => patch(c, body, key));
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(a.body, b.body); assert.equal((await audit(c)).length, 1);
});
for (const first of ["schedule", "operation"] as const) {
  test(`E08.7 PostgreSQL concorrência E03 com ${first} primeiro`, async () => {
    const c = await context(), body = await proposal(c), a = await readyEntrant();
    if (first === "schedule") { const [changed, joined] = await ordered(() => patch(c, body), () => admit(c, a)); assert.equal(changed.status, 200); assert.equal(joined.kind, "created"); }
    else { const [joined, changed] = await ordered(() => admit(c, a), () => patch(c, body)); assert.equal(joined.kind, "created"); assert.equal(changed.status, 200); }
    assert.equal((await state(c)).people.length, 1); assert.equal((await audit(c)).length, 1);
  });
  test(`E08.7 PostgreSQL concorrência E07.1 com ${first} primeiro`, async () => {
    const c = await context(), body = await proposal(c), a = await person(c);
    if (first === "schedule") { const [changed, joined] = await ordered(() => patch(c, body), () => join(c, a)); assert.equal(changed.status, 200); assert.equal(joined.kind, "created"); }
    else { const [joined, changed] = await ordered(() => join(c, a), () => patch(c, body)); assert.equal(joined.kind, "created"); assert.equal(changed.status, 200); }
    assert.equal((await state(c)).queues.length, 1); assert.equal((await audit(c)).length, 1);
  });
  test(`E08.7 PostgreSQL concorrência E08.6 com ${first} primeiro`, async () => {
    const c = await context(), body = await proposal(c); await person(c, "waiting");
    const [a, b] = first === "schedule" ? await ordered(() => patch(c, body), () => external(c)) : await ordered(() => external(c), () => patch(c, body));
    assert.equal(a.status, 200); assert.equal(b.status, 200); const after = await state(c); assert.equal(after.event.external_queue_enabled, false); assert.equal(after.people[0].status, "active"); assert.equal((await audit(c)).length, 1);
  });
  test(`E08.7 PostgreSQL concorrência E08.5 com ${first} primeiro`, async () => {
    const c = await context(), body = await proposal(c);
    const [a, b] = first === "schedule" ? await ordered(() => patch(c, body), () => station(c)) : await ordered(() => station(c), () => patch(c, body));
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal((await state(c)).stations[0].availability, "unavailable"); assert.equal((await audit(c)).length, 1);
  });
}
test("E08.7 PostgreSQL fechamento concorrente primeiro impede PATCH com status defasado", async () => {
  const c = await context(), body = await proposal(c), before = await state(c), r = await lockWait(c, () => patch(c, body), async client => {
    await client.query("UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
  }); problem(r, 409, "EVENT_TIME_CHANGE_CLOSED"); const after = await state(c); assert.equal(after.event.official_ends_at, before.event.official_ends_at); assert.equal(after.idempotency, null); assert.equal((await audit(c)).length, 0);
});
test("E08.7 PostgreSQL PATCH antes de fechamento confirma, retry não reabre e mudança nova falha", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), [r] = await ordered(() => patch(c, body, key), () => pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId])); assert.equal(r.status, 200);
  const before = await state(c); assert.deepEqual((await patch(c, body, key)).body, r.body); problem(await patch(c, await proposal(c, 180)), 409, "EVENT_TIME_CHANGE_CLOSED"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL conta/concessão/sessão/2FA revalidadas após espera real no evento", async () => {
  for (const mode of ["inactive", "role", "revoked", "expired", "2fa"]) {
    const c = await context(), body = await proposal(c), before = await state(c), r = await lockWait(c, () => patch(c, body), async () => {
      if (mode === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [c.admin.userId]);
      if (mode === "role") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]);
      if (mode === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.sessionId]);
      if (mode === "expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [c.admin.sessionId]);
      if (mode === "2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [c.admin.sessionId]);
    }); problem(r, mode === "role" ? 403 : 401, mode === "inactive" ? "ACCOUNT_DEACTIVATED" : mode === "role" ? "ADMIN_REQUIRED" : mode === "revoked" ? "SESSION_REVOKED" : mode === "expired" ? "SESSION_EXPIRED" : "ADMIN_2FA_REQUIRED"); assert.deepEqual(await state(c), before);
  }
});
test("E08.7 PostgreSQL revogação primeiro é observada após espera na concessão", async () => {
  const c = await context(), body = await proposal(c), r = await lockWait(c, () => patch(c, body), async client => { await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId]); }, "role"); problem(r, 403, "ADMIN_REQUIRED"); assert.equal((await audit(c)).length, 0);
});
test("E08.7 PostgreSQL PATCH primeiro retém concessão até commit, replay posterior é negado", async () => {
  const c = await context(), body = await proposal(c), key = randomUUID(), [r] = await ordered(() => patch(c, body, key), () => pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.admin.roleId])); assert.equal(r.status, 200); problem(await patch(c, body, key), 403, "ADMIN_REQUIRED"); assert.equal((await audit(c)).length, 1);
});
for (const lock of ["event", "account"] as const) test(`E08.7 PostgreSQL corte antigo alcançado durante espera de ${lock} não prorroga evento`, async () => {
  const c = await context(), body = await proposal(c); const cut = (await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()+interval '10 seconds',operational_deadline_at=clock_timestamp()+interval '30 minutes'
    WHERE id=$1 RETURNING to_char(official_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cut`, [c.eventId])).rows[0].cut as string;
  const before = await state(c), r = await lockWait(c, () => patch(c, body), async (_client, pid) => { await waitPast(cut, pid); }, lock);
  problem(r, 409, "EVENT_TIME_CHANGE_CLOSED"); assert.deepEqual(await state(c), before);
});
test("E08.7 PostgreSQL novo oficial alcançado durante espera não é gravado", async () => {
  const c = await context(), at = (await pool.query("SELECT date_trunc('milliseconds',clock_timestamp())+interval '10 seconds' AS at")).rows[0].at as Date;
  const body: Proposal = { officialEndsAt: at.toISOString(), operationalDeadlineAt: at.toISOString(), reason }, before = await state(c);
  const r = await lockWait(c, () => patch(c, body), async (_client, pid) => { await waitPast(body.officialEndsAt, pid); }); problem(r, 400, "VALIDATION_ERROR"); assert.deepEqual(await state(c), before);
});
for (const operationName of ["E03", "E07.1", "E08.6"] as const) test(`E08.7 PostgreSQL ${operationName} bloqueada passa a observar o novo corte confirmado`, async () => {
  const c = await context(), entrant = operationName === "E03" ? await readyEntrant() : undefined;
  const participant = operationName !== "E03" ? await person(c) : undefined;
  const at = (await pool.query("SELECT date_trunc('milliseconds',clock_timestamp())+interval '10 seconds' AS at")).rows[0].at as Date;
  const body: Proposal = { officialEndsAt: at.toISOString(), operationalDeadlineAt: new Date(at.getTime() + 30 * 60000).toISOString(), reason };
  if (operationName === "E03") {
    assert.ok(entrant); const [changed, joined] = await ordered(() => patch(c, body), () => admit(c, entrant), pid => waitPast(body.officialEndsAt, pid));
    assert.equal(changed.status, 200); assert.equal(joined.kind, "blocked"); if (joined.kind !== "blocked") assert.fail();
    assert.deepEqual(joined.eligibility.blockingReasons, ["EVENT_REGISTRATION_CLOSED"]); assert.equal((await state(c)).people, null);
  } else if (operationName === "E07.1") {
    assert.ok(participant); const [changed, joined] = await ordered(() => patch(c, body), () => join(c, participant), pid => waitPast(body.officialEndsAt, pid));
    assert.equal(changed.status, 200); assert.equal(joined.kind, "event_closed"); if (joined.kind !== "event_closed") assert.fail();
    assert.ok(joined.missing.includes("EVENT_ENTRY_CLOSED")); assert.equal((await state(c)).queues, null);
  } else {
    const [changed, queue] = await ordered(() => patch(c, body), () => external(c), pid => waitPast(body.officialEndsAt, pid));
    assert.equal(changed.status, 200); problem(queue, 409, "EVENT_REGISTRATION_CLOSED"); assert.equal((await state(c)).event.external_queue_enabled, true);
  }
  assert.equal((await audit(c)).length, 1);
});
