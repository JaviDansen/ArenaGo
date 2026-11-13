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
