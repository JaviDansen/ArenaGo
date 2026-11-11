import { sessionScenario, assertSessionRefusal, assertSessionTransaction } from "./mutation-session-scenario";
import type { MutationSession } from "../../src/auth/mutation-session";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLED_REMOVAL_OPERATION, CalledRemovalServiceIntegrityError, createCalledRemovalServiceFingerprint } from "../../src/events/staff-called-removal.service";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";

import { fixture, input, at, payload } from "./helpers/staff-called-removal-fixture";
import { CompleteService } from "../../src/events/complete.service";
import { AbsentService } from "../../src/events/absent.service";

test('remoção audita e libera pending sem efeitos de conclusão, ausência ou reentrada', async () => {
  const f = fixture();
  const result = await f.service.remove(input);
  assert.equal(result.kind, 'removed');
  assert.deepEqual(f.state, { session: 'canceled', entry: 'closed', currentId: null, audit: 1, reservation: 1 });
  assert.ok(f.queries.some(q => q.text.includes("cancel_reason='staff_queue_removed'")));
  assert.ok(f.queries.some(q => q.text.includes("'staff_called_service_removed'")));
  assert.equal(f.queries.filter(q => /UPDATE service_sessions s SET/.test(q.text)).length, 1);
  assert.ok(!f.queries.some(q => /INSERT INTO queue_entries|status='completed'|status='absent'|SET status='finished'/.test(q.text)));
});

test('falha de auditoria restaura sessão, entrada, ponteiro e reserva na persistência simulada', async () => {
  const f = fixture({ fail: 'audit' });
  await assert.rejects(f.service.remove(input));
  assert.deepEqual(f.state, { session: 'pending', entry: 'called', currentId: 'entry', audit: 0, reservation: 0 });
  assert.equal(f.queries.at(-1)?.text, 'rollback');
});

test('complete/absent/remove concorrentes após remoção não substituem terminal: lock simulado', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.service.remove(input),
    new CompleteService(f.database).complete({ ...input, idempotencyKey: 'complete-competing' }),
    new AbsentService(f.database).absent({ ...input, idempotencyKey: 'absent-competing' }),
    f.service.remove({ ...input, idempotencyKey: 'remove-competing' }),
  ]);
  assert.deepEqual(results.map(r => r.kind), ['removed', 'service_not_pending', 'service_not_pending', 'service_not_pending']);
  assert.equal(f.state.audit, 1);
  assert.equal(f.state.session, 'canceled');
  assert.equal(f.state.reservation, 1);
});

test("STAFF-CALLED fingerprint vincula evento/sessão em namespace próprio", () => {
  const hash = createCalledRemovalServiceFingerprint("e", "s");
  assert.equal(hash, createCalledRemovalServiceFingerprint("e", "s"));
  assert.notEqual(hash, createCalledRemovalServiceFingerprint("other", "s"));
  assert.notEqual(hash, createCalledRemovalServiceFingerprint("e", "other"));
  assert.notEqual(hash, createRequestFingerprint("call_next", { eventId: "e", serviceSessionId: "s" }));
  assert.equal(CALLED_REMOVAL_OPERATION, "staff_remove_called_service_session");
});
test("STAFF-CALLED conclui sessão/entrada/ponteiro/idempotência no mesmo tx e contrato mínimo", async () => {
  const { service, queries } = fixture(); const result = await service.remove(input);
  assert.deepEqual(result, { kind: "removed", ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: at } });
  assert.equal(queries[0].text, "begin isolation level read committed"); assert.equal(queries.at(-1)?.text, "commit");
  assert.ok(queries.find(q => q.text.includes("UPDATE service_sessions s SET"))?.params.includes(input.staffUserId));
  assert.equal(queries.some(q => /INSERT INTO service_sessions|INSERT INTO queue_entries|UPDATE stations|last_queue_order\s*=|SET status='finished'/i.test(q.text)), false);
  assert.equal(JSON.stringify(result).includes(input.staffUserId), false);
});
test("STAFF-CALLED descobre sessão explícita e trava evento → experiência → estação → pessoa → entrada → sessão", async () => {
  const { service, queries } = fixture(); await service.remove(input);
  const order = ['SELECT s.experience_id AS "experienceId"', "SELECT id FROM events", "SELECT id FROM experiences", "SELECT id FROM stations",
    "SELECT r.id FROM users", 'AS "currentId"', "SELECT status FROM queue_entries", "SELECT status FROM service_sessions", 'insert into "idempotency_operations"', "WITH decision AS MATERIALIZED"];
  const index = (part: string) => queries.findIndex(q => q.text.includes(part));
  for (let i = 1; i < order.length; i++) assert.ok(index(order[i-1]) < index(order[i]), order[i]);
  assert.doesNotMatch(queries[1].text, /FOR UPDATE|FOR SHARE|current_queue_entry_id/);
  assert.match(queries[index(order[1])].text, /FOR SHARE/);
  for (const part of [order[2], order[3], order[5], order[6], order[7]]) assert.match(queries[index(part)].text, /FOR UPDATE/);
  for (const part of [order[6], order[7]]) assert.ok(queries[index(part)].params.includes("entry"));
});
test("STAFF-CALLED Staff requer conta ativa/verificada e concessão vigente do evento inclusive no replay", async () => {
  const { service, queries } = fixture({ reservation: "replay" }); await service.remove(input);
  const auth = queries.find(q => q.text.includes("SELECT r.id FROM users"))!;
  for (const part of ["u.is_active=true", "u.email_verified_at IS NOT NULL", "r.role='staff'", "r.revoked_at IS NULL", "FOR SHARE OF u, r"]) assert.ok(auth.text.includes(part));
  assert.ok(auth.params.includes(input.eventId)); assert.ok(auth.params.includes(input.staffUserId)); assert.doesNotMatch(auth.text, /admin/);
  assert.deepEqual(await fixture({ missing: "staff", reservation: "replay" }).service.remove(input), { kind: "staff_event_forbidden" });
});
test("STAFF-CALLED relógio decisivo após locks permite janela residual e copia timestamp PostgreSQL", async () => {
  const { service, queries } = fixture(); await service.remove(input);
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
  test(`STAFF-CALLED bloqueia ${name} sem confirmar reserva ou escrever entrada/ponteiro`, async () => {
    const { service, queries } = fixture(options); assert.deepEqual(await service.remove(input), { kind });
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes("UPDATE queue_entries") || q.text.includes("UPDATE participations") || q.text.includes('update "idempotency_operations"')), false);
  });
}
test("STAFF-CALLED replay histórico ignora estado/ponteiro posteriores e não repete resolução", async () => {
  const { service, queries } = fixture({ reservation: "replay", status: "canceled", entryStatus: "closed", participantStatus: "finished", pointer: "later", ended: true });
  const result = await service.remove(input); assert.equal(result.kind, "replay");
  assert.deepEqual(result, { kind: "replay", ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: at } });
  assert.equal(queries.some(q => q.text.includes("WITH decision") || q.text.includes("UPDATE participations")), false);
});
test("STAFF-CALLED conflito/in_progress não resolvem atendimento", async () => {
  for (const reservation of ["conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation });
    assert.deepEqual(await service.remove(input), { kind: reservation === "conflict" ? "request_conflict" : "in_progress" });
    assert.equal(queries.some(q => q.text.includes("WITH decision")), false);
  }
});
test("STAFF-CALLED vínculos/estados/linhas inconsistentes causam rollback", async () => {
  for (const options of [{ missing: "experience" }, { missing: "station" }, { missing: "person" }, { missing: "entry" }, { missing: "session" },
    { status: "unknown" }, { participantStatus: "finished" }, { participantStatus: "waiting" }, { pointer: null }, { pointer: "later" },
    { entryStatus: "waiting" }, { entryStatus: "closed" }, { closeCount: 0 }, { clearCount: 0 }, { clock: NaN }] as const) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.remove(input), CalledRemovalServiceIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("STAFF-CALLED replay inválido ou de outra sessão não vira sucesso", async () => {
  for (const replayPayload of [{}, { ...payload, serviceSession: { ...payload.serviceSession, id: "other" } },
    { ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: "invalid" } }, { ...payload, queueEntry: { status: "waiting" } },
    { ...payload, participation: { status: "active", currentQueueEntryId: "later" } }]) {
    const { service, queries } = fixture({ reservation: "replay", replayPayload });
    await assert.rejects(service.remove(input), CalledRemovalServiceIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("STAFF-CALLED falhas em cada escrita propagam causa e solicitam rollback", async () => {
  for (const fail of ["resolve", "close", "clear", "audit", "complete"] as const) {
    const { service, queries, marker } = fixture({ fail });
    await assert.rejects(service.remove(input), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("STAFF-CALLED input inválido falha antes de abrir transação", async () => {
  const { service, queries } = fixture();
  for (const changes of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) await assert.rejects(service.remove({ ...input, ...changes }), /inválida/);
  assert.equal(queries.length, 0);
});

// E08-EST01: a entrada HTTP não admite fallback para o contrato interno E07.
for (const scenario of ["valid", "revoked", "expired", "foreign", "inactive", "admin", "late", "wait", "intent-wait"] as const) {
  test(`STAFF-CALLED sessão ${scenario}`, async () => {
    const f = fixture(), auth = sessionScenario(f.service, input.staffUserId, scenario);
    if (scenario === "valid") {
      const result = await f.service.removeAuthenticated(input, auth.context);
      assert.equal(result.kind, "removed");
      assert.ok(auth.checks() >= 2); assertSessionTransaction(auth.queries, true);
    } else {
      const code = scenario === "foreign" ? "INVALID_SESSION" : scenario === "inactive" ? "ACCOUNT_DEACTIVATED"
        : scenario === "admin" ? "ADMIN_2FA_REQUIRED" : scenario === "late" || scenario === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED";
      await assert.rejects(f.service.removeAuthenticated(input, auth.context), error => assertSessionRefusal(error, code));
      assertSessionTransaction(auth.queries, false);
      if (scenario === "late") assert.ok(auth.queries.some(q => q.includes('update "idempotency_operations"')));
    }
  });
}
for (const context of [undefined, { userId: "other", sessionId: "session" }, { userId: input.staffUserId, sessionId: "" }]) {
  test(`STAFF-CALLED recusa contexto ausente ou incompatível ${JSON.stringify(context)}`, async () => {
    const f = fixture();
    await assert.rejects(async () => f.service.removeAuthenticated(input, context as MutationSession), error => assertSessionRefusal(error, "UNAUTHENTICATED_CONTEXT"));
    assert.equal(f.queries.length, 0);
  });
}
for (const scenario of ["valid", "revoked", "expired", "late"] as const) {
  test(`STAFF-CALLED replay exige sessão ${scenario}`, async () => {
    const f = fixture({ reservation: "replay" }), auth = sessionScenario(f.service, input.staffUserId, scenario);
    if (scenario === "valid") { assert.equal((await f.service.removeAuthenticated(input, auth.context)).kind, "replay"); assertSessionTransaction(auth.queries, true); }
    else { await assert.rejects(f.service.removeAuthenticated(input, auth.context), error => assertSessionRefusal(error, scenario === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED")); assertSessionTransaction(auth.queries, false); }
    assert.equal(auth.queries.some(q => q.includes('update "idempotency_operations"')), false);
  });
}
