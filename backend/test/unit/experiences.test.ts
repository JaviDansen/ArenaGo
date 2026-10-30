import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { buildEventAvailabilityResult, evaluateEventConfigurationReadiness, type EventAvailabilityResult } from "../../src/events/event-availability";
import { evaluateEventEntryWindow } from "../../src/events/event-entry-window";
import { buildEventOperationalCapacityResult } from "../../src/events/event-operational-capacity";
import { EventsService } from "../../src/events/events.service";
import { ExperiencesService } from "../../src/events/experiences.service";

const eventId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const observedAt = new Date("2026-10-29T15:00:00Z");
const baseRow = {
  id: "experience-a", name: "Just Dance", queueAcceptingEntries: true,
  waitingCount: "3", stationId: "station-a", stationLabel: "Estação A", stationAvailable: true,
};

function fixture(options: {
  access?: boolean;
  clock?: number;
  status?: string;
  startsAt?: Date;
  officialEndsAt?: Date;
  closureRequestedAt?: Date | null;
  staff?: boolean;
  station?: boolean;
  rows?: Array<Record<string, unknown>>;
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let availabilityCalls = 0;
  let availability: EventAvailabilityResult | undefined;
  const client = {
    async query(config: { text: string }, params: unknown[]) {
      queries.push({ text: config.text, params });
      if (config.text.startsWith("select") && config.text.includes('from "participations"')) {
        return { rows: options.access === false ? [] : [[options.clock ?? observedAt.getTime()]] };
      }
      if (config.text.includes("WITH waiting_counts")) return { rows: options.rows ?? [baseRow] };
      return { rows: [] };
    },
  };
  const database = drizzle(client as unknown as Client, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async (id, at, executor) => {
    availabilityCalls += 1;
    assert.equal(id, eventId);
    assert.equal(at.getTime(), observedAt.getTime());
    assert.ok(executor);
    assert.notEqual(executor, database);
    const officialEndsAt = options.officialEndsAt ?? new Date("2026-10-29T16:00:00Z");
    const event = {
      name: "E06 unit", accessCodeNormalized: "E06-UNIT", timezone: "America/Sao_Paulo",
      externalQueueEnabled: false,
      startsAt: options.startsAt ?? new Date(officialEndsAt.getTime() - 2 * 60 * 60_000),
      officialEndsAt,
      operationalDeadlineAt: new Date(officialEndsAt.getTime() + 60 * 60_000),
      closureRequestedAt: options.closureRequestedAt ?? null, adminDeadlineAt: null,
    };
    const configuration = evaluateEventConfigurationReadiness(event);
    assert.equal(configuration.ready, true, "A fixture deve manter a configuração válida em todos os cenários.");
    availability = buildEventAvailabilityResult({
      eventId: id, eventStatus: options.status ?? "open",
      configuration,
      entryWindow: evaluateEventEntryWindow(event, at),
      operationalCapacity: buildEventOperationalCapacityResult(options.staff ?? true, options.station ?? true),
    });
    return availability;
  };
  return { service: new ExperiencesService(database, events), queries, availabilityCalls: () => availabilityCalls, availability: () => availability };
}

test("E06 agrupa estações sem multiplicar fila; contrato seguro e transação somente leitura", async () => {
  const { service, queries, availabilityCalls } = fixture({ rows: [
    baseRow,
    { ...baseRow, stationId: "station-b", stationLabel: "Estação B", stationAvailable: false },
    { ...baseRow, id: "experience-b", name: "VR", stationId: null, stationLabel: null, stationAvailable: null, waitingCount: "0" },
  ] });
  assert.deepEqual(await service.getEventExperiences(userId, eventId), {
    kind: "ok", eventId, observedAt, acceptingNewQueueEntries: true,
    experiences: [
      { id: "experience-a", name: "Just Dance", acceptingNewQueueEntries: true, waitingCount: 3,
        stations: [{ id: "station-a", label: "Estação A", available: true }, { id: "station-b", label: "Estação B", available: false }] },
      { id: "experience-b", name: "VR", acceptingNewQueueEntries: false, waitingCount: 0, stations: [] },
    ],
  });
  assert.equal(availabilityCalls(), 1);
  assert.equal(queries[0].text, "begin isolation level repeatable read read only");
  assert.deepEqual(queries[1].params, [userId, eventId, "active", 1]);
  assert.match(queries[1].text, /statement_timestamp\(\)/);
  assert.match(queries[2].text, /status = 'waiting'/);
  assert.match(queries[2].text, /GROUP BY experience_id/);
  assert.match(queries[2].text, /ORDER BY e.id ASC, s.id ASC/);
  assert.deepEqual(queries[2].params, [eventId, eventId]);
  assert.equal(queries.at(-1)?.text, "commit");
  assert.equal(queries.some((q) => /\b(update|insert|delete|for update|for share)\b/i.test(q.text)), false);
});

test("E06 acesso negado é explícito e não consulta dados internos", async () => {
  const { service, queries, availabilityCalls } = fixture({ access: false });
  assert.deepEqual(await service.getEventExperiences(userId, eventId), { kind: "access_denied" });
  assert.equal(availabilityCalls(), 0);
  assert.equal(queries.length, 3); // BEGIN, titularidade + relógio, COMMIT.
});

test("E06 cortes exatos, estado administrativo, início e capacidade só bloqueiam novas entradas", async () => {
  for (const { options, missing } of [
    { options: { officialEndsAt: observedAt }, missing: "EVENT_ENTRY_CLOSED" },
    { options: { closureRequestedAt: observedAt }, missing: "EVENT_ENTRY_CLOSED" },
    { options: { status: "closing" }, missing: "EVENT_ADMIN_CLOSING" },
    { options: { status: "closed" }, missing: "EVENT_CLOSED" },
    { options: { startsAt: new Date(observedAt.getTime() + 1) }, missing: "EVENT_NOT_STARTED" },
    { options: { staff: false }, missing: "EVENT_HAS_NO_AUTHORIZED_STAFF" },
    { options: { station: false }, missing: "EVENT_HAS_NO_AVAILABLE_STATION" },
  ]) {
    const { service, availability } = fixture(options);
    const result = await service.getEventExperiences(userId, eventId);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") assert.fail("Participante ativo deve continuar consultando.");
    assert.equal(result.acceptingNewQueueEntries, false, JSON.stringify(options));
    assert.equal(result.experiences[0].acceptingNewQueueEntries, false);
    assert.equal(result.experiences[0].waitingCount, 3);
    const evaluated = availability();
    assert.ok(evaluated?.eventExists);
    assert.deepEqual(evaluated.missing, [missing], "Somente a guarda do cenário pode impedir novas entradas.");
    if (missing === "EVENT_ENTRY_CLOSED") {
      assert.equal(evaluated.ready, true);
      assert.equal(evaluated.withinEntryWindow, false);
      assert.equal(evaluated.cutoffAt.getTime(), observedAt.getTime());
    }
  }
  const atStart = fixture({ startsAt: observedAt });
  const result = await atStart.service.getEventExperiences(userId, eventId);
  assert.ok(result.kind === "ok" && result.acceptingNewQueueEntries);
  const evaluated = atStart.availability();
  assert.ok(evaluated?.eventExists);
  assert.equal(evaluated.withinEntryWindow, true);
  assert.deepEqual(evaluated.missing, []);
});

test("E06 fila pausada ou sem estação não bloqueia outra apta; indicador global exige alguma apta", async () => {
  const blockedRows = [
    { ...baseRow, queueAcceptingEntries: false },
    { ...baseRow, id: "experience-b", stationAvailable: false },
  ];
  for (const rows of [blockedRows, [...blockedRows, { ...baseRow, id: "experience-c" }], []]) {
    const { service } = fixture({ rows });
    const result = await service.getEventExperiences(userId, eventId);
    assert.ok(result.kind === "ok");
    assert.equal(result.acceptingNewQueueEntries, rows.length === 3);
    assert.deepEqual(result.experiences.map((e) => e.acceptingNewQueueEntries), rows.map((_, i) => i === 2));
  }
});

test("E06 preserva contagens seguras como number e serializa sem bigint", async () => {
  const { service } = fixture({ rows: [{ ...baseRow, waitingCount: String(Number.MAX_SAFE_INTEGER) }] });
  const result = await service.getEventExperiences(userId, eventId);
  assert.ok(result.kind === "ok");
  const serialized = JSON.parse(JSON.stringify(result)) as { observedAt: string; experiences: Array<{ waitingCount: number }> };
  assert.equal(serialized.observedAt, observedAt.toISOString());
  assert.equal(serialized.experiences[0].waitingCount, Number.MAX_SAFE_INTEGER);
});

test("E06 rejeita relógio e contagem inválidos, sem devolver informação enganosa", async () => {
  for (const clock of [NaN, Infinity, 9e15]) {
    const { service, queries } = fixture({ clock });
    await assert.rejects(service.getEventExperiences(userId, eventId), /PostgreSQL/);
    assert.equal(queries.at(-1)?.text, "rollback");
  }
  for (const waitingCount of ["-1", "1.5", "9007199254740992", "garbage"]) {
    const { service, queries } = fixture({ rows: [{ ...baseRow, waitingCount }] });
    await assert.rejects(service.getEventExperiences(userId, eventId), /contagem/);
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});
