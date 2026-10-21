import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EventAccessCodeValidationError,
  normalizeEventAccessCode,
} from "../../src/events/access-code";

test("normaliza códigos ASCII válidos e whitespace externo reconhecido por trim", () => {
  const cases: Array<[string, string]> = [
    ["FILA", "FILA"],
    ["fila", "FILA"],
    ["  fila  ", "FILA"],
    ["\tARENA-2026\r\n", "ARENA-2026"],
    ["\u00a0SLZ-GAMES-2026\u00a0", "SLZ-GAMES-2026"],
    ["A1B2", "A1B2"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeEventAccessCode(input), expected);
  }
});

test("aceita limites de comprimento 4 e 64 e rejeita 3 e 65", () => {
  assert.equal(normalizeEventAccessCode("ABCD"), "ABCD");
  assert.equal(normalizeEventAccessCode("A".repeat(64)), "A".repeat(64));
  assert.throws(() => normalizeEventAccessCode("ABC"), EventAccessCodeValidationError);
  assert.throws(() => normalizeEventAccessCode("A".repeat(65)), EventAccessCodeValidationError);
});

test("rejeita formato inválido, whitespace interno e caracteres não ASCII", () => {
  const invalidCodes = [
    "-ARENA", "ARENA-", "ARENA--2026", "ARENA 2026", "ARENA\t2026",
    "SÃO-LUIS", "EVENTO_01", "ßABC", "éABC", "😀ABC", "", "   ",
  ];

  for (const input of invalidCodes) {
    assert.throws(() => normalizeEventAccessCode(input), {
      name: "EventAccessCodeValidationError",
    }, JSON.stringify(input));
  }
});

test("normalização é idempotente", () => {
  const once = normalizeEventAccessCode("  slz-games-2026\n");
  assert.equal(normalizeEventAccessCode(once), once);
});
