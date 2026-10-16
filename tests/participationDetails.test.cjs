const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const participationUtils = loadModule('utils/participation.js', require).exports;
const { exports: mockData } = loadModule('data/mockData.js', require);

const reactNative = {
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles) => styles },
  Text: 'Text',
  View: 'View',
};

// Expande componentes de função (DetailRow, TimeRow) para ler o que a tela exibe.
function renderTree(element) {
  if (element == null || typeof element === 'boolean') return element;
  if (Array.isArray(element)) return element.map(renderTree);
  if (typeof element !== 'object' || !element.props) return element;
  if (typeof element.type === 'function') return renderTree(element.type(element.props));
  return { ...element, props: { ...element.props, children: renderTree(element.props.children) } };
}

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

function renderDetails(participations, route) {
  const screen = loadModule('screens/ParticipationDetailsScreen.js', (name) => {
    if (name === 'react-native') return reactNative;
    if (name === '../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../data/mockData') return { mockParticipations: participations };
    if (name === '../utils/participation') return participationUtils;
    return require(name);
  });
  const rendered = renderTree(screen.exports.default({ route }));
  const texts = nodes(rendered).filter((node) => node.type === 'Text').map(textOf);
  return { rendered, texts };
}

const openDetails = (participations, participationId) => renderDetails(
  participations,
  { name: 'ParticipationDetails', params: { participationId } },
);

const event = Object.freeze({ id: 'event-1', name: 'BEAST Arena — Teste', location: 'Teste' });
const playstation = Object.freeze({ id: 'playstation', name: 'PlayStation' });
const simulator = Object.freeze({ id: 'racing-simulator', name: 'Simulador de Corrida' });

const withRepeatedExperience = Object.freeze({
  id: 'participation-1',
  event,
  enteredAt: '2026-09-28T15:10:00-03:00',
  exitedAt: '2026-09-28T16:52:00-03:00',
  experiences: [
    { id: 'participation-1-experience-1', experience: playstation },
    { id: 'participation-1-experience-2', experience: simulator },
    { id: 'participation-1-experience-3', experience: playstation },
  ],
  evaluation: null,
});
const sameEventWithoutExperiences = Object.freeze({
  id: 'participation-2',
  event,
  enteredAt: '2026-09-28T17:30:00-03:00',
  exitedAt: '2026-09-28T17:55:00-03:00',
  experiences: [],
  evaluation: null,
});
const withoutExit = Object.freeze({
  id: 'participation-3',
  event: { id: 'event-2', name: 'BEAST Arena — Outro evento', location: 'Outro' },
  enteredAt: '2026-07-05T18:20:00-03:00',
  exitedAt: null,
  experiences: [{ id: 'participation-3-experience-1', experience: playstation }],
  evaluation: null,
});
const participations = [sameEventWithoutExperiences, withRepeatedExperience, withoutExit];

test('participations are found by ID, never by event name', () => {
  const { findParticipationById } = participationUtils;
  assert.equal(findParticipationById(participations, 'participation-1'), withRepeatedExperience);
  assert.equal(findParticipationById(participations, 'participation-2'), sameEventWithoutExperiences);
  assert.equal(findParticipationById(participations, event.name), null);
  for (const invalidId of ['participation-999', '', null, undefined, 1, {}]) {
    assert.equal(findParticipationById(participations, invalidId), null, String(invalidId));
  }
  assert.equal(findParticipationById(null, 'participation-1'), null);
  assert.equal(findParticipationById([null, withoutExit], 'participation-3'), withoutExit);
});

test('registered times keep the recorded time and never fill missing data', () => {
  const { getParticipationTimes } = participationUtils;
  assert.deepEqual(JSON.parse(JSON.stringify(getParticipationTimes(withRepeatedExperience))), {
    entry: { status: 'registered', time: '15:10' },
    exit: { status: 'registered', time: '16:52' },
    stayDurationInMinutes: 102,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(getParticipationTimes(withoutExit))), {
    entry: { status: 'registered', time: '18:20' },
    exit: { status: 'missing', time: null },
    stayDurationInMinutes: null,
  });
  const exitBeforeEntry = getParticipationTimes({ ...withRepeatedExperience, exitedAt: '2026-09-28T15:00:00-03:00' });
  assert.equal(exitBeforeEntry.exit.status, 'invalid');
  assert.equal(exitBeforeEntry.stayDurationInMinutes, null);
  const impossibleExit = getParticipationTimes({ ...withRepeatedExperience, exitedAt: '2026-02-31T16:52:00-03:00' });
  assert.equal(impossibleExit.exit.status, 'invalid');
  const withoutEntry = getParticipationTimes({ ...withRepeatedExperience, enteredAt: undefined });
  assert.deepEqual({ ...withoutEntry.entry }, { status: 'missing', time: null });
  assert.deepEqual({ ...withoutEntry.exit }, { status: 'registered', time: '16:52' });
  assert.equal(withoutEntry.stayDurationInMinutes, null);
});

test('registered times with offsets beyond ±14:00 are invalid', () => {
  const { getParticipationTimes } = participationUtils;
  const atLimit = getParticipationTimes({
    enteredAt: '2026-09-28T15:10:00+14:00',
    exitedAt: '2026-09-28T16:52:00+14:00',
  });
  assert.deepEqual({ ...atLimit.entry }, { status: 'registered', time: '15:10' });
  assert.deepEqual({ ...atLimit.exit }, { status: 'registered', time: '16:52' });
  assert.equal(atLimit.stayDurationInMinutes, 102);
  const beyondLimit = getParticipationTimes({
    enteredAt: '2026-09-28T15:10:00-14:01',
    exitedAt: '2026-09-28T16:52:00+14:59',
  });
  assert.deepEqual({ ...beyondLimit.entry }, { status: 'invalid', time: null });
  assert.deepEqual({ ...beyondLimit.exit }, { status: 'invalid', time: null });
  assert.equal(beyondLimit.stayDurationInMinutes, null);
});

test('null or invalid experience occurrences are ignored, valid repetitions kept', () => {
  const getExperienceOccurrences = (participation) => [...participationUtils.getExperienceOccurrences(participation)];
  const first = { id: 'occurrence-1', experience: playstation };
  const repeated = { id: 'occurrence-2', experience: playstation };
  assert.deepEqual(getExperienceOccurrences({ experiences: [null] }), []);
  assert.deepEqual(getExperienceOccurrences({
    experiences: [null, undefined, first, 'PlayStation', 42, {}, { id: '' }, { id: 7 }, repeated, false],
  }), [first, repeated]);
  for (const experiences of [undefined, null, {}, 'PlayStation']) {
    assert.deepEqual(getExperienceOccurrences({ experiences }), [], String(experiences));
  }
  assert.deepEqual(getExperienceOccurrences(null), []);
});

test('experience occurrences require an own valid ID', () => {
  const getExperienceOccurrences = (participation) => [...participationUtils.getExperienceOccurrences(participation)];
  const inheritedOccurrence = Object.create({ id: 'herdado' });
  inheritedOccurrence.experience = playstation;
  const first = { id: 'occurrence-1', experience: playstation };
  const repeated = { id: 'occurrence-2', experience: playstation };

  assert.deepEqual(getExperienceOccurrences({
    experiences: [null, undefined, inheritedOccurrence, first, repeated, false],
  }), [first, repeated]);
});

test('details with only null experiences show that none were registered', () => {
  for (const experiences of [[null], [null, undefined, {}]]) {
    const onlyInvalid = { ...withRepeatedExperience, experiences };
    const { texts } = openDetails([onlyInvalid], 'participation-1');
    assert.equal(texts[0], 'BEAST Arena — Teste');
    assert.equal(texts.at(-1), 'Nenhuma experiência registrada nesta participação.');
  }
});

test('details list valid occurrences among invalid ones, keeping repetitions', () => {
  const mixed = {
    ...withRepeatedExperience,
    experiences: [
      null,
      { id: 'participation-1-experience-1', experience: playstation },
      { experience: simulator },
      undefined,
      { id: 'participation-1-experience-2', experience: playstation },
      { id: 'participation-1-experience-3', experience: null },
    ],
  };
  const { rendered, texts } = openDetails([mixed], 'participation-1');
  const keys = nodes(rendered).filter((node) => node.type === 'View' && node.key != null).map((node) => node.key);
  assert.deepEqual(keys, [
    'participation-1-experience-1',
    'participation-1-experience-2',
    'participation-1-experience-3',
  ]);
  assert.deepEqual(texts.slice(texts.indexOf('Experiências realizadas') + 1), [
    'PlayStation',
    'PlayStation',
    'Experiência não identificada',
  ]);
});

test('details show the event, date, times and stay of the selected participation', () => {
  const { rendered, texts } = openDetails(participations, 'participation-1');
  assert.equal(rendered.type, 'ScreenContainer');
  assert.deepEqual(texts, [
    'BEAST Arena — Teste',
    '28/09/2026',
    'Permanência',
    'Entrada', '15:10',
    'Saída', '16:52',
    'Tempo de permanência', '1h 42min',
    'Experiências realizadas',
    'PlayStation', 'Simulador de Corrida', 'PlayStation',
  ]);
});

test('distinct participations of the same event open their own details', () => {
  const first = openDetails(participations, 'participation-1').texts;
  const second = openDetails(participations, 'participation-2').texts;
  assert.equal(first[0], second[0]);
  assert.deepEqual(second.slice(3, 9), ['Entrada', '17:30', 'Saída', '17:55', 'Tempo de permanência', '25min']);
  assert.notDeepEqual(first, second);
});

test('details never invent an exit or a stay that was not registered', () => {
  const { texts } = openDetails(participations, 'participation-3');
  assert.deepEqual(texts.slice(0, 9), [
    'BEAST Arena — Outro evento',
    '05/07/2026',
    'Permanência',
    'Entrada', '18:20',
    'Saída', 'Não registrada',
    'Tempo de permanência', 'Não registrado',
  ]);
});

test('repeated experiences are listed once per occurrence, keyed by occurrence ID', () => {
  const { rendered } = openDetails(participations, 'participation-1');
  const keys = nodes(rendered).filter((node) => node.type === 'View' && node.key != null).map((node) => node.key);
  assert.deepEqual(keys, [
    'participation-1-experience-1',
    'participation-1-experience-2',
    'participation-1-experience-3',
  ]);
});

test('a participation without experiences shows that none were registered', () => {
  const { texts } = openDetails(participations, 'participation-2');
  assert.equal(texts.at(-1), 'Nenhuma experiência registrada nesta participação.');
  assert.equal(texts.includes('PlayStation'), false);
});

test('an unknown or missing participation ID shows a not found message', () => {
  for (const route of [
    { params: { participationId: 'participation-999' } },
    { params: { participationId: event.name } },
    { params: {} },
    {},
    undefined,
  ]) {
    const { rendered, texts } = renderDetails(participations, route);
    assert.equal(rendered.type, 'ScreenContainer');
    assert.deepEqual(texts, ['Participação não encontrada.']);
  }
});

test('every mocked participation opens its details by ID', () => {
  const mocks = mockData.mockParticipations;
  for (const participation of mocks) {
    const { texts } = openDetails(mocks, participation.id);
    assert.equal(texts[0], participation.event.name, participation.id);
  }
});

test('mocks cover repeated experiences, no experiences and re-entry in the same event', () => {
  const mocks = mockData.mockParticipations;
  const occurrenceIds = mocks.flatMap((participation) => participation.experiences.map((occurrence) => occurrence.id));
  assert.equal(new Set(occurrenceIds).size, occurrenceIds.length);
  assert.ok(mocks.some((participation) => {
    const experienceIds = participation.experiences.map((occurrence) => occurrence.experience.id);
    return new Set(experienceIds).size < experienceIds.length;
  }));
  assert.ok(mocks.some((participation) => participation.experiences.length === 0));
  const eventIds = mocks.map((participation) => participation.event.id);
  assert.ok(new Set(eventIds).size < eventIds.length);
  for (const participation of mocks) {
    assert.ok(!('stayDuration' in participation), participation.id);
  }
});

test('details open from the root stack with a back button to the list', () => {
  const app = loadModule('App.js', (name) => {
    if (name === '@react-navigation/native') return { NavigationContainer: 'NavigationContainer' };
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator: () => ({ Navigator: 'StackNavigator', Screen: 'StackScreen' }) };
    }
    if (name === './context/ParticipationContext') return { ParticipationProvider: 'ParticipationProvider' };
    if (name.startsWith('./screens/') || name === './navigation/MainTabs') return { __esModule: true, default: name };
    return require(name);
  });
  const screens = nodes(app.exports.default()).filter((node) => node.type === 'StackScreen');
  const details = screens.find((node) => node.props.name === 'ParticipationDetails');
  assert.equal(details.props.component, './screens/ParticipationDetailsScreen');
  assert.equal(details.props.options.headerShown, true);
  assert.notEqual(details.props.options.headerBackVisible, false);
  assert.equal(details.props.options.title, 'Detalhes da participação');
  assert.ok(screens.some((node) => node.props.name === 'MainTabs'));
});

test('the bottom tabs keep Início, Eventos and Perfil without a new tab', () => {
  const tabs = loadModule('navigation/MainTabs.js', (name) => {
    if (name === '@react-navigation/bottom-tabs') {
      return { createBottomTabNavigator: () => ({ Navigator: 'TabNavigator', Screen: 'TabScreen' }) };
    }
    if (name.startsWith('../screens/')) return { __esModule: true, default: name };
    return require(name);
  });
  const screens = nodes(tabs.exports.default()).filter((node) => node.type === 'TabScreen');
  assert.deepEqual(screens.map((node) => node.props.name), ['Início', 'Eventos', 'Perfil']);
  assert.equal(screens[1].props.component, '../screens/EventsScreen');
});
