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
import { assertSafeTestDatabase } from "./test-db-guard";

// Barreira antes de importar environment e providers; nunca usa .env nem destino remoto.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test"
    || url.search || url.hash || !url.username) throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
let app: INestApplication, database: NodePgDatabase<typeof schema>;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[] };
const baseOrder = 9007199254741000n;
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { EventsModule } = await import("../../src/events/events.module");
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ProblemDetailsExceptionFilter } = await import("../../src/common/errors/problem-details.filter");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now()-120000, ttlSeconds: 1 } : undefined);
  @Module({ imports: [EventsModule], providers: [{ provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter }] })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE);
});
after(async () => {
  const errors: unknown[] = [];
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
      await client.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await client.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [ids.users]);
      await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
      await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
      await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [ids.versions]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) { errors.push(error); }
  for (const r of await Promise.allSettled([app?.close(), pool.end()])) if (r.status === "rejected") errors.push(r.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.4 falhou.");
});
async function account(name = "Pessoa privada E084") {
  const userId = randomUUID(), sessionId = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,$2,$3,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, name, `${userId}@example.test`]);
  ids.users.push(userId);
  // Uma única sessão por usuário, conforme uq_sessions_one_unrevoked_user.
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`, [sessionId, userId]);
  return { userId, sessionId, token: signAccess(userId, sessionId) };
}
async function person(eventId: string, status: "active" | "waiting" | "finished" | "canceled" = "active") {
  const auth = await account(), participationId = randomUUID();
  const terminal = status === "finished" || status === "canceled";
  await pool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4::varchar(20),clock_timestamp(),CASE WHEN $5::boolean THEN clock_timestamp() END,
      CASE WHEN $6::boolean THEN clock_timestamp() END,CASE WHEN $6::boolean THEN 'fixture_terminal' END)`,
  [participationId, auth.userId, eventId, status, status === "active", terminal]);
  return { ...auth, participationId };
}
async function context() {
  const eventId = randomUUID();
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E084 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E084-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const viewer = await person(eventId), staff = await account("Staff privado E084"), roleId = randomUUID();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [roleId, staff.userId, eventId]);
  return { eventId, viewer, staff, roleId };
}
type Context = Awaited<ReturnType<typeof context>>;
async function experience(eventId: string, name = "Experiência E084", id = randomUUID()) {
  await pool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())`, [id, eventId, name, baseOrder.toString()]);
  return id;
}
async function station(experienceId: string, available = true) {
  const id = randomUUID();
  await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'Estação E084',$3,clock_timestamp(),clock_timestamp())`, [id, experienceId, available ? "available" : "unavailable"]);
  return id;
}
async function populated() {
  const c = await context(), experienceId = await experience(c.eventId), stationId = await station(experienceId);
  return { ...c, experienceId, stationId };
}
async function entry(c: Context, experienceId: string, status: "waiting" | "called" | "closed" = "waiting", stationId?: string, id = randomUUID()) {
  const owner = await person(c.eventId);
  const order = (await pool.query("UPDATE experiences SET last_queue_order=last_queue_order+1 WHERE id=$1 RETURNING last_queue_order::text AS n", [experienceId])).rows[0].n;
  await pool.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at,closed_at,close_reason)
    VALUES($1,$2,$3,$4,$5,$6::varchar(20),clock_timestamp(),CASE WHEN $7::boolean THEN clock_timestamp() END,
      CASE WHEN $7::boolean THEN 'fixture_closed' END)`, [id, owner.participationId, c.eventId, experienceId, order, status, status === "closed"]);
  if (status !== "closed") await pool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [owner.participationId, id]);
  if (status === "called") {
    assert.ok(stationId);
    await pool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),'pending')`, [randomUUID(), id, experienceId, stationId, c.staff.userId]);
  }
  return { id, owner };
}
const routes = (c: Context, experienceId: string) => [`/api/v1/staff/events/${c.eventId}/stations`, `/api/v1/staff/events/${c.eventId}/experiences/${experienceId}/queue`];
const get = (route: string, auth: { token: string }) => supertest(app.getHttpServer()).get(route).set("Authorization", `Bearer ${auth.token}`);
const stationsGet = (c: Context) => get(routes(c, "unused")[0], c.staff);
const queueGet = (c: Context & { experienceId: string }) => get(routes(c, c.experienceId)[1], c.staff);
function problem(r: supertest.Response, status: number, code?: string) {
  assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.status, status);
  assert.match(r.headers["content-type"], /application\/problem\+json/); if (code) assert.equal(r.body.code, code);
}
async function state() {
  return (await pool.query(`SELECT jsonb_build_object(
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM events e WHERE e.id=ANY($1::uuid[])),
    'experiences',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM experiences e WHERE e.event_id=ANY($1::uuid[])),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=ANY($1::uuid[])),
    'queues',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=ANY($1::uuid[])),
    'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM users u WHERE u.id=ANY($2::uuid[])),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM user_roles r WHERE r.user_id=ANY($2::uuid[])),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sessions s WHERE s.user_id=ANY($2::uuid[])),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[])),
    'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.participation_id) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.event_id=ANY($1::uuid[]))
    )::text AS value`, [ids.events, ids.users])).rows[0].value as string;
}

/** Intercala commit real em outra conexão após o SELECT de autorização, sem substituir SQL/resultados. */
async function afterAuthorization(effect: () => Promise<void>, request: () => PromiseLike<supertest.Response>) {
  const original = database.transaction.bind(database) as typeof database.transaction;
  let reached = 0;
  database.transaction = (callback, config) => original(async tx => {
    const execute = tx.execute.bind(tx);
    tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
      const result = await execute(...args);
      if (reached++ === 0) {
        const settings = (await execute<{ isolation: string; readOnly: string }>(sql`
          SELECT current_setting('transaction_isolation') AS isolation,
            current_setting('transaction_read_only') AS "readOnly"
        `)).rows[0];
        assert.equal(settings.isolation, "repeatable read"); assert.equal(settings.readOnly, "on");
        await effect();
      }
      return result;
    }) as typeof tx.execute;
    return callback(tx);
  }, config);
  try { const response = await request(); assert.ok(reached > 0); return response; }
  finally { database.transaction = original; }
}

test("E08.4 PostgreSQL HTTP Staff vigente recebe estações e fila com relógio PostgreSQL", async () => {
  const c = await populated(), before = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  const stations = await stationsGet(c), queue = await queueGet(c);
  assert.equal(stations.status, 200); assert.deepEqual(stations.body, { eventId: c.eventId, stations: [{ id: c.stationId,
    experienceId: c.experienceId, label: "Estação E084", availability: "available", pendingServiceSessionId: null, pendingCalledAt: null }] });
  assert.equal(queue.status, 200); assert.equal(queue.body.eventId, c.eventId); assert.equal(queue.body.experienceId, c.experienceId);
  assert.equal(queue.body.waitingCount, 0); assert.equal(queue.body.firstWaitingQueueEntryId, null);
  assert.equal(queue.body.acceptingNewEntries, true); assert.equal(queue.body.canCallWaitingEntries, true);
  const after = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  assert.match(queue.body.observedAt, /Z$/); assert.ok(Date.parse(queue.body.observedAt) >= before.getTime()-1 && Date.parse(queue.body.observedAt) <= after.getTime()+1);
});
test("E08.4 PostgreSQL HTTP ambas as rotas exigem Bearer válido", async () => {
  const c = await populated(), before = await state();
  for (const route of routes(c, c.experienceId)) {
    problem(await supertest(app.getHttpServer()).get(route), 401, "MISSING_ACCESS_TOKEN");
    problem(await get(route, { token: "invalid" }), 401, "INVALID_ACCESS_TOKEN");
  }
  assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP sessão revogada/expirada e token expirado são recusados", async () => {
  for (const mode of ["revoked", "session-expired", "token-expired"]) {
    const c = await populated();
    if (mode === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1", [c.staff.sessionId]);
    if (mode === "session-expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [c.staff.sessionId]);
    if (mode === "token-expired") c.staff.token = signAccess(c.staff.userId, c.staff.sessionId, true);
    const before = await state();
    for (const route of routes(c, c.experienceId)) problem(await get(route, c.staff), 401,
      mode === "revoked" ? "SESSION_REVOKED" : mode === "session-expired" ? "SESSION_EXPIRED" : "ACCESS_TOKEN_EXPIRED");
    assert.equal(await state(), before);
  }
});
test("E08.4 PostgreSQL HTTP revogação Staff vale imediatamente na próxima consulta", async () => {
  const c = await populated(); assert.equal((await stationsGet(c)).status, 200); assert.equal((await queueGet(c)).status, 200);
  await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]); const before = await state();
  for (const route of routes(c, c.experienceId)) problem(await get(route, c.staff), 404, "RESOURCE_NOT_FOUND");
  assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP Staff alheio, participante e conta sem papel não recebem acesso", async () => {
  const c = await populated(), other = await populated(), outsider = await account(), before = await state();
  for (const auth of [other.staff, c.viewer, outsider]) for (const route of routes(c, c.experienceId)) {
    problem(await get(route, auth).query({ staffUserId: c.staff.userId }), 404, "RESOURCE_NOT_FOUND");
  }
  assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP conta inativa e email não verificado impedem leitura", async () => {
  for (const mode of ["inactive", "unverified"]) {
    const c = await populated();
    if (mode === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [c.staff.userId]);
    else await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [c.staff.userId]);
    const before = await state();
    for (const route of routes(c, c.experienceId)) problem(await get(route, c.staff), mode === "inactive" ? 401 : 404,
      mode === "inactive" ? "ACCOUNT_DEACTIVATED" : "RESOURCE_NOT_FOUND");
    assert.equal(await state(), before);
  }
});
test("E08.4 PostgreSQL HTTP Admin isolado exige 2FA e não substitui Staff do evento", async () => {
  const c = await populated(), admin = await account();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'admin',NULL,clock_timestamp())", [randomUUID(), admin.userId]);
  for (const route of routes(c, c.experienceId)) problem(await get(route, admin), 401, "ADMIN_2FA_REQUIRED");
  await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1", [admin.sessionId]);
  for (const route of routes(c, c.experienceId)) problem(await get(route, admin), 404, "RESOURCE_NOT_FOUND");
});
test("E08.4 PostgreSQL HTTP Admin também Staff conserva exigência 2FA", async () => {
  const c = await populated();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'admin',NULL,clock_timestamp())", [randomUUID(), c.staff.userId]);
  for (const route of routes(c, c.experienceId)) problem(await get(route, c.staff), 401, "ADMIN_2FA_REQUIRED");
  await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1", [c.staff.sessionId]);
  assert.equal((await stationsGet(c)).status, 200); assert.equal((await queueGet(c)).status, 200);
});
test("E08.4 PostgreSQL HTTP valida ambos UUIDs e normaliza maiúsculas", async () => {
  const c = await populated(), before = await state();
  for (const route of routes(c, c.experienceId)) {
    problem(await get(route.replace(c.eventId, "bad"), c.staff), 400, "VALIDATION_ERROR");
    assert.equal((await get(route.replace(c.eventId, c.eventId.toUpperCase()).replace(c.experienceId, c.experienceId.toUpperCase()), c.staff)).status, 200);
  }
  problem(await get(routes(c, "bad")[1], c.staff), 400, "VALIDATION_ERROR"); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP evento ausente/alheio e experiência ausente/alheia têm recusa neutra", async () => {
  const c = await populated(), other = await populated();
  for (const route of routes(c, c.experienceId)) {
    const a = await get(route.replace(c.eventId, randomUUID()), c.staff), b = await get(route.replace(c.eventId, other.eventId), c.staff);
    problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
  }
  const a = await get(routes(c, randomUUID())[1], c.staff), b = await get(routes(c, other.experienceId)[1], c.staff);
  problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
});
test("E08.4 PostgreSQL HTTP evento sem experiências e experiência sem estações retornam coleção vazia", async () => {
  const c = await context(); assert.deepEqual((await stationsGet(c)).body, { eventId: c.eventId, stations: [] });
  const experienceId = await experience(c.eventId); const before = await state();
  assert.deepEqual((await stationsGet(c)).body, { eventId: c.eventId, stations: [] });
  const r = await queueGet({ ...c, experienceId }); assert.equal(r.status, 200); assert.equal(r.body.acceptingNewEntries, false);
  assert.equal(r.body.canCallWaitingEntries, true); assert.equal(r.body.waitingCount, 0); assert.equal(r.body.firstWaitingQueueEntryId, null);
  assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP estações mantêm experiência e ordem sem multiplicação por filas", async () => {
  const c = await populated(), otherExperience = await experience(c.eventId), extra = await station(c.experienceId), third = await station(otherExperience);
  await entry(c, c.experienceId); await entry(c, c.experienceId); await entry(c, otherExperience);
  const r = await stationsGet(c); assert.equal(r.status, 200); assert.equal(r.body.stations.length, 3);
  const expected = [{ id: c.stationId, experienceId: c.experienceId }, { id: extra, experienceId: c.experienceId }, { id: third, experienceId: otherExperience }]
    .sort((a,b) => a.experienceId.localeCompare(b.experienceId) || a.id.localeCompare(b.id));
  assert.deepEqual(r.body.stations.map((s: { id: string; experienceId: string }) => ({ id: s.id, experienceId: s.experienceId })), expected);
  assert.equal((await queueGet(c)).body.waitingCount, 2); assert.equal((await queueGet({ ...c, experienceId: otherExperience })).body.waitingCount, 1);
});
test("E08.4 PostgreSQL HTTP estação available pode estar ocupada por pending com instante exato", async () => {
  const c = await populated(); await entry(c, c.experienceId, "called", c.stationId);
  const pending = (await pool.query("SELECT id,called_at FROM service_sessions WHERE station_id=$1 AND status='pending'", [c.stationId])).rows[0];
  const r = await stationsGet(c); assert.equal(r.status, 200);
  assert.deepEqual(r.body.stations[0], { id: c.stationId, experienceId: c.experienceId, label: "Estação E084", availability: "available",
    pendingServiceSessionId: pending.id, pendingCalledAt: (pending.called_at as Date).toISOString() });
  const queue = await queueGet(c); assert.equal(queue.body.acceptingNewEntries, true); assert.equal(queue.body.canCallWaitingEntries, true);
});
test("E08.4 PostgreSQL HTTP estação unavailable sem pending preserva fila existente", async () => {
  const c = await populated(), waiting = await entry(c, c.experienceId);
  await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]); const before = await state();
  const r = await stationsGet(c); assert.equal(r.status, 200); assert.equal(r.body.stations[0].availability, "unavailable");
  assert.equal(r.body.stations[0].pendingServiceSessionId, null); assert.equal(r.body.stations[0].pendingCalledAt, null);
  const queue = await queueGet(c); assert.equal(queue.body.acceptingNewEntries, false); assert.equal(queue.body.canCallWaitingEntries, true);
  assert.equal(queue.body.waitingCount, 1); assert.equal(queue.body.firstWaitingQueueEntryId, waiting.id); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP histórico terminal não aparece como pending nem duplica estação", async () => {
  const c = await populated(), called = await entry(c, c.experienceId, "called", c.stationId);
  await pool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [called.owner.participationId]);
  await pool.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_completed' WHERE id=$1", [called.id]);
  await pool.query("UPDATE service_sessions SET status='completed',resolved_at=clock_timestamp(),resolved_by_user_id=$2 WHERE queue_entry_id=$1", [called.id, c.staff.userId]);
  const r = await stationsGet(c); assert.equal(r.status, 200); assert.equal(r.body.stations.length, 1);
  assert.equal(r.body.stations[0].pendingServiceSessionId, null); assert.equal(r.body.stations[0].pendingCalledAt, null);
  await entry(c, c.experienceId, "called", c.stationId);
  const next = await stationsGet(c); assert.equal(next.status, 200); assert.equal(next.body.stations.length, 1); assert.ok(next.body.stations[0].pendingServiceSessionId);
});
test("E08.4 PostgreSQL HTTP FIFO usa bigint além do inteiro seguro e exclui called/closed", async () => {
  const c = await populated(), orderedIds = [randomUUID(), randomUUID()].sort();
  await entry(c, c.experienceId, "closed"); await entry(c, c.experienceId, "called", c.stationId);
  const first = await entry(c, c.experienceId, "waiting", undefined, orderedIds[1]);
  const second = await entry(c, c.experienceId, "waiting", undefined, orderedIds[0]);
  // Ordenação por ID ou instante de ingresso escolheria a segunda; somente queue_order escolhe a primeira.
  await pool.query("UPDATE queue_entries SET entered_at=clock_timestamp()+interval '1 minute' WHERE id=$1", [first.id]);
  const orders = (await pool.query("SELECT queue_order::text AS n FROM queue_entries WHERE id=ANY($1::uuid[])", [[first.id,second.id]])).rows;
  assert.ok(orders.every(row => BigInt(row.n) > BigInt(Number.MAX_SAFE_INTEGER)));
  const r = await queueGet(c); assert.equal(r.status, 200); assert.equal(r.body.waitingCount, 2); assert.equal(r.body.firstWaitingQueueEntryId, first.id);
});
test("E08.4 PostgreSQL HTTP fila vazia mantém primeiro nulo mesmo com histórico", async () => {
  const c = await populated(); await entry(c, c.experienceId, "closed"); await entry(c, c.experienceId, "called", c.stationId);
  const r = await queueGet(c); assert.equal(r.status, 200); assert.equal(r.body.waitingCount, 0); assert.equal(r.body.firstWaitingQueueEntryId, null);
  assert.equal(r.body.canCallWaitingEntries, true);
});
test("E08.4 PostgreSQL HTTP pausa da fila não impede janela de chamadas preexistentes", async () => {
  const c = await populated(), first = await entry(c, c.experienceId);
  await pool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]); const before = await state();
  const r = await queueGet(c); assert.equal(r.status, 200); assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, true);
  assert.equal(r.body.waitingCount, 1); assert.equal(r.body.firstWaitingQueueEntryId, first.id); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP corte oficial mantém chamadas na margem operacional", async () => {
  const c = await populated(), first = await entry(c, c.experienceId);
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
  const before = await state(), r = await queueGet(c); assert.equal(r.status, 200);
  assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, true); assert.equal(r.body.firstWaitingQueueEntryId, first.id);
  assert.equal(r.body.waitingCount, 1); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP corte Admin controlado conserva chamadas até prazo administrativo", async () => {
  const c = await populated(); await entry(c, c.experienceId);
  await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
  const before = await state(), r = await queueGet(c); assert.equal(r.status, 200);
  assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, true); assert.equal(r.body.waitingCount, 1); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP encerramento closed, prazo operacional/Admin e imediato impedem chamadas", async () => {
  for (const mode of ["closed", "operational", "admin", "immediate"]) {
    const c = await populated(), first = await entry(c, c.experienceId); await entry(c, c.experienceId, "called", c.stationId);
    if (mode === "closed") await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    if (mode === "operational") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [c.eventId]);
    if (mode === "admin") await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '20 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [c.eventId]);
    if (mode === "immediate") await pool.query("UPDATE events SET status='closing',closure_mode='immediate',closure_requested_at=statement_timestamp()-interval '1 minute',admin_deadline_at=statement_timestamp()-interval '1 minute' WHERE id=$1", [c.eventId]);
    const before = await state(), r = await queueGet(c); assert.equal(r.status, 200);
    assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, false);
    assert.equal(r.body.waitingCount, 1); assert.equal(r.body.firstWaitingQueueEntryId, first.id);
    const stations = await stationsGet(c); assert.equal(stations.status, 200); assert.ok(stations.body.stations[0].pendingServiceSessionId);
    assert.equal(await state(), before);
  }
});
test("E08.4 PostgreSQL HTTP evento futuro bloqueia ingressos e chamadas sem apagar fila", async () => {
  const c = await populated(); await entry(c, c.experienceId);
  await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1", [c.eventId]);
  const before = await state(), r = await queueGet(c); assert.equal(r.status, 200);
  assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, false); assert.equal(r.body.waitingCount, 1); assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP recursos de outra experiência não permitem ingressos nesta fila", async () => {
  const c = await populated(), empty = await experience(c.eventId); await entry(c, empty);
  const r = await queueGet({ ...c, experienceId: empty }); assert.equal(r.status, 200);
  assert.equal(r.body.acceptingNewEntries, false); assert.equal(r.body.canCallWaitingEntries, true); assert.equal(r.body.waitingCount, 1);
  assert.equal((await queueGet(c)).body.acceptingNewEntries, true);
});
test("E08.4 PostgreSQL HTTP isolamento não inclui estações ou esperas de outro evento", async () => {
  const c = await populated(), other = await populated(), own = await entry(c, c.experienceId), foreign = await entry(other, other.experienceId);
  const stations = await stationsGet(c), queue = await queueGet(c); assert.equal(stations.status, 200); assert.equal(queue.status, 200);
  assert.deepEqual(stations.body.stations.map((s: { id: string }) => s.id), [c.stationId]); assert.equal(queue.body.waitingCount, 1);
  assert.equal(queue.body.firstWaitingQueueEntryId, own.id);
  for (const id of [other.eventId, other.experienceId, other.stationId, foreign.id]) assert.equal(JSON.stringify([stations.body, queue.body]).includes(id), false);
});
test("E08.4 PostgreSQL HTTP privacidade usa projeção fechada com dados privados persistidos", async () => {
  const c = await populated(), waiting = await entry(c, c.experienceId), called = await entry(c, c.experienceId, "called", c.stationId), versionId = randomUUID();
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [versionId, `e84-${versionId}`]); ids.versions.push(versionId);
  await pool.query(`INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at)
    VALUES($1,$2,'{"private":"E084_PRIVATE_PROFILE"}','[]',clock_timestamp())`, [waiting.owner.participationId, versionId]);
  const a = await stationsGet(c), b = await queueGet(c); assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(a.body).sort(), ["eventId", "stations"]);
  for (const station of a.body.stations) {
    assert.deepEqual(Object.keys(station).sort(), ["availability", "experienceId", "id", "label", "pendingCalledAt", "pendingServiceSessionId"]);
    assert.equal(station.label, "Estação E084");
  }
  assert.deepEqual(Object.keys(b.body).sort(), ["acceptingNewEntries", "canCallWaitingEntries", "eventId", "experienceId", "firstWaitingQueueEntryId", "observedAt", "waitingCount"]);
  const json = JSON.stringify([a.body,b.body]);
  for (const secret of [c.viewer.userId,c.staff.userId,waiting.owner.userId,called.owner.userId,waiting.owner.participationId,called.id,
    c.staff.sessionId, "Pessoa privada E084", "Staff privado E084", "example.test", "fixture-private-hash", "E084_PRIVATE_PROFILE"]) assert.equal(json.includes(secret), false);
});
test("E08.4 PostgreSQL HTTP consultas repetidas são read only e não alteram estado persistido", async () => {
  const c = await populated(); await entry(c, c.experienceId); await entry(c, c.experienceId, "called", c.stationId);
  const before = await state();
  for (let n=0;n<3;n++) {
    assert.equal((await afterAuthorization(async () => {}, () => stationsGet(c))).status, 200);
    assert.equal((await afterAuthorization(async () => {}, () => queueGet(c))).status, 200);
  }
  assert.equal(await state(), before);
});
test("E08.4 PostgreSQL HTTP snapshot conserva autorização até fim da leitura e próxima consulta recusa revogação", async () => {
  for (const kind of ["stations", "queue"]) {
    const c = await populated(); await entry(c, c.experienceId);
    const r = await afterAuthorization(async () => {
      await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
    }, () => kind === "stations" ? stationsGet(c) : queueGet(c));
    assert.equal(r.status, 200);
    if (kind === "stations") assert.equal(r.body.stations[0].id, c.stationId);
    else { assert.equal(r.body.acceptingNewEntries, true); assert.equal(r.body.waitingCount, 1); }
    for (const route of routes(c,c.experienceId)) problem(await get(route,c.staff), 404, "RESOURCE_NOT_FOUND");
  }
});
test("E08.4 PostgreSQL HTTP snapshot conserva dados operacionais apesar de commit concorrente", async () => {
  for (const kind of ["stations", "queue"]) {
    const c = await populated(), waiting = await entry(c,c.experienceId), called = await entry(c,c.experienceId,"called",c.stationId);
    const pending = (await pool.query("SELECT id FROM service_sessions WHERE queue_entry_id=$1", [called.id])).rows[0].id;
    const r = await afterAuthorization(async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=ANY($1::uuid[])", [[waiting.owner.participationId,called.owner.participationId]]);
        await client.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_withdrawal' WHERE id=ANY($1::uuid[])", [[waiting.id,called.id]]);
        await client.query("UPDATE service_sessions SET status='canceled',resolved_at=clock_timestamp(),cancel_reason='fixture_withdrawal' WHERE id=$1", [pending]);
        await client.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
        await client.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
        await client.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }, () => kind === "stations" ? stationsGet(c) : queueGet(c));
    assert.equal(r.status, 200);
    if (kind === "stations") { assert.equal(r.body.stations[0].availability,"available"); assert.equal(r.body.stations[0].pendingServiceSessionId,pending); }
    else { assert.equal(r.body.waitingCount,1); assert.equal(r.body.firstWaitingQueueEntryId,waiting.id); assert.equal(r.body.acceptingNewEntries,true); assert.equal(r.body.canCallWaitingEntries,true); }
    const a = await stationsGet(c), b = await queueGet(c); assert.equal(a.status,200); assert.equal(b.status,200);
    assert.equal(a.body.stations[0].availability,"unavailable"); assert.equal(a.body.stations[0].pendingServiceSessionId,null);
    assert.equal(a.body.stations[0].pendingCalledAt,null); assert.equal(b.body.waitingCount,0); assert.equal(b.body.firstWaitingQueueEntryId,null);
    assert.equal(b.body.acceptingNewEntries,false); assert.equal(b.body.canCallWaitingEntries,false);
  }
});
