const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
  name === './httpClient' ? { httpClient: {} } : require(name)).exports;

function providerRig() {
  let auth = null;
  let epoch = 0;
  let cursor = 0;
  let appState = 'active';
  const appStateListeners = new Set();
  const hooks = [], pending = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useRef(value) { const i = cursor++; return hooks[i] ||= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], (next) => { hooks[i] = next; }]; },
    useEffect(fn, deps) {
      const i = cursor++, previous = hooks[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        hooks[i] = { deps, cleanup: previous?.cleanup };
        pending.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  const module = loadModule('context/ParticipationContext.js', (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return { AppState: {
      get currentState() { return appState; },
      addEventListener(event, listener) { appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) }; },
    } };
    if (name === './AuthContext') return { useAuth: () => auth };
    if (name === '../services/participationService') return { createParticipationStore };
    if (name === '../services/eventAdmissionService') return {
      createEventAdmissionStore: () => {
        let state = { userId: null, epoch: null, status: 'idle' };
        const listeners = new Set();
        return {
          getSnapshot: () => state,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          setIdentity(identity) {
            state = { userId: identity?.userId ?? null, epoch: identity?.epoch ?? null, status: 'idle' };
            listeners.forEach((listener) => listener(state));
          },
          lookup: async () => ({ kind: 'stale' }),
          confirm: async () => ({ kind: 'stale' }),
          retrySync: async () => ({ kind: 'stale' }),
          isCurrent: () => Boolean(state.userId),
        };
      },
    };
    return require(name);
  }).exports;
  const render = () => { cursor = 0; return module.ParticipationProvider({ children: null }).props.value; };
  return {
    render,
    effects() { while (pending.length) pending.shift()(); },
    authenticate(userId, client) {
      epoch += 1;
      auth = { isAuthenticated: true, user: { id: userId }, httpClient: client, getSessionEpoch: () => epoch };
    },
    logout() { epoch += 1; auth = { isAuthenticated: false, getSessionEpoch: () => epoch }; },
    appState(value) { appState = value; appStateListeners.forEach(listener => listener(value)); },
  };
}

test('provider restores participation after session restoration and hides it immediately on logout', async () => {
  const r = providerRig();
  const participation = { id: 'p-a', eventId: 'e-a', status: 'active', externalQueue: null };
  const client = { get: async (path) => path.endsWith('/current') ? { participation } : { recentFinalization: null, pendingEvaluationParticipationIds: [] } };
  r.render(); r.effects();
  r.authenticate('a', client);
  assert.equal(r.render().status, 'loading');
  r.effects();
  await new Promise((resolve) => setImmediate(resolve));
  const ready = r.render();
  assert.equal(ready.participation.id, 'p-a');
  assert.equal(ready.participation.source, 'server');
  r.logout();
  assert.equal(r.render().participation, null);
  r.effects();
  assert.equal(r.render().status, 'idle');
});

test('provider invalida retorno no background e reconsulta ao retomar', async () => {
  const r = providerRig();
  let reads = 0;
  const client = { async get(path) {
    reads += 1;
    return path.endsWith('/current') ? { participation: null }
      : { recentFinalization: null, pendingEvaluationParticipationIds: [] };
  } };
  r.authenticate('a', client); r.render(); r.effects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.render().status, 'ready');
  r.appState('background');
  assert.equal(r.render().status, 'loading');
  assert.equal(r.render().returnState, null);
  r.appState('active');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.render().status, 'ready');
  assert.equal(reads, 4);
});

test('estado nativo inicial desconhecido não bloqueia restauração da participação', async () => {
  const r = providerRig();
  r.appState(null);
  r.authenticate('a', { get: async path => path.endsWith('/current') ? { participation: null }
    : { recentFinalization: null, pendingEvaluationParticipationIds: [] } });
  r.render(); r.effects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.render().status, 'ready');
});

test('provider masks the previous account before the identity-change effect runs', async () => {
  const r = providerRig();
  const client = { get: async (path) => path.endsWith('/current')
    ? { participation: { id: 'old', eventId: 'event', status: 'active', externalQueue: null } }
    : { recentFinalization: null, pendingEvaluationParticipationIds: [] } };
  r.authenticate('a', client); r.render(); r.effects();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.render().participation.id, 'old');
  r.authenticate('b', client);
  const switched = r.render();
  assert.equal(switched.participation, null);
  assert.equal(switched.returnState, null);
  assert.equal(switched.status, 'loading');
});
