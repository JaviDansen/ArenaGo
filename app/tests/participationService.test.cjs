const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
  name === './httpClient' ? { httpClient: {} } : require(name)).exports;
const identityA = { userId: 'user-a', epoch: 1 };
const identityB = { userId: 'user-b', epoch: 2 };
const active = { id: 'p-1', eventId: 'e-1', status: 'active', externalQueue: null };
const waiting = { id: 'p-2', eventId: 'e-2', status: 'waiting', externalQueue: { position: 3, observedAt: '2026-01-01T00:00:00.000000Z' } };
const returned = { recentFinalization: null, pendingEvaluationParticipationIds: [] };
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function rig(handler) {
  let identity = identityA;
  const calls = [];
  const store = createParticipationStore({
    getIdentity: () => identity,
    client: { get(path, options) { calls.push({ path, options }); return handler(path); } },
  });
  return { store, calls, identity(value) { identity = value; } };
}

test('loads absence and return state using authenticated backend contracts', async () => {
  const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation: null } : returned));
  r.store.setIdentity(identityA);
  await r.store.refresh();
  assert.equal(r.store.getSnapshot().status, 'ready');
  assert.equal(r.store.getSnapshot().participation, null);
  assert.equal(r.store.getSnapshot().returnState, returned);
  assert.deepEqual(r.calls.map((c) => [c.path, c.options.auth]), [
    ['/participations/current', true], ['/participations/return-state', true],
  ]);
});

test('restores active and waiting participation with real queue position', async () => {
  for (const participation of [active, waiting]) {
    const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation } : returned));
    r.store.setIdentity(identityA);
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().participation, participation);
    assert.equal(r.store.getSnapshot().status, 'ready');
  }
});

test('logout invalidates a delayed response and clears all state', async () => {
  const first = deferred(), second = deferred();
  const r = rig((path) => path.endsWith('/current') ? first.promise : second.promise);
  r.store.setIdentity(identityA);
  const pending = r.store.refresh();
  r.identity(null);
  r.store.setIdentity(null);
  first.resolve({ participation: active }); second.resolve(returned);
  await pending;
  assert.equal(r.store.getSnapshot().status, 'idle');
  assert.equal(r.store.getSnapshot().participation, null);
  assert.equal(r.store.getSnapshot().returnState, null);
});

test('epoch change rejects late results even before the provider cleanup', async () => {
  const first = deferred(), second = deferred();
  const r = rig((path) => path.endsWith('/current') ? first.promise : second.promise);
  r.store.setIdentity(identityA);
  const pending = r.store.refresh();
  r.identity({ userId: 'user-a', epoch: 2 });
  first.resolve({ participation: active }); second.resolve(returned);
  await pending;
  assert.equal(r.store.getSnapshot().participation, null);
});

test('switching users prevents previous responses from replacing the new account', async () => {
  const first = deferred(), second = deferred();
  let old = true;
  const r = rig((path) => old ? (path.endsWith('/current') ? first.promise : second.promise)
    : Promise.resolve(path.endsWith('/current') ? { participation: waiting } : returned));
  r.store.setIdentity(identityA);
  const pending = r.store.refresh();
  old = false; r.identity(identityB); r.store.setIdentity(identityB);
  await r.store.refresh();
  first.resolve({ participation: active }); second.resolve(returned);
  await pending;
  assert.equal(r.store.getSnapshot().userId, 'user-b');
  assert.equal(r.store.getSnapshot().participation, waiting);
});

test('401 and network errors clear data and allow retry', async () => {
  for (const [failure, expected] of [[{ status: 401 }, 'authorization'], [{ isNetworkError: true }, 'network']]) {
    let fail = true;
    const r = rig((path) => fail ? Promise.reject(failure) : Promise.resolve(path.endsWith('/current') ? { participation: active } : returned));
    r.store.setIdentity(identityA);
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().error, expected);
    assert.equal(r.store.getSnapshot().participation, null);
    fail = false;
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().participation, active);
  }
});

test('real participation cannot be overwritten by a simulated entry', async () => {
  const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation: active } : returned));
  r.store.setIdentity(identityA);
  await r.store.refresh();
  r.store.setDemoParticipation({ status: 'waiting' });
  assert.equal(r.store.getSnapshot().participation, active);
  assert.equal(r.store.getSnapshot().demoParticipation, null);
});

test('malformed server data is not treated as absence', async () => {
  const r = rig((path) => Promise.resolve(path.endsWith('/current') ? {} : returned));
  r.store.setIdentity(identityA);
  await r.store.refresh();
  assert.equal(r.store.getSnapshot().status, 'error');
  assert.equal(r.store.getSnapshot().error, 'unavailable');
});

test('apresentação é única na retomada, inclusive após refresh e remontagem da Home', async () => {
  const recent = { ...returned, recentFinalization: { participationId: 'p-recent' } };
  const r = rig(path => Promise.resolve(path.endsWith('/current') ? { participation: null } : recent));
  r.store.setIdentity(identityA); await r.store.refresh();
  assert.equal(r.store.canPresentReturnEvaluation(recent), true);
  assert.equal(r.store.claimReturnEvaluation(recent), true);
  assert.equal(r.store.claimReturnEvaluation(recent), false);
  await r.store.refresh();
  assert.equal(r.store.canPresentReturnEvaluation(recent), false);
  r.store.suspend();
  assert.equal(r.store.claimReturnEvaluation(recent), false);
  await r.store.resume();
  assert.equal(r.store.claimReturnEvaluation(recent), true);
});

test('claim recusa leitura antiga, participação corrente, demo e identidade trocada', async () => {
  const recent = { ...returned, recentFinalization: { participationId: 'p-recent' } };
  let current = null;
  const r = rig(path => Promise.resolve(path.endsWith('/current') ? { participation: current } : recent));
  r.store.setIdentity(identityA); await r.store.refresh();
  const version = r.store.getSnapshot().returnStateVersion;
  await r.store.refresh();
  assert.equal(r.store.claimReturnEvaluation(recent, version), false);
  r.store.setDemoParticipation({ status: 'active' });
  assert.equal(r.store.claimReturnEvaluation(recent), false);
  current = active; await r.store.refresh();
  assert.equal(r.store.claimReturnEvaluation(recent), false);
  current = waiting; await r.store.refresh();
  assert.equal(r.store.claimReturnEvaluation(recent), false);
  current = null; await r.store.refresh();
  r.identity(identityB);
  assert.equal(r.store.claimReturnEvaluation(recent), false);
});

const STAFF03_PART_ID = '22222222-2222-4222-8222-222222222222';
const STAFF03_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const STAFF03_CALL_1 = '66666666-6666-4666-8666-000000000001';
const STAFF03_CALL_2 = '66666666-6666-4666-8666-000000000002';
const STAFF03_OTHER_ID = '99999999-9999-4999-8999-999999999999';

test('STAFF-03 syncCurrentSilent detecta surgimento, troca de callId e remoção de externalEntryCall sem mudança de posição', async () => {
  const calledAt1 = '2026-11-10T15:00:00.123456Z';
  const calledAt2 = '2026-11-10T15:05:00.123456Z';
  let currentParticipation = {
    id: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    status: 'waiting',
    externalQueue: { position: 1, observedAt: calledAt1 },
    externalEntryCall: null,
  };
  const snapshots = [];
  const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation: currentParticipation } : returned));
  r.store.subscribe((snap) => snapshots.push(snap));
  r.store.setIdentity(identityA);
  await r.store.refresh();
  assert.equal(r.store.getSnapshot().participation.externalEntryCall, null);

  const countBefore = snapshots.length;
  // Mesmo sem mudar posição (1), chamada externa válida deve disparar atualização silenciosa
  currentParticipation = {
    ...currentParticipation,
    externalEntryCall: {
      callId: STAFF03_CALL_1,
      participationId: STAFF03_PART_ID,
      eventId: STAFF03_EVENT_ID,
      kind: 'external_entry',
      status: 'pending',
      calledAt: calledAt1,
    },
  };
  await r.store.syncCurrentSilent();
  assert.equal(snapshots.length, countBefore + 1);
  assert.equal(r.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);
  assert.equal(r.store.getSnapshot().syncStale, false);

  // Polling repetido idêntico não deve republicar desnecessariamente
  await r.store.syncCurrentSilent();
  assert.equal(snapshots.length, countBefore + 1);

  // Remoção / ausência requeue limpa chamada externa mesmo em waiting posição 1
  currentParticipation = {
    ...currentParticipation,
    externalEntryCall: null,
  };
  await r.store.syncCurrentSilent();
  assert.equal(snapshots.length, countBefore + 2);
  assert.equal(r.store.getSnapshot().participation.externalEntryCall, null);

  // Nova chamada gera novo callId distinto na mesma participação
  currentParticipation = {
    ...currentParticipation,
    externalEntryCall: {
      callId: STAFF03_CALL_2,
      participationId: STAFF03_PART_ID,
      eventId: STAFF03_EVENT_ID,
      kind: 'external_entry',
      status: 'pending',
      calledAt: calledAt2,
    },
  };
  await r.store.syncCurrentSilent();
  assert.equal(snapshots.length, countBefore + 3);
  assert.equal(r.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_2);

  // Confirmação -> active sem externalEntryCall
  currentParticipation = {
    id: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    status: 'active',
    externalQueue: null,
    externalEntryCall: null,
  };
  await r.store.syncCurrentSilent();
  assert.equal(r.store.getSnapshot().participation.status, 'active');
  assert.equal(r.store.getSnapshot().participation.externalEntryCall, null);
});

test('STAFF03-AUD-02 valida estritamente UUIDs, campos obrigatórios, vínculos e timestamp UTC de externalEntryCall', async () => {
  const validCall = {
    callId: STAFF03_CALL_1,
    participationId: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    kind: 'external_entry',
    status: 'pending',
    calledAt: '2026-11-10T15:00:00.123456Z',
  };
  const validWaiting = {
    id: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    status: 'waiting',
    externalQueue: { position: 1, observedAt: '2026-11-10T15:00:00.123456Z' },
    externalEntryCall: validCall,
  };

  // Compatibilidade preservada: campo omitido ou explicitamente null
  for (const compat of [
    { id: STAFF03_PART_ID, eventId: STAFF03_EVENT_ID, status: 'waiting', externalQueue: { position: 1, observedAt: '2026-11-10T15:00:00.123456Z' } },
    { ...validWaiting, externalEntryCall: null },
    validWaiting,
  ]) {
    const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation: compat } : returned));
    r.store.setIdentity(identityA);
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().status, 'ready');
  }

  const { participationId: _omitPart, ...missingParticipationId } = validCall;
  const { eventId: _omitEvent, ...missingEventId } = validCall;
  const { callId: _omitCall, ...missingCallId } = validCall;
  const { calledAt: _omitCalledAt, ...missingCalledAt } = validCall;

  for (const malformed of [
    { id: STAFF03_PART_ID, eventId: STAFF03_EVENT_ID, status: 'active', externalQueue: null, externalEntryCall: validCall },
    { ...validWaiting, externalEntryCall: missingParticipationId },
    { ...validWaiting, externalEntryCall: missingEventId },
    { ...validWaiting, externalEntryCall: missingCallId },
    { ...validWaiting, externalEntryCall: missingCalledAt },
    { ...validWaiting, externalEntryCall: { ...validCall, callId: 'call-1' } },
    { ...validWaiting, externalEntryCall: { ...validCall, participationId: 'p-1' } },
    { ...validWaiting, externalEntryCall: { ...validCall, eventId: 'e-1' } },
    { ...validWaiting, externalEntryCall: { ...validCall, participationId: STAFF03_OTHER_ID } },
    { ...validWaiting, externalEntryCall: { ...validCall, eventId: STAFF03_OTHER_ID } },
    { ...validWaiting, externalEntryCall: { ...validCall, status: 'confirmed' } },
    { ...validWaiting, externalEntryCall: { ...validCall, status: 'absent' } },
    { ...validWaiting, externalEntryCall: { ...validCall, status: 'removed' } },
    { ...validWaiting, externalEntryCall: { ...validCall, status: 'canceled' } },
    { ...validWaiting, externalEntryCall: { ...validCall, kind: 'station' } },
    { ...validWaiting, externalEntryCall: { ...validCall, calledAt: 'invalido' } },
    { ...validWaiting, externalEntryCall: { ...validCall, calledAt: '2026-11-10T15:00:00.000Z' } },
    { ...validWaiting, externalEntryCall: { ...validCall, calledAt: '2026-11-10T15:00:00.123456-03:00' } },
    { ...validWaiting, externalEntryCall: { ...validCall, calledAt: '2026-02-30T15:00:00.123456Z' } },
    { ...validWaiting, externalEntryCall: { ...validCall, staffUserId: STAFF03_OTHER_ID } },
  ]) {
    const r = rig((path) => Promise.resolve(path.endsWith('/current') ? { participation: malformed } : returned));
    r.store.setIdentity(identityA);
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().status, 'error');
    assert.equal(r.store.getSnapshot().error, 'unavailable');
  }
});

test('STAFF03-AUD-01 syncCurrentSilent diferencia falha transitória, payload malformado (syncStale) e 401/403 (limpeza total)', async () => {
  const validCall = {
    callId: STAFF03_CALL_1,
    participationId: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    kind: 'external_entry',
    status: 'pending',
    calledAt: '2026-11-10T15:00:00.123456Z',
  };
  const validWaiting = {
    id: STAFF03_PART_ID,
    eventId: STAFF03_EVENT_ID,
    status: 'waiting',
    externalQueue: { position: 1, observedAt: '2026-11-10T15:00:00.123456Z' },
    externalEntryCall: validCall,
  };

  // A + B: Rede e payload malformado preservam último estado válido, sinalizam syncStale: true e recuperam depois
  let mode = 'valid';
  const r = rig((path) => {
    if (!path.endsWith('/current')) return Promise.resolve(returned);
    if (mode === 'network') return Promise.reject({ isNetworkError: true });
    if (mode === 'malformed') {
      return Promise.resolve({ participation: { ...validWaiting, externalEntryCall: { ...validCall, callId: 'nao-uuid' } } });
    }
    return Promise.resolve({ participation: validWaiting });
  });
  r.store.setIdentity(identityA);
  await r.store.refresh();
  assert.equal(r.store.getSnapshot().syncStale, false);
  assert.equal(r.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);

  mode = 'malformed';
  await r.store.syncCurrentSilent();
  assert.equal(r.store.getSnapshot().status, 'ready');
  assert.equal(r.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);
  assert.equal(r.store.getSnapshot().syncStale, true);

  mode = 'valid';
  await r.store.syncCurrentSilent();
  assert.equal(r.store.getSnapshot().syncStale, false);

  mode = 'network';
  await r.store.syncCurrentSilent();
  assert.equal(r.store.getSnapshot().status, 'ready');
  assert.equal(r.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);
  assert.equal(r.store.getSnapshot().syncStale, true);

  mode = 'valid';
  await r.store.syncCurrentSilent();
  assert.equal(r.store.getSnapshot().syncStale, false);

  // C: HTTP 401 e 403 em /participations/current limpam estado protegido e impedem restauração por resposta atrasada
  for (const statusCode of [401, 403]) {
    let currentHandler = () => Promise.resolve({ participation: validWaiting });
    const authRig = rig((path) => (path.endsWith('/current') ? currentHandler() : Promise.resolve(returned)));
    authRig.store.setIdentity(identityA);
    await authRig.store.refresh();
    assert.equal(authRig.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);

    currentHandler = () => Promise.reject({ status: statusCode });
    await authRig.store.syncCurrentSilent();
    assert.equal(authRig.store.getSnapshot().status, 'error');
    assert.equal(authRig.store.getSnapshot().error, 'authorization');
    assert.equal(authRig.store.getSnapshot().participation, null);
    assert.equal(authRig.store.getSnapshot().returnState, null);
    assert.equal(authRig.store.getSnapshot().syncStale, false);

    // Após nova autorização válida, refresh recupera normalmente
    currentHandler = () => Promise.resolve({ participation: validWaiting });
    await authRig.store.refresh();
    assert.equal(authRig.store.getSnapshot().status, 'ready');
    assert.equal(authRig.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);
  }

  // C2: HTTP 401/403 na leitura de /participations/return-state durante transição prev -> null também limpa estado protegido
  for (const statusCode of [401, 403]) {
    let currentVal = validWaiting;
    let returnHandler = () => Promise.resolve(returned);
    const transRig = rig((path) => (path.endsWith('/current') ? Promise.resolve({ participation: currentVal }) : returnHandler()));
    transRig.store.setIdentity(identityA);
    await transRig.store.refresh();
    assert.equal(transRig.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);

    currentVal = null;
    returnHandler = () => Promise.reject({ status: statusCode });
    await transRig.store.syncCurrentSilent();
    assert.equal(transRig.store.getSnapshot().status, 'error');
    assert.equal(transRig.store.getSnapshot().error, 'authorization');
    assert.equal(transRig.store.getSnapshot().participation, null);
    assert.equal(transRig.store.getSnapshot().returnState, null);
    assert.equal(transRig.store.getSnapshot().syncStale, false);
  }

  // Isolamento entre contas: resposta atrasada da conta A não altera a conta B após troca
  const slowA = deferred();
  let useSlow = false;
  const isoRig = rig((path) => {
    if (!path.endsWith('/current')) return Promise.resolve(returned);
    if (useSlow) return slowA.promise;
    return Promise.resolve({ participation: validWaiting });
  });
  isoRig.store.setIdentity(identityA);
  await isoRig.store.refresh();
  useSlow = true;
  const pendingSyncA = isoRig.store.syncCurrentSilent();
  useSlow = false;
  isoRig.identity(identityB);
  isoRig.store.setIdentity(identityB);
  await isoRig.store.refresh();
  slowA.reject({ status: 401 });
  await pendingSyncA;
  assert.equal(isoRig.store.getSnapshot().userId, 'user-b');
  assert.equal(isoRig.store.getSnapshot().status, 'ready');
  assert.equal(isoRig.store.getSnapshot().participation.externalEntryCall.callId, STAFF03_CALL_1);
});
