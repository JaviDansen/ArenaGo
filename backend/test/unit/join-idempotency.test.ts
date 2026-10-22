import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJoinRequestFingerprint,
  createRequestFingerprint,
} from "../../src/participations/join-idempotency";

test("a mesma intenção de ingresso e o mesmo evento produzem o mesmo fingerprint", () => {
  const first = createJoinRequestFingerprint("550e8400-e29b-41d4-a716-446655440101");
  const retry = createJoinRequestFingerprint("550e8400-e29b-41d4-a716-446655440101");

  assert.equal(first, retry);
});

test("evento diferente produz fingerprint diferente", () => {
  const first = createJoinRequestFingerprint("550e8400-e29b-41d4-a716-446655440101");
  const otherEvent = createJoinRequestFingerprint("550e8400-e29b-41d4-a716-446655440102");

  assert.notEqual(first, otherEvent);
});

test("fingerprint segue o formato char(64) hexadecimal minúsculo do schema", () => {
  assert.match(createJoinRequestFingerprint("event-id"), /^[a-f0-9]{64}$/);
});

test("objetos JSON equivalentes independem da ordem de suas propriedades", () => {
  const first = createRequestFingerprint("join", {
    eventId: "event-id",
    options: { queue: true, mode: "external" },
  });
  const reordered = createRequestFingerprint("join", {
    options: { mode: "external", queue: true },
    eventId: "event-id",
  });

  assert.equal(first, reordered);
});

test("operation separa fingerprints de intenções com o mesmo corpo", () => {
  assert.notEqual(
    createRequestFingerprint("join", { eventId: "event-id" }),
    createRequestFingerprint("leave", { eventId: "event-id" }),
  );
});
