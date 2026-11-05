import { sessionScenario, assertSessionRefusal, assertSessionTransaction } from "./mutation-session-scenario";
import type { MutationSession } from "../../src/auth/mutation-session";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { COMPLETE_SERVICE_OPERATION, CompleteService, CompleteServiceIntegrityError, createCompleteServiceFingerprint } from "../../src/events/complete.service";
import type { CompleteServiceInput } from "../../src/events/complete.types";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";

const input: CompleteServiceInput = { staffUserId: "staff", eventId: "event", serviceSessionId: "session",
  idempotencyKey: "complete-intent", expiresAt: new Date("2099-01-01") };
const at = new Date("2026-11-02T18:00:00Z");
const payload = { serviceSession: { id: input.serviceSessionId, status: "completed", resolvedAt: at.toISOString() },
  queueEntry: { status: "closed", closeReason: "completed" }, participation: { status: "active", currentQueueEntryId: null } };

function fixture(options: {
  missing?: "target" | "event" | "experience" | "station" | "staff" | "person" | "entry" | "session";
  status?: string; participantStatus?: string; pointer?: string | null; entryStatus?: string;
  ended?: boolean; clock?: number; closeCount?: number; clearCount?: number;
  reservation?: "replay" | "conflict" | "in_progress"; replayPayload?: unknown;
  fail?: "resolve" | "close" | "clear" | "complete";
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const marker = new Error(`E075_${options.fail}`);
  const client = { async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (text.includes('SELECT s.experience_id AS "experienceId"')) return { rows: options.missing === "target" ? [] : [{ experienceId: "experience", stationId: "station", queueEntryId: "entry", participationId: "person" }] };
    if (text.includes("SELECT id FROM events")) return { rows: options.missing === "event" ? [] : [{ id: input.eventId }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: options.missing === "experience" ? [] : [{ id: "experience" }] };
    if (text.includes("SELECT id FROM stations")) return { rows: options.missing === "station" ? [] : [{ id: "station" }] };
    if (text.includes("SELECT r.id FROM users")) return { rows: options.missing === "staff" ? [] : [{ id: "role" }] };
    if (text.includes('AS "currentId"')) return { rows: options.missing === "person" ? [] : [{ status: options.participantStatus ?? "active", currentId: options.pointer === undefined ? "entry" : options.pointer }] };
    if (text.includes("SELECT status FROM queue_entries")) return { rows: options.missing === "entry" ? [] : [{ status: options.entryStatus ?? "called" }] };
    if (text.includes("SELECT status FROM service_sessions")) return { rows: options.missing === "session" ? [] : [{ status: options.status ?? "pending" }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "conflict" ? "other" : createCompleteServiceFingerprint(input.eventId, input.serviceSessionId),
      options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.serviceSessionId, options.replayPayload ?? payload]] };
    if (text.includes("UPDATE service_sessions s SET")) {
      if (options.fail === "resolve") throw marker;
      return { rows: options.ended ? [] : [{ resolvedAtMs: options.clock ?? at.getTime() }] };
    }
    if (text.includes("UPDATE queue_entries q SET")) {
      if (options.fail === "close") throw marker;
      return { rows: options.closeCount === 0 ? [] : [{ id: "entry" }] };
    }
    if (text.includes("UPDATE participations SET")) {
      if (options.fail === "clear") throw marker;
      return { rows: options.clearCount === 0 ? [] : [{ id: "person" }] };
    }
    if (text.includes('update "idempotency_operations"')) {
      if (options.fail === "complete") throw marker;
      return { rows: [["reservation", 200, input.serviceSessionId, payload]] };
    }
    return { rows: [] };
  } };
  return { service: new CompleteService(drizzle(client as unknown as Client, { schema })), queries, marker };
}

test("E07.5 fingerprint vincula evento/sessão em namespace próprio", () => {
  const hash = createCompleteServiceFingerprint("e", "s");
  assert.equal(hash, createCompleteServiceFingerprint("e", "s"));
  assert.notEqual(hash, createCompleteServiceFingerprint("other", "s"));
  assert.notEqual(hash, createCompleteServiceFingerprint("e", "other"));
  assert.notEqual(hash, createRequestFingerprint("call_next", { eventId: "e", serviceSessionId: "s" }));
  assert.equal(COMPLETE_SERVICE_OPERATION, "complete_service_session");
});
test("E07.5 conclui sessão/entrada/ponteiro/idempotência no mesmo tx e contrato mínimo", async () => {
  const { service, queries } = fixture(); const result = await service.complete(input);
  assert.deepEqual(result, { kind: "completed", ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: at } });
  assert.equal(queries[0].text, "begin isolation level read committed"); assert.equal(queries.at(-1)?.text, "commit");
  assert.ok(queries.find(q => q.text.includes("UPDATE service_sessions s SET"))?.params.includes(input.staffUserId));
  assert.equal(queries.some(q => /INSERT INTO service_sessions|INSERT INTO queue_entries|UPDATE stations|last_queue_order\s*=|SET status='finished'/i.test(q.text)), false);
  assert.equal(JSON.stringify(result).includes(input.staffUserId), false);
});
test("E07.5 descobre sessão explícita e trava evento → experiência → estação → pessoa → entrada → sessão", async () => {
  const { service, queries } = fixture(); await service.complete(input);
  const order = ['SELECT s.experience_id AS "experienceId"', "SELECT id FROM events", "SELECT id FROM experiences", "SELECT id FROM stations",
    "SELECT r.id FROM users", 'AS "currentId"', "SELECT status FROM queue_entries", "SELECT status FROM service_sessions", 'insert into "idempotency_operations"', "WITH decision AS MATERIALIZED"];
  const index = (part: string) => queries.findIndex(q => q.text.includes(part));
  for (let i = 1; i < order.length; i++) assert.ok(index(order[i-1]) < index(order[i]), order[i]);
  assert.doesNotMatch(queries[1].text, /FOR UPDATE|FOR SHARE|current_queue_entry_id/);
  assert.match(queries[index(order[1])].text, /FOR SHARE/);
  for (const part of [order[2], order[3], order[5], order[6], order[7]]) assert.match(queries[index(part)].text, /FOR UPDATE/);
  for (const part of [order[6], order[7]]) assert.ok(queries[index(part)].params.includes("entry"));
});
test("E07.5 Staff requer conta ativa/verificada e concessão vigente do evento inclusive no replay", async () => {
  const { service, queries } = fixture({ reservation: "replay" }); await service.complete(input);
  const auth = queries.find(q => q.text.includes("SELECT r.id FROM users"))!;
  for (const part of ["u.is_active=true", "u.email_verified_at IS NOT NULL", "r.role='staff'", "r.revoked_at IS NULL", "FOR SHARE OF u, r"]) assert.ok(auth.text.includes(part));
  assert.ok(auth.params.includes(input.eventId)); assert.ok(auth.params.includes(input.staffUserId)); assert.doesNotMatch(auth.text, /admin/);
  assert.deepEqual(await fixture({ missing: "staff", reservation: "replay" }).service.complete(input), { kind: "staff_event_forbidden" });
});
test("E07.5 relógio decisivo após locks permite janela residual e copia timestamp PostgreSQL", async () => {
  const { service, queries } = fixture(); await service.complete(input);
  const decisive = queries.find(q => q.text.includes("UPDATE service_sessions s SET"))!.text;
  for (const part of ["clock_timestamp()", "d.at < e.operational_deadline_at", "d.at < e.admin_deadline_at", "e.status <> 'closed'", "s.status='pending'", "q.status='called'", "p.current_queue_entry_id=q.id"]) assert.ok(decisive.includes(part));
  assert.doesNotMatch(decisive, /official_ends_at|closure_requested_at|queue_accepting_entries|availability/);
  assert.match(queries.find(q => q.text.includes("UPDATE queue_entries q SET"))!.text, /closed_at=s.resolved_at/);
  assert.match(queries.find(q => q.text.includes("UPDATE participations SET"))!.text, /current_queue_entry_id=\$/);
});
for (const [name, options, kind] of [
  ["sem evento", { missing: "event" }, "staff_event_forbidden"],
  ["sem Staff", { missing: "staff" }, "staff_event_forbidden"],
  ["sessão ausente/alheia", { missing: "target" }, "service_not_found"],
  ["já concluído", { status: "completed", entryStatus: "closed", pointer: null }, "service_not_pending"],
  ["ausência", { status: "absent" }, "service_not_pending"],
  ["cancelamento", { status: "canceled" }, "service_not_pending"],
  ["prazo encerrado", { ended: true }, "event_operation_ended"],
] as const) {
  test(`E07.5 bloqueia ${name} sem confirmar reserva ou escrever entrada/ponteiro`, async () => {
    const { service, queries } = fixture(options); assert.deepEqual(await service.complete(input), { kind });
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes("UPDATE queue_entries") || q.text.includes("UPDATE participations") || q.text.includes('update "idempotency_operations"')), false);
  });
}
test("E07.5 replay histórico ignora estado/ponteiro posteriores e não repete resolução", async () => {
  const { service, queries } = fixture({ reservation: "replay", status: "completed", entryStatus: "closed", participantStatus: "finished", pointer: "later", ended: true });
  const result = await service.complete(input); assert.equal(result.kind, "replay");
  assert.deepEqual(result, { kind: "replay", ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: at } });
  assert.equal(queries.some(q => q.text.includes("WITH decision") || q.text.includes("UPDATE participations")), false);
});
test("E07.5 conflito/in_progress não resolvem atendimento", async () => {
  for (const reservation of ["conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation });
    assert.deepEqual(await service.complete(input), { kind: reservation === "conflict" ? "request_conflict" : "in_progress" });
    assert.equal(queries.some(q => q.text.includes("WITH decision")), false);
  }
});
test("E07.5 vínculos/estados/linhas inconsistentes causam rollback", async () => {
  for (const options of [{ missing: "experience" }, { missing: "station" }, { missing: "person" }, { missing: "entry" }, { missing: "session" },
    { status: "unknown" }, { participantStatus: "finished" }, { participantStatus: "waiting" }, { pointer: null }, { pointer: "later" },
    { entryStatus: "waiting" }, { entryStatus: "closed" }, { closeCount: 0 }, { clearCount: 0 }, { clock: NaN }] as const) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.complete(input), CompleteServiceIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("E07.5 replay inválido ou de outra sessão não vira sucesso", async () => {
  for (const replayPayload of [{}, { ...payload, serviceSession: { ...payload.serviceSession, id: "other" } },
    { ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: "invalid" } }, { ...payload, queueEntry: { status: "waiting" } },
    { ...payload, participation: { status: "active", currentQueueEntryId: "later" } }]) {
    const { service, queries } = fixture({ reservation: "replay", replayPayload });
    await assert.rejects(service.complete(input), CompleteServiceIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("E07.5 falhas em cada escrita propagam causa e solicitam rollback", async () => {
  for (const fail of ["resolve", "close", "clear", "complete"] as const) {
    const { service, queries, marker } = fixture({ fail });
    await assert.rejects(service.complete(input), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("E07.5 input inválido falha antes de abrir transação", async () => {
  const { service, queries } = fixture();
  for (const changes of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) await assert.rejects(service.complete({ ...input, ...changes }), /inválida/);
  assert.equal(queries.length, 0);
});

// E08-EST01: a entrada HTTP não admite fallback para o contrato interno E07.
for (const scenario of ["valid", "revoked", "expired", "foreign", "inactive", "admin", "late", "wait", "intent-wait"] as const) {
  test(`E08-EST01 complete sessão ${scenario}`, async () => {
    const f = fixture(), auth = sessionScenario(f.service, input.staffUserId, scenario);
    if (scenario === "valid") {
      const result = await f.service.completeAuthenticated(input, auth.context);
      assert.equal(result.kind, "completed");
      assert.ok(auth.checks() >= 2); assertSessionTransaction(auth.queries, true);
    } else {
      const code = scenario === "foreign" ? "INVALID_SESSION" : scenario === "inactive" ? "ACCOUNT_DEACTIVATED"
        : scenario === "admin" ? "ADMIN_2FA_REQUIRED" : scenario === "late" || scenario === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED";
      await assert.rejects(f.service.completeAuthenticated(input, auth.context), error => assertSessionRefusal(error, code));
      assertSessionTransaction(auth.queries, false);
      if (scenario === "late") assert.ok(auth.queries.some(q => q.includes('update "idempotency_operations"')));
    }
  });
}
for (const context of [undefined, { userId: "other", sessionId: "session" }, { userId: input.staffUserId, sessionId: "" }]) {
  test(`E08-EST01 complete recusa contexto ausente ou incompatível ${JSON.stringify(context)}`, async () => {
    const f = fixture();
    await assert.rejects(async () => f.service.completeAuthenticated(input, context as MutationSession), error => assertSessionRefusal(error, "UNAUTHENTICATED_CONTEXT"));
    assert.equal(f.queries.length, 0);
  });
}
for (const scenario of ["valid", "revoked", "expired", "late"] as const) {
  test(`E08-EST01 complete replay exige sessão ${scenario}`, async () => {
    const f = fixture({ reservation: "replay" }), auth = sessionScenario(f.service, input.staffUserId, scenario);
    if (scenario === "valid") { assert.equal((await f.service.completeAuthenticated(input, auth.context)).kind, "replay"); assertSessionTransaction(auth.queries, true); }
    else { await assert.rejects(f.service.completeAuthenticated(input, auth.context), error => assertSessionRefusal(error, scenario === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED")); assertSessionTransaction(auth.queries, false); }
    assert.equal(auth.queries.some(q => q.includes('update "idempotency_operations"')), false);
  });
}
