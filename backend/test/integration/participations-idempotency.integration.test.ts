import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/database/schema";
import {
  completeIdempotencyOperationWithTx,
  createJoinRequestFingerprint,
  reserveJoinIntentWithTx,
} from "../../src/participations/join-idempotency";

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

const applicationName = `arena-join-idempotency-${randomUUID()}`;
const pool = new Pool({ connectionString: testDatabaseUrlValue, application_name: applicationName, max: 6 });
const database = drizzle(pool, { schema });
const fixtureTime = new Date("2026-01-01T00:00:00.000Z");
const fixtureExpiry = new Date("2099-01-01T00:00:00.000Z");

after(async () => pool.end());

interface FixtureIds {
  users: string[];
  events: string[];
  questionnaireVersions: string[];
  participations: string[];
}

function createFixtureIds(): FixtureIds {
  return { users: [], events: [], questionnaireVersions: [], participations: [] };
}

function createQuestionnaireVersionFixture(): { id: string; version: string } {
  const id = randomUUID();
  const version = `idem-${id.replaceAll("-", "")}`;
  if (version.length > 40) throw new Error("A versão fictícia excedeu o varchar(40) do schema.");
  return { id, version };
}

async function createUser(ids: FixtureIds): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'Idempotency fixture',$2,'placeholder',$3,$3)",
    [userId, `${userId}@example.test`, fixtureTime],
  );
  ids.users.push(userId);
  return userId;
}

async function createEvent(ids: FixtureIds): Promise<string> {
  const eventId = randomUUID();
  const startsAt = new Date("2025-12-31T23:00:00.000Z");
  const endsAt = new Date("2099-01-01T01:00:00.000Z");
  const deadlineAt = new Date("2099-01-01T02:00:00.000Z");
  await pool.query(
    `INSERT INTO events(
       id,name,access_code_normalized,timezone,starts_at,official_ends_at,
       operational_deadline_at,status,external_queue_enabled,created_at,updated_at
     ) VALUES($1,'Idempotency fixture',$2,'America/Sao_Paulo',$3,$4,$5,'open',true,$6,$6)`,
    [eventId, `IDM-${eventId.slice(0, 8).toUpperCase()}`, startsAt, endsAt, deadlineAt, fixtureTime],
  );
  ids.events.push(eventId);
  return eventId;
}

async function waitUntilBlockedByLock(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'
       LIMIT 1`,
      [applicationName],
    );
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("O PostgreSQL não sinalizou a espera concorrente por lock.");
}

async function cleanup(ids: FixtureIds, actorUserId: string): Promise<void> {
  if (ids.participations.length) {
    await pool.query("DELETE FROM participation_profile_snapshots WHERE participation_id = ANY($1::uuid[])", [ids.participations]);
    await pool.query("DELETE FROM participations WHERE id = ANY($1::uuid[])", [ids.participations]);
  }
  if (actorUserId) {
    await pool.query("DELETE FROM idempotency_operations WHERE actor_user_id = $1", [actorUserId]);
  }
  if (ids.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids.users]);
  if (ids.events.length) await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids.events]);
  if (ids.questionnaireVersions.length) {
    await pool.query("DELETE FROM questionnaire_versions WHERE id = ANY($1::uuid[])", [ids.questionnaireVersions]);
  }
}

test("helpers de idempotência reservam, fazem replay e concluem apenas dentro do mesmo tx", async () => {
  const ids = createFixtureIds();
  let actorUserId = "";

  try {
    actorUserId = await createUser(ids);
    const subjectUserId = await createUser(ids);
    const eventId = await createEvent(ids);
    const otherEventId = await createEvent(ids);
    const questionnaireVersion = createQuestionnaireVersionFixture();
    await pool.query(
      "INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}'::jsonb,$3,$3)",
      [questionnaireVersion.id, questionnaireVersion.version, fixtureTime],
    );
    ids.questionnaireVersions.push(questionnaireVersion.id);

    const existingParticipationId = randomUUID();
    await pool.query(
      "INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'active',$4)",
      [existingParticipationId, actorUserId, eventId, fixtureTime],
    );
    ids.participations.push(existingParticipationId);
    await pool.query(
      `INSERT INTO participation_profile_snapshots(
         participation_id,questionnaire_version_id,answers,games_snapshot,captured_at
       ) VALUES($1,$2,'{}'::jsonb,'[]'::jsonb,$3)`,
      [existingParticipationId, questionnaireVersion.id, fixtureTime],
    );

    const primaryKey = randomUUID();
    const primaryHash = createJoinRequestFingerprint(eventId);
    const newParticipationId = randomUUID();
    const completed = await database.transaction(async (tx) => {
      const reservation = await reserveJoinIntentWithTx(tx, {
        actorUserId,
        eventId,
        idempotencyKey: primaryKey,
        expiresAt: fixtureExpiry,
      });
      assert.equal(reservation.kind, "reserved");
      if (reservation.kind !== "reserved") throw new Error("Esperava uma reserva nova.");

      // Efeito ilustrativo apenas no teste: confirma que efeito e conclusão compartilham o tx.
      await tx.insert(schema.participations).values({
        id: newParticipationId,
        userId: subjectUserId,
        eventId,
        status: "active",
        joinedAt: fixtureTime,
      });
      ids.participations.push(newParticipationId);
      await tx.insert(schema.participationProfileSnapshots).values({
        participationId: newParticipationId,
        questionnaireVersionId: questionnaireVersion.id,
        answers: {},
        gamesSnapshot: [],
        capturedAt: fixtureTime,
      });

      return completeIdempotencyOperationWithTx(tx, reservation.operationId, {
        httpStatus: 201,
        resultReference: newParticipationId,
        resultPayload: { participationId: newParticipationId },
      });
    }, { isolationLevel: "read committed" });
    assert.deepEqual(completed, {
      operationId: completed.operationId,
      httpStatus: 201,
      resultReference: newParticipationId,
      resultPayload: { participationId: newParticipationId },
    });

    const replay = await database.transaction(async (tx) => reserveJoinIntentWithTx(tx, {
      actorUserId,
      eventId,
      idempotencyKey: primaryKey,
      expiresAt: fixtureExpiry,
    }), { isolationLevel: "read committed" });
    assert.deepEqual(replay, {
      kind: "replay",
      operationId: completed.operationId,
      httpStatus: 201,
      resultReference: newParticipationId,
      resultPayload: { participationId: newParticipationId },
    });

    const keyConflict = await database.transaction(async (tx) => reserveJoinIntentWithTx(tx, {
      actorUserId,
      eventId: otherEventId,
      idempotencyKey: primaryKey,
      expiresAt: fixtureExpiry,
    }), { isolationLevel: "read committed" });
    assert.deepEqual(keyConflict, { kind: "request_conflict", operationId: completed.operationId });

    const rollbackKey = randomUUID();
    await assert.rejects(database.transaction(async (tx) => {
      const reservation = await reserveJoinIntentWithTx(tx, {
        actorUserId,
        eventId,
        idempotencyKey: rollbackKey,
        expiresAt: fixtureExpiry,
      });
      assert.equal(reservation.kind, "reserved");
      throw new Error("rollback controlado do teste");
    }, { isolationLevel: "read committed" }), /rollback controlado do teste/);

    const inProgressKey = randomUUID();
    const inProgressId = randomUUID();
    await assert.rejects(database.transaction(async (tx) => {
      await tx.insert(schema.idempotencyOperations).values({
        id: inProgressId,
        actorUserId,
        operation: "join",
        idempotencyKey: inProgressKey,
        requestHash: primaryHash,
        status: "in_progress",
        createdAt: fixtureTime,
        expiresAt: fixtureExpiry,
      });
      const existingProgress = await reserveJoinIntentWithTx(tx, {
        actorUserId,
        eventId,
        idempotencyKey: inProgressKey,
        expiresAt: fixtureExpiry,
      });
      assert.deepEqual(existingProgress, { kind: "in_progress", operationId: inProgressId });
      throw new Error("rollback da fixture in_progress");
    }, { isolationLevel: "read committed" }), /rollback da fixture in_progress/);

    const concurrentKey = randomUUID();
    const concurrentSubjectId = await createUser(ids);
    const concurrentParticipationId = randomUUID();
    let signalFirstReserved!: () => void;
    let releaseFirstTransaction!: () => void;
    const firstReserved = new Promise<void>((resolve) => { signalFirstReserved = resolve; });
    const releaseFirst = new Promise<void>((resolve) => { releaseFirstTransaction = resolve; });
    const firstTransaction = database.transaction(async (tx) => {
      const reservation = await reserveJoinIntentWithTx(tx, {
        actorUserId,
        eventId,
        idempotencyKey: concurrentKey,
        expiresAt: fixtureExpiry,
      });
      assert.equal(reservation.kind, "reserved");
      if (reservation.kind !== "reserved") throw new Error("Esperava a primeira reserva concorrente.");
      signalFirstReserved();
      await releaseFirst;
      await tx.insert(schema.participations).values({
        id: concurrentParticipationId,
        userId: concurrentSubjectId,
        eventId,
        status: "active",
        joinedAt: fixtureTime,
      });
      ids.participations.push(concurrentParticipationId);
      return completeIdempotencyOperationWithTx(tx, reservation.operationId, {
        httpStatus: 201,
        resultReference: concurrentParticipationId,
        resultPayload: { participationId: concurrentParticipationId },
      });
    }, { isolationLevel: "read committed" });

    await firstReserved;
    const secondTransaction = database.transaction(async (tx) => reserveJoinIntentWithTx(tx, {
      actorUserId,
      eventId,
      idempotencyKey: concurrentKey,
      expiresAt: fixtureExpiry,
    }), { isolationLevel: "read committed" });
    let lockWaitObserved = false;
    try {
      await waitUntilBlockedByLock();
      lockWaitObserved = true;
    } finally {
      releaseFirstTransaction();
    }
    const firstResult = await firstTransaction;
    const secondResult = await secondTransaction;
    assert.equal(lockWaitObserved, true);
    assert.equal(firstResult.resultReference, concurrentParticipationId);
    assert.deepEqual(secondResult, {
      kind: "replay",
      operationId: firstResult.operationId,
      httpStatus: 201,
      resultReference: concurrentParticipationId,
      resultPayload: { participationId: concurrentParticipationId },
    });

    const rollbackRows = await pool.query(
      "SELECT count(*)::int AS count FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=ANY($2::varchar[])",
      [actorUserId, [rollbackKey, inProgressKey]],
    );
    assert.equal(rollbackRows.rows[0].count, 0);

    const statuses = await pool.query<{ status: string }>(
      "SELECT status FROM idempotency_operations WHERE actor_user_id=$1",
      [actorUserId],
    );
    assert.ok(statuses.rows.length > 0);
    assert.ok(statuses.rows.every((row) => row.status === "completed"));

    const preserved = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE id=$2 AND user_id=$1) AS participations,
         (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id=$2) AS snapshots`,
      [actorUserId, existingParticipationId],
    );
    assert.deepEqual(preserved.rows[0], { participations: 1, snapshots: 1 });
    const createdEffects = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE id=ANY($1::uuid[])) AS participations,
         (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id=ANY($1::uuid[])) AS snapshots`,
      [[newParticipationId, concurrentParticipationId]],
    );
    assert.deepEqual(createdEffects.rows[0], { participations: 2, snapshots: 1 });
  } finally {
    await cleanup(ids, actorUserId);
  }
});
