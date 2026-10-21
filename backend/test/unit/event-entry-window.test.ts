import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateEventEntryWindow,
  type EventEntryWindowTimes,
} from "../../src/events/event-entry-window";

const dates = (): EventEntryWindowTimes => ({
  startsAt: new Date("2030-05-10T12:00:00.000Z"),
  officialEndsAt: new Date("2030-05-10T18:00:00.000Z"),
  closureRequestedAt: null,
  operationalDeadlineAt: new Date("2030-05-10T18:45:00.000Z"),
  adminDeadlineAt: null,
});

const at = (instant: string) => new Date(instant);

test("bloqueia antes do início e permite exatamente em startsAt", () => {
  const event = dates();

  assert.deepEqual(evaluateEventEntryWindow(event, at("2030-05-10T11:59:59.999Z")), {
    withinEntryWindow: false,
    blockReason: "EVENT_NOT_STARTED",
    cutoffAt: at("2030-05-10T18:00:00.000Z"),
  });
  assert.equal(evaluateEventEntryWindow(event, event.startsAt).withinEntryWindow, true);
});

test("permite um instante durante a janela e imediatamente antes do corte", () => {
  const event = dates();

  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T15:00:00.000Z")).withinEntryWindow, true);
  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T17:59:59.999Z")).withinEntryWindow, true);
});

test("bloqueia no horário oficial e depois dele mesmo com prazo operacional posterior", () => {
  const event = dates();

  for (const instant of ["2030-05-10T18:00:00.000Z", "2030-05-10T18:00:00.001Z", "2030-05-10T18:45:00.000Z"]) {
    const result = evaluateEventEntryWindow(event, at(instant));
    assert.equal(result.withinEntryWindow, false);
    assert.equal(result.blockReason, "EVENT_ENTRY_CLOSED");
    assert.equal(result.cutoffAt.toISOString(), "2030-05-10T18:00:00.000Z");
  }
});

test("usa fechamento Admin quando antecede o horário oficial, com corte exclusivo", () => {
  const event = dates();
  event.closureRequestedAt = at("2030-05-10T16:00:00.000Z");
  event.adminDeadlineAt = at("2030-05-10T16:30:00.000Z");

  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T15:59:59.999Z")).withinEntryWindow, true);
  const atAdminCutoff = evaluateEventEntryWindow(event, event.closureRequestedAt);
  assert.equal(atAdminCutoff.withinEntryWindow, false);
  assert.equal(atAdminCutoff.blockReason, "EVENT_ENTRY_CLOSED");
  assert.equal(atAdminCutoff.cutoffAt.toISOString(), "2030-05-10T16:00:00.000Z");
  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T17:00:00.000Z")).withinEntryWindow, false);
});

test("ignora fechamento Admin posterior ao oficial e aceita ausência de fechamento Admin", () => {
  const event = dates();
  event.closureRequestedAt = at("2030-05-10T19:00:00.000Z");

  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T17:59:59.999Z")).withinEntryWindow, true);
  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T18:00:00.000Z")).cutoffAt.toISOString(), "2030-05-10T18:00:00.000Z");
  event.closureRequestedAt = null;
  assert.equal(evaluateEventEntryWindow(event, at("2030-05-10T17:00:00.000Z")).withinEntryWindow, true);
});

test("instantes absolutos equivalentes produzem o mesmo resultado em fusos diferentes", () => {
  const event = dates();
  const utcResult = evaluateEventEntryWindow(event, at("2030-05-10T15:00:00.000Z"));
  const offsetResult = evaluateEventEntryWindow(event, at("2030-05-10T12:00:00.000-03:00"));

  assert.deepEqual(offsetResult, utcResult);
});

test("não modifica os horários recebidos nem compartilha a referência do corte", () => {
  const event = dates();
  const snapshots = Object.fromEntries(
    Object.entries(event).map(([key, value]) => [key, value?.getTime() ?? null]),
  );
  const result = evaluateEventEntryWindow(event, at("2030-05-10T15:00:00.000Z"));
  result.cutoffAt.setUTCFullYear(2040);

  assert.deepEqual(
    Object.fromEntries(Object.entries(event).map(([key, value]) => [key, value?.getTime() ?? null])),
    snapshots,
  );
  assert.equal(event.officialEndsAt.toISOString(), "2030-05-10T18:00:00.000Z");
});
