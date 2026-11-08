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

const pool = new Pool({ connectionString, max: 2 });
const database = drizzle(pool, { schema });
const eventsService = new EventsService(database);

after(async () => pool.end());

// Cobre sucesso, ausência, repetição da leitura e preservação da linha no banco.
test("EventsService.findById consulta o evento pelo UUID sem alterá-lo", async () => {
  const eventId = randomUUID();
  const accessCode = `E01-${randomUUID().slice(0, 8).toUpperCase()}`;
  const startsAt = new Date("2030-01-01T12:00:00.000Z");
  const officialEndsAt = new Date("2030-01-01T14:00:00.000Z");
  const operationalDeadlineAt = new Date("2030-01-01T14:30:00.000Z");
  const createdAt = new Date("2029-12-01T12:00:00.000Z");
  const updatedAt = new Date("2029-12-02T12:00:00.000Z");

  await pool.query(
    `INSERT INTO events (
       id, name, access_code_normalized, timezone, starts_at, official_ends_at,
       operational_deadline_at, status, external_queue_enabled, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      eventId,
      "Evento de teste E01.1",
      accessCode,
      "America/Sao_Paulo",
      startsAt,
      officialEndsAt,
      operationalDeadlineAt,
      "scheduled",
      true,
      createdAt,
      updatedAt,
    ],
  );

  // UUID e código aleatórios isolam o fixture; o finally remove somente esta linha.
  try {
    const found = await eventsService.findById(eventId);
    assert.ok(found);
    assert.equal(found.id, eventId);
    assert.equal(found.name, "Evento de teste E01.1");
    assert.equal(found.accessCodeNormalized, accessCode);
    assert.equal(found.timezone, "America/Sao_Paulo");
    assert.equal(found.startsAt.toISOString(), startsAt.toISOString());
    assert.equal(found.officialEndsAt.toISOString(), officialEndsAt.toISOString());
    assert.equal(found.operationalDeadlineAt.toISOString(), operationalDeadlineAt.toISOString());

    const repeated = await eventsService.findById(eventId);
    assert.deepEqual(repeated, found);

    const byCode = await eventsService.findByAccessCode(accessCode);
    assert.deepEqual(byCode, found);
    assert.deepEqual(await eventsService.findByAccessCode(accessCode.toLowerCase()), found);
    assert.deepEqual(await eventsService.findByAccessCode(`\t ${accessCode.toLowerCase()}\n`), found);
    assert.equal(await eventsService.findByAccessCode(`MISS-${randomUUID().slice(0, 8)}`), null);
    await assert.rejects(
      eventsService.findByAccessCode("BAD"),
      { name: "EventAccessCodeValidationError" },
    );

    const temporalStart = await eventsService.evaluateEntryWindowById(
      eventId,
      new Date("2030-01-01T12:00:00.000Z"),
    );
    assert.equal(temporalStart.eventExists, true);
    if (temporalStart.eventExists) {
      assert.equal(temporalStart.entryWindow.withinEntryWindow, true);
      assert.equal(temporalStart.entryWindow.blockReason, null);
    }
    const temporalCutoff = await eventsService.evaluateEntryWindowById(
      eventId,
      new Date("2030-01-01T14:00:00.000Z"),
    );
    assert.equal(temporalCutoff.eventExists, true);
    if (temporalCutoff.eventExists) {
      assert.equal(temporalCutoff.entryWindow.withinEntryWindow, false);
      assert.equal(temporalCutoff.entryWindow.blockReason, "EVENT_ENTRY_CLOSED");
    }
    assert.deepEqual(
      await eventsService.evaluateEntryWindowById(randomUUID(), new Date("2030-01-01T13:00:00.000Z")),
      { eventExists: false },
    );

    const missing = await eventsService.findById(randomUUID());
    assert.equal(missing, null);

    const stored = await pool.query(
      `SELECT id, name, access_code_normalized, timezone, starts_at, official_ends_at,
              operational_deadline_at, status, external_queue_enabled, created_at, updated_at
       FROM events WHERE id = $1`,
      [eventId],
    );
    assert.equal(stored.rowCount, 1);
    assert.deepEqual(stored.rows[0], {
      id: eventId,
      name: "Evento de teste E01.1",
      access_code_normalized: accessCode,
      timezone: "America/Sao_Paulo",
      starts_at: startsAt,
      official_ends_at: officialEndsAt,
      operational_deadline_at: operationalDeadlineAt,
      status: "scheduled",
      external_queue_enabled: true,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  } finally {
    await pool.query("DELETE FROM events WHERE id = $1", [eventId]);
  }
});
