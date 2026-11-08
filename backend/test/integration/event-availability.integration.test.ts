import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { EventsService } from "../../src/events/events.service";
import * as schema from "../../src/database/schema";

const databaseUrlValue = process.env.DATABASE_URL;
const eventsTestDatabaseUrlValue = process.env.EVENTS_TEST_DATABASE_URL;
if (!databaseUrlValue || !eventsTestDatabaseUrlValue) {
  throw new Error("DATABASE_URL e EVENTS_TEST_DATABASE_URL devem apontar para o banco local descartável arenago_events_test.");
}

const databaseUrl = new URL(databaseUrlValue);
const eventsTestDatabaseUrl = new URL(eventsTestDatabaseUrlValue);
const isLocal = (hostname: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
const isAuthorizedDatabase = (url: URL) => isLocal(url.hostname)
  && url.pathname.replace(/^\//, "") === "arenago_events_test";
if (!isAuthorizedDatabase(databaseUrl) || !isAuthorizedDatabase(eventsTestDatabaseUrl)
  || databaseUrl.hostname !== eventsTestDatabaseUrl.hostname
  || databaseUrl.port !== eventsTestDatabaseUrl.port
  || databaseUrl.pathname !== eventsTestDatabaseUrl.pathname) {
  throw new Error("Ambas as URLs de teste devem apontar ao mesmo localhost e banco arenago_events_test.");
}

const pool = new Pool({ connectionString: eventsTestDatabaseUrlValue, max: 3 });
const database = drizzle(pool, { schema });
const eventsService = new EventsService(database);
const fixtureTime = new Date("2030-01-01T12:00:00.000Z");
const eventIds: string[] = [];
const userIds: string[] = [];
const experienceIds: string[] = [];
const stationIds: string[] = [];
const participationIds: string[] = [];
const queueEntryIds: string[] = [];

after(async () => pool.end());

async function createEvent(options: {
  status?: "scheduled" | "open" | "closing" | "closed";
  closureRequestedAt?: Date;
  adminDeadlineAt?: Date;
  closureMode?: "immediate" | "controlled";
  externalQueueEnabled?: boolean;
} = {}): Promise<string> {
  const id = randomUUID();
  const code = `AVL-${randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO events (
       id, name, access_code_normalized, timezone, starts_at, official_ends_at,
       operational_deadline_at, status, external_queue_enabled, closure_mode,
       closure_requested_at, admin_deadline_at, created_at, updated_at
     ) VALUES ($1, 'Availability fixture', $2, 'America/Sao_Paulo', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      id,
      code,
      new Date("2030-01-01T10:00:00.000Z"),
      new Date("2030-01-01T14:00:00.000Z"),
      new Date("2030-01-01T14:30:00.000Z"),
      options.status ?? "open",
      options.externalQueueEnabled ?? true,
      options.closureMode ?? null,
      options.closureRequestedAt ?? null,
      options.adminDeadlineAt ?? null,
      fixtureTime,
    ],
  );
  eventIds.push(id);
  return id;
}

async function createUser(options: { active?: boolean; verified?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (
       id, name, email, password_hash, is_active, email_verified_at, created_at, updated_at
     ) VALUES ($1, 'Availability fixture', $2, 'test-only-placeholder', $3, $4, $5, $5)`,
    [id, `${id}@example.test`, options.active ?? true, options.verified === false ? null : fixtureTime, fixtureTime],
  );
  userIds.push(id);
  return id;
}

async function grantStaff(userId: string, eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_roles (id, user_id, role, event_id, granted_at)
     VALUES ($1, $2, 'staff', $3, $4)`,
    [randomUUID(), userId, eventId, fixtureTime],
  );
}

async function createExperience(eventId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, event_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Availability experience', $3, $3)`,
    [id, eventId, fixtureTime],
  );
  experienceIds.push(id);
  return id;
}

async function createStation(experienceId: string, available = true): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO stations (id, experience_id, label, availability, created_at, updated_at)
     VALUES ($1, $2, 'Availability station', $3, $4, $4)`,
    [id, experienceId, available ? "available" : "unavailable", fixtureTime],
  );
  stationIds.push(id);
  return id;
}

async function assertAvailability(eventId: string, at: string) {
  const result = await eventsService.evaluateEventAvailabilityById(eventId, new Date(at));
  assert.equal(result.eventExists, true);
  if (!result.eventExists) throw new Error("Fixture event was not found.");
  return result;
}

test("EventsService consolidates readiness, time window, capacity and administrative state", async () => {
  try {
    const readyEvent = await createEvent();
    await grantStaff(await createUser(), readyEvent);
    const readyExperience = await createExperience(readyEvent);
    await createStation(readyExperience);

    const during = await assertAvailability(readyEvent, "2030-01-01T12:00:00.000Z");
    assert.equal(during.ready, true);
    assert.equal(during.withinEntryWindow, true);
    assert.equal(during.eventAcceptingNewEntries, true);

    const beforeStart = await assertAvailability(readyEvent, "2030-01-01T09:59:59.999Z");
    assert.equal(beforeStart.ready, true);
    assert.equal(beforeStart.withinEntryWindow, false);
    assert.equal(beforeStart.eventAcceptingNewEntries, false);

    const afterEnd = await assertAvailability(readyEvent, "2030-01-01T14:00:00.000Z");
    assert.equal(afterEnd.ready, true);
    assert.equal(afterEnd.withinEntryWindow, false);
    assert.equal(afterEnd.eventAcceptingNewEntries, false);

    const noStaffEvent = await createEvent();
    const noStaffExperience = await createExperience(noStaffEvent);
    await createStation(noStaffExperience);
    const noStaff = await assertAvailability(noStaffEvent, "2030-01-01T12:00:00.000Z");
    assert.equal(noStaff.ready, false);
    assert.equal(noStaff.checks.hasAuthorizedStaff, false);

    const noStationEvent = await createEvent();
    await grantStaff(await createUser(), noStationEvent);
    const noStationExperience = await createExperience(noStationEvent);
    await createStation(noStationExperience, false);
    assert.equal((await assertAvailability(noStationEvent, "2030-01-01T12:00:00.000Z")).checks.hasAvailableStation, false);

    const incompleteEvent = await createEvent({ externalQueueEnabled: false });
    const incomplete = await assertAvailability(incompleteEvent, "2030-01-01T12:00:00.000Z");
    assert.equal(incomplete.ready, false);
    assert.equal(incomplete.checks.externalQueueConfigured, true);
    assert.ok(incomplete.missing.includes("EVENT_HAS_NO_AUTHORIZED_STAFF"));
    assert.ok(incomplete.missing.includes("EVENT_HAS_NO_AVAILABLE_STATION"));

    const recoverableEvent = await createEvent();
    const recoverable = await assertAvailability(recoverableEvent, "2030-01-01T12:00:00.000Z");
    assert.equal(recoverable.eventAcceptingNewEntries, false);
    await grantStaff(await createUser(), recoverableEvent);
    const recoverableExperience = await createExperience(recoverableEvent);
    await createStation(recoverableExperience);
    assert.equal((await assertAvailability(recoverableEvent, "2030-01-01T12:30:00.000Z")).eventAcceptingNewEntries, true);
    const recoveredAfterCutoff = await assertAvailability(recoverableEvent, "2030-01-01T14:00:00.000Z");
    assert.equal(recoveredAfterCutoff.ready, true);
    assert.equal(recoveredAfterCutoff.eventAcceptingNewEntries, false);

    const adminCutoffEvent = await createEvent({
      status: "closing",
      closureMode: "controlled",
      closureRequestedAt: new Date("2030-01-01T13:00:00.000Z"),
      adminDeadlineAt: new Date("2030-01-01T13:30:00.000Z"),
    });
    await grantStaff(await createUser(), adminCutoffEvent);
    const adminExperience = await createExperience(adminCutoffEvent);
    await createStation(adminExperience);
    assert.equal((await assertAvailability(adminCutoffEvent, "2030-01-01T13:00:00.000Z")).eventAcceptingNewEntries, false);

    const closedEvent = await createEvent({ status: "closed" });
    await grantStaff(await createUser(), closedEvent);
    const closedExperience = await createExperience(closedEvent);
    await createStation(closedExperience);
    const closed = await assertAvailability(closedEvent, "2030-01-01T12:00:00.000Z");
    assert.equal(closed.ready, true);
    assert.equal(closed.eventAcceptingNewEntries, false);
    assert.ok(closed.missing.includes("EVENT_CLOSED"));

    assert.deepEqual(
      await eventsService.evaluateEventAvailabilityById(randomUUID(), new Date("2030-01-01T12:00:00.000Z")),
      { eventExists: false },
    );

    const participantId = await createUser();
    const participationId = randomUUID();
    const queueEntryId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, user_id, event_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [participationId, participantId, readyEvent, fixtureTime],
    );
    participationIds.push(participationId);
    await pool.query(
      `INSERT INTO queue_entries (id, participation_id, event_id, experience_id, queue_order, status, entered_at)
       VALUES ($1, $2, $3, $4, 1, 'waiting', $5)`,
      [queueEntryId, participationId, readyEvent, readyExperience, fixtureTime],
    );
    queueEntryIds.push(queueEntryId);

    const countsBefore = await pool.query(
      `SELECT e.status,
              (SELECT count(*)::int FROM participations WHERE event_id = $1) AS participations,
              (SELECT count(*)::int FROM queue_entries WHERE event_id = $1) AS queue_entries
       FROM events e WHERE e.id = $1`,
      [readyEvent],
    );
    await eventsService.evaluateEventAvailabilityById(readyEvent, new Date("2030-01-01T12:00:00.000Z"));
    const countsAfter = await pool.query(
      `SELECT e.status,
              (SELECT count(*)::int FROM participations WHERE event_id = $1) AS participations,
              (SELECT count(*)::int FROM queue_entries WHERE event_id = $1) AS queue_entries
       FROM events e WHERE e.id = $1`,
      [readyEvent],
    );
    assert.deepEqual(countsAfter.rows, countsBefore.rows);
  } finally {
    if (eventIds.length > 0) {
      if (queueEntryIds.length > 0) await pool.query("DELETE FROM queue_entries WHERE id = ANY($1::uuid[])", [queueEntryIds]);
      if (participationIds.length > 0) await pool.query("DELETE FROM participations WHERE id = ANY($1::uuid[])", [participationIds]);
      if (stationIds.length > 0) await pool.query("DELETE FROM stations WHERE id = ANY($1::uuid[])", [stationIds]);
      if (experienceIds.length > 0) await pool.query("DELETE FROM experiences WHERE id = ANY($1::uuid[])", [experienceIds]);
      await pool.query(
        "DELETE FROM user_roles WHERE event_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])",
        [eventIds, userIds],
      );
      await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [eventIds]);
    }
    if (userIds.length > 0) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  }
});
