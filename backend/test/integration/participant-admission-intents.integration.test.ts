// PARTICIPANTE-01 R02 — concorrência real entre ingresso, consulta e abandono de intenção.
// Executa somente no banco descartável da Etapa 3 (mesma guarda de participant-admission-http).
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import supertest from "supertest";
import { assertParticipantAdmissionTestDatabaseUrls } from "./participant-admission-db-guard";

// A guarda é avaliada antes de importar a aplicação, abrir conexão ou carregar .env.
const connectionString = assertParticipantAdmissionTestDatabaseUrls(process.env);
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVENT_CLOSURE_JOB_TEST_ENABLED = "false";

const pool = new Pool({ connectionString, ssl: false, max: 12, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
const users: string[] = [], events: string[] = [], versions: string[] = [], games: string[] = [];
let app: INestApplication;
let signAccess: (userId: string, sessionId: string) => string;

interface Actor { userId: string; token: string }
interface Fixture { eventId: string; actor: Actor }

before(async () => {
  const destination = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assert.equal(destination.rows[0]?.name, "arenago_admission_test");
  const historical = await pool.query<{ users: string; events: string }>(
    "SELECT (SELECT count(*) FROM users)::text AS users, (SELECT count(*) FROM events)::text AS events",
  );
  if (historical.rows[0]?.users !== "0" || historical.rows[0]?.events !== "0") {
    throw new Error("[SEGURANÇA BLOQUEADA] Banco dedicado contém usuários ou eventos preexistentes.");
  }
  const [{ AppModule }, token] = await Promise.all([import("../../src/app.module"), import("../../src/auth/token.util")]);
  signAccess = (userId, sessionId) => token.signAccessToken({ userId, sessionId });
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
});

after(async () => {
  const errors: unknown[] = [];
  if (events.length || users.length) {
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
    } catch (error) { await client.query("ROLLBACK"); errors.push(error); }
    finally { client.release(); }
  }
  for (const item of await Promise.allSettled([app?.close(), pool.end()]))
    if (item.status === "rejected") errors.push(item.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza da fixture R02 falhou.");
});

async function actor(): Promise<Actor> {
  const userId = randomUUID(), sessionId = randomUUID(), versionId = randomUUID(), gameId = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'R02 fixture',$2,'fixture-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, `${userId}@example.test`]);
  users.push(userId);
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`, [sessionId, userId]);
  versions.push(versionId); games.push(gameId);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}'::jsonb,clock_timestamp(),clock_timestamp())",
    [versionId, `r02-${versionId.slice(0, 8)}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'1990-01-01','Masculino','Superior','Conheço um pouco.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [userId, versionId]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [gameId, `R02 ${gameId}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [userId, gameId]);
  return { userId, token: signAccess(userId, sessionId) };
}

async function fixture(externalQueueEnabled = true): Promise<Fixture> {
  const eventId = randomUUID(), code = `R2-${eventId.slice(0, 12).toUpperCase()}`;
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'R02 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',$3,clock_timestamp(),clock_timestamp())`,
  [eventId, code, externalQueueEnabled]); events.push(eventId);
  const experienceId = randomUUID();
  await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'R02 experience',clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'R02 station','available',clock_timestamp(),clock_timestamp())", [randomUUID(), experienceId]);
  return { eventId, actor: await actor() };
}

const post = (path: string, f: Fixture, key: string, eventId = f.eventId, a = f.actor) =>
  supertest(app.getHttpServer()).post(`/api/v1/${path}`)
    .set("Authorization", `Bearer ${a.token}`).set("Idempotency-Key", key).send({ eventId });
const join = (f: Fixture, key: string) => post("participations", f, key);
const lookup = (f: Fixture, key: string, eventId?: string, a?: Actor) => post("participations/admission-intents/lookup", f, key, eventId, a);
const abandon = (f: Fixture, key: string, eventId?: string) => post("participations/admission-intents/abandon", f, key, eventId);

async function counts(f: Fixture) {
  const response = await pool.query<{ participations: string; snapshots: string; operations: string; lastOrder: string }>(`
    SELECT (SELECT count(*) FROM participations WHERE user_id=$1)::text AS participations,
      (SELECT count(*) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.user_id=$1)::text AS snapshots,
      (SELECT count(*) FROM idempotency_operations WHERE actor_user_id=$1 AND operation='join')::text AS operations,
      (SELECT external_last_order::text FROM events WHERE id=$2) AS "lastOrder"`, [f.actor.userId, f.eventId]);
  return response.rows[0];
}

test("R02-T01 PostgreSQL: consulta de chave inexistente em evento aberto não cria nada", async () => {
  const f = await fixture(); const before = await counts(f);
  const response = await lookup(f, randomUUID());
  assert.equal(response.status, 200); assert.deepEqual(response.body, { intent: { state: "not_found" } });
  assert.deepEqual(await counts(f), before);
  assert.equal(before.participations, "0");
});

test("R02-T07 PostgreSQL: abandono antes do ingresso atrasado impede a criação, a fila e o snapshot", async () => {
  const f = await fixture(); const key = randomUUID(); const before = await counts(f);
  const abandoned = await abandon(f, key);
  assert.equal(abandoned.status, 200); assert.deepEqual(abandoned.body, { intent: { state: "abandoned" } });
  const late = await join(f, key);
  assert.equal(late.status, 409); assert.equal(late.body.code, "ADMISSION_INTENT_ABANDONED");
  const after = await counts(f);
  assert.equal(after.participations, "0"); assert.equal(after.snapshots, "0");
  assert.equal(after.lastOrder, before.lastOrder, "posição da fila externa não foi consumida");
  assert.deepEqual((await lookup(f, key)).body, { intent: { state: "abandoned" } });
  assert.deepEqual((await abandon(f, key)).body, { intent: { state: "abandoned" } }, "R02-T09/T10: abandono repetido");
});

test("R02-T08 PostgreSQL: ingresso concluído antes do abandono é preservado", async () => {
  const f = await fixture(); const key = randomUUID();
  const created = await join(f, key); assert.equal(created.status, 201);
  const abandoned = await abandon(f, key);
  assert.deepEqual(abandoned.body, { intent: { state: "completed", participationId: created.body.participationId } });
  const replay = await join(f, key);
  assert.equal(replay.status, 201); assert.equal(replay.body.participationId, created.body.participationId);
  assert.equal((await counts(f)).participations, "1");
});

test("R02-T03/T04 PostgreSQL: outra conta e fingerprint diferente não acessam nem alteram a intenção", async () => {
  const f = await fixture(); const key = randomUUID(); const other = await actor();
  const created = await join(f, key); assert.equal(created.status, 201);
  assert.deepEqual((await lookup(f, key, f.eventId, other)).body, { intent: { state: "not_found" } });
  const g = await fixture();
  assert.deepEqual((await lookup(f, key, g.eventId)).body, { intent: { state: "conflict" } });
  const conflict = await abandon(f, key, g.eventId);
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual((await lookup(f, key)).body, { intent: { state: "completed", participationId: created.body.participationId } });
});

test("R02-T24 PostgreSQL: ingresso e abandono concorrentes com a mesma chave têm um único desfecho terminal", async () => {
  for (let round = 0; round < 12; round++) {
    const f = await fixture(round % 2 === 0); const key = randomUUID();
    const [joined, abandoned, looked] = await Promise.all([join(f, key), abandon(f, key), lookup(f, key)]);
    const c = await counts(f);
    assert.equal(c.operations, "1", "uma única linha de idempotência por chave");
    if (joined.status === 201) {
      assert.deepEqual(abandoned.body, { intent: { state: "completed", participationId: joined.body.participationId } });
      assert.equal(c.participations, "1"); assert.equal(c.snapshots, "1");
    } else {
      assert.equal(joined.status, 409); assert.equal(joined.body.code, "ADMISSION_INTENT_ABANDONED");
      assert.deepEqual(abandoned.body, { intent: { state: "abandoned" } });
      assert.equal(c.participations, "0"); assert.equal(c.snapshots, "0");
    }
    assert.equal(looked.status, 200);
    assert.ok(["not_found", "completed", "abandoned"].includes(looked.body.intent.state), "consulta nunca vê estado parcial");
  }
});

test("R02-T24 PostgreSQL: abandono de A e ingresso em B da mesma conta não entram em deadlock", async () => {
  const a = await fixture(); const b = { eventId: (await fixture()).eventId, actor: a.actor };
  const keyA = randomUUID(), keyB = randomUUID();
  const results = await Promise.all([abandon(a, keyA), join(b, keyB), abandon(a, randomUUID()), join(b, keyB)]);
  assert.ok(results.every(response => response.status < 500), JSON.stringify(results.map(r => r.body)));
  assert.equal((await counts(a)).participations, "1", "B criado uma única vez");
});
