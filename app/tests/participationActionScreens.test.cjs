const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadModule, nodes, textOf, createParticipantUiStubs, createParticipantThemeStub,
} = require('./helpers/questionnaireHarness.cjs');

const ID = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT = '11111111-1111-4111-8111-111111111111';
const item = { participationId: ID, event: { id: EVENT, name: 'Arena' }, status: 'finished',
  joinedAt: '2026-11-08T10:00:00.000000Z', arenaEnteredAt: '2026-11-08T10:01:00.000000Z',
  finishedAt: '2026-11-08T11:00:00.000000Z', finishReason: 'voluntary', completedServicesCount: 1,
  evaluation: { eligible: true, submitted: false, pending: true } };
const native = { Pressable: 'Pressable', FlatList: 'FlatList', ScrollView: 'ScrollView',
  Text: 'Text', View: 'View', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: value => value } };
const nav = calls => ({ navigate: (...args) => calls.push(args) });
const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && textOf(node) === label);

test('histórico real oferece Avaliar evento somente para avaliação pendente', () => {
  const calls = [];
  const screen = loadModule('screens/participation/ParticipationsRealScreen.js', name => {
    if (name === 'react') return {
      useContext: () => ({ isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => 1 }),
      useRef: value => ({ current: value }), useState: () => [{ items: [item], nextCursor: null,
        status: 'ready', loadingMore: false, error: null }, () => {}], useCallback: fn => fn,
    };
    if (name === '@react-navigation/native') return { useFocusEffect: () => {} };
    if (name === 'react-native') return native;
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../components/ParticipationCard') return { __esModule: true, default: 'ParticipationCard' };
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/AuthContext') return { AuthContext: {} };
    if (name === '../../utils/evaluation') return {
      EVALUATION_SITUATIONS: { PENDING: 'pending' },
      getEvaluationSituation: value => value.evaluation.pending ? 'pending' : 'evaluated',
      getPendingEvaluationParticipations: values => values.filter(value => value.evaluation.pending),
    };
    if (name === '../../services/participationHistoryService') return {
      toParticipationCardItem: value => ({ ...value, id: value.participationId }),
    };
    return require(name);
  }).exports.default;
  const tree = screen({ navigation: nav(calls) });
  const list = nodes(tree).find(node => node.type === 'FlatList');
  const pendingRow = list.props.renderItem({ item: { ...item, id: ID } });
  button(pendingRow, 'Avaliar evento').props.onPress();
  assert.equal(calls[0][0], 'RealEvaluation');
  assert.equal(calls[0][1].participationId, ID);
  assert.equal(calls[0][1].historyItem, item);
  const evaluatedRow = list.props.renderItem({ item: { ...item, id: ID,
    evaluation: { eligible: true, submitted: true, pending: false } } });
  assert.equal(button(evaluatedRow, 'Avaliar evento'), undefined);
});

test('detalhes reais oferecem avaliação pendente e bloqueiam a já enviada', () => {
  const calls = [];
  const screen = loadModule('screens/participation/ParticipationRealDetailsScreen.js', name => {
    if (name === 'react') return {
      useContext: () => ({ isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => 1 }),
      useEffect: () => {}, useState: initial => [initial, () => {}],
    };
    if (name === 'react-native') return native;
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/AuthContext') return { AuthContext: {} };
    if (name === '../../services/participationHistoryService') return { validateHistoryItem: () => true };
    if (name === '../../utils/participation') return { formatStayDuration: () => '59 minutos' };
    return require(name);
  }).exports.default;
  const pending = screen({ route: { params: { historyItem: item, participationId: ID } }, navigation: nav(calls) });
  button(pending, 'Avaliar evento').props.onPress();
  assert.equal(calls[0][0], 'RealEvaluation');
  const submitted = screen({ route: { params: { historyItem: { ...item,
    evaluation: { eligible: true, submitted: true, pending: false } }, participationId: ID } }, navigation: nav(calls) });
  assert.equal(button(submitted, 'Avaliar evento'), undefined);
});

test('Arena real exige confirmação e bloqueia duas finalizações simultâneas', async () => {
  const alerts = [];
  let finishes = 0, refreshes = 0, stateIndex = 0, releaseFinish;
  const arena = { experiences: [], currentQueueEntry: null, pendingIntent: null };
  const screen = loadModule('screens/arena/RealArenaScreen.js', name => {
    if (name === 'react') return {
      useRef: value => ({ current: value }), useMemo: factory => factory(), useCallback: fn => fn,
      useState(initial) {
        const index = stateIndex++;
        return [index === 0 ? arena : index === 2 ? false : initial, () => {}];
      },
    };
    if (name === '@react-navigation/native') return { useFocusEffect: callback => callback() };
    if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    if (name === 'react-native') return { ...native, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/AuthContext') return { useAuth: () => ({ isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => 1 }) };
    if (name === '../../services/arenaQueueService') return {
      createArenaQueueCoordinator: () => ({ read: async () => arena }), describeArenaError: () => 'erro',
    };
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') return {
      createParticipationActionCoordinator: () => ({ finish: () => {
        finishes += 1;
        return new Promise(resolve => { releaseFinish = resolve; });
      } }),
      describeParticipationActionError: () => 'erro',
    };
    if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
    return require(name);
  }).exports.default;
  const tree = screen({ participation: { id: ID, eventId: EVENT },
    refreshParticipation: async () => { refreshes += 1; } });
  const leave = button(tree, 'Sair da Arena');
  assert.ok(leave);
  assert.equal(finishes, 0);
  leave.props.onPress();
  assert.equal(alerts.length, 1);
  assert.equal(finishes, 0);
  const first = alerts[0][2][1].onPress();
  const second = alerts[0][2][1].onPress();
  assert.equal(finishes, 1);
  releaseFinish();
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
});

function realArenaExitHarness(lookup, waitForFinish = async () => {}) {
  const alerts = [], events = [];
  const arena = { experiences: [], currentQueueEntry: null, pendingIntent: null };
  let stateIndex = 0, epoch = 1, blur = () => {};
  const screen = loadModule('screens/arena/RealArenaScreen.js', name => {
    if (name === 'react') return {
      useRef: value => ({ current: value }), useMemo: factory => factory(), useCallback: fn => fn,
      useState(initial) { const index = stateIndex++; return [index === 0 ? arena : index === 2 ? false : initial, () => {}]; },
    };
    if (name === '@react-navigation/native') return { useFocusEffect: callback => { blur = callback(); } };
    if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    if (name === 'react-native') return { ...native, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') return { useAuth: () => ({
      isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => epoch,
    }) };
    if (name === '../../services/arenaQueueService') return {
      createArenaQueueCoordinator: () => ({ read: async () => arena }), describeArenaError: () => 'erro',
    };
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') return {
      createParticipationActionCoordinator: ({ isCurrent }) => ({ finish: async () => {
        events.push('finish');
        await waitForFinish();
        if (!isCurrent()) throw new Error('sessão alterada');
      } }),
      describeParticipationActionError: () => 'erro',
    };
    if (name === '../../services/participationHistoryService') return {
      fetchPendingEvaluationHistoryItem: async (...args) => { events.push('lookup'); return lookup(...args); },
    };
    return require(name);
  }).exports.default;
  const tree = screen({ participation: { id: ID, eventId: EVENT },
    refreshParticipation: async () => { events.push('refresh'); },
    onOpenEvaluation: value => { events.push(value); } });
  button(tree, 'Sair da Arena').props.onPress();
  return { events, confirm: alerts[0][2][1].onPress, blur: () => blur(), changeSession: () => { epoch += 1; } };
}

test('saída real abre uma vez o item pendente e atualiza a participação', async () => {
  const h = realArenaExitHarness(async () => item);
  await h.confirm();
  await h.confirm();
  assert.deepEqual(h.events, ['finish', 'lookup', item, 'refresh']);
});

test('falha ou ausência de avaliação após saída atualiza sem repetir finish', async () => {
  for (const lookup of [async () => null, async () => { throw new Error('rede'); }]) {
    const h = realArenaExitHarness(lookup);
    await h.confirm();
    await h.confirm();
    assert.deepEqual(h.events, ['finish', 'lookup', 'refresh']);
  }
});

test('item de histórico de outro evento não abre avaliação', async () => {
  const h = realArenaExitHarness(async () => ({ ...item, event: { ...item.event, id: USER } }));
  await h.confirm();
  assert.deepEqual(h.events, ['finish', 'lookup', 'refresh']);
});

test('avaliar mais tarde na rota real retorna à tela anterior', () => {
  let backs = 0;
  const screen = loadModule('screens/participation/RealEvaluationScreen.js', name => {
    if (name === 'react') return {
      useCallback: fn => fn, useContext: () => ({ refreshParticipation: async () => {} }),
      useEffect: () => {}, useMemo: factory => factory(), useRef: value => ({ current: value }),
      useState: initial => [initial, () => {}],
    };
    if (name === 'react-native') return native;
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') return { useAuth: () => ({
      isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => 1,
    }) };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../../services/participationActionService') return {
      createParticipationActionCoordinator: () => ({}), describeParticipationActionError: () => 'erro',
    };
    if (name === '../../services/participationHistoryService') return { validateHistoryItem: () => true };
    if (name === './EvaluationScreen') return { __esModule: true, default: 'EvaluationScreen' };
    return require(name);
  }).exports.default;
  const tree = screen({ navigation: { goBack: () => { backs += 1; } }, route: { params: { participationId: ID, historyItem: item } } });
  assert.equal(tree.type, 'EvaluationScreen');
  tree.props.onLater();
  assert.equal(backs, 1);
});

test('perda de foco durante consulta impede navegação e ainda atualiza a sessão original', async () => {
  let release;
  const h = realArenaExitHarness(() => new Promise(resolve => { release = resolve; }));
  const result = h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  h.blur();
  release(item);
  await result;
  assert.deepEqual(h.events, ['finish', 'lookup', 'refresh']);
});

test('troca de sessão durante consulta descarta navegação e atualização tardia', async () => {
  let release;
  const h = realArenaExitHarness(() => new Promise(resolve => { release = resolve; }));
  const result = h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  h.changeSession();
  release(item);
  await result;
  assert.deepEqual(h.events, ['finish', 'lookup']);
});

test('saída confirmada após perder foco atualiza participação sem abrir avaliação', async () => {
  let releaseFinish;
  const h = realArenaExitHarness(async () => item, () => new Promise(resolve => { releaseFinish = resolve; }));
  const result = h.confirm();
  h.blur();
  releaseFinish();
  await result;
  assert.deepEqual(h.events, ['finish', 'refresh']);
});

test('troca de sessão durante finish descarta o resultado tardio', async () => {
  let releaseFinish;
  const h = realArenaExitHarness(async () => item, () => new Promise(resolve => { releaseFinish = resolve; }));
  const result = h.confirm();
  h.changeSession();
  releaseFinish();
  await result;
  assert.deepEqual(h.events, ['finish']);
});
