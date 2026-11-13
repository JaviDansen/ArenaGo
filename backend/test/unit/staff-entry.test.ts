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
test("rota legada recusa novas confirmações sem callId, sem efeito ou reserva",async()=>{
  for(const participationId of [id(4),id(5),id(99)]) {
    const f=entryFixture();await assert.rejects(f.service.confirm({...intent(),participationId}),code('ENTRY_CALL_REQUIRED'));
    assert.deepEqual(f.state.people.map(p=>p.status),['waiting','waiting']);assert.equal(f.state.receipts.size,0);
    assert.equal(f.queries.some(q=>q.text.includes('UPDATE participations p SET')),false);
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
      assert.equal(f.queries.some(q => q.text.includes("UPDATE participations p SET") || q.text.includes('UPDATE events e SET external_queue_enabled')), false);
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
    await assert.rejects(f.service.confirm({ ...intent(), participationId: id(4) }), code("ENTRY_CALL_REQUIRED"));
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
test("corte no UPDATE decisivo reverte reserva sem liberar participantes ou auditar", async () => {
  for (const enabled of [false, true]) {
    const f = entryFixture(); f.state.enabled = !enabled; f.flags.cutoffAtDecision = true;
    await assert.rejects(f.service.setEnabled({ ...intent(), enabled }), code('EVENT_ENTRY_UNAVAILABLE'));
    assert.equal(f.state.enabled, !enabled);
    assert.deepEqual(f.state.people.map(p => p.status), ['waiting', 'waiting']);
    assert.equal(f.state.receipts.size, 0);
    assert.equal(f.queries.some(q => q.text.includes('INSERT INTO audit_logs')), false);
    assert.equal(f.queries.at(-1)?.text, 'rollback');
  }
});
test("chave de alternância reutilizada para intenção diferente não altera o evento", async () => {
  const f = entryFixture(); await f.service.setEnabled({ ...intent(), enabled: false });
  await assert.rejects(f.service.setEnabled({ ...intent(), enabled: true }), code("IDEMPOTENCY_REQUEST_CONFLICT"));
  assert.equal(f.state.enabled, false);
});
test("confirmações concorrentes do mesmo alvo não ativam o próximo; liberação aguarda evento", async () => {
  const f = entryFixture(), entered = deferred(), release = deferred();
  const called = await f.calls.execute('call', intent(19));
  f.flags.hold = { entered: entered.resolve, until: release.promise };
  const first = f.calls.execute('confirm', { ...intent(), callId: called.call.id }); await entered.promise;
  const second = f.calls.execute('confirm', { ...intent(21), callId: called.call.id });
  const refused = assert.rejects(second, code("ENTRY_CALL_NOT_PENDING"));
  const bulk = f.service.setEnabled({ ...intent(22), enabled: false });
  assert.equal(f.state.enabled, true, "alternância não ultrapassa a confirmação pendente");
  release.resolve(); await first; await refused;
  const result = await bulk; assert.equal(result.releasedCount, 1);
  assert.deepEqual(f.state.people.map(p => p.status), ["active", "active"]);
});
test('replay legado válido é preservado sem nova admissão',async()=>{
  const {entryFingerprint}=await import('../../src/participations/staff-entry.service');
  const f=entryFixture();const payload={eventId:actor.eventId,participation:{id:id(4),status:'active',arenaEnteredAt:'2026-11-10T15:00:00.000Z'}};
  f.state.receipts.set(`${actor.userId}:staff_confirm_event_entry:${id(20)}`,{id:id(90),hash:entryFingerprint(actor.eventId,id(4)),status:'completed',httpStatus:200,reference:id(4),payload});
  assert.deepEqual(await f.service.confirm({...intent(),participationId:id(4)}),payload);
  assert.deepEqual(f.state.people.map(p=>p.status),['waiting','waiting']);
});
