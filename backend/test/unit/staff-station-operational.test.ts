import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProblemException } from '../../src/common/errors/problem.exception';
import { actor, fixture, id, queueEntryId, serviceSessionId } from './helpers/staff-station-fixture';

const input = (key = id(20)) => ({ ...actor, queueEntryId, idempotencyKey: key, expiresAt: new Date('2099-01-01') });

test('estação lê fila FIFO nominal mínima e chamada pendente sem SQL mutante', async () => {
  const f = fixture();
  const value = await f.reader.read(actor);
  assert.deepEqual(value?.waiting, [{ queueEntryId, displayName: 'Ana', position: 1 }]);
  assert.equal(value?.waitingCount, 1); assert.equal(value?.canCall, true);
  f.flags.pending = true; f.state.entry = 'called';
  const called = await f.reader.read(actor);
  assert.equal(called?.pending?.serviceSessionId, serviceSessionId); assert.equal(called?.canCall, false);
  assert.equal(f.queries.some(q => /\b(insert|update|delete)\b/i.test(q.text)), false);
  assert.doesNotMatch(JSON.stringify(called), /email|password|userId|queueOrder/);
});

test('estação rejeita sessão revogada e oculta evento sem concessão', async () => {
  const f = fixture(); f.flags.session = false;
  await assert.rejects(f.reader.read(actor), (error: unknown) => error instanceof ProblemException && error.getStatus() === 401);
  f.flags.session = true; f.flags.grant = false;
  assert.equal(await f.reader.read(actor), null);
});

test('remoção Staff fecha apenas waiting, preserva participação e reexecuta mesma chave sem novo efeito', async () => {
  const f = fixture(), requested = input();
  const result = await f.remover.remove(requested);
  assert.equal(result.queueEntry.closeReason, 'staff_queue_removed');
  assert.equal(result.participation.status, 'active'); assert.equal(result.participation.currentQueueEntryId, null);
  assert.equal(f.state.entry, 'closed'); assert.equal(f.state.audit, 1);
  assert.deepEqual(await f.remover.remove(requested), result); assert.equal(f.state.audit, 1);
});

test('duas remoções concorrentes não fecham duas vezes e chave diferente é recusada', async () => {
  const f = fixture();
  const first = f.remover.remove(input(id(21)));
  const second = f.remover.remove(input(id(22)));
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.state.audit, 1); assert.equal(f.state.entry, 'closed');
});

test('falha na auditoria faz rollback da remoção e da reserva', async () => {
  const f = fixture(); f.flags.failAudit = true;
  await assert.rejects(f.remover.remove(input()), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, 'PRIVATE_AUDIT_FAILURE');
    return true;
  });
  assert.equal(f.state.entry, 'waiting'); assert.equal(f.state.current, queueEntryId);
  assert.equal(f.state.receipts.size, 0); assert.equal(f.state.audit, 0);
  assert.equal(f.queries.at(-1)?.text, 'rollback');
  assert.equal(f.queries.some(query => query.text === 'commit'), false);
});
