const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
  name === './httpClient' ? { httpClient: {} } : require(name)).exports;

function providerRig() {
  let auth = null;
  let epoch = 0;
  let cursor = 0;
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
    if (name === './AuthContext') return { useAuth: () => auth };
    if (name === '../services/participationService') return { createParticipationStore };
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
