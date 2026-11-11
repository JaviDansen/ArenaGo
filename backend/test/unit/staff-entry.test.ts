import assert from "node:assert/strict";
import { test } from "node:test";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { entryFixture, actor, intent, id, deferred } from "./helpers/staff-entry-fixture";

const code = (expected: string) => (error: unknown) => error instanceof ProblemException &&
  (error.getResponse() as { code: string }).code === expected;
test("entrada Staff lê snapshot autorizado, FIFO e identificação mínima, sem escrita", async () => {
  const f = entryFixture(), result = await f.service.read(actor);
  assert.equal(result.waitingCount, 2); assert.equal(result.externalQueueEnabled, true);
  assert.deepEqual(result.waiting, [{ participationId: id(4), displayName: "Ana", position: 1 }, { participationId: id(5), displayName: "Bia", position: 2 }]);
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
  assert.equal(f.queries.some(q => /\b(insert|update|delete)\b/i.test(q.text)), false);
  const grant = f.queries.find(q => q.text.includes('AS "observedAt"'))!;
  assert.ok(grant.params.includes(actor.eventId) && grant.params.includes(actor.userId));
  assert.match(grant.text, /r.role='staff'.*r.event_id=e.id.*r.revoked_at IS NULL/s);
  assert.doesNotMatch(JSON.stringify(result), /email|password|userId|externalQueueOrder/);
});
test("entrada vazia e fechamento continuam consultáveis sem autorizar mutação", async () => {
  const f = entryFixture(); f.state.people = []; f.flags.manage = false;
  const result = await f.service.read(actor); assert.equal(result.waitingCount, 0); assert.equal(result.canManage, false);
});
test("confirma somente o primeiro e persiste efeito, auditoria e idempotência no mesmo tx", async () => {
  const f = entryFixture(); const input = { ...intent(), participationId: id(4) };
  const result = await f.service.confirm(input); assert.equal(result.participation.status, "active");
  assert.deepEqual(f.state.people.map(p => p.status), ["active", "waiting"]);
  const sql = f.queries.map(q => q.text).join("\n");
  assert.match(sql, /FROM events WHERE.*FOR UPDATE/);
  assert.match(sql, /ORDER BY external_queue_order, id LIMIT 1 FOR UPDATE/);
  assert.match(sql, /closure_requested_at IS NULL/); assert.match(sql, /d.at<e.official_ends_at/);
  assert.equal(f.queries.at(-1)?.text, "commit");
  const before = f.queries.filter(q => q.text.includes("UPDATE participations p SET")).length;
  assert.deepEqual(await f.service.confirm(input), result);
  assert.equal(f.queries.filter(q => q.text.includes("UPDATE participations p SET")).length, before);
  assert.equal(f.queries.at(-1)?.text, "rollback");
});
test("segundo participante e alvo de outro evento não furam FIFO nem deixam reserva", async () => {
  for (const participationId of [id(5), id(99)]) {
    const f = entryFixture(); await assert.rejects(f.service.confirm({ ...intent(), participationId }), code("ENTRY_NOT_FIRST"));
    assert.deepEqual(f.state.people.map(p => p.status), ["waiting", "waiting"]); assert.equal(f.state.receipts.size, 0);
  }
});
test("Staff desativa liberando todos atomicamente e reativa sem recolocar ativos", async () => {
  const f = entryFixture();
  const off = await f.service.setEnabled({ ...intent(), enabled: false }); assert.equal(off.releasedCount, 2);
  assert.deepEqual(f.state.people.map(p => p.status), ["active", "active"]);
  const on = await f.service.setEnabled({ ...intent(21), enabled: true }); assert.equal(on.releasedCount, 0);
  assert.equal(f.state.enabled, true); assert.deepEqual(f.state.people.map(p => p.status), ["active", "active"]);
  assert.deepEqual(await f.service.setEnabled({ ...intent(), enabled: false }), off);
  assert.equal(f.state.enabled, true, "replay antigo não desfaz a reativação posterior");
  assert.equal(f.queries.some(q => /update.*(queue_entries|service_sessions)/i.test(q.text)), false);
});
for (const flags of [{ staff: false }, { verified: false }, { revoked: true }, { expired: true }, { active: false },
  { admin: true, staff: false, secondFactor: true }, { admin: true, secondFactor: false }]) {
  test(`autorização atual protege consulta e mutações: ${JSON.stringify(flags)}`, async () => {
    for (const op of ["read", "confirm", "toggle"]) {
      const f = entryFixture(); Object.assign(f.flags, flags);
      await assert.rejects(op === "read" ? f.service.read(actor) : op === "confirm"
        ? f.service.confirm({ ...intent(), participationId: id(4) }) : f.service.setEnabled({ ...intent(), enabled: false }));
      assert.equal(f.queries.some(q => q.text.includes("UPDATE participations p SET") || q.text.startsWith('update "events"')), false);
    }
  });
}
test("evento ausente e não autorizado retornam 404 sem consulta nominal", async () => {
  for (const flags of [{ exists: false }, { staff: false }]) {
    const f = entryFixture(); Object.assign(f.flags, flags);
    await assert.rejects(f.service.read(actor), code("RESOURCE_NOT_FOUND"));
    assert.equal(f.queries.some(q => q.text.includes("row_number() OVER")), false);
  }
});
test("cortes D07/D09, evento não pronto e fila desligada não ativam participação", async () => {
  for (const enabled of [true, false]) {
    const f = entryFixture(); f.state.enabled = enabled; f.flags.manage = false;
    await assert.rejects(f.service.confirm({ ...intent(), participationId: id(4) }), code("EVENT_ENTRY_UNAVAILABLE"));
    await assert.rejects(f.service.setEnabled({ ...intent(21), enabled: !enabled }), code("EVENT_ENTRY_UNAVAILABLE"));
    assert.equal(f.state.enabled, enabled); assert.equal(f.state.receipts.size, 0);
  }
});
test("falha após alteração reverte participação, alternância e reserva", async () => {
  for (const toggle of [true, false]) {
    const f = entryFixture(); f.flags.fail = true;
    await assert.rejects(toggle ? f.service.setEnabled({ ...intent(), enabled: false }) : f.service.confirm({ ...intent(), participationId: id(4) }));
    assert.equal(f.state.enabled, true); assert.deepEqual(f.state.people.map(p => p.status), ["waiting", "waiting"]);
    assert.equal(f.state.receipts.size, 0); assert.equal(f.queries.at(-1)?.text, "rollback");
  }
});
test("chave de alternância reutilizada para intenção diferente não altera o evento", async () => {
  const f = entryFixture(); await f.service.setEnabled({ ...intent(), enabled: false });
  await assert.rejects(f.service.setEnabled({ ...intent(), enabled: true }), code("IDEMPOTENCY_REQUEST_CONFLICT"));
  assert.equal(f.state.enabled, false);
});
test("confirmações concorrentes do mesmo alvo não ativam o próximo; liberação aguarda evento", async () => {
  const f = entryFixture(), entered = deferred(), release = deferred();
  f.flags.hold = { entered: entered.resolve, until: release.promise };
  const first = f.service.confirm({ ...intent(), participationId: id(4) }); await entered.promise;
  const second = f.service.confirm({ ...intent(21), participationId: id(4) });
  const refused = assert.rejects(second, code("ENTRY_NOT_FIRST"));
  const bulk = f.service.setEnabled({ ...intent(22), enabled: false });
  assert.equal(f.state.enabled, true, "alternância não ultrapassa a confirmação pendente");
  release.resolve(); await first; await refused;
  const result = await bulk; assert.equal(result.releasedCount, 1);
  assert.deepEqual(f.state.people.map(p => p.status), ["active", "active"]);
});
