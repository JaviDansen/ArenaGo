import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService } from "../../src/participations/participations.service";

const databaseUrlValue = process.env.DATABASE_URL;
const testDatabaseUrlValue = process.env.EVENTS_TEST_DATABASE_URL;
if (!databaseUrlValue || !testDatabaseUrlValue) {
  throw new Error("DATABASE_URL e EVENTS_TEST_DATABASE_URL precisam apontar ao banco descartável arenago_events_test.");
}
const databaseUrl = new URL(databaseUrlValue);
const testDatabaseUrl = new URL(testDatabaseUrlValue);
const isLocal = (hostname: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
const isAuthorized = (url: URL) => isLocal(url.hostname)
  && url.port === "55432"
  && url.pathname.replace(/^\//, "") === "arenago_events_test";
if (!isAuthorized(databaseUrl) || !isAuthorized(testDatabaseUrl)
  || databaseUrl.hostname !== testDatabaseUrl.hostname
  || databaseUrl.port !== testDatabaseUrl.port
  || databaseUrl.pathname !== testDatabaseUrl.pathname) {
  throw new Error("Ambas as URLs precisam apontar ao mesmo localhost:55432/arenago_events_test.");
}

const appName = `arena-join-create-${randomUUID()}`;
const servicePool = new Pool({ connectionString: testDatabaseUrlValue, application_name: appName, max: 6 });
const fixturePool = new Pool({ connectionString: testDatabaseUrlValue, max: 4 });
const database = drizzle(servicePool, { schema });
const service = new ParticipationsService(database, new EventsService(database));
const fixtureTime = new Date();
const expiresAt = new Date("2099-01-01T00:00:00.000Z");

interface Fixtures {
  users: string[];
  events: string[];
  roles: string[];
  experiences: string[];
  stations: string[];
  versions: string[];
  games: string[];
  participations: string[];
}
const fixtures: Fixtures = { users: [], events: [], roles: [], experiences: [], stations: [], versions: [], games: [], participations: [] };
after(async () => {
  await cleanup();
  await Promise.all([servicePool.end(), fixturePool.end()]);
});

async function createUser(active = true, verified = false): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(
    "INSERT INTO users(id,name,email,password_hash,is_active,email_verified_at,created_at,updated_at) VALUES($1,'Join creation fixture',$2,'placeholder',$3,$4,$5,$5)",
    [id, `${id}@example.test`, active, verified ? fixtureTime : null, fixtureTime],
  );
  fixtures.users.push(id);
  return id;
}

async function createReadyEvent(externalQueueEnabled: boolean): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() - 60_000);
  const officialEnd = new Date(Date.now() + 30 * 60_000);
  await fixturePool.query(
    `INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
     VALUES($1,'Join creation fixture',$2,'America/Sao_Paulo',$3,$4,$5,'open',$6,$7,$7)`,
    [id, `JC-${id.slice(0, 8).toUpperCase()}`, startsAt, officialEnd, new Date(officialEnd.getTime() + 30 * 60_000), externalQueueEnabled, fixtureTime],
  );
  fixtures.events.push(id);
  const staffId = await createUser(true, true);
  const roleId = randomUUID();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,$4)", [roleId, staffId, id, fixtureTime]);
  fixtures.roles.push(roleId);
  const experienceId = randomUUID();
  await fixturePool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'Fixture experience',$3,$3)", [experienceId, id, fixtureTime]);
  fixtures.experiences.push(experienceId);
  const stationId = randomUUID();
  await fixturePool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Fixture station','available',$3,$3)", [stationId, experienceId, fixtureTime]);
  fixtures.stations.push(stationId);
  return id;
}

async function completeProfile(userId: string): Promise<{
  versionId: string;
  gamesSnapshot: Array<{ gameId: string; name: string; isCurated: boolean }>;
}> {
  const versionId = randomUUID();
  await fixturePool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}'::jsonb,$3,$3)", [versionId, `create-${versionId.replaceAll("-", "")}`, fixtureTime]);
  fixtures.versions.push(versionId);
  await fixturePool.query(
    `INSERT INTO profiles(user_id,birth_date,gender,other_gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
     VALUES($1,'1990-02-03','Masculino',NULL,'Superior','Conheço um pouco.','Sim, tenho interesse.',$2,$3,$3,$3)`,
    [userId, versionId, fixtureTime],
  );
  const gamesSnapshot: Array<{ gameId: string; name: string; isCurated: boolean }> = [];
  for (const [name, isCurated] of [["Alpha", false], ["Zeta", false], ["Árvore", true]] as const) {
    const id = randomUUID();
    const canonicalName = `${name} ${id}`;
    await fixturePool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,$3,$4)", [id, canonicalName, isCurated, fixtureTime]);
    fixtures.games.push(id);
    await fixturePool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,$3)", [userId, id, fixtureTime]);
    gamesSnapshot.push({ gameId: id, name: canonicalName, isCurated });
  }
  return { versionId, gamesSnapshot };
}

async function cleanup(): Promise<void> {
  await fixturePool.query(
    `DELETE FROM participation_profile_snapshots s USING participations p
     WHERE s.participation_id=p.id
       AND (p.user_id=ANY($1::uuid[]) OR p.event_id=ANY($2::uuid[]) OR p.id=ANY($3::uuid[]))`,
    [fixtures.users, fixtures.events, fixtures.participations],
  );
  await fixturePool.query(
    `DELETE FROM participations
     WHERE user_id=ANY($1::uuid[]) OR event_id=ANY($2::uuid[]) OR id=ANY($3::uuid[])`,
    [fixtures.users, fixtures.events, fixtures.participations],
  );
  if (fixtures.users.length) await fixturePool.query("DELETE FROM idempotency_operations WHERE actor_user_id = ANY($1::uuid[])", [fixtures.users]);
  if (fixtures.users.length) {
    await fixturePool.query("DELETE FROM user_games WHERE user_id = ANY($1::uuid[])", [fixtures.users]);
    await fixturePool.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [fixtures.users]);
  }
  if (fixtures.stations.length) await fixturePool.query("DELETE FROM stations WHERE id = ANY($1::uuid[])", [fixtures.stations]);
  if (fixtures.experiences.length) await fixturePool.query("DELETE FROM experiences WHERE id = ANY($1::uuid[])", [fixtures.experiences]);
  if (fixtures.roles.length) await fixturePool.query("DELETE FROM user_roles WHERE id = ANY($1::uuid[])", [fixtures.roles]);
  if (fixtures.events.length) await fixturePool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [fixtures.events]);
  if (fixtures.games.length) await fixturePool.query("DELETE FROM games WHERE id = ANY($1::uuid[])", [fixtures.games]);
  if (fixtures.users.length) await fixturePool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixtures.users]);
  if (fixtures.versions.length) await fixturePool.query("DELETE FROM questionnaire_versions WHERE id = ANY($1::uuid[])", [fixtures.versions]);
  fixtures.users.length = 0;
  fixtures.events.length = 0;
  fixtures.roles.length = 0;
  fixtures.experiences.length = 0;
  fixtures.stations.length = 0;
  fixtures.versions.length = 0;
  fixtures.games.length = 0;
  fixtures.participations.length = 0;
}

async function waitUntilBlocked(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await fixturePool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock' LIMIT 1", [appName]);
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("O PostgreSQL não sinalizou espera concorrente por lock.");
}

function createServiceFailingBeforeIdempotencyCompletion(): ParticipationsService {
  const databaseWithInjectedFailure = {
    transaction: <T>(
      callback: (tx: DatabaseTransactionExecutor) => Promise<T>,
      config?: Parameters<typeof database.transaction>[1],
    ) => database.transaction(async (tx) => {
      const instrumentedTx = new Proxy(tx, {
        get(target, property) {
          if (property === "update") {
            return (table: unknown) => {
              if (table === schema.idempotencyOperations) {
                throw new Error("falha injetada após gravar participação e snapshot");
              }
              return (target as unknown as { update: (table: unknown) => unknown }).update(table);
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as DatabaseTransactionExecutor;
      return callback(instrumentedTx);
    }, config),
  } as unknown as typeof database;

  return new ParticipationsService(databaseWithInjectedFailure, new EventsService(database));
}

test("cria participação e snapshot, e repete a mesma resposta idempotente", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  const { versionId, gamesSnapshot } = await completeProfile(userId);
  const key = randomUUID();
  const created = await service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  assert.equal(created.kind, "created", `resultado completo: ${JSON.stringify(created)}`);
  if (created.kind !== "created") return;
  fixtures.participations.push(created.participationId);

  const persisted = await fixturePool.query(
    `SELECT p.status,p.external_queue_order::text,p.arena_entered_at,p.joined_at,p.finished_at,p.finish_reason,p.current_queue_entry_id,
       s.questionnaire_version_id,s.answers,s.games_snapshot,s.age_band_at_event,s.captured_at,
       (SELECT count(*)::int FROM queue_entries q WHERE q.participation_id=p.id) AS queue_entries
     FROM participations p JOIN participation_profile_snapshots s ON s.participation_id=p.id WHERE p.id=$1`,
    [created.participationId],
  );
  const row = persisted.rows[0];
  assert.equal(row.status, "waiting");
  assert.equal(row.external_queue_order, "1");
  assert.equal(row.arena_entered_at, null);
  assert.equal(row.finished_at, null);
  assert.equal(row.finish_reason, null);
  assert.equal(row.current_queue_entry_id, null);
  assert.equal(row.questionnaire_version_id, versionId);
  assert.deepEqual(row.answers, {
    schemaVersion: 1,
    gender: "Masculino",
    otherGender: null,
    education: "Superior",
    marketKnowledge: "Conheço um pouco.",
    marketInterest: "Sim, tenho interesse.",
  });
  assert.deepEqual(row.games_snapshot, gamesSnapshot);
  assert.equal(JSON.stringify(row.answers).includes("birthDate"), false);
  assert.equal(row.age_band_at_event, null);
  assert.equal(row.captured_at.getTime(), row.joined_at.getTime());
  assert.equal(row.queue_entries, 0);
  const originalSnapshot = {
    questionnaire_version_id: row.questionnaire_version_id,
    answers: row.answers,
    games_snapshot: row.games_snapshot,
    age_band_at_event: row.age_band_at_event,
    captured_at: row.captured_at,
  };

  await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [eventId]);
  await fixturePool.query("UPDATE profiles SET gender='Outro',other_gender='Atualizado' WHERE user_id=$1", [userId]);
  const replay = await service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  assert.deepEqual(replay, {
    kind: "replay",
    httpStatus: 201,
    participationId: created.participationId,
    idempotencyResult: { participationId: created.participationId },
  });
  const snapshotAfterProfileEdit = await fixturePool.query(
    `SELECT questionnaire_version_id,answers,games_snapshot,age_band_at_event,captured_at
     FROM participation_profile_snapshots WHERE participation_id=$1`,
    [created.participationId],
  );
  assert.deepEqual(snapshotAfterProfileEdit.rows[0], originalSnapshot);
  const counts = await fixturePool.query(
    `SELECT (SELECT count(*)::int FROM participations WHERE user_id=$1) AS participations,
       (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id=$2) AS snapshots,
       (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$3) AS operations`,
    [userId, created.participationId, key],
  );
  assert.deepEqual(counts.rows[0], { participations: 1, snapshots: 1, operations: 1 });
});

test("ingresso direto à arena e concorrência da mesma chave produzem efeito único", async () => {
  const eventId = await createReadyEvent(false);
  const userId = await createUser();
  await completeProfile(userId);
  const key = randomUUID();
  const locker = await fixturePool.connect();
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
  const firstRun = service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  const secondRun = service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  try {
    await waitUntilBlocked();
  } finally {
    await locker.query("COMMIT");
    locker.release();
  }
  const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
  assert.equal(firstResult.kind, "created");
  if (firstResult.kind !== "created") return;
  fixtures.participations.push(firstResult.participationId);
  assert.equal(secondResult.kind, "replay");
  if (secondResult.kind === "replay") assert.equal(secondResult.participationId, firstResult.participationId);
  const row = await fixturePool.query("SELECT status,external_queue_order,arena_entered_at,joined_at FROM participations WHERE id=$1", [firstResult.participationId]);
  assert.equal(row.rows[0].status, "active");
  assert.equal(row.rows[0].external_queue_order, null);
  assert.equal(row.rows[0].arena_entered_at.getTime(), row.rows[0].joined_at.getTime());
});

test("FIFO cresce em concorrência, conflito por pedido diferente e reingresso criam histórico novo", async () => {
  const eventId = await createReadyEvent(true);
  const userA = await createUser();
  const userB = await createUser();
  await completeProfile(userA);
  await completeProfile(userB);
  const keyA = randomUUID();
  const keyB = randomUUID();
  const [joinA, joinB] = await Promise.all([
    service.createParticipation({ userId: userA, eventId, idempotencyKey: keyA, expiresAt }),
    service.createParticipation({ userId: userB, eventId, idempotencyKey: keyB, expiresAt }),
  ]);
  assert.equal(joinA.kind, "created");
  assert.equal(joinB.kind, "created");
  if (joinA.kind !== "created" || joinB.kind !== "created") return;
  fixtures.participations.push(joinA.participationId, joinB.participationId);
  const positions = await fixturePool.query("SELECT external_queue_order::text FROM participations WHERE id=ANY($1::uuid[]) ORDER BY external_queue_order", [[joinA.participationId, joinB.participationId]]);
  assert.deepEqual(positions.rows.map((row) => row.external_queue_order), ["1", "2"]);

  const anotherEvent = await createReadyEvent(true);
  const conflictingReuse = await service.createParticipation({ userId: userA, eventId: anotherEvent, idempotencyKey: keyA, expiresAt });
  assert.deepEqual(conflictingReuse, { kind: "request_conflict", operationId: (await fixturePool.query("SELECT id FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [userA, keyA])).rows[0].id });

  await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='participant_finished' WHERE id=$1", [joinA.participationId]);
  const rejoin = await service.createParticipation({ userId: userA, eventId, idempotencyKey: randomUUID(), expiresAt });
  assert.equal(rejoin.kind, "created");
  if (rejoin.kind !== "created") return;
  fixtures.participations.push(rejoin.participationId);
  const history = await fixturePool.query("SELECT count(*)::int AS count FROM participation_profile_snapshots WHERE participation_id=ANY($1::uuid[])", [[joinA.participationId, rejoin.participationId]]);
  assert.equal(history.rows[0].count, 2);
  const lastOrder = await fixturePool.query("SELECT external_last_order::text FROM events WHERE id=$1", [eventId]);
  assert.equal(lastOrder.rows[0].external_last_order, "3");
});

test("falha após participação e snapshot reverte todos os efeitos da transação", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  await completeProfile(userId);
  const key = randomUUID();
  const failureService = createServiceFailingBeforeIdempotencyCompletion();
  await assert.rejects(
    failureService.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt }),
    /falha injetada após gravar participação e snapshot/,
  );
  const state = await fixturePool.query(
    `SELECT e.external_last_order::text,
      (SELECT count(*)::int FROM participations WHERE user_id=$2) AS participations,
      (SELECT count(*)::int FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.user_id=$2) AS snapshots,
      (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$2 AND idempotency_key=$3) AS operations
     FROM events e WHERE e.id=$1`,
    [eventId, userId, key],
  );
  assert.deepEqual(state.rows[0], { external_last_order: "0", participations: 0, snapshots: 0, operations: 0 });
});

test("chaves distintas concorrentes para o mesmo usuário permitem só um ingresso", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  await completeProfile(userId);
  const [first, second] = await Promise.all([
    service.createParticipation({ userId, eventId, idempotencyKey: randomUUID(), expiresAt }),
    service.createParticipation({ userId, eventId, idempotencyKey: randomUUID(), expiresAt }),
  ]);
  const results = [first, second];
  assert.equal(results.filter((result) => result.kind === "created").length, 1);
  assert.equal(results.filter((result) => result.kind === "blocked").length, 1);
  const created = results.find((result) => result.kind === "created");
  if (created?.kind === "created") fixtures.participations.push(created.participationId);
});

test("perfil incompleto, sem jogos, versão não ativada e participação corrente não reservam a chave", async () => {
  const eventId = await createReadyEvent(true);
  const cases: Array<{ userId: string; prepare?: () => Promise<void> }> = [];
  const noProfile = await createUser();
  cases.push({ userId: noProfile });

  const noGames = await createUser();
  await completeProfile(noGames);
  cases.push({ userId: noGames, prepare: async () => { await fixturePool.query("DELETE FROM user_games WHERE user_id=$1", [noGames]); } });

  const draftVersionUser = await createUser();
  const draft = await completeProfile(draftVersionUser);
  cases.push({ userId: draftVersionUser, prepare: async () => { await fixturePool.query("UPDATE questionnaire_versions SET activated_at=NULL WHERE id=$1", [draft.versionId]); } });

  const alreadyCurrent = await createUser();
  await completeProfile(alreadyCurrent);
  const otherEvent = await createReadyEvent(false);
  const currentId = randomUUID();
  await fixturePool.query("INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'active',$4)", [currentId, alreadyCurrent, otherEvent, fixtureTime]);
  fixtures.participations.push(currentId);
  cases.push({ userId: alreadyCurrent });

  for (const testCase of cases) {
    await testCase.prepare?.();
    const key = randomUUID();
    const result = await service.createParticipation({ userId: testCase.userId, eventId, idempotencyKey: key, expiresAt });
    assert.equal(result.kind, "blocked");
    const count = await fixturePool.query("SELECT count(*)::int AS count FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [testCase.userId, key]);
    assert.equal(count.rows[0].count, 0);
  }
});

test("fechamento confirmado enquanto o ingresso aguarda o lock é respeitado", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  await completeProfile(userId);
  const key = randomUUID();
  const locker = await fixturePool.connect();
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
  const attempt = service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  try {
    await waitUntilBlocked();
    await locker.query("UPDATE events SET status='closed' WHERE id=$1", [eventId]);
    await locker.query("COMMIT");
  } catch (error) {
    await locker.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    locker.release();
  }
  assert.equal((await attempt).kind, "blocked");
  const persisted = await fixturePool.query(
    `SELECT (SELECT count(*)::int FROM participations WHERE user_id=$2) AS participations,
       (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$2 AND idempotency_key=$3) AS operations
     FROM events WHERE id=$1`,
    [eventId, userId, key],
  );
  assert.deepEqual(persisted.rows[0], { participations: 0, operations: 0 });
});

test("corte oficial atingido durante espera pelo lock impede e reverte o ingresso", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  await completeProfile(userId);
  const cutoff = new Date(Date.now() + 1_000);
  await fixturePool.query("UPDATE events SET official_ends_at=$2,operational_deadline_at=$3 WHERE id=$1", [eventId, cutoff, new Date(cutoff.getTime() + 30 * 60_000)]);
  const key = randomUUID();
  const locker = await fixturePool.connect();
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
  const attempt = service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  try {
    await waitUntilBlocked();
    while (Date.now() < cutoff.getTime()) await new Promise((resolve) => setTimeout(resolve, 10));
    await locker.query("COMMIT");
  } catch (error) {
    await locker.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    locker.release();
  }
  assert.equal((await attempt).kind, "blocked");
  const persisted = await fixturePool.query(
    `SELECT e.external_last_order::text,
       (SELECT count(*)::int FROM participations WHERE user_id=$2) AS participations,
       (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$2 AND idempotency_key=$3) AS operations
     FROM events e WHERE e.id=$1`,
    [eventId, userId, key],
  );
  assert.deepEqual(persisted.rows[0], { external_last_order: "0", participations: 0, operations: 0 });
});

test("snapshot lê o perfil confirmado antes de liberar o lock do usuário", async () => {
  const eventId = await createReadyEvent(true);
  const userId = await createUser();
  await completeProfile(userId);
  const key = randomUUID();
  const locker = await fixturePool.connect();
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  const attempt = service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  try {
    await waitUntilBlocked();
    await locker.query("UPDATE profiles SET gender='Feminino',education='Médio' WHERE user_id=$1", [userId]);
    await locker.query("COMMIT");
  } catch (error) {
    await locker.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    locker.release();
  }
  const result = await attempt;
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;
  fixtures.participations.push(result.participationId);
  const snapshot = await fixturePool.query("SELECT answers FROM participation_profile_snapshots WHERE participation_id=$1", [result.participationId]);
  assert.equal(snapshot.rows[0].answers.gender, "Feminino");
  assert.equal(snapshot.rows[0].answers.education, "Médio");
});
