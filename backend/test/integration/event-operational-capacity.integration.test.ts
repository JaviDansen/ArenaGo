import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { EventsService } from "../../src/events/events.service";
import * as schema from "../../src/database/schema";

const connectionString = process.env.EVENTS_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("EVENTS_TEST_DATABASE_URL deve apontar para o PostgreSQL local descartável arenago_events_test.");
}

const databaseUrl = new URL(connectionString);
const databaseName = databaseUrl.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseUrl.hostname) || databaseName !== "arenago_events_test") {
  throw new Error("Os testes de Events só podem usar localhost e o banco descartável arenago_events_test.");
}

const pool = new Pool({ connectionString, max: 3 });
const database = drizzle(pool, { schema });
const eventsService = new EventsService(database);
const fixtureTime = new Date("2030-01-01T12:00:00.000Z");
const createdEventIds: string[] = [];
const createdUserIds: string[] = [];
const createdExperienceIds: string[] = [];
const createdStationIds: string[] = [];
const createdParticipationIds: string[] = [];
const createdQueueEntryIds: string[] = [];
const createdServiceSessionIds: string[] = [];

after(async () => pool.end());

async function createEvent(): Promise<string> {
  const id = randomUUID();
  const code = `CAP-${randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO events (
       id, name, access_code_normalized, timezone, starts_at, official_ends_at,
       operational_deadline_at, status, external_queue_enabled, created_at, updated_at
     ) VALUES ($1, 'Capacity fixture', $2, 'UTC', $3, $4, $5, 'open', true, $6, $6)`,
    [id, code, new Date("2030-01-01T10:00:00.000Z"), new Date("2030-01-01T14:00:00.000Z"), new Date("2030-01-01T14:30:00.000Z"), fixtureTime],
  );
  createdEventIds.push(id);
  return id;
}

async function createUser(options: { active?: boolean; verified?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (
       id, name, email, password_hash, is_active, email_verified_at, created_at, updated_at
     ) VALUES ($1, 'Capacity fixture', $2, 'test-only-placeholder', $3, $4, $5, $5)`,
    [id, `${id}@example.test`, options.active ?? true, options.verified === false ? null : fixtureTime, fixtureTime],
  );
  createdUserIds.push(id);
  return id;
}

async function grantStaff(userId: string, eventId: string, revoked = false): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO user_roles (id, user_id, role, event_id, granted_at, revoked_at)
     VALUES ($1, $2, 'staff', $3, $4, $5)`,
    [id, userId, eventId, fixtureTime, revoked ? fixtureTime : null],
  );
  return id;
}

async function grantGlobalAdmin(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_roles (id, user_id, role, event_id, granted_at)
     VALUES ($1, $2, 'admin', NULL, $3)`,
    [randomUUID(), userId, fixtureTime],
  );
}

async function createExperience(eventId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, event_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Capacity experience', $3, $3)`,
    [id, eventId, fixtureTime],
  );
  createdExperienceIds.push(id);
  return id;
}

async function createStation(experienceId: string, availability: "available" | "unavailable"): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO stations (id, experience_id, label, availability, created_at, updated_at)
     VALUES ($1, $2, 'Capacity station', $3, $4, $4)`,
    [id, experienceId, availability, fixtureTime],
  );
  createdStationIds.push(id);
  return id;
}

async function readCapacity(eventId: string) {
  const result = await eventsService.evaluateOperationalCapacityByEventId(eventId);
  assert.equal(result.eventExists, true);
  if (!result.eventExists) throw new Error("Fixture event was not found.");
  return result;
}

test("EventsService evaluates event capacity from scoped Staff and available stations", async () => {
  try {
    const readyEvent = await createEvent();
    const readyStaff = await createUser();
    await grantStaff(readyStaff, readyEvent);
    const readyExperience = await createExperience(readyEvent);
    const readyStation = await createStation(readyExperience, "available");
    const ready = await readCapacity(readyEvent);
    assert.equal(ready.hasAuthorizedStaff, true);
    assert.equal(ready.hasAvailableStation, true);
    assert.equal(ready.hasOperationalCapacity, true);

    const withoutStaffEvent = await createEvent();
    const withoutStaffExperience = await createExperience(withoutStaffEvent);
    await createStation(withoutStaffExperience, "available");
    const withoutStaff = await readCapacity(withoutStaffEvent);
    assert.equal(withoutStaff.hasAuthorizedStaff, false);
    assert.equal(withoutStaff.hasAvailableStation, true);
    assert.equal(withoutStaff.hasOperationalCapacity, false);

    const noExperienceEvent = await createEvent();
    await grantStaff(await createUser(), noExperienceEvent);
    const noExperience = await readCapacity(noExperienceEvent);
    assert.equal(noExperience.hasAuthorizedStaff, true);
    assert.equal(noExperience.hasAvailableStation, false);

    const unavailableEvent = await createEvent();
    await grantStaff(await createUser(), unavailableEvent);
    const unavailableExperience = await createExperience(unavailableEvent);
    await createStation(unavailableExperience, "unavailable");
    assert.equal((await readCapacity(unavailableEvent)).hasAvailableStation, false);

    const revokedEvent = await createEvent();
    await grantStaff(await createUser(), revokedEvent, true);
    const revokedExperience = await createExperience(revokedEvent);
    await createStation(revokedExperience, "available");
    assert.equal((await readCapacity(revokedEvent)).hasAuthorizedStaff, false);

    const inactiveEvent = await createEvent();
    await grantStaff(await createUser({ active: false }), inactiveEvent);
    assert.equal((await readCapacity(inactiveEvent)).hasAuthorizedStaff, false);

    const unverifiedEvent = await createEvent();
    await grantStaff(await createUser({ verified: false }), unverifiedEvent);
    assert.equal((await readCapacity(unverifiedEvent)).hasAuthorizedStaff, false);

    const globalAdminEvent = await createEvent();
    await grantGlobalAdmin(await createUser());
    assert.equal((await readCapacity(globalAdminEvent)).hasAuthorizedStaff, false);

    const otherEventStaffTarget = await createEvent();
    const otherEventStaffGrant = await createEvent();
    await grantStaff(await createUser(), otherEventStaffGrant);
    assert.equal((await readCapacity(otherEventStaffTarget)).hasAuthorizedStaff, false);

    const stationTargetEvent = await createEvent();
    const stationOwnerEvent = await createEvent();
    const foreignExperience = await createExperience(stationOwnerEvent);
    await createStation(foreignExperience, "available");
    assert.equal((await readCapacity(stationTargetEvent)).hasAvailableStation, false);

    const recoverableEvent = await createEvent();
    const recoverableStaff = await createUser();
    const recoverableRole = await grantStaff(recoverableStaff, recoverableEvent, true);
    const recoverableExperience = await createExperience(recoverableEvent);
    const recoverableStation = await createStation(recoverableExperience, "unavailable");
    const beforeRecovery = await readCapacity(recoverableEvent);
    assert.equal(beforeRecovery.hasOperationalCapacity, false);
    await pool.query("UPDATE user_roles SET revoked_at = NULL WHERE id = $1", [recoverableRole]);
    await pool.query("UPDATE stations SET availability = 'available' WHERE id = $1", [recoverableStation]);
    assert.equal((await readCapacity(recoverableEvent)).hasOperationalCapacity, true);

    assert.deepEqual(await eventsService.evaluateOperationalCapacityByEventId(randomUUID()), { eventExists: false });

    // Uma estação disponível pode ter chamada pendente; capacidade usa disponibilidade, não ocupação.
    const participant = await createUser();
    const participationId = randomUUID();
    const queueEntryId = randomUUID();
    const serviceSessionId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, user_id, event_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [participationId, participant, readyEvent, fixtureTime],
    );
    createdParticipationIds.push(participationId);
    await pool.query(
      `INSERT INTO queue_entries (id, participation_id, event_id, experience_id, queue_order, status, entered_at)
       VALUES ($1, $2, $3, $4, 1, 'called', $5)`,
      [queueEntryId, participationId, readyEvent, readyExperience, fixtureTime],
    );
    createdQueueEntryIds.push(queueEntryId);
    await pool.query(
      `INSERT INTO service_sessions (id, queue_entry_id, experience_id, station_id, called_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [serviceSessionId, queueEntryId, readyExperience, readyStation, fixtureTime],
    );
    createdServiceSessionIds.push(serviceSessionId);

    const beforeRead = await pool.query(
      `SELECT e.status,
              (SELECT count(*)::int FROM participations WHERE event_id = $1) AS participations,
              (SELECT count(*)::int FROM queue_entries WHERE event_id = $1) AS queue_entries,
              (SELECT count(*)::int FROM service_sessions WHERE queue_entry_id = $2) AS service_sessions
       FROM events e WHERE e.id = $1`,
      [readyEvent, queueEntryId],
    );
    const withPendingCall = await readCapacity(readyEvent);
    assert.equal(withPendingCall.hasAvailableStation, true);
    const afterRead = await pool.query(
      `SELECT e.status,
              (SELECT count(*)::int FROM participations WHERE event_id = $1) AS participations,
              (SELECT count(*)::int FROM queue_entries WHERE event_id = $1) AS queue_entries,
              (SELECT count(*)::int FROM service_sessions WHERE queue_entry_id = $2) AS service_sessions
       FROM events e WHERE e.id = $1`,
      [readyEvent, queueEntryId],
    );
    assert.deepEqual(afterRead.rows, beforeRead.rows);
  } finally {
    if (createdEventIds.length > 0) {
      const eventIds = createdEventIds;
      if (createdServiceSessionIds.length > 0) {
        await pool.query("DELETE FROM service_sessions WHERE id = ANY($1::uuid[])", [createdServiceSessionIds]);
      }
      if (createdQueueEntryIds.length > 0) {
        await pool.query("DELETE FROM queue_entries WHERE id = ANY($1::uuid[])", [createdQueueEntryIds]);
      }
      if (createdParticipationIds.length > 0) {
        await pool.query("DELETE FROM participations WHERE id = ANY($1::uuid[])", [createdParticipationIds]);
      }
      if (createdStationIds.length > 0) {
        await pool.query("DELETE FROM stations WHERE id = ANY($1::uuid[])", [createdStationIds]);
      }
      if (createdExperienceIds.length > 0) {
        await pool.query("DELETE FROM experiences WHERE id = ANY($1::uuid[])", [createdExperienceIds]);
      }
      await pool.query(
        "DELETE FROM user_roles WHERE event_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])",
        [eventIds, createdUserIds],
      );
      await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [eventIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUserIds]);
    }
  }
});
