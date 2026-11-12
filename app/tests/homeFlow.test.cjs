const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, createParticipantUiStubs } = require('./helpers/questionnaireHarness.cjs');

function renderHomeFlow(participation, extra = {}) {
  let contextWrites = 0;
  const navigationCalls = [];
  const navigation = { navigate: (...args) => navigationCalls.push(args) };
  const screen = loadModule('screens/home/HomeFlowScreen.js', (name) => {
    if (name === '@react-navigation/native') return { useIsFocused: () => true };
    if (name === 'react') return {
      useContext: () => ({
        participation,
        ...extra,
        setParticipation() { contextWrites += 1; },
      }),
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
    };
    if (name === 'react-native') return {
      Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles) => styles },
    };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../arena/RealArenaScreen') {
      return { __esModule: true, default: 'RealArenaScreen' };
    }
    if (name === '../arena/ActiveArenaScreen') {
      return { __esModule: true, default: 'ActiveArenaScreen' };
    }
    if (name === '../arena/ArenaQueueScreen') {
      return { __esModule: true, default: 'ArenaQueueScreen' };
    }
    if (name === './HomeScreen') return { __esModule: true, default: 'HomeScreen' };
    return require(name);
  });
  const rendered = screen.exports.default({ navigation });
  return { contextWrites, navigation, navigationCalls, participation, rendered };
}

function assertReadOnlySelection(result, expectedType, initialParticipation) {
  assert.equal(result.rendered.type, expectedType);
  assert.equal(result.contextWrites, 0);
  assert.equal(result.participation, initialParticipation);
}

test('HomeFlow renders HomeScreen when there is no participation', () => {
  const result = renderHomeFlow(null);
  assertReadOnlySelection(result, 'HomeScreen', null);
  assert.equal(result.rendered.props.navigation, result.navigation);
});

test('HomeFlow shows a real participation without routing to simulated Arena screens', () => {
  const participation = { source: 'server', status: 'waiting', eventId: 'event-a', externalQueue: { position: 2 } };
  const refreshParticipation = () => {};
  const result = renderHomeFlow(participation, { status: 'ready', refreshParticipation });
  assert.equal(result.rendered.type.name, 'ExternalQueueScreen');
  assert.equal(result.rendered.props.participation, participation);
  assert.equal(result.rendered.props.onRefresh, refreshParticipation);
  assert.equal(result.contextWrites, 0);
});

test('HomeFlow renders the real Arena for an active server participation', () => {
  const participation = { source: 'server', id: 'participation-a', status: 'active', eventId: 'event-a' };
  const refreshParticipation = () => {};
  const result = renderHomeFlow(participation, { status: 'ready', refreshParticipation });
  assert.equal(result.rendered.type, 'RealArenaScreen');
  assert.equal(result.rendered.props.participation, participation);
  assert.equal(result.rendered.props.refreshParticipation, refreshParticipation);
  assert.equal(result.contextWrites, 0);
});

test('HomeFlow encaminha a avaliação real para o stack raiz', () => {
  const participation = { source: 'server', id: 'participation-a', status: 'active', eventId: 'event-a' };
  const result = renderHomeFlow(participation, { status: 'ready', refreshParticipation() {} });
  const calls = [];
  result.navigation.getParent = () => ({ navigate: (...args) => calls.push(args) });
  const historyItem = { participationId: participation.id };
  result.rendered.props.onOpenEvaluation(historyItem);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'RealEvaluation');
  assert.equal(calls[0][1].participationId, participation.id);
  assert.equal(calls[0][1].historyItem, historyItem);
});

test('pendência no estado de retorno não abre avaliação ao renderizar a Home', () => {
  const result = renderHomeFlow(null, { status: 'ready', returnState: { pendingEvaluationParticipationIds: ['participation-a'] } });
  assert.equal(result.rendered.type, 'HomeScreen');
  assert.deepEqual(result.navigationCalls, []);
});

test('HomeFlow keeps loading and error states out of simulated navigation', () => {
  for (const status of ['loading', 'error']) {
    const refreshParticipation = () => {};
    const result = renderHomeFlow(null, { status, error: 'network', refreshParticipation });
    assert.equal(result.rendered.type, 'HomeScreen');
    assert.equal(result.rendered.props.mode, status);
    if (status === 'error') {
      assert.equal(result.rendered.props.message, 'Não foi possível conectar ao servidor para consultar sua participação.');
      assert.equal(result.rendered.props.onRetry, refreshParticipation);
    }
    assert.equal(result.contextWrites, 0);
  }
});

test('HomeFlow renders ArenaQueueScreen for a waiting participation', () => {
  const participation = Object.freeze({ id: 'participation-1', status: 'waiting' });
  const result = renderHomeFlow(participation);
  assertReadOnlySelection(result, 'ArenaQueueScreen', participation);
});

test('HomeFlow renders ActiveArenaScreen for an active participation', () => {
  const participation = Object.freeze({ id: 'participation-2', status: 'active' });
  const result = renderHomeFlow(participation);
  assertReadOnlySelection(result, 'ActiveArenaScreen', participation);
  assert.equal(result.rendered.props.navigation, result.navigation);
});

test('HomeFlow renders HomeScreen for a finished participation', () => {
  const participation = Object.freeze({ id: 'participation-3', status: 'finished' });
  const result = renderHomeFlow(participation);
  assertReadOnlySelection(result, 'HomeScreen', participation);
  assert.equal(result.rendered.props.navigation, result.navigation);
});
