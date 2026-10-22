import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService } from "../../src/participations/participations.service";

const primaryUrl = process.env.DATABASE_URL;
const testUrl = process.env.EVENTS_TEST_DATABASE_URL;
if (!primaryUrl || !testUrl) {
  throw new Error("DATABASE_URL e EVENTS_TEST_DATABASE_URL devem apontar ao banco descartável local arenago_events_test.");
}

const primary = new URL(primaryUrl);
const testDatabase = new URL(testUrl);
const isLocal = (host: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
const isAuthorized = (url: URL) => isLocal(url.hostname)
  && url.pathname.replace(/^\//, "") === "arenago_events_test";
if (!isAuthorized(primary) || !isAuthorized(testDatabase)
  || primary.port !== "55432" || testDatabase.port !== "55432"
  || primary.hostname !== testDatabase.hostname
  || primary.port !== testDatabase.port
  || primary.pathname !== testDatabase.pathname) {
  throw new Error("DATABASE_URL e EVENTS_TEST_DATABASE_URL devem apontar ao mesmo localhost:55432/arenago_events_test.");
}

const pool = new Pool({ connectionString: testUrl, max: 3 });
const database = drizzle(pool, { schema });
const eventsService = new EventsService(database);
const service = new ParticipationsService(database, eventsService);
const at = new Date("2030-01-01T12:00:00.000Z");
const created = {
  users: [] as string[],
  events: [] as string[],
  experiences: [] as string[],
  stations: [] as string[],
  roles: [] as string[],
  versions: [] as string[],
  games: [] as string[],
  participations: [] as string[],
};

after(async () => pool.end());

async function createUser(options: { verified?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, is_active, email_verified_at, created_at, updated_at)
     VALUES ($1, 'Eligibility fixture', $2, 'test-only-placeholder', true, $3, $4, $4)`,
    [id, `${id}@example.test`, options.verified ? at : null, at],
  );
  created.users.push(id);
  return id;
}

async function createVersion(activated = true): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO questionnaire_versions (id, version, definition, activated_at, created_at)
     VALUES ($1, $2, '{}'::jsonb, $3, $4)`,
    [id, `e-${id}`, activated ? at : null, at],
  );
  created.versions.push(id);
  return id;
}

async function createGame(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO games (id, name, is_curated, created_at) VALUES ($1, $2, false, $3)",
    [id, `Eligibility game ${id}`, at],
  );
  created.games.push(id);
  return id;
}

async function completeProfile(userId: string, versionId: string): Promise<void> {
  await pool.query(
    `INSERT INTO profiles (
       user_id, birth_date, gender, other_gender, education, market_knowledge,
       market_interest, questionnaire_version_id, completed_at, created_at, updated_at
     ) VALUES ($1, '2000-01-01', 'Prefiro não informar', NULL, 'Médio', 'Não conheço.',
       'Não tenho interesse.', $2, $3, $3, $3)`,
    [userId, versionId, at],
  );
}

async function selectGame(userId: string, gameId: string): Promise<void> {
  await pool.query(
    "INSERT INTO user_games (user_id, game_id, created_at) VALUES ($1, $2, $3)",
    [userId, gameId, at],
  );
}

async function createEvent(options: { ready?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO events (
       id, name, access_code_normalized, timezone, starts_at, official_ends_at,
       operational_deadline_at, status, external_queue_enabled, created_at, updated_at
     ) VALUES ($1, 'Eligibility fixture', $2, 'America/Sao_Paulo', $3, $4, $5, 'open', true, $6, $6)`,
    [id, `ELG-${randomUUID().slice(0, 8).toUpperCase()}`, new Date("2030-01-01T10:00:00Z"),
      new Date("2030-01-01T14:00:00Z"), new Date("2030-01-01T14:30:00Z"), at],
  );
  created.events.push(id);
  if (options.ready !== false) {
    const staffId = await createUser({ verified: true });
    const roleId = randomUUID();
    await pool.query(
      "INSERT INTO user_roles (id, user_id, role, event_id, granted_at) VALUES ($1, $2, 'staff', $3, $4)",
      [roleId, staffId, id, at],
    );
    created.roles.push(roleId);
    const experienceId = randomUUID();
    await pool.query(
      "INSERT INTO experiences (id, event_id, name, created_at, updated_at) VALUES ($1, $2, 'Eligibility experience', $3, $3)",
      [experienceId, id, at],
    );
    created.experiences.push(experienceId);
    const stationId = randomUUID();
    await pool.query(
      "INSERT INTO stations (id, experience_id, label, availability, created_at, updated_at) VALUES ($1, $2, 'Eligibility station', 'available', $3, $3)",
      [stationId, experienceId, at],
    );
    created.stations.push(stationId);
  }
  return id;
}

async function createParticipation(userId: string, eventId: string, status: "waiting" | "active" | "finished" | "canceled"): Promise<void> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO participations (id, user_id, event_id, status, joined_at, finished_at, finish_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, eventId, status, at,
      status === "finished" || status === "canceled" ? at : null,
      status === "finished" ? "event_ended" : status === "canceled" ? "user_canceled" : null],
  );
  created.participations.push(id);
}

test("ParticipationsService evaluates eligibility against PostgreSQL without writes", async () => {
  try {
    const eventId = await createEvent();
    const versionId = await createVersion();
    const gameId = await createGame();
    const eligibleUser = await createUser(); // Sem email verificado: isso não é um requisito aprovado para participante.
    await completeProfile(eligibleUser, versionId);
    await selectGame(eligibleUser, gameId);
    const eligible = await service.evaluateJoinEligibility(eligibleUser, eventId, at);
    assert.equal(eligible.eligible, true);
    assert.deepEqual(eligible.blockingReasons, []);

    const noProfile = await service.evaluateJoinEligibility(await createUser(), eventId, at);
    assert.ok(noProfile.blockingReasons.includes("PROFILE_INCOMPLETE"));

    const noGameUser = await createUser();
    await completeProfile(noGameUser, versionId);
    const noGame = await service.evaluateJoinEligibility(noGameUser, eventId, at);
    assert.ok(noGame.blockingReasons.includes("PROFILE_INCOMPLETE"));

    const draftVersionUser = await createUser();
    await completeProfile(draftVersionUser, await createVersion(false));
    await selectGame(draftVersionUser, gameId);
    const draftVersion = await service.evaluateJoinEligibility(draftVersionUser, eventId, at);
    assert.equal(draftVersion.checks.questionnaireVersionValid, false);
    assert.ok(draftVersion.blockingReasons.includes("PROFILE_INCOMPLETE"));

    for (const status of ["waiting", "active"] as const) {
      const userId = await createUser();
      await completeProfile(userId, versionId);
      await selectGame(userId, gameId);
      await createParticipation(userId, eventId, status);
      const current = await service.evaluateJoinEligibility(userId, eventId, at);
      assert.ok(current.blockingReasons.includes("PARTICIPATION_ALREADY_CURRENT"), status);
    }

    for (const status of ["finished", "canceled"] as const) {
      const userId = await createUser();
      await completeProfile(userId, versionId);
      await selectGame(userId, gameId);
      await createParticipation(userId, eventId, status);
      assert.equal((await service.evaluateJoinEligibility(userId, eventId, at)).eligible, true, status);
    }

    const otherEventId = await createEvent();
    const globalCurrentUser = await createUser();
    await completeProfile(globalCurrentUser, versionId);
    await selectGame(globalCurrentUser, gameId);
    await createParticipation(globalCurrentUser, otherEventId, "active");
    assert.ok((await service.evaluateJoinEligibility(globalCurrentUser, eventId, at))
      .blockingReasons.includes("PARTICIPATION_ALREADY_CURRENT"));

    const absentEvent = await service.evaluateJoinEligibility(eligibleUser, randomUUID(), at);
    assert.ok(absentEvent.blockingReasons.includes("EVENT_NOT_FOUND"));
    const outsideWindow = await service.evaluateJoinEligibility(eligibleUser, eventId, new Date("2030-01-01T09:59:59Z"));
    assert.ok(outsideWindow.blockingReasons.includes("EVENT_NOT_STARTED"));
    const afterWindow = await service.evaluateJoinEligibility(eligibleUser, eventId, new Date("2030-01-01T14:00:00Z"));
    assert.ok(afterWindow.blockingReasons.includes("EVENT_REGISTRATION_CLOSED"));
    const notReadyEvent = await createEvent({ ready: false });
    const notReady = await service.evaluateJoinEligibility(eligibleUser, notReadyEvent, at);
    assert.ok(notReady.blockingReasons.includes("EVENT_NOT_READY"));

    const before = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE id = ANY($1::uuid[])) AS participations,
         (SELECT count(*)::int FROM profiles WHERE user_id = ANY($2::uuid[])) AS profiles,
         (SELECT count(*)::int FROM user_games WHERE user_id = ANY($2::uuid[])) AS user_games,
         (SELECT count(*)::int FROM events WHERE id = ANY($3::uuid[])) AS events`,
      [created.participations, created.users, created.events],
    );
    await service.evaluateJoinEligibility(eligibleUser, eventId, at);
    const afterCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE id = ANY($1::uuid[])) AS participations,
         (SELECT count(*)::int FROM profiles WHERE user_id = ANY($2::uuid[])) AS profiles,
         (SELECT count(*)::int FROM user_games WHERE user_id = ANY($2::uuid[])) AS user_games,
         (SELECT count(*)::int FROM events WHERE id = ANY($3::uuid[])) AS events`,
      [created.participations, created.users, created.events],
    );
    assert.deepEqual(afterCounts.rows, before.rows);
  } finally {
    if (created.participations.length) await pool.query("DELETE FROM participations WHERE id = ANY($1::uuid[])", [created.participations]);
    if (created.users.length) {
      await pool.query("DELETE FROM user_games WHERE user_id = ANY($1::uuid[])", [created.users]);
      await pool.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [created.users]);
    }
    if (created.stations.length) await pool.query("DELETE FROM stations WHERE id = ANY($1::uuid[])", [created.stations]);
    if (created.experiences.length) await pool.query("DELETE FROM experiences WHERE id = ANY($1::uuid[])", [created.experiences]);
    if (created.roles.length) await pool.query("DELETE FROM user_roles WHERE id = ANY($1::uuid[])", [created.roles]);
    if (created.events.length) await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [created.events]);
    if (created.games.length) await pool.query("DELETE FROM games WHERE id = ANY($1::uuid[])", [created.games]);
    if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
    if (created.versions.length) await pool.query("DELETE FROM questionnaire_versions WHERE id = ANY($1::uuid[])", [created.versions]);
  }
});
