import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import supertest from "supertest";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import { assertParticipantAdmissionTestDatabaseUrls } from "./participant-admission-db-guard";

// A guarda é avaliada antes de importar a aplicação, abrir conexão ou carregar .env.
const connectionString = assertParticipantAdmissionTestDatabaseUrls(process.env);
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVENT_CLOSURE_JOB_TEST_ENABLED = "false";

const pool = new Pool({ connectionString, ssl: false, max: 8, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
const users: string[] = [], events: string[] = [], versions: string[] = [], games: string[] = [];
let app: INestApplication;
let database: NodePgDatabase<typeof schema>;
let admissionService: import("../../src/participations/participations.service").ParticipationsService;
let eventsService: import("../../src/events/events.service").EventsService;
let signAccess: (userId: string, sessionId: string) => string;

interface Actor { userId: string; sessionId: string; token: string }
interface Fixture { eventId: string; code: string; actor: Actor }

before(async () => {
  const destination = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assert.equal(destination.rows[0]?.name, "arenago_admission_test");
  const historical = await pool.query<{ users: string; events: string }>(
    "SELECT (SELECT count(*) FROM users)::text AS users, (SELECT count(*) FROM events)::text AS events",
  );
  if (historical.rows[0]?.users !== "0" || historical.rows[0]?.events !== "0") {
    throw new Error("[SEGURANÇA BLOQUEADA] Banco dedicado contém usuários ou eventos preexistentes.");
  }
  const [{ AppModule }, { DRIZZLE_DATABASE }, { ParticipationsService }, { EventsService }, token] = await Promise.all([
    import("../../src/app.module"), import("../../src/database/database.module"),
    import("../../src/participations/participations.service"), import("../../src/events/events.service"),
    import("../../src/auth/token.util"),
  ]);
  signAccess = (userId, sessionId) => token.signAccessToken({ userId, sessionId });
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  database = app.get(DRIZZLE_DATABASE); admissionService = app.get(ParticipationsService); eventsService = app.get(EventsService);
});

after(async () => {
  const errors: unknown[] = [];
  if (events.length || users.length || versions.length || games.length) {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM participation_profile_snapshots s USING participations p
          WHERE s.participation_id=p.id AND (p.event_id=ANY($1::uuid[]) OR p.user_id=ANY($2::uuid[]))`, [events, users]);
        await client.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])", [events, users]);
        await client.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM stations WHERE experience_id IN (SELECT id FROM experiences WHERE event_id=ANY($1::uuid[]))", [events]);
        await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [events]);
        await client.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [events]);
        await client.query("DELETE FROM games WHERE id=ANY($1::uuid[])", [games]);
        await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
        await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [versions]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { errors.push(error); }
  }
  for (const item of await Promise.allSettled([app?.close(), pool.end()]))
    if (item.status === "rejected") errors.push(item.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza da fixture Etapa 3 falhou.");
});

async function actor(complete = true): Promise<Actor> {
  const userId = randomUUID(), sessionId = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Admission fixture',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [userId, `${userId}@example.test`]); users.push(userId);
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`, [sessionId, userId]);
  if (complete) {
    const versionId = randomUUID(), gameId = randomUUID(); versions.push(versionId); games.push(gameId);
    await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}'::jsonb,clock_timestamp(),clock_timestamp())",
      [versionId, `admission-${versionId.slice(0, 8)}`]);
    await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
      VALUES($1,'1990-01-01','Masculino','Superior','Conheço um pouco.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, versionId]);
    await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [gameId, `Admission ${gameId}`]);
    await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [userId, gameId]);
  }
  return { userId, sessionId, token: signAccess(userId, sessionId) };
}
async function fixture(externalQueueEnabled = false, complete = true): Promise<Fixture> {
  const eventId = randomUUID(), code = `AD-${eventId.slice(0, 12).toUpperCase()}`;
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'Admission fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',$3,clock_timestamp(),clock_timestamp())`,
  [eventId, code, externalQueueEnabled]); events.push(eventId);
  const staff = await actor(false), person = await actor(complete);
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), staff.userId, eventId]);
  const experienceId = randomUUID();
  await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'Admission experience',clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Admission station','available',clock_timestamp(),clock_timestamp())", [randomUUID(), experienceId]);
  return { eventId, code, actor: person };
}
const lookup = (f: Fixture) => supertest(app.getHttpServer()).post("/api/v1/events/lookup")
  .set("Authorization", `Bearer ${f.actor.token}`).send({ accessCode: ` ${f.code.toLowerCase()} ` });
const join = (f: Fixture, key = randomUUID()) => supertest(app.getHttpServer()).post("/api/v1/participations")
  .set("Authorization", `Bearer ${f.actor.token}`).set("Idempotency-Key", key).send({ eventId: f.eventId });
function problem(response: supertest.Response, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.match(response.headers["content-type"], /application\/problem\+json/); assert.equal(response.body.code, code);
}
async function counts(f: Fixture) {
  const response = await pool.query<{ participations: string; snapshots: string; operations: string }>(`
    SELECT (SELECT count(*) FROM participations WHERE user_id=$1)::text AS participations,
      (SELECT count(*) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.user_id=$1)::text AS snapshots,
      (SELECT count(*) FROM idempotency_operations WHERE actor_user_id=$1 AND operation='join')::text AS operations`, [f.actor.userId]);
  return response.rows[0];
}

test("Etapa 3 PostgreSQL lookup exato é informativo e não escreve", async () => {
  const f = await fixture(); const response = await lookup(f);
  assert.equal(response.status, 200); assert.equal(response.body.event.id, f.eventId);
  assert.equal(response.body.event.name, "Admission fixture"); assert.equal(response.body.eligibility.eligible, true);
  assert.deepEqual(await counts(f), { participations: "0", snapshots: "0", operations: "0" });
  problem(await supertest(app.getHttpServer()).post("/api/v1/events/lookup")
    .set("Authorization", `Bearer ${f.actor.token}`).send({ accessCode: "AD-UNKNOWN" }), 404, "EVENT_NOT_FOUND");
});
test("Etapa 3 PostgreSQL ingresso ativo cria participação, snapshot e reserva concluída", async () => {
  const f = await fixture(); const response = await join(f);
  assert.equal(response.status, 201); assert.match(response.body.participationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await counts(f), { participations: "1", snapshots: "1", operations: "1" });
  const row = await pool.query("SELECT status,arena_entered_at FROM participations WHERE id=$1", [response.body.participationId]);
  assert.equal(row.rows[0].status, "active"); assert.ok(row.rows[0].arena_entered_at);
});
test("Etapa 3 PostgreSQL fila externa inicia waiting sem entrada de fila interna", async () => {
  const f = await fixture(true); const response = await join(f);
  assert.equal(response.status, 201);
  const row = await pool.query(`SELECT p.status,p.external_queue_order::text AS position,p.arena_entered_at,
    (SELECT count(*)::int FROM queue_entries q WHERE q.participation_id=p.id) AS queue_entries
    FROM participations p WHERE p.id=$1`, [response.body.participationId]);
  assert.equal(row.rows[0].status, "waiting"); assert.equal(row.rows[0].position, "1");
  assert.equal(row.rows[0].arena_entered_at, null); assert.equal(row.rows[0].queue_entries, 0);
});
test("Etapa 3 PostgreSQL replay e concorrência mesma chave persistem uma única operação", async () => {
  const f = await fixture(), key = randomUUID();
  const [first, second] = await Promise.all([join(f, key), join(f, key)]);
  assert.equal(first.status, 201); assert.equal(second.status, 201); assert.deepEqual(first.body, second.body);
  assert.deepEqual((await join(f, key)).body, first.body);
  assert.deepEqual(await counts(f), { participations: "1", snapshots: "1", operations: "1" });
  const operation = await pool.query("SELECT status,http_status,result_reference,result_payload FROM idempotency_operations WHERE actor_user_id=$1 AND operation='join'", [f.actor.userId]);
  assert.equal(operation.rows[0].status, "completed"); assert.equal(operation.rows[0].http_status, 201);
  assert.equal(operation.rows[0].result_reference, first.body.participationId);
  assert.deepEqual(operation.rows[0].result_payload, first.body);
});
test("Etapa 3 PostgreSQL chave reutilizada para outro evento conflita sem criar nova participação", async () => {
  const first = await fixture(), second = await fixture(); const key = randomUUID();
  assert.equal((await join(first, key)).status, 201);
  const response = await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", `Bearer ${first.actor.token}`).set("Idempotency-Key", key).send({ eventId: second.eventId });
  problem(response, 409, "IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual(await counts(first), { participations: "1", snapshots: "1", operations: "1" });
});
test("Etapa 3 PostgreSQL perfil incompleto é bloqueado e reserva sofre rollback", async () => {
  const f = await fixture(false, false);
  assert.equal((await lookup(f)).body.eligibility.eligible, false);
  problem(await join(f), 422, "PROFILE_INCOMPLETE");
  assert.deepEqual(await counts(f), { participations: "0", snapshots: "0", operations: "0" });
});
test("Etapa 3 PostgreSQL janela e disponibilidade bloqueiam ingresso sem escrita", async () => {
  const future = await fixture();
  await pool.query(`WITH clock AS (SELECT clock_timestamp() AS t)
    UPDATE events SET starts_at=clock.t+interval '1 hour',
    official_ends_at=clock.t+interval '2 hours',operational_deadline_at=clock.t+interval '3 hours'
    FROM clock WHERE events.id=$1`, [future.eventId]);
  problem(await join(future), 409, "EVENT_NOT_STARTED");
  assert.deepEqual(await counts(future), { participations: "0", snapshots: "0", operations: "0" });
  const unavailable = await fixture();
  await pool.query("UPDATE stations SET availability='unavailable' WHERE experience_id IN (SELECT id FROM experiences WHERE event_id=$1)", [unavailable.eventId]);
  problem(await join(unavailable), 409, "EVENT_NOT_READY");
  assert.deepEqual(await counts(unavailable), { participations: "0", snapshots: "0", operations: "0" });
});
test("Etapa 3 PostgreSQL participação corrente bloqueia nova chave sem criar operação", async () => {
  const f = await fixture(); assert.equal((await join(f)).status, 201);
  problem(await join(f), 409, "PARTICIPATION_ALREADY_CURRENT");
  assert.deepEqual(await counts(f), { participations: "1", snapshots: "1", operations: "1" });
});
test("Etapa 3 PostgreSQL sessão ausente e identidade arbitrária não escrevem", async () => {
  const f = await fixture();
  problem(await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Idempotency-Key", randomUUID()).send({ eventId: f.eventId }), 401, "MISSING_ACCESS_TOKEN");
  problem(await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", `Bearer ${f.actor.token}`).set("Idempotency-Key", randomUUID())
    .send({ eventId: f.eventId, userId: randomUUID() }), 400, "VALIDATION_ERROR");
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='test' WHERE id=$1", [f.actor.sessionId]);
  problem(await join(f), 401, "SESSION_REVOKED");
  assert.deepEqual(await counts(f), { participations: "0", snapshots: "0", operations: "0" });
});
test("Etapa 3 PostgreSQL falha após escritas reais causa rollback e permite retry", async () => {
  const f = await fixture(), key = randomUUID();
  const { ParticipationsService } = await import("../../src/participations/participations.service");
  const original = admissionService.createParticipation;
  const instrumentedDatabase = { transaction: <T>(
    callback: (tx: DatabaseTransactionExecutor) => Promise<T>,
    config?: Parameters<typeof database.transaction>[1],
  ) => database.transaction(async tx => callback(new Proxy(tx, {
    get(target, property) {
      if (property === "update") return (table: unknown) => {
        if (table === schema.idempotencyOperations) throw new Error("falha injetada após participação e snapshot");
        return (target as unknown as { update: (value: unknown) => unknown }).update(table);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseTransactionExecutor), config) } as unknown as typeof database;
  const injected = new ParticipationsService(instrumentedDatabase, eventsService);
  admissionService.createParticipation = input => injected.createParticipation(input);
  try {
    const failed = await join(f, key); assert.equal(failed.status, 500);
    assert.deepEqual(await counts(f), { participations: "0", snapshots: "0", operations: "0" });
  } finally { admissionService.createParticipation = original; }
  const retried = await join(f, key); assert.equal(retried.status, 201);
  assert.deepEqual(await counts(f), { participations: "1", snapshots: "1", operations: "1" });
});
