import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/database/schema";
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
const isAuthorizedDatabase = (url: URL) => isLocal(url.hostname)
  && url.port === "55432"
  && url.pathname.replace(/^\//, "") === "arenago_events_test";
if (!isAuthorizedDatabase(databaseUrl) || !isAuthorizedDatabase(testDatabaseUrl)
  || databaseUrl.hostname !== testDatabaseUrl.hostname
  || databaseUrl.port !== testDatabaseUrl.port
  || databaseUrl.pathname !== testDatabaseUrl.pathname) {
  throw new Error("Ambas as URLs precisam apontar ao mesmo localhost:55432/arenago_events_test.");
}

const applicationName = `arena-e032b-${randomUUID()}`;
const servicePool = new Pool({ connectionString: testDatabaseUrlValue, application_name: applicationName, max: 2 });
const fixturePool = new Pool({ connectionString: testDatabaseUrlValue, max: 3 });
const database = drizzle(servicePool, { schema });
const service = new ParticipationsService(database, new EventsService(database));
const fixtureTime = new Date();
type CreatedFixtures = {
  users: string[];
  events: string[];
  roles: string[];
  experiences: string[];
  stations: string[];
  questionnaireVersions: string[];
  games: string[];
  participations: string[];
};

function createFixtureTracker(): CreatedFixtures {
  return {
    users: [],
    events: [],
    roles: [],
    experiences: [],
    stations: [],
    questionnaireVersions: [],
    games: [],
    participations: [],
  };
}

after(async () => {
  await Promise.all([servicePool.end(), fixturePool.end()]);
});

async function createUser(created: CreatedFixtures, options: { verified?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(
    `INSERT INTO users (id, name, email, password_hash, is_active, email_verified_at, created_at, updated_at)
     VALUES ($1, 'Transactional eligibility fixture', $2, 'test-placeholder', true, $3, $4, $4)`,
    [id, `${id}@example.test`, options.verified ? fixtureTime : null, fixtureTime],
  );
  created.users.push(id);
  return id;
}

async function createReadyEvent(
  created: CreatedFixtures,
  options: { startsAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  const startsAt = options.startsAt ?? new Date(Date.now() - 60_000);
  const officialEndsAt = new Date(Math.max(Date.now() + 10 * 60_000, startsAt.getTime() + 10 * 60_000));
  const operationalDeadlineAt = new Date(officialEndsAt.getTime() + 30 * 60_000);
  await fixturePool.query(
    `INSERT INTO events (
       id, name, access_code_normalized, timezone, starts_at, official_ends_at,
       operational_deadline_at, status, external_queue_enabled, created_at, updated_at
     ) VALUES ($1, 'Transactional eligibility fixture', $2, 'America/Sao_Paulo', $3, $4, $5, 'open', true, $6, $6)`,
    [id, `TXE-${randomUUID().slice(0, 8).toUpperCase()}`, startsAt, officialEndsAt, operationalDeadlineAt, fixtureTime],
  );
  created.events.push(id);

  const staffId = await createUser(created, { verified: true });
  const roleId = randomUUID();
  await fixturePool.query(
    "INSERT INTO user_roles (id, user_id, role, event_id, granted_at) VALUES ($1, $2, 'staff', $3, $4)",
    [roleId, staffId, id, fixtureTime],
  );
  created.roles.push(roleId);

  const experienceId = randomUUID();
  await fixturePool.query(
    "INSERT INTO experiences (id, event_id, name, created_at, updated_at) VALUES ($1, $2, 'Transactional experience', $3, $3)",
    [experienceId, id, fixtureTime],
  );
  created.experiences.push(experienceId);
  const stationId = randomUUID();
  await fixturePool.query(
    `INSERT INTO stations (id, experience_id, label, availability, created_at, updated_at)
     VALUES ($1, $2, 'Transactional station', 'available', $3, $3)`,
    [stationId, experienceId, fixtureTime],
  );
  created.stations.push(stationId);
  return id;
}

async function createCompleteProfile(created: CreatedFixtures, userId: string): Promise<void> {
  const versionId = randomUUID();
  await fixturePool.query(
    `INSERT INTO questionnaire_versions (id, version, definition, activated_at, created_at)
     VALUES ($1, $2, '{}'::jsonb, $3, $3)`,
    [versionId, `t-${versionId}`, fixtureTime],
  );
  created.questionnaireVersions.push(versionId);
  await fixturePool.query(
    `INSERT INTO profiles (
       user_id, birth_date, gender, other_gender, education, market_knowledge,
       market_interest, questionnaire_version_id, completed_at, created_at, updated_at
     ) VALUES ($1, '2000-01-01', 'Prefiro não informar', NULL, 'Médio', 'Não conheço.',
       'Não tenho interesse.', $2, $3, $3, $3)`,
    [userId, versionId, fixtureTime],
  );
  const gameId = randomUUID();
  await fixturePool.query(
    "INSERT INTO games (id, name, is_curated, created_at) VALUES ($1, $2, false, $3)",
    [gameId, `Transactional game ${gameId}`, fixtureTime],
  );
  created.games.push(gameId);
  await fixturePool.query(
    "INSERT INTO user_games (user_id, game_id, created_at) VALUES ($1, $2, $3)",
    [userId, gameId, fixtureTime],
  );
}

async function cleanupFixtures(created: CreatedFixtures): Promise<void> {
  if (created.participations.length) {
    await fixturePool.query("DELETE FROM participations WHERE id = ANY($1::uuid[])", [created.participations]);
  }
  if (created.users.length) {
    await fixturePool.query("DELETE FROM user_games WHERE user_id = ANY($1::uuid[])", [created.users]);
    await fixturePool.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [created.users]);
  }
  if (created.stations.length) {
    await fixturePool.query("DELETE FROM stations WHERE id = ANY($1::uuid[])", [created.stations]);
  }
  if (created.experiences.length) {
    await fixturePool.query("DELETE FROM experiences WHERE id = ANY($1::uuid[])", [created.experiences]);
  }
  if (created.roles.length) {
    await fixturePool.query("DELETE FROM user_roles WHERE id = ANY($1::uuid[])", [created.roles]);
  }
  if (created.events.length) {
    await fixturePool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [created.events]);
  }
  if (created.games.length) {
    await fixturePool.query("DELETE FROM games WHERE id = ANY($1::uuid[])", [created.games]);
  }
  if (created.users.length) {
    await fixturePool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  }
  if (created.questionnaireVersions.length) {
    await fixturePool.query("DELETE FROM questionnaire_versions WHERE id = ANY($1::uuid[])", [created.questionnaireVersions]);
  }
}

async function waitUntilBlockedByLock(blockingApplicationName = applicationName): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await fixturePool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'
       LIMIT 1`,
      [blockingApplicationName],
    );
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("O PostgreSQL não sinalizou a espera por lock dentro do limite de teste.");
}

test("o auxiliar usa a transação do chamador e mantém os locks até o callback terminar", async () => {
  const created = createFixtureTracker();
  const eventId = await createReadyEvent(created);
  const userId = await createUser(created);
  await createCompleteProfile(created, userId);
  const probeApplicationName = `arena-lock-probe-${randomUUID()}`;
  const probe = await fixturePool.connect();
  let blockedQuery: Promise<unknown> | undefined;

  try {
    await database.transaction(async (tx) => {
      const evaluation = await service.evaluateJoinEligibilityWithTx(tx, userId, eventId);
      assert.equal(evaluation.eligibility.eligible, true);

      await probe.query("SELECT set_config('application_name', $1, false)", [probeApplicationName]);
      blockedQuery = probe.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      await waitUntilBlockedByLock(probeApplicationName);
      // Chegar aqui prova que o auxiliar retornou sem encerrar a transação do chamador.
    }, { isolationLevel: "read committed" });

    await blockedQuery;
  } finally {
    if (blockedQuery) await blockedQuery.catch(() => undefined);
    probe.release();
    await cleanupFixtures(created);
  }
});

async function lockRow(client: PoolClient, table: "events" | "users", id: string): Promise<void> {
  await client.query("BEGIN");
  await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
}

test("ParticipationsService avalia elegibilidade no mesmo tx e após as esperas por locks", async () => {
  const created = createFixtureTracker();
  try {
    const eventId = await createReadyEvent(created);
    const userId = await createUser(created);
    await createCompleteProfile(created, userId);

    const countsBeforeEvaluation = await fixturePool.query(
      `SELECT e.external_last_order::text AS external_last_order,
         (SELECT count(*)::int FROM participations WHERE user_id = $2) AS participations,
         (SELECT count(*)::int FROM participation_profile_snapshots s
           INNER JOIN participations p ON p.id = s.participation_id WHERE p.user_id = $2) AS snapshots,
         (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id = $2) AS idempotency
       FROM events e WHERE e.id = $1`,
      [eventId, userId],
    );
    const beforeClock = await fixturePool.query<{ value: Date }>("SELECT clock_timestamp() AS value");
    const favorable = await service.evaluateJoinEligibilityInTransaction(userId, eventId);
    const afterClock = await fixturePool.query<{ value: Date }>("SELECT clock_timestamp() AS value");
    const countsAfterEvaluation = await fixturePool.query(
      `SELECT e.external_last_order::text AS external_last_order,
         (SELECT count(*)::int FROM participations WHERE user_id = $2) AS participations,
         (SELECT count(*)::int FROM participation_profile_snapshots s
           INNER JOIN participations p ON p.id = s.participation_id WHERE p.user_id = $2) AS snapshots,
         (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id = $2) AS idempotency
       FROM events e WHERE e.id = $1`,
      [eventId, userId],
    );
    assert.equal(favorable.eligibility.eligible, true);
    assert.deepEqual(countsAfterEvaluation.rows, countsBeforeEvaluation.rows);
    assert.ok(favorable.evaluatedAt >= beforeClock.rows[0].value);
    assert.ok(favorable.evaluatedAt <= afterClock.rows[0].value);

    const absentEvent = await service.evaluateJoinEligibilityInTransaction(userId, randomUUID());
    assert.ok(absentEvent.eligibility.blockingReasons.includes("EVENT_NOT_FOUND"));
    const absentUser = await service.evaluateJoinEligibilityInTransaction(randomUUID(), eventId);
    assert.ok(absentUser.eligibility.blockingReasons.includes("USER_NOT_FOUND"));

    const futureEvent = await createReadyEvent(created, { startsAt: new Date(Date.now() + 60 * 60_000) });
    const notStarted = await service.evaluateJoinEligibilityInTransaction(userId, futureEvent);
    assert.ok(notStarted.eligibility.blockingReasons.includes("EVENT_NOT_STARTED"));

    const currentParticipationId = randomUUID();
    await fixturePool.query(
      `INSERT INTO participations (id, user_id, event_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [currentParticipationId, userId, futureEvent, fixtureTime],
    );
    created.participations.push(currentParticipationId);
    const alreadyCurrent = await service.evaluateJoinEligibilityInTransaction(userId, eventId);
    assert.ok(alreadyCurrent.eligibility.blockingReasons.includes("PARTICIPATION_ALREADY_CURRENT"));
    await fixturePool.query("DELETE FROM participations WHERE id = $1", [currentParticipationId]);
    created.participations.pop();

    const incompleteUserId = await createUser(created);
    const incomplete = await service.evaluateJoinEligibilityInTransaction(incompleteUserId, eventId);
    assert.ok(incomplete.eligibility.blockingReasons.includes("PROFILE_INCOMPLETE"));

    // Aguarda a sessão do service realmente ficar bloqueada; não sincroniza por sleep arbitrário.
    const eventLocker = await fixturePool.connect();
    try {
      await lockRow(eventLocker, "events", eventId);
      const waitingOnEvent = service.evaluateJoinEligibilityInTransaction(userId, eventId);
      await waitUntilBlockedByLock();
      await eventLocker.query("UPDATE events SET status = 'closed' WHERE id = $1", [eventId]);
      await eventLocker.query("COMMIT");
      const afterEventWait = await waitingOnEvent;
      assert.ok(afterEventWait.eligibility.blockingReasons.includes("EVENT_REGISTRATION_CLOSED"));
    } catch (error) {
      await eventLocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      eventLocker.release();
    }

    // O perfil é alterado sob o lock de users; a leitura só começa depois que o escritor confirma.
    const userLocker = await fixturePool.connect();
    try {
      await lockRow(userLocker, "users", userId);
      const waitingOnUser = service.evaluateJoinEligibilityInTransaction(userId, futureEvent);
      await waitUntilBlockedByLock();
      await userLocker.query("DELETE FROM profiles WHERE user_id = $1", [userId]);
      await userLocker.query("DELETE FROM user_games WHERE user_id = $1", [userId]);
      await userLocker.query("COMMIT");
      const afterUserWait = await waitingOnUser;
      assert.equal(afterUserWait.eligibility.checks.hasCompletedQuestionnaire, false);
      assert.ok(afterUserWait.eligibility.blockingReasons.includes("PROFILE_INCOMPLETE"));
    } catch (error) {
      await userLocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      userLocker.release();
    }

    const persisted = await fixturePool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE user_id = ANY($1::uuid[])) AS participations,
         (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id = ANY($2::uuid[])) AS snapshots,
         (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id = ANY($1::uuid[])) AS idempotency,
         (SELECT count(*)::int FROM profiles WHERE user_id = ANY($1::uuid[])) AS profiles,
         (SELECT count(*)::int FROM user_games WHERE user_id = ANY($1::uuid[])) AS user_games,
         (SELECT count(*)::int FROM events WHERE id = ANY($3::uuid[]) AND status = 'closed') AS closed_events`,
      [created.users, created.participations, [eventId, futureEvent]],
    );
    assert.equal(persisted.rows[0].participations, 0);
    assert.equal(persisted.rows[0].snapshots, 0);
    assert.equal(persisted.rows[0].idempotency, 0);
    assert.equal(persisted.rows[0].profiles, 0);
    assert.equal(persisted.rows[0].user_games, 0);
    assert.equal(persisted.rows[0].closed_events, 1); // Apenas a alteração concorrente de fixture persiste.
  } finally {
    await cleanupFixtures(created);
  }
});
