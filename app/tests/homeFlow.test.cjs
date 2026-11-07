const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

function renderHomeFlow(participation, extra = {}) {
  let contextWrites = 0;
  const navigation = { navigate() {} };
  const screen = loadModule('screens/home/HomeFlowScreen.js', (name) => {
    if (name === 'react') return {
      useContext: () => ({
        participation,
        ...extra,
        setParticipation() { contextWrites += 1; },
      }),
    };
    if (name === 'react-native') return { Pressable: 'Pressable', Text: 'Text' };
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
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
  return { contextWrites, navigation, participation, rendered };
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
  const result = renderHomeFlow({ source: 'server', status: 'waiting', eventId: 'event-a', externalQueue: { position: 2 } }, { status: 'ready' });
  assert.equal(result.rendered.type, 'ScreenContainer');
  assert.equal(result.contextWrites, 0);
});

test('HomeFlow keeps loading and error states out of simulated navigation', () => {
  for (const status of ['loading', 'error']) {
    const result = renderHomeFlow(null, { status, error: 'network', refreshParticipation() {} });
    assert.equal(result.rendered.type, 'ScreenContainer');
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
