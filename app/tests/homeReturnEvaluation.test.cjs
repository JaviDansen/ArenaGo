const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const history = loadModule('services/participationHistoryService.js', require).exports;
const { createParticipationStore } = loadModule('services/participationService.js', name =>
  name === './httpClient' ? { httpClient: {} } : require(name)).exports;
const ID = 'c79b25f1-b171-487f-9fee-a24d184054b5';
const EVENT = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const item = { participationId: ID, event: { id: EVENT, name: 'Evento real' }, status: 'finished',
  joinedAt: '2026-11-01T12:00:00.000000Z', arenaEnteredAt: '2026-11-01T12:05:00.000000Z',
  finishedAt: '2026-11-01T14:00:00.000000Z', finishReason: 'automatic_operational_deadline',
  completedServicesCount: 1, evaluation: { eligible: true, submitted: false, pending: true } };
const returned = { recentFinalization: { participationId: ID, eventId: EVENT,
  finishedAt: item.finishedAt, finishReason: item.finishReason }, pendingEvaluationParticipationIds: [ID] };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; }

function rig({ current = null, returnState = returned, read } = {}) {
  let identity = { userId: 'a', epoch: 1 }, verified = true, focused = true;
  let cursor = 0, dirty = false, tree;
  const hooks = [], effects = [], calls = [], reads = [];
  const client = { async get(path, options) {
    assert.equal(options.auth, true); reads.push(path);
    if (path.endsWith('/current')) return { participation: current };
    if (path.endsWith('/return-state')) return returnState;
    if (read) return read(path);
    return path.endsWith('/evaluation-eligibility') ? { participationId: ID, ...item.evaluation }
      : { items: [item], nextCursor: null };
  } };
  let auth = { isAuthenticated: true, identityStatus: 'verified', user: { id: 'a' }, httpClient: client,
    getSessionEpoch: () => identity?.epoch, isIdentityVerified: () => verified };
  const store = createParticipationStore({ client, getIdentity: () => identity });
  store.setIdentity(identity); store.subscribe(() => { dirty = true; });
  const context = () => ({ ...store.getSnapshot(), participation: store.getSnapshot().participation,
    refreshParticipation: store.refresh, canPresentReturnEvaluation: store.canPresentReturnEvaluation,
    claimReturnEvaluation: store.claimReturnEvaluation });
  const react = {
    useContext: () => context(),
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => { hooks[i] = value; dirty = true; }]; },
    useEffect(fn, deps) {
      const i = cursor++, old = hooks[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
        hooks[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  const navigation = { getParent: () => ({ navigate(name, params) { calls.push({ name, params }); focused = false; dirty = true; } }) };
  const screen = loadModule('screens/home/HomeFlowScreen.js', name => {
    if (name === 'react') return react;
    if (name === '@react-navigation/native') return { useIsFocused: () => focused };
    if (name === 'react-native') return { StyleSheet: { create: v => v } };
    if (name === 'expo-status-bar') return {};
    if (name === '../../context/AuthContext') return { useAuth: () => auth };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../../services/participationHistoryService') return history;
    if (name === '../../components/ui') return {};
    if (name.startsWith('../arena/') || name === './HomeScreen') return { __esModule: true, default: name.split('/').at(-1) };
    return require(name);
  }).exports;
  function flush() {
    let loops = 0;
    do {
      assert.ok(loops++ < 15, 'loop de renderização/navegação');
      dirty = false; cursor = 0; tree = screen.default({ navigation });
      while (effects.length) effects.shift()();
    } while (dirty);
  }
  return {
    store, calls, reads, context, get auth() { return auth; }, get tree() { return tree; },
    async start() { await store.refresh(); flush(); },
    async settle() { await tick(); flush(); await tick(); flush(); },
    focus(value) { focused = value; flush(); },
    verify(value) { verified = value; auth = { ...auth, identityStatus: value ? 'verified' : 'checking' }; flush(); },
    invalidate(value) { identity = value; },
    async refresh() { await store.refresh(); flush(); },
    later() { focused = true; flush(); },
  };
}

test('retomada navega uma vez para RealEvaluation com dados reais revalidados', async () => {
  const r = rig(); await r.start();
  assert.equal(r.tree.props.mode, 'loading');
  assert.equal(r.calls.length, 0);
  await r.settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].name, 'RealEvaluation');
  assert.equal(r.calls[0].params.historyItem, item);
  assert.equal(r.calls[0].params.participationId, ID);
});

test('Avaliar mais tarde real retorna sem loop, mesmo após refresh e novo foco', async () => {
  const r = rig(); await r.start(); await r.settle();
  const evaluation = loadModule('screens/participation/RealEvaluationScreen.js', name => {
    if (name === 'react') return { useCallback: fn => fn, useContext: r.context, useEffect() {},
      useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}] };
    if (name === 'react-native') return { StyleSheet: { create: v => v } };
    if (name === 'expo-status-bar' || name === 'expo-crypto' || name === '../../components/ui') return {};
    if (name === '../../context/AuthContext') return { useAuth: () => r.auth };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../../services/participationHistoryService') return history;
    if (name === '../../services/participationActionService') return { createParticipationActionCoordinator: () => ({}) };
    if (name === '../../theme') return { spacing: { layout: {} }, typography: {}, colors: { text: {} } };
    if (name === './EvaluationScreen') return { __esModule: true, default: 'EvaluationScreen' };
    return require(name);
  }).exports.default({ route: { params: r.calls[0].params }, navigation: { goBack: () => r.later() } });
  assert.equal(evaluation.props.real, true);
  evaluation.props.onLater(); await r.settle(); await r.refresh(); await r.settle();
  r.focus(false); r.focus(true); await r.settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.tree.type, 'HomeScreen');
  assert.equal(r.tree.props.returnState.pendingEvaluationParticipationIds[0], ID);
});

test('finalização sem elegibilidade mantém aviso de encerramento na Home', async () => {
  const r = rig({ read: async () => ({ participationId: ID, eligible: false, submitted: false, pending: false }) });
  await r.start(); await r.settle();
  assert.equal(r.calls.length, 0);
  assert.equal(r.tree.type, 'HomeScreen');
  assert.equal(r.tree.props.returnState.recentFinalization.participationId, ID);
  assert.equal(r.tree.props.returnState.pendingEvaluationParticipationIds.length, 0);
});

test('nova retomada permite nova apresentação após adiamento, com leituras novas', async () => {
  const r = rig(); await r.start(); await r.settle();
  r.later(); await r.settle();
  const previousReads = r.reads.length;
  r.store.suspend(); await r.store.resume(); await r.settle();
  assert.equal(r.calls.length, 2);
  assert.equal(r.reads.length, previousReads + 4);
});

test('pendências antigas sem relação com a finalização continuam somente no histórico/atalho', async () => {
  const other = '886c0487-5710-427a-a6ba-a5b1d2b01d72';
  for (const returnState of [{ ...returned, pendingEvaluationParticipationIds: [other] },
    { recentFinalization: null, pendingEvaluationParticipationIds: [other] }]) {
    const r = rig({ returnState }); await r.start(); await r.settle();
    assert.equal(r.calls.length, 0); assert.equal(r.reads.length, 2);
    assert.equal(r.tree.props.returnState.pendingEvaluationParticipationIds[0], other);
  }
});

test('erro de elegibilidade ou histórico não abre avaliação e permite retry por leitura', async () => {
  for (const failingPath of ['eligibility', 'history']) {
    let failing = true;
    const r = rig({ read: async path => {
      if (failing && path.includes(failingPath)) throw new Error('rede');
      return path.endsWith('/evaluation-eligibility') ? { participationId: ID, ...item.evaluation }
        : { items: [item], nextCursor: null };
    } });
    await r.start(); await r.settle();
    assert.equal(r.calls.length, 0); assert.equal(r.tree.props.mode, 'error');
    failing = false; await r.tree.props.onRetry(); await r.settle();
    assert.equal(r.calls.length, 1);
  }
});

test('sessão, conta, foco e identidade incerta descartam elegibilidade atrasada', async () => {
  for (const invalidate of [r => r.invalidate(null), r => r.invalidate({ userId: 'b', epoch: 2 }),
    r => r.invalidate({ userId: 'a', epoch: 2 }), r => r.focus(false), r => r.verify(false)]) {
    const delayed = deferred();
    const r = rig({ read: () => delayed.promise });
    await r.start(); invalidate(r);
    delayed.resolve({ participationId: ID, ...item.evaluation }); await r.settle();
    assert.equal(r.calls.length, 0);
  }
});

test('retomada seguinte invalida respostas anteriores mesmo se o objeto de retorno for reutilizado', async () => {
  const delayed = deferred(); let first = true;
  const r = rig({ read: async path => {
    if (first) return delayed.promise;
    return path.endsWith('/evaluation-eligibility') ? { participationId: ID, ...item.evaluation }
      : { items: [item], nextCursor: null };
  } });
  await r.start(); r.store.suspend(); first = false; await r.store.resume();
  delayed.resolve({ participationId: ID, ...item.evaluation }); await r.settle();
  assert.equal(r.calls.length, 1);
});

test('logout durante leitura do histórico descarta os dados da participação anterior', async () => {
  const delayed = deferred();
  const r = rig({ read: path => path.endsWith('/evaluation-eligibility')
    ? { participationId: ID, ...item.evaluation } : delayed.promise });
  await r.start(); await r.settle();
  assert.ok(r.reads.includes('/participations/history?limit=50'));
  r.invalidate(null); delayed.resolve({ items: [item], nextCursor: null }); await r.settle();
  assert.equal(r.calls.length, 0);
});

test('participação ativa e fila externa impedem apresentação de finalização anterior', async () => {
  for (const current of [
    { id: 'active', eventId: EVENT, status: 'active', source: 'server' },
    { id: 'waiting', eventId: EVENT, status: 'waiting', source: 'server', externalQueue: { position: 1 } },
  ]) {
    const r = rig({ current }); await r.start(); await r.settle();
    assert.equal(r.calls.length, 0);
    assert.equal(r.reads.length, 2);
    assert.equal(r.tree.type === 'RealArenaScreen' || r.tree.type.name === 'ExternalQueueScreen', true);
  }
});
