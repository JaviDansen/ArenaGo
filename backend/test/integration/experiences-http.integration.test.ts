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
import type { EventsService } from "../../src/events/events.service";
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
let app: INestApplication, events: EventsService, database: NodePgDatabase<typeof schema>;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[] };
const baseOrder = 9007199254741000n;
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { EventsModule } = await import("../../src/events/events.module");
  const { EventsService } = await import("../../src/events/events.service");
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ProblemDetailsExceptionFilter } = await import("../../src/common/errors/problem-details.filter");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId, sessionId, expired) => tokens.signAccessToken({ userId, sessionId }, expired ? { nowMs: Date.now()-120000, ttlSeconds: 1 } : undefined);
  @Module({ imports: [EventsModule], providers: [{ provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter }] })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule, { logger: false }); app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  events = app.get(EventsService); database = app.get(DRIZZLE_DATABASE);
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
  if (errors.length) throw new AggregateError(errors, "Limpeza E08.3 falhou.");
});
async function account(name = "Pessoa privada E083") {
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
    VALUES($1,'E083 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E083-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const viewer = await person(eventId), staff = await account("Staff privado E083"), roleId = randomUUID();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [roleId, staff.userId, eventId]);
  return { eventId, viewer, staff, roleId };
}
type Context = Awaited<ReturnType<typeof context>>;
async function experience(eventId: string, name = "Experiência E083", id = randomUUID()) {
  await pool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())`, [id, eventId, name, baseOrder.toString()]);
  return id;
}
async function station(experienceId: string, available = true) {
  const id = randomUUID();
  await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'Estação E083',$3,clock_timestamp(),clock_timestamp())`, [id, experienceId, available ? "available" : "unavailable"]);
  return id;
}
async function populated() {
  const c = await context(), experienceId = await experience(c.eventId), stationId = await station(experienceId);
  return { ...c, experienceId, stationId };
}
async function entry(c: Context, experienceId: string, status: "waiting" | "called" | "closed" = "waiting", stationId?: string) {
  const owner = await person(c.eventId), id = randomUUID();
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
const get = (c: Context, auth = c.viewer, eventId: string = c.eventId) => supertest(app.getHttpServer()).get(`/api/v1/events/${eventId}/experiences`).set("Authorization", `Bearer ${auth.token}`);
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

test("E08.3 PostgreSQL HTTP titular active recebe estrutura e instante PostgreSQL em 200", async () => {
  const c = await populated(), before = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  const r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.eventId, c.eventId); assert.equal(r.body.acceptingNewQueueEntries, true);
  assert.equal(r.body.experiences[0].id, c.experienceId); assert.equal(r.body.experiences[0].waitingCount, 0);
  assert.equal(r.body.experiences[0].stations[0].id, c.stationId);
  const after = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  assert.match(r.body.observedAt, /Z$/); assert.ok(Date.parse(r.body.observedAt) >= before.getTime()-1 && Date.parse(r.body.observedAt) <= after.getTime()+1);
});
test("E08.3 PostgreSQL HTTP ausência de Bearer recebe 401", async () => {
  const c = await populated(), before = await state();
  problem(await supertest(app.getHttpServer()).get(`/api/v1/events/${c.eventId}/experiences`), 401, "MISSING_ACCESS_TOKEN");
  assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP sessão revogada, sessão expirada e token expirado não acessam", async () => {
  for (const mode of ["revoked", "session-expired", "token-expired"]) {
    const c = await populated();
    if (mode === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1", [c.viewer.sessionId]);
    if (mode === "session-expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [c.viewer.sessionId]);
    if (mode === "token-expired") c.viewer.token = signAccess(c.viewer.userId, c.viewer.sessionId, true);
    const before = await state(); problem(await get(c), 401, mode === "revoked" ? "SESSION_REVOKED" : mode === "session-expired" ? "SESSION_EXPIRED" : "ACCESS_TOKEN_EXPIRED");
    assert.equal(await state(), before);
  }
});
test("E08.3 PostgreSQL HTTP participação waiting externa não autoriza consulta", async () => {
  const c = await populated(), waiting = await person(c.eventId, "waiting"), before = await state();
  problem(await get(c, waiting), 404, "RESOURCE_NOT_FOUND"); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP participações finished e canceled não autorizam consulta", async () => {
  const c = await populated();
  for (const status of ["finished", "canceled"] as const) {
    const terminal = await person(c.eventId, status), before = await state();
    problem(await get(c, terminal), 404, "RESOURCE_NOT_FOUND"); assert.equal(await state(), before);
  }
});
test("E08.3 PostgreSQL HTTP participação ativa de outro evento ou conta sem participação não concede acesso", async () => {
  const c = await populated(), other = await populated(), outsider = await account(), before = await state();
  problem(await get(c, other.viewer), 404, "RESOURCE_NOT_FOUND");
  const noParticipation = { ...c.viewer, ...outsider }; problem(await get(c, noParticipation), 404, "RESOURCE_NOT_FOUND"); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP evento inexistente e existente inacessível são indistinguíveis", async () => {
  const c = await populated(), other = await populated(), a = await get(c, c.viewer, randomUUID()), b = await get(c, c.viewer, other.eventId);
  problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
  assert.equal(JSON.stringify(b.body).includes(other.eventId), false);
});
test("E08.3 PostgreSQL HTTP múltiplas experiências preservam agrupamento e ordenação UUID", async () => {
  const c = await context(), experiences = [randomUUID(), randomUUID(), randomUUID()].sort();
  for (const id of [...experiences].reverse()) await station(await experience(c.eventId, "Nome repetido", id));
  await entry(c, experiences[0]); await entry(c, experiences[0]); await entry(c, experiences[1]);
  const r = await get(c); assert.equal(r.status, 200); assert.deepEqual(r.body.experiences.map((e: { id: string }) => e.id), experiences);
  assert.deepEqual(r.body.experiences.map((e: { waitingCount: number }) => e.waitingCount), [2,1,0]);
});
test("E08.3 PostgreSQL HTTP experiência sem estações retorna stations vazio sem bloquear outra apta", async () => {
  const c = await populated(), empty = await experience(c.eventId, "Sem estações"), r = await get(c); assert.equal(r.status, 200);
  const e = r.body.experiences.find((e: { id: string }) => e.id === empty);
  assert.deepEqual(e.stations, []); assert.equal(e.waitingCount, 0); assert.equal(e.acceptingNewQueueEntries, false); assert.equal(r.body.acceptingNewQueueEntries, true);
});
test("E08.3 PostgreSQL HTTP várias estações não multiplicam a contagem compartilhada", async () => {
  const c = await populated(), more = [await station(c.experienceId), await station(c.experienceId, false)];
  await entry(c, c.experienceId); await entry(c, c.experienceId);
  const r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 2);
  assert.deepEqual(r.body.experiences[0].stations.map((s: { id: string }) => s.id), [c.stationId, ...more].sort());
});
test("E08.3 PostgreSQL HTTP called e closed não contam e available não significa estação livre", async () => {
  const c = await populated(); await entry(c, c.experienceId); await entry(c, c.experienceId, "called", c.stationId); await entry(c, c.experienceId, "closed");
  const r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 1);
  assert.equal(r.body.experiences[0].stations[0].available, true); assert.equal(r.body.experiences[0].acceptingNewQueueEntries, true);
});
test("E08.3 PostgreSQL HTTP estação indisponível preserva espera existente e bloqueia ingresso", async () => {
  const c = await populated(); await entry(c, c.experienceId);
  await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  const before = await state(), r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 1);
  assert.equal(r.body.experiences[0].stations[0].available, false); assert.equal(r.body.acceptingNewQueueEntries, false); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP fila pausada mantém contagem sem oferecer novos ingressos", async () => {
  const c = await populated(); await entry(c, c.experienceId);
  await pool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
  const before = await state(), r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 1);
  assert.equal(r.body.experiences[0].stations[0].available, true); assert.equal(r.body.experiences[0].acceptingNewQueueEntries, false);
  assert.equal(r.body.acceptingNewQueueEntries, false); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP cortes oficial e Admin mudam disponibilidade sem apagar fila", async () => {
  for (const mode of ["official", "admin"]) {
    const c = await populated(); await entry(c, c.experienceId);
    if (mode === "official") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [c.eventId]);
    else await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
    const before = await state(), r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 1);
    assert.equal(r.body.experiences[0].acceptingNewQueueEntries, false); assert.equal(r.body.acceptingNewQueueEntries, false); assert.equal(await state(), before);
  }
});
test("E08.3 PostgreSQL HTTP janela residual conserva espera e chamada pendente", async () => {
  const c = await populated(), waiting = await entry(c, c.experienceId), called = await entry(c, c.experienceId, "called", c.stationId);
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',operational_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
  const before = await state(), r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.experiences[0].waitingCount, 1);
  assert.equal(r.body.acceptingNewQueueEntries, false); assert.equal(await state(), before);
  const rows = (await pool.query("SELECT id,status FROM queue_entries WHERE id=ANY($1::uuid[]) ORDER BY id", [[waiting.id, called.id]])).rows;
  assert.equal(rows.find(row => row.id === waiting.id).status, "waiting"); assert.equal(rows.find(row => row.id === called.id).status, "called");
});
test("E08.3 PostgreSQL HTTP consultas repetidas usam transação read only sem efeitos ou idempotência", async () => {
  const c = await populated(); await entry(c, c.experienceId);
  const before = await state(), original = events.evaluateEventAvailabilityById.bind(events); let reached = 0;
  events.evaluateEventAvailabilityById = async (eventId, at, executor) => {
    assert.ok(executor && executor !== database);
    const settings = (await executor.execute<{ isolation: string; readOnly: string }>(sql`SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS "readOnly"`)).rows[0];
    assert.equal(settings.isolation, "repeatable read"); assert.equal(settings.readOnly, "on"); reached++;
    return original(eventId, at, executor);
  };
  try { for (let n=0;n<3;n++) assert.equal((await get(c)).status, 200); }
  finally { events.evaluateEventAvailabilityById = original; }
  assert.equal(reached, 3); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP snapshot preserva fila, estações e disponibilidade após commit concorrente", async () => {
  const c = await populated(), waiting = await entry(c, c.experienceId), original = events.evaluateEventAvailabilityById.bind(events); let changed = false;
  events.evaluateEventAvailabilityById = async (...args) => {
    const availability = await original(...args); assert.ok(availability.eventExists && availability.eventAcceptingNewEntries);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [waiting.owner.participationId]);
      await client.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_withdrawal' WHERE id=$1", [waiting.id]);
      await client.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
      await client.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [c.experienceId]);
      await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
      await client.query("COMMIT"); changed = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return availability;
  };
  let during: supertest.Response;
  try { during = await get(c); } finally { events.evaluateEventAvailabilityById = original; }
  assert.equal(changed, true); assert.equal(during.status, 200); assert.equal(during.body.acceptingNewQueueEntries, true);
  assert.equal(during.body.experiences[0].waitingCount, 1); assert.equal(during.body.experiences[0].stations[0].available, true);
  const after = await get(c); assert.equal(after.status, 200); assert.equal(after.body.acceptingNewQueueEntries, false);
  assert.equal(after.body.experiences[0].waitingCount, 0); assert.equal(after.body.experiences[0].stations[0].available, false);
});
test("E08.3 PostgreSQL HTTP autorização compartilha snapshot e consulta seguinte observa perda de acesso", async () => {
  const c = await populated(), original = events.evaluateEventAvailabilityById.bind(events); let changed = false;
  events.evaluateEventAvailabilityById = async (...args) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture_finished' WHERE id=$1", [c.viewer.participationId]);
      await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
      await client.query("COMMIT"); changed = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return original(...args);
  };
  let during: supertest.Response;
  try { during = await get(c); } finally { events.evaluateEventAvailabilityById = original; }
  assert.equal(changed, true); assert.equal(during.status, 200); assert.equal(during.body.acceptingNewQueueEntries, true);
  assert.equal(during.body.experiences[0].id, c.experienceId); problem(await get(c), 404, "RESOURCE_NOT_FOUND");
});
test("E08.3 PostgreSQL HTTP JSON expõe somente campos públicos sem perfis, pessoas ou Staff", async () => {
  const c = await populated(), waiting = await entry(c, c.experienceId), versionId = randomUUID();
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [versionId, `e83-${versionId}`]);
  ids.versions.push(versionId);
  await pool.query(`INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at)
    VALUES($1,$2,'{"private":"E083_PRIVATE_PROFILE"}','[]',clock_timestamp())`, [waiting.owner.participationId, versionId]);
  const r = await get(c); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["acceptingNewQueueEntries", "eventId", "experiences", "observedAt"]);
  for (const e of r.body.experiences) {
    assert.deepEqual(Object.keys(e).sort(), ["acceptingNewQueueEntries", "id", "name", "stations", "waitingCount"]);
    assert.ok(Number.isSafeInteger(e.waitingCount) && e.waitingCount >= 0);
    for (const s of e.stations) assert.deepEqual(Object.keys(s).sort(), ["available", "id", "label"]);
  }
  const json = JSON.stringify(r.body);
  for (const secret of [c.viewer.userId, c.staff.userId, waiting.owner.userId, waiting.id, "Pessoa privada E083", "Staff privado E083", "example.test", "fixture-private-hash", "E083_PRIVATE_PROFILE"]) assert.equal(json.includes(secret), false);
});
test("E08.3 PostgreSQL HTTP lista vazia retorna 200 e disponibilidade global false", async () => {
  const c = await context(), before = await state(), r = await get(c); assert.equal(r.status, 200);
  assert.deepEqual(r.body.experiences, []); assert.equal(r.body.acceptingNewQueueEntries, false); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP UUID inválido recebe 400 e UUID maiúsculo é normalizado", async () => {
  const c = await populated(), before = await state();
  problem(await get(c, c.viewer, "bad"), 400, "VALIDATION_ERROR"); const r = await get(c, c.viewer, c.eventId.toUpperCase());
  assert.equal(r.status, 200); assert.equal(r.body.eventId, c.eventId); assert.equal(await state(), before);
});
test("E08.3 PostgreSQL HTTP Admin mantém segundo fator e não precisa de concessão Staff", async () => {
  const c = await populated();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'admin',NULL,clock_timestamp())", [randomUUID(), c.viewer.userId]);
  problem(await get(c), 401, "ADMIN_2FA_REQUIRED");
  const row = await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id", [c.viewer.sessionId, c.viewer.userId]);
  assert.equal(row.rowCount, 1); assert.equal(row.rows[0].id, c.viewer.sessionId); assert.equal((await get(c)).status, 200);
});
test("E08.3 PostgreSQL HTTP evento futuro e Staff revogado impedem ingresso sem ocultar experiências", async () => {
  for (const mode of ["future", "staff"]) {
    const c = await populated(); await entry(c, c.experienceId);
    if (mode === "future") await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1", [c.eventId]);
    else await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
    const before = await state(), r = await get(c); assert.equal(r.status, 200); assert.equal(r.body.acceptingNewQueueEntries, false);
    assert.equal(r.body.experiences[0].waitingCount, 1); assert.equal(await state(), before);
  }
});
