const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const participationSource = readFileSync(path.join(__dirname, '../utils/participation.js'), 'utf8');
const participationModule = import(
  `data:text/javascript;base64,${Buffer.from(participationSource).toString('base64')}`
);

const reactNative = {
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles) => styles },
  Text: 'Text',
};

function nodes(element) {
  if (element == null || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== 'object' || !element.props) return [];
  return [element, ...nodes(element.props.children)];
}

function textOf(element) {
  if (element == null || typeof element === 'boolean') return '';
  if (Array.isArray(element)) return element.map(textOf).join('');
  if (typeof element !== 'object') return String(element);
  return textOf(element.props?.children);
}

function renderEventsScreen(participations) {
  const screen = loadModule('screens/EventsScreen.js', (name) => {
    if (name === 'react-native') return reactNative;
    if (name === '../components/ParticipationCard') return { __esModule: true, default: 'ParticipationCard' };
    if (name === '../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../data/mockData') return { mockParticipations: participations };
    return require(name);
  });
  const navigationCalls = [];
  const navigation = { navigate: (name, params) => navigationCalls.push({ name, params: { ...params } }) };
  const rendered = screen.exports.default({ navigation });
  const list = nodes(rendered).find((node) => node.type === 'FlatList');
  return { rendered, list, navigationCalls };
}

function renderParticipationCard(props) {
  const card = loadModule('components/ParticipationCard.js', (name) => {
    if (name === 'react-native') return reactNative;
    if (name === '../utils/participation') return loadModule('utils/participation.js', require).exports;
    return require(name);
  });
  return card.exports.default(props);
}

const finished = Object.freeze({
  id: 'participation-1',
  event: { id: 'event-1', name: 'BEAST Arena — Teste', location: 'Teste' },
  enteredAt: '2026-09-28T15:10:00-03:00',
  exitedAt: '2026-09-28T16:52:00-03:00',
  experiences: [],
  evaluation: null,
});
const withoutExit = Object.freeze({ ...finished, id: 'participation-2', exitedAt: null });

test('participation date uses the registered entry date as DD/MM/AAAA', async () => {
  const { formatParticipationDate } = await participationModule;
  assert.equal(formatParticipationDate('2026-09-28T15:10:00-03:00'), '28/09/2026');
  assert.equal(formatParticipationDate('2026-04-15T12:00:00-03:00'), '15/04/2026');
  assert.equal(formatParticipationDate('2026-07-05T23:50:00-03:00'), '05/07/2026');
  assert.equal(formatParticipationDate('2026-02-31T12:00:00-03:00'), null);
  assert.equal(formatParticipationDate('2026-04-31T12:00:00-03:00'), null);
  assert.equal(formatParticipationDate('2024-02-29T12:00:00-03:00'), '29/02/2024');
  assert.equal(formatParticipationDate('2025-02-29T12:00:00-03:00'), null);
  for (const value of [null, undefined, '', 'ontem', 20260928]) {
    assert.equal(formatParticipationDate(value), null, String(value));
  }
});

test('stay duration is only calculated from registered entry and exit', async () => {
  const { getStayDurationInMinutes } = await participationModule;
  assert.equal(getStayDurationInMinutes(finished), 102);
  assert.equal(getStayDurationInMinutes(withoutExit), null);
  assert.equal(getStayDurationInMinutes({ ...finished, exitedAt: undefined }), null);
  assert.equal(getStayDurationInMinutes({ ...finished, exitedAt: 'invalida' }), null);
  assert.equal(getStayDurationInMinutes({ ...finished, exitedAt: finished.enteredAt }), null);
  assert.equal(getStayDurationInMinutes({ ...finished, exitedAt: '2026-09-28T15:00:00-03:00' }), null);
  assert.equal(getStayDurationInMinutes(null), null);
});

test('stay duration rejects impossible instants without relying on Date rollover', async () => {
  const { getStayDurationInMinutes } = await participationModule;
  const invalidInstants = [
    '2026-02-31T15:10:00-03:00',
    '2025-02-29T15:10:00-03:00',
    '2026-09-28T24:00:00-03:00',
    '2026-09-28T15:60:00-03:00',
    '2026-09-28T15:10:60-03:00',
    '2026-09-28T15:10:00-15:00',
    '2026-09-28T15:10:00',
    '2026-09-28',
  ];
  for (const instant of invalidInstants) {
    assert.equal(getStayDurationInMinutes({ ...finished, enteredAt: instant }), null, `entrada ${instant}`);
    assert.equal(getStayDurationInMinutes({ ...finished, exitedAt: instant }), null, `saida ${instant}`);
  }
  assert.equal(getStayDurationInMinutes({
    enteredAt: '2024-02-29T23:30:00-03:00',
    exitedAt: '2024-03-01T00:15:00-03:00',
  }), 45);
  assert.equal(getStayDurationInMinutes({
    enteredAt: '2026-09-28T18:10:00Z',
    exitedAt: '2026-09-28T16:52:00-03:00',
  }), 102);
});

test('stay duration is formatted in hours and minutes', async () => {
  const { formatStayDuration } = await participationModule;
  assert.equal(formatStayDuration(45), '45min');
  assert.equal(formatStayDuration(120), '2h');
  assert.equal(formatStayDuration(102), '1h 42min');
  for (const value of [null, 0, -5, Number.NaN, Infinity, '45']) {
    assert.equal(formatStayDuration(value), null, String(value));
  }
});

test('mock participations cover registered and unregistered exits', () => {
  const { exports } = loadModule('data/mockData.js', require);
  const participations = exports.mockParticipations;
  assert.ok(Array.isArray(participations) && participations.length > 0);
  assert.equal(new Set(participations.map((item) => item.id)).size, participations.length);
  for (const item of participations) {
    assert.ok(item.event && item.event.name, item.id);
    assert.ok(!Number.isNaN(Date.parse(item.enteredAt)), item.id);
  }
  assert.ok(participations.some((item) => item.exitedAt === null));
  assert.ok(participations.some((item) => item.exitedAt !== null));
});

test('EventsScreen lists participations under Minhas Participações', () => {
  const participations = [finished, withoutExit];
  const { rendered, list } = renderEventsScreen(participations);
  assert.equal(rendered.type, 'ScreenContainer');
  assert.ok(nodes(rendered).some((node) => node.type === 'Text' && textOf(node) === 'Minhas Participações'));
  assert.equal(list.props.data, participations);
  assert.equal(list.props.keyExtractor(finished), 'participation-1');
  const item = list.props.renderItem({ item: withoutExit });
  assert.equal(item.type, 'ParticipationCard');
  assert.equal(item.props.participation, withoutExit);
  assert.equal(typeof item.props.onPress, 'function');
});

test('pressing a participation card opens its details by participation ID', () => {
  const sameEventLater = Object.freeze({ ...finished, id: 'participation-3' });
  const { list, navigationCalls } = renderEventsScreen([finished, sameEventLater]);
  list.props.renderItem({ item: sameEventLater }).props.onPress();
  list.props.renderItem({ item: finished }).props.onPress();
  assert.deepEqual(navigationCalls, [
    { name: 'ParticipationDetails', params: { participationId: 'participation-3' } },
    { name: 'ParticipationDetails', params: { participationId: 'participation-1' } },
  ]);
});

test('EventsScreen shows the empty state message when there are no participations', () => {
  const { list } = renderEventsScreen([]);
  assert.deepEqual(list.props.data, []);
  assert.equal(textOf(list.props.ListEmptyComponent), 'Você ainda não possui participações em eventos.');
});

test('ParticipationCard shows event, date and stay duration', () => {
  const card = renderParticipationCard({ participation: finished });
  const text = nodes(card).filter((node) => node.type === 'Text').map(textOf);
  assert.deepEqual(text, ['BEAST Arena — Teste', '28/09/2026', 'Permanência: 1h 42min']);
  assert.equal(card.props.disabled, true);
  assert.equal(card.props.accessibilityRole, undefined);
});

test('ParticipationCard never estimates a stay without a registered exit', () => {
  const card = renderParticipationCard({ participation: withoutExit });
  const text = nodes(card).filter((node) => node.type === 'Text').map(textOf);
  assert.deepEqual(text, ['BEAST Arena — Teste', '28/09/2026', 'Permanência não registrada']);
});

test('ParticipationCard becomes a button only when onPress is provided', () => {
  const onPress = () => {};
  const card = renderParticipationCard({ participation: finished, onPress });
  assert.equal(card.props.disabled, false);
  assert.equal(card.props.onPress, onPress);
  assert.equal(card.props.accessibilityRole, 'button');
});
