const assert = require('node:assert/strict');
const path = require('node:path').posix;
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const modules = new Map();
function load(file) {
  if (!modules.has(file)) {
    modules.set(file, loadModule(file, name =>
      name.startsWith('.') ? load(path.join(path.dirname(file), name + '.js')) : require(name)).exports);
  }
  return modules.get(file);
}
const { readAdminEventOperation, sendAdminEventOperation } = load('services/adminEventOperationService.js');
const { allowedEventOperations, observedOperationNow, prepareEventOperation } = load('screens/admin/adminOperationForm.js');
const { bindOperationSession, createOperationSession } = load('screens/admin/adminOperationSession.js');
const plain = value => JSON.parse(JSON.stringify(value));
const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
const eventId = id(1), otherId = id(2);
const at = '2090-11-23T13:00:00.000000Z';
const view = overrides => ({ eventId, name: 'Arena teste', timezone: 'America/Sao_Paulo',
  effectivePhase: 'open', observedAt: at, startsAt: '2090-11-23T12:00:00Z',
  officialEndsAt: '2090-11-23T13:45:00Z', operationalDeadlineAt: '2090-11-23T14:15:00Z',
  closureMode: null, closureRequestedAt: null, adminDeadlineAt: null, externalQueueEnabled: true,
  activeParticipants: 0, externalWaitingParticipants: 4, canSetExternalQueue: true, canClose: true, ...overrides });
const queue = { kind: 'queue', body: { enabled: false, reason: 'Entrada direta' } };
const queueReceipt = (target = eventId) => ({ eventId: target, externalQueueEnabled: false, releasedCount: 4, changedAt: at });
const controlled = (time, date = '23/11/2090') => ({ kind: 'close', mode: 'controlled', reason: '  Prazo de operação  ', deadline: { date, time } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('ADMIN-07 GET usa o UUID autenticado e distingue zero de indicador indisponível', async () => {
  const get = async (url, options) => {
    assert.equal(url, '/admin/events/' + eventId + '/operation');
    assert.equal(options.auth, true);
    return view({ externalWaitingParticipants: undefined });
  };
  const result = await readAdminEventOperation({ get }, eventId);
  assert.equal(result.activeParticipants, 0);
  assert.equal(result.externalWaitingParticipants, null);
  await assert.rejects(readAdminEventOperation({ get: async () => view({ eventId: otherId }) }, eventId), /não pôde ser confirmada/);
  await assert.rejects(readAdminEventOperation({ get: async () => assert.fail('GET para UUID inválido') }, 'inválido'), /Identificador/);
});

test('ADMIN-07 converte o prazo no fuso do evento e valida hora, data e limite original', () => {
  const now = observedOperationNow({ view: view(), receivedAt: 18 }, 30);
  assert.equal(now, Date.parse(at) + 12);
  assert.deepEqual(plain(prepareEventOperation(view(), controlled('10:30'), now)), {
    kind: 'close', body: { mode: 'controlled', reason: 'Prazo de operação', controlledUntilAt: '2090-11-23T13:30:00.000Z' },
  });
  for (const draft of [controlled('09:59'), controlled('11:01'), controlled('10:30', '30/02/2090'),
    { ...controlled('10:30'), reason: ' ' }, { ...controlled('10:30'), reason: 'quebra\nde linha' }]) {
    assert.throws(() => prepareEventOperation(view(), draft, now));
  }
  assert.throws(() => prepareEventOperation(view({ operationalDeadlineAt: '2090-11-23T13:50:00Z' }), controlled('10:51'), now), /limite operacional/);
});

test('ADMIN-07 exige flags oficiais e bloqueia alterações após o corte ou encerramento', () => {
  const now = Date.parse(at);
  assert.deepEqual(plain(allowedEventOperations(view(), now)), { queue: true, close: true });
  assert.deepEqual(plain(allowedEventOperations(view({ canSetExternalQueue: false, canClose: false }), now)), { queue: false, close: false });
  assert.deepEqual(plain(allowedEventOperations(view({ effectivePhase: 'scheduled' }), now)), { queue: false, close: true });
  for (const data of [view({ effectivePhase: 'closing' }), view({ effectivePhase: 'closed' }),
    view({ officialEndsAt: at }), view({ closureMode: 'controlled' })]) {
    assert.deepEqual(plain(allowedEventOperations(data, now)), { queue: false, close: false });
  }
  assert.throws(() => prepareEventOperation(view(), { kind: 'queue', enabled: false, reason: '' }, now), /justificativa/);
});

test('ADMIN-07 valida recibos e usa o contrato HTTP com uma chave e sem retry automático', async () => {
  const calls = [];
  const client = {
    async patch(...args) { calls.push(args); return queueReceipt(); },
    async post(...args) { calls.push(args); return { eventId, closureMode: 'immediate', status: 'closed',
      newEntriesClosedAt: at, effectiveOperationalDeadlineAt: at, externalWaitingFinalized: 2 }; },
  };
  await sendAdminEventOperation(client, { eventId, ...queue, key: 'queue-id' });
  await sendAdminEventOperation(client, { eventId, kind: 'close', body: { mode: 'immediate', reason: 'Chuva' }, key: 'close-id' });
  assert.deepEqual(calls.map(([url, body, options]) => [url, plain(body), plain(options)]),
    [['/admin/events/' + eventId + '/external-queue', queue.body, { auth: true, headers: { 'Idempotency-Key': 'queue-id' },
      retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true, expectedStatus: 200 }],
    ['/admin/events/' + eventId + '/close', { mode: 'immediate', reason: 'Chuva' }, { auth: true, headers: { 'Idempotency-Key': 'close-id' },
      retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true, expectedStatus: 200 }]]);
  await assert.rejects(sendAdminEventOperation({ patch: async () => queueReceipt(otherId) },
    { eventId, ...queue, key: 'unconfirmed' }), /não pôde ser confirmado/);
});

test('ADMIN-07 reserva antes do transporte, não duplica escrita e recupera timeout com a mesma chave e corpo', async () => {
  const calls = [], changes = [];
  let keys = 0;
  const session = createOperationSession({ async patch(url, body, options) {
    calls.push({ url, body: plain(body), key: options.headers['Idempotency-Key'] });
    if (calls.length === 1) throw { status: 408, code: 'REQUEST_TIMEOUT', outcomeUnknown: true };
    return queueReceipt();
  } }, () => 'key-' + ++keys, () => true);
  session.subscribe((event, reload) => changes.push({ event, reload }));
  const expected = session.start(eventId, queue);
  await session.start(eventId, { kind: 'close', body: { mode: 'immediate', reason: 'Repetido' } });
  await expected;
  const uncertain = session.snapshot(eventId).intent;
  assert.equal(uncertain.status, 'unknown');
  assert.equal(session.snapshot(eventId).receipt, undefined);
  assert.equal(calls.length, 1);
  assert.equal(changes.at(-1).reload, true);
  await session.start(eventId, queue);
  assert.equal(calls.length, 1);
  await session.retry(otherId, uncertain);
  assert.equal(calls.length, 1);
  await session.retry(eventId, uncertain);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(keys, 1);
  assert.equal(session.snapshot(eventId).receipt.result.releasedCount, 4);
  assert.equal(session.snapshot(otherId).receipt, undefined);
});

test('ADMIN-07 conflito de chave bloqueia reenvio e falha definitiva permite nova confirmação', async () => {
  let count = 0;
  const session = createOperationSession({ async patch() {
    count++;
    throw count === 1 ? { status: 409, code: 'EVENT_REGISTRATION_CLOSED' } :
      { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };
  } }, () => 'key-' + count, () => true);
  await session.start(eventId, queue);
  assert.equal(session.snapshot(eventId).intent, undefined);
  assert.match(session.snapshot(eventId).error, /janela/);
  await session.start(eventId, queue);
  const conflict = session.snapshot(eventId).intent;
  assert.equal(conflict.status, 'conflict');
  await session.retry(eventId, conflict);
  assert.equal(count, 2);
});

test('ADMIN-07 preserva a intenção quando o reenvio não distingue o resultado original', async () => {
  for (const response of [
    { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' },
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 404, code: 'RESOURCE_NOT_FOUND' },
    { status: 429, code: 'HTTP_429' },
    { status: 500, code: 'CLOSURE_DEADLINE_INVALID' },
    { status: 409, code: 'CLOSURE_DEADLINE_INVALID', outcomeUnknown: true },
    { status: 409, code: 'EVENT_REGISTRATION_CLOSED' }, // Não pertence ao POST de encerramento.
  ]) {
    const calls = [];
    const command = prepareEventOperation(view(), controlled('10:30'), Date.parse(at));
    const expectedCall = { url: '/admin/events/' + eventId + '/close', body: plain(command.body), key: 'mesma-chave' };
    const session = createOperationSession({ async post(url, body, options) {
      calls.push({ url, body: plain(body), key: options.headers['Idempotency-Key'] });
      throw calls.length === 1 ? { status: 408, outcomeUnknown: true } : response;
    } }, () => 'mesma-chave', () => true);
    await session.start(eventId, command);
    assert.equal(session.snapshot(eventId).intent.status, 'unknown');
    assert.equal(calls.length, 1);
    await session.retry(eventId, session.snapshot(eventId).intent);
    assert.equal(calls.length, 2, response.code);
    assert.deepEqual(calls[0], expectedCall, response.code);
    assert.deepEqual(calls[1], expectedCall, response.code);
    const { intent } = session.snapshot(eventId);
    assert.equal(intent.status, 'unknown', response.code);
    assert.equal(intent.key, expectedCall.key, response.code);
    assert.deepEqual(plain(intent.body), expectedCall.body, response.code);
    assert.equal(session.snapshot(eventId).receipt, undefined);
    await session.start(eventId, command);
    assert.equal(calls.length, 2);
  }
});

test('ADMIN-07 mantém intenção após expiração sem reenvio e descarta resposta após troca de sessão', async () => {
  let current = { isAuthenticated: true, sessionStatus: 'authenticated', identityStatus: 'verified',
    user: { id: id(10), sessionId: id(11), roles: ['admin'] } };
  let epoch = 0, renewals = 0, calls = 0, keys = 0;
  const hold = deferred();
  const manager = { getSnapshot: () => current, getIdentityRevision: () => 0, getSessionEpoch: () => epoch,
    isIdentityVerified: () => current.identityStatus === 'verified', async refreshSession() { renewals++; },
    client: { async patch() {
      calls++;
      if (calls === 1) throw { status: 401, code: 'ACCESS_TOKEN_EXPIRED' };
      return hold.promise;
    } } };
  const binding = bindOperationSession(manager, () => 'key-' + ++keys, () => true);
  const original = binding.get();
  await original.start(eventId, queue);
  assert.equal(renewals, 1);
  assert.equal(calls, 1);
  current = { ...current, identityStatus: 'checking' };
  binding.sync();
  assert.equal(binding.get(), null);
  current = { ...current, identityStatus: 'verified' };
  assert.equal(binding.get(), original);
  const flight = original.retry(eventId, original.snapshot(eventId).intent);
  epoch++;
  current = { ...current, user: { ...current.user, sessionId: id(12) } };
  binding.sync();
  hold.resolve(queueReceipt());
  await flight;
  assert.equal(keys, 1);
  assert.equal(original.snapshot(eventId).receipt, undefined);
  assert.equal(binding.get().snapshot(eventId).receipt, undefined);
});
