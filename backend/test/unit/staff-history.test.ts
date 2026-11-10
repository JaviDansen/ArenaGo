import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { createCallNextFingerprint } from "../../src/events/call-next.service";
import { createCompleteServiceFingerprint } from "../../src/events/complete.service";
import { createAbsentServiceFingerprint } from "../../src/events/absent.service";
import { StaffHistoryService, type HistoricalScope } from "../../src/events/staff-history.service";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), session = id(2), eventId = id(3), experienceId = id(4), stationId = id(5), serviceSessionId = id(6), key = id(7);
const call = { kind: "call-next", eventId, experienceId, stationId } as const;
const complete = { kind: "complete", eventId, serviceSessionId } as const;
const absence = { kind: "absent", eventId, serviceSessionId } as const;
const called = { serviceSession: { id: serviceSessionId, queueEntryId: id(8), experienceId,
  station: { id: stationId, label: "Estação", privateValue: "PRIVATE" }, status: "pending", calledAt: "2026-11-03T15:00:00.000Z", privateValue: "PRIVATE" }, privateValue: "PRIVATE" };
const completed = { serviceSession: { id: serviceSessionId, status: "completed", resolvedAt: "2026-11-03T15:00:00.000Z" },
  queueEntry: { status: "closed", closeReason: "completed" }, participation: { status: "active", currentQueueEntryId: null } };
const absent = { serviceSession: { id: serviceSessionId, status: "absent", resolvedAt: "2026-11-03T15:00:00.000Z" },
  previousQueueEntry: { id: id(8), status: "closed", closeReason: "absent" }, requeued: false, newQueueEntry: null };

function fixture(options: { invalidSession?: boolean; denied?: boolean; failHistory?: boolean; row?: Record<string, unknown> | null;
  actor?: string; operation?: string; key?: string; hash?: string } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const database = drizzle({ async query(config: { text: string }, params: unknown[] = []) {
    const text = config.text; queries.push({ text, params });
    if (text.includes("FROM sessions s JOIN users")) return { rows: options.invalidSession ? [] : [{ id: session }] };
    if (text.includes("FROM events e")) return { rows: options.denied ? [] : [{ id: eventId }] };
    if (text.includes("FROM idempotency_operations")) {
      if (options.failHistory) throw new Error("PRIVATE_DATABASE_MARKER");
      const matches = params[0] === (options.actor ?? user) && params[1] === (options.operation ?? "call_next") &&
        params[2] === (options.key ?? key) && params[3] === (options.hash ?? createCallNextFingerprint(eventId, experienceId, stationId));
      return { rows: matches && options.row !== null ? [options.row ?? { status: "completed", httpStatus: 201,
        resultReference: serviceSessionId, resultPayload: called }] : [] };
    }
    return { rows: [] };
  } } as unknown as Client, { schema });
  return { service: new StaffHistoryService(database), queries };
}

test("histórico retorna somente resultado projetado, com aviso obrigatório de sessão desconhecida", async () => {
  const f = fixture(); const result = await f.service.find(user, session, key, call);
  assert.equal(result.kind, "recorded"); if (result.kind !== "recorded") throw new Error("Resultado ausente");
  assert.equal(result.originSession, "unavailable");
  assert.equal(result.automaticReconciliation, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
  assert.match(f.queries[1].text, /revoked_at IS NULL/); assert.match(f.queries[1].text, /admin_2fa_verified_at/);
  for (const s of [/r.role='staff'/, /r.event_id=e.id/, /r.revoked_at IS NULL/, /u.email_verified_at IS NOT NULL/]) assert.match(f.queries[2].text, s);
  assert.deepEqual(f.queries[3].params, [user, "call_next", key, createCallNextFingerprint(eventId, experienceId, stationId)]);
  assert.equal(f.queries.some(q => /\b(insert|update|delete|for update|for share)\b/i.test(q.text)), false);
});

test("mesma conta em outra sessão não adquire comprovação de sessão de origem", async () => {
  const f = fixture(); const result = await f.service.find(user, id(30), key, call);
  assert.equal(result.kind, "recorded");
  if (result.kind !== "recorded") throw new Error("Resultado ausente");
  assert.equal(result.originSession, "unavailable"); assert.equal(result.automaticReconciliation, false);
  assert.deepEqual(f.queries[1].params, [id(30), user]);
});

test("sessão revogada, concessão revogada e conta sem Staff são recusadas antes da consulta histórica", async () => {
  for (const [options, kind] of [[{ invalidSession: true }, "session_invalid"], [{ denied: true }, "access_denied"]] as const) {
    const f = fixture(options); assert.equal((await f.service.find(user, session, key, call)).kind, kind);
    assert.equal(f.queries.some(q => q.text.includes("FROM idempotency_operations")), false);
  }
});

test("ator, chave, evento, operação e recursos divergentes não revelam resultados", async () => {
  const cases: Array<[ReturnType<typeof fixture>, HistoricalScope, string, string]> = [
    [fixture({ actor: id(20) }), call, user, key], [fixture({ key: id(21) }), call, user, key],
    [fixture(), { ...call, eventId: id(22) }, user, key], [fixture(), { ...call, stationId: id(23) }, user, key],
    [fixture(), complete, user, key], [fixture({ row: null }), call, user, key],
  ];
  for (const [f, scope, actor, suppliedKey] of cases) assert.equal((await f.service.find(actor, session, suppliedKey, scope)).kind, "unknown");
});

test("resultado completo e ausência com ou sem reentrada são projetados pelo fingerprint", async () => {
  const scenarios = [
    { scope: complete, operation: "complete_service_session", hash: createCompleteServiceFingerprint(eventId, serviceSessionId), payload: completed },
    { scope: absence, operation: "absent_service_session", hash: createAbsentServiceFingerprint(eventId, serviceSessionId), payload: absent },
    { scope: absence, operation: "absent_service_session", hash: createAbsentServiceFingerprint(eventId, serviceSessionId),
      payload: { ...absent, requeued: true, newQueueEntry: { id: id(9), status: "waiting", queueOrder: "9007199254740993", position: 1 } } },
  ];
  for (const s of scenarios) {
    const f = fixture({ operation: s.operation, hash: s.hash, row: { status: "completed", httpStatus: 200, resultReference: serviceSessionId, resultPayload: s.payload } });
    assert.equal((await f.service.find(user, session, key, s.scope)).kind, "recorded");
  }
});

test("registro expirado continua legível se presente; em andamento ou resultado inválido é desconhecido", async () => {
  const expired = fixture({ row: { status: "completed", httpStatus: 201, resultReference: serviceSessionId, resultPayload: called, expiresAt: new Date(0) } });
  assert.equal((await expired.service.find(user, session, key, call)).kind, "recorded");
  assert.doesNotMatch(expired.queries[3].text, /expires_at/);
  for (const row of [{ status: "in_progress", httpStatus: null, resultReference: null, resultPayload: null },
    { status: "completed", httpStatus: 201, resultReference: id(99), resultPayload: called },
    { status: "completed", httpStatus: 201, resultReference: serviceSessionId, resultPayload: { privateValue: "PRIVATE" } }]) {
    const f = fixture({ row }); assert.equal((await f.service.find(user, session, key, call)).kind, "unknown");
  }
});

test("ausência com reentrada igual à entrada encerrada não é apresentada como resultado válido", async () => {
  const f = fixture({ operation: "absent_service_session", hash: createAbsentServiceFingerprint(eventId, serviceSessionId),
    row: { status: "completed", httpStatus: 200, resultReference: serviceSessionId,
      resultPayload: { ...absent, requeued: true, newQueueEntry: { id: id(8).toUpperCase(), status: "waiting", queueOrder: "1", position: 1 } } } });
  assert.equal((await f.service.find(user, session, key, absence)).kind, "unknown");
});

test("timestamps históricos exigem o formato completo e canônico de toISOString nas três operações", async () => {
  const scenarios = [
    { scope: call, operation: "call_next", hash: createCallNextFingerprint(eventId, experienceId, stationId), payload: called, field: "calledAt", status: 201 },
    { scope: complete, operation: "complete_service_session", hash: createCompleteServiceFingerprint(eventId, serviceSessionId), payload: completed, field: "resolvedAt", status: 200 },
    { scope: absence, operation: "absent_service_session", hash: createAbsentServiceFingerprint(eventId, serviceSessionId), payload: absent, field: "resolvedAt", status: 200 },
  ];
  const valid = ["2026-11-03T15:00:00.000Z", "2024-02-29T23:59:59.999Z", "+010000-01-01T00:00:00.000Z"];
  const invalid = ["2026-11-03", "2026-11-03T15:00:00.000", "2026-11-03T15:00:00Z",
    "2026-11-03T15:00:00.000+00:00", "2026-02-29T15:00:00.000Z", "2026-04-31T15:00:00.000Z",
    "2026-11-03T24:00:00.000Z", "not-a-date"];
  for (const scenario of scenarios) {
    for (const [values, expected] of [[valid, "recorded"], [invalid, "unknown"]] as const) {
      for (const value of values) {
        const payload = { ...scenario.payload, serviceSession: { ...scenario.payload.serviceSession, [scenario.field]: value } };
        const f = fixture({ operation: scenario.operation, hash: scenario.hash, row: { status: "completed", httpStatus: scenario.status,
          resultReference: serviceSessionId, resultPayload: payload } });
        assert.equal((await f.service.find(user, session, key, scenario.scope)).kind, expected, `${scenario.scope.kind}: ${value}`);
      }
    }
  }
});

test("ordem histórica de reentrada respeita limites positivos do bigint PostgreSQL sem perda de precisão", async () => {
  for (const [value, expected] of [["1", "recorded"], ["9007199254740993", "recorded"],
    ["9223372036854775807", "recorded"], ["0", "unknown"], ["-1", "unknown"], ["1.1", "unknown"],
    ["01", "unknown"], ["9223372036854775808", "unknown"], ["999999999999999999999999999", "unknown"]] as const) {
    const payload = { ...absent, requeued: true, newQueueEntry: { id: id(9), status: "waiting", queueOrder: value, position: 1 } };
    const f = fixture({ operation: "absent_service_session", hash: createAbsentServiceFingerprint(eventId, serviceSessionId),
      row: { status: "completed", httpStatus: 200, resultReference: serviceSessionId, resultPayload: payload } });
    const outcome = await f.service.find(user, session, key, absence);
    assert.equal(outcome.kind, expected, value);
    if (outcome.kind === "recorded") {
      assert.deepEqual((outcome.result as { newQueueEntry: { queueOrder: string } }).newQueueEntry.queueOrder, value);
      assert.equal(outcome.originSession, "unavailable"); assert.equal(outcome.automaticReconciliation, false);
    }
  }
});

test("erro na leitura histórica propaga a falha e reverte transação sem SQL mutante", async () => {
  const f = fixture({ failHistory: true });
  await assert.rejects(f.service.find(user, session, key, call), (error: unknown) =>
    error instanceof Error && error.cause instanceof Error && error.cause.message === "PRIVATE_DATABASE_MARKER");
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
  assert.equal(f.queries.at(-1)?.text, "rollback");
  assert.equal(f.queries.some(query => query.text === "commit"), false);
  assert.equal(f.queries.some(query => /\b(insert|update|delete|for update|for share)\b/i.test(query.text)), false);
});
