import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEventAvailabilityResult,
  evaluateEventConfigurationReadiness,
} from "../../src/events/event-availability";
import type { EventConfigurationReadinessInput } from "../../src/events/event-availability";
import { buildEventOperationalCapacityResult } from "../../src/events/event-operational-capacity";
import { evaluateEventEntryWindow } from "../../src/events/event-entry-window";

const makeEvent = (): EventConfigurationReadinessInput => ({
  name: "ArenaGo Open",
  accessCodeNormalized: "ARENA-2030",
  startsAt: new Date("2030-11-01T10:00:00.000Z"),
  officialEndsAt: new Date("2030-11-01T16:00:00.000Z"),
  operationalDeadlineAt: new Date("2030-11-01T16:45:00.000Z"),
  timezone: "America/Sao_Paulo",
  externalQueueEnabled: true,
});

const at = (instant: string) => new Date(instant);

function makeAvailability(
  event: EventConfigurationReadinessInput,
  instant: string,
  capacity = buildEventOperationalCapacityResult(true, true),
  status = "open",
) {
  const configuration = evaluateEventConfigurationReadiness(event);
  const entryWindow = evaluateEventEntryWindow({
    ...event,
    closureRequestedAt: null,
    adminDeadlineAt: null,
  }, at(instant));

  return buildEventAvailabilityResult({
    eventId: "event-uuid",
    eventStatus: status,
    configuration,
    entryWindow,
    operationalCapacity: capacity,
  });
}

test("configuração C-05 válida fica pronta; fila externa explicitamente desligada também é válida", () => {
  const event = makeEvent();
  assert.equal(evaluateEventConfigurationReadiness(event).ready, true);
  event.externalQueueEnabled = false;
  const disabledQueue = evaluateEventConfigurationReadiness(event);
  assert.equal(disabledQueue.ready, true);
  assert.equal(disabledQueue.checks.externalQueueConfigured, true);
});

test("nome vazio e código persistido incompatível com C-10 falham sem reescrita", () => {
  const event = makeEvent();
  event.name = " \t ";
  event.accessCodeNormalized = "SÃO-2030";
  const before = { name: event.name, code: event.accessCodeNormalized };

  const result = evaluateEventConfigurationReadiness(event);
  assert.equal(result.ready, false);
  assert.equal(result.checks.nameAndAccessCode, false);
  assert.ok(result.missing.includes("EVENT_NAME_OR_ACCESS_CODE_INVALID"));
  assert.equal(event.name, before.name);
  assert.equal(event.accessCodeNormalized, before.code);
});

test("fuso inválido e cronologia fora dos limites falham na configuração", () => {
  const event = makeEvent();
  event.timezone = "Mars/Olympus_Mons";
  event.operationalDeadlineAt = at("2030-11-01T17:00:00.001Z");

  const result = evaluateEventConfigurationReadiness(event);
  assert.equal(result.checks.validScheduleAndTimezone, false);
  assert.ok(result.missing.includes("EVENT_TIMEZONE_INVALID"));
  assert.ok(result.missing.includes("EVENT_SCHEDULE_INVALID"));

  event.timezone = "UTC";
  event.startsAt = event.officialEndsAt;
  assert.ok(evaluateEventConfigurationReadiness(event).missing.includes("EVENT_SCHEDULE_INVALID"));
});

test("limite operacional de 60 minutos é inclusivo; uma data inválida é rejeitada", () => {
  const event = makeEvent();
  event.operationalDeadlineAt = at("2030-11-01T17:00:00.000Z");
  assert.equal(evaluateEventConfigurationReadiness(event).checks.validScheduleAndTimezone, true);
  event.startsAt = new Date(Number.NaN);
  assert.ok(evaluateEventConfigurationReadiness(event).missing.includes("EVENT_SCHEDULE_INVALID"));
});

test("prontidão antes do início não equivale a estar dentro da janela", () => {
  const result = makeAvailability(makeEvent(), "2030-11-01T09:59:59.999Z");
  assert.equal(result.eventExists, true);
  if (!result.eventExists) return;
  assert.equal(result.ready, true);
  assert.equal(result.withinEntryWindow, false);
  assert.equal(result.eventAcceptingNewEntries, false);
  assert.ok(result.missing.includes("EVENT_NOT_STARTED"));
});

test("janela temporal aberta com configuração incompleta não permite novas entradas", () => {
  const event = makeEvent();
  event.name = "  ";
  const result = makeAvailability(event, "2030-11-01T12:00:00.000Z");
  assert.equal(result.eventExists, true);
  if (!result.eventExists) return;
  assert.equal(result.ready, false);
  assert.equal(result.withinEntryWindow, true);
  assert.equal(result.eventAcceptingNewEntries, false);
});

test("configuração e janela verdadeiras permitem entradas sem converter isso em autorização de usuário", () => {
  const result = makeAvailability(makeEvent(), "2030-11-01T12:00:00.000Z");
  assert.equal(result.eventExists, true);
  if (!result.eventExists) return;
  assert.equal(result.ready, true);
  assert.equal(result.withinEntryWindow, true);
  assert.equal(result.eventAcceptingNewEntries, true);
  assert.deepEqual(result.missing, []);
});

test("corte oficial e fechamento Admin são exclusivos e nunca estendidos pela margem operacional", () => {
  const event = makeEvent();
  const atOfficialCutoff = makeAvailability(event, "2030-11-01T16:00:00.000Z");
  assert.equal(atOfficialCutoff.eventExists, true);
  if (atOfficialCutoff.eventExists) {
    assert.equal(atOfficialCutoff.ready, true);
    assert.equal(atOfficialCutoff.withinEntryWindow, false);
    assert.equal(atOfficialCutoff.eventAcceptingNewEntries, false);
    assert.equal(atOfficialCutoff.cutoffAt.toISOString(), "2030-11-01T16:00:00.000Z");
  }

  const config = evaluateEventConfigurationReadiness(event);
  const entryWindow = evaluateEventEntryWindow({
    ...event,
    closureRequestedAt: at("2030-11-01T13:00:00.000Z"),
    adminDeadlineAt: at("2030-11-01T14:00:00.000Z"),
  }, at("2030-11-01T13:00:00.000Z"));
  const adminCutoff = buildEventAvailabilityResult({
    eventId: "event-uuid",
    eventStatus: "closing",
    configuration: config,
    entryWindow,
    operationalCapacity: buildEventOperationalCapacityResult(true, true),
  });
  assert.equal(adminCutoff.eventExists, true);
  if (adminCutoff.eventExists) {
    assert.equal(adminCutoff.eventAcceptingNewEntries, false);
    assert.ok(adminCutoff.missing.includes("EVENT_ENTRY_CLOSED"));
    assert.ok(adminCutoff.missing.includes("EVENT_ADMIN_CLOSING"));
  }
});

test("perda e restauração de Staff/estação é dinâmica e status closed nunca reabre", () => {
  const event = makeEvent();
  const loss = makeAvailability(
    event,
    "2030-11-01T12:00:00.000Z",
    buildEventOperationalCapacityResult(false, true),
  );
  assert.equal(loss.eventExists, true);
  if (loss.eventExists) {
    assert.equal(loss.ready, false);
    assert.equal(loss.eventAcceptingNewEntries, false);
    assert.ok(loss.missing.includes("EVENT_HAS_NO_AUTHORIZED_STAFF"));
  }

  const restored = makeAvailability(event, "2030-11-01T12:00:00.000Z");
  assert.equal(restored.eventExists, true);
  if (restored.eventExists) assert.equal(restored.eventAcceptingNewEntries, true);

  const closed = makeAvailability(event, "2030-11-01T12:00:00.000Z", undefined, "closed");
  assert.equal(closed.eventExists, true);
  if (closed.eventExists) {
    assert.equal(closed.ready, true);
    assert.equal(closed.eventAcceptingNewEntries, false);
    assert.ok(closed.missing.includes("EVENT_CLOSED"));
  }
});
