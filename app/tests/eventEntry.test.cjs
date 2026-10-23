const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

function nativeComponents() {
  const native = Object.fromEntries(
    ['Pressable', 'Text', 'TextInput'].map((name) => [name, name])
  );
  native.StyleSheet = { create: (styles) => styles };
  return native;
}

function entryScreen() {
  const state = [];
  const navigationCalls = [];
  let cursor = 0;
  let tree;
  const data = loadModule('data/mockData.js', require).exports;
  const screen = loadModule('screens/event-entry/EventEntryScreen.js', (name) => {
    if (name === 'react') return {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        }];
      },
    };
    if (name === 'react-native') return nativeComponents();
    if (name === '../../components/ScreenContainer') {
      return { __esModule: true, default: 'ScreenContainer' };
    }
    if (name === '../../data/mockData') return data;
    return require(name);
  });
  screen.context.console = { log() {} };

  function render() {
    cursor = 0;
    tree = screen.exports.default({
      navigation: {
        navigate: (name, params) => navigationCalls.push({ name, params }),
      },
    });
  }

  render();
  return {
    navigationCalls,
    changeCode(value) {
      const input = nodes(tree).find((node) => node.type === 'TextInput');
      assert.ok(input, 'missing event code input');
      input.props.onChangeText(value);
      render();
    },
    continue() {
      const button = nodes(tree).find((node) =>
        node.type === 'Pressable' && textOf(node) === 'Continuar');
      assert.ok(button, 'missing continue button');
      button.props.onPress();
      render();
    },
  };
}

function confirmationScreen(event, previousParticipation) {
  let participation = previousParticipation;
  const contextUpdates = [];
  const navigationCalls = [];
  let tree;
  const screen = loadModule('screens/event-entry/EventConfirmationScreen.js', (name) => {
    if (name === 'react') return {
      useContext: () => ({
        participation,
        setParticipation(value) {
          contextUpdates.push(value);
          participation = value;
        },
      }),
    };
    if (name === 'react-native') return nativeComponents();
    if (name === '../../components/ScreenContainer') {
      return { __esModule: true, default: 'ScreenContainer' };
    }
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  });

  function render() {
    tree = screen.exports.default({
      route: { params: { event } },
      navigation: {
        reset: (payload) => navigationCalls.push(structuredClone(payload)),
      },
    });
  }

  render();
  return {
    contextUpdates,
    navigationCalls,
    get participation() { return participation; },
    confirm() {
      const button = nodes(tree).find((node) =>
        node.type === 'Pressable' && textOf(node) === 'Confirmar entrada');
      assert.ok(button, 'missing confirmation button');
      button.props.onPress();
      render();
    },
  };
}

function enteredEvent(h) {
  assert.equal(h.navigationCalls.length, 1);
  assert.equal(h.navigationCalls[0].name, 'EventConfirmation');
  return structuredClone(h.navigationCalls[0].params.event);
}

test('FILA code is case-insensitive and opens the queue event', () => {
  for (const code of ['FILA', 'fila', 'Fila', 'fIlA']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    const event = enteredEvent(h);
    assert.equal(event.id, 'beast-arena-queue');
    assert.equal(event.hasArenaQueue, true);
  }
});

test('LIVRE code is case-insensitive and opens the direct-entry event', () => {
  for (const code of ['LIVRE', 'livre', 'Livre', 'lIvRe']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    const event = enteredEvent(h);
    assert.equal(event.id, 'beast-arena-free');
    assert.equal(event.hasArenaQueue, false);
  }
});

test('event code ignores outer whitespace before normalizing its case', () => {
  const h = entryScreen();
  h.changeCode(' \tfIlA\r\n ');
  h.continue();
  assert.equal(enteredEvent(h).id, 'beast-arena-queue');
});

test('empty or whitespace-only event code does not navigate', () => {
  for (const code of ['', ' ', '\t\r\n']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    assert.deepEqual(h.navigationCalls, []);
  }
});

test('unknown event codes do not navigate regardless of case', () => {
  for (const code of ['DESCONHECIDO', 'desconhecido', 'Desconhecido']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    assert.deepEqual(h.navigationCalls, []);
  }
});

test('inherited mock object properties are not interpreted as events', () => {
  const h = entryScreen();
  h.changeCode('toString');
  h.continue();
  assert.deepEqual(h.navigationCalls, []);
});

test('navigation occurs only after the current code resolves to a valid event', () => {
  const h = entryScreen();
  h.changeCode('INVALIDO');
  h.continue();
  h.changeCode('FILA');
  h.continue();
  h.changeCode('toString');
  h.continue();
  assert.equal(h.navigationCalls.length, 1);
  assert.equal(enteredEvent(h).id, 'beast-arena-queue');
});

test('confirming a FILA event replaces prior context with a waiting participation', () => {
  const event = {
    id: 'queue-event',
    name: 'Evento com fila',
    location: 'Local A',
    hasArenaQueue: true,
    experiences: [{ id: 'experience-a', name: 'Experiência A' }],
  };
  const previous = {
    event: { id: 'old-event' },
    status: 'finished',
    queuePosition: 99,
    experienceQueue: { experienceId: 'old-experience', position: 2 },
    activeExperience: { experienceId: 'old-experience' },
    experienceParticipations: { 'old-experience': 7 },
    residualData: true,
  };
  const h = confirmationScreen(event, previous);
  h.confirm();

  assert.equal(h.contextUpdates.length, 1);
  assert.equal(h.contextUpdates[0], h.participation);
  assert.equal(h.participation.event, event);
  assert.deepEqual(structuredClone(h.participation), {
    event,
    status: 'waiting',
    queuePosition: 5,
    experienceQueue: null,
    activeExperience: null,
    experienceParticipations: {},
  });
  assert.deepEqual(h.navigationCalls, [{ index: 0, routes: [{ name: 'MainTabs' }] }]);
});

test('confirming a LIVRE event replaces prior context with an active participation', () => {
  const event = {
    id: 'free-event',
    name: 'Evento livre',
    location: 'Local B',
    hasArenaQueue: false,
    experiences: [{ id: 'experience-b', name: 'Experiência B' }],
  };
  const previous = {
    event: { id: 'old-event' },
    status: 'waiting',
    queuePosition: 8,
    experienceQueue: { experienceId: 'old-experience', position: 3 },
    activeExperience: { experienceId: 'old-experience' },
    experienceParticipations: { 'old-experience': 4 },
    residualData: true,
  };
  const h = confirmationScreen(event, previous);
  h.confirm();

  assert.equal(h.contextUpdates.length, 1);
  assert.equal(h.contextUpdates[0], h.participation);
  assert.equal(h.participation.event, event);
  assert.deepEqual(structuredClone(h.participation), {
    event,
    status: 'active',
    queuePosition: null,
    experienceQueue: null,
    activeExperience: null,
    experienceParticipations: {},
  });
  assert.deepEqual(h.navigationCalls, [{ index: 0, routes: [{ name: 'MainTabs' }] }]);
});
