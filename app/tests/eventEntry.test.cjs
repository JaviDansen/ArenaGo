const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

const appDirectory = path.resolve(__dirname, '..');

function createRuntimeResolver({ getState, getRef, getContext }) {
  const internalModules = new Map();
  const native = Object.fromEntries(
    [
      'ActivityIndicator',
      'Image',
      'KeyboardAvoidingView',
      'Pressable',
      'ScrollView',
      'SafeAreaView',
      'Text',
      'TextInput',
      'View',
    ].map((name) => [name, name])
  );
  native.Platform = { OS: 'android' };
  native.useWindowDimensions = () => ({ width: 390, height: 844 });
  native.StyleSheet = {
    create: (styles) => styles,
    flatten: (style) =>
      Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  };

  function resolveFrom(fromRelativePath, name) {
    if (name === 'react') {
      return {
        useState: getState,
        useRef: getRef,
        useContext: getContext,
      };
    }
    if (name === 'react-native') return native;
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'react-native-safe-area-context') {
      return {
        SafeAreaView: 'SafeAreaView',
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      };
    }
    if (name === '../../context/ParticipationContext') {
      return { ParticipationContext: 'ParticipationContext' };
    }
    if (name.startsWith('.') && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(name)) {
      return { uri: name };
    }
    if (name.startsWith('.')) {
      const fromDir = path.dirname(path.join(appDirectory, fromRelativePath));
      let resolvedAbs = path.resolve(fromDir, name);
      if (!resolvedAbs.endsWith('.js')) {
        const asFile = `${resolvedAbs}.js`;
        try {
          readFileSync(asFile);
          resolvedAbs = asFile;
        } catch {
          resolvedAbs = path.join(resolvedAbs, 'index.js');
        }
      }
      const targetRelative = path.relative(appDirectory, resolvedAbs);
      if (internalModules.has(targetRelative)) {
        return internalModules.get(targetRelative);
      }
      const loaded = loadModule(targetRelative, (dep) =>
        resolveFrom(targetRelative, dep)
      ).exports;
      internalModules.set(targetRelative, loaded);
      return loaded;
    }
    return require(name);
  }

  return resolveFrom;
}

function entryScreen(currentParticipation = null) {
  const state = [];
  const navigationCalls = [];
  const consoleLogs = [];
  let cursor = 0;
  let tree;

  const resolveFrom = createRuntimeResolver({
    getState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    getRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    getContext() {
      return {
        participation: currentParticipation,
        setParticipation() {},
      };
    },
  });

  const screen = loadModule('screens/event-entry/EventEntryScreen.js', (name) =>
    resolveFrom('screens/event-entry/EventEntryScreen.js', name)
  );
  screen.context.console = {
    log(...args) {
      consoleLogs.push(args);
    },
  };

  function render() {
    cursor = 0;
    tree = screen.exports.default({
      navigation: {
        navigate: (name, params) => navigationCalls.push({ name, params }),
        goBack: () => navigationCalls.push({ name: 'BACK' }),
      },
    });
  }

  render();
  return {
    navigationCalls,
    consoleLogs,
    get tree() {
      return tree;
    },
    texts() {
      return nodes(tree)
        .filter((node) => node.type === 'Text')
        .map(textOf);
    },
    changeCode(value) {
      const input = nodes(tree).find((node) => node.type === 'TextInput');
      assert.ok(input, 'missing event code input');
      input.props.onChangeText(value);
      render();
    },
    continue() {
      const button = nodes(tree).find(
        (node) => node.type === 'Pressable' && textOf(node) === 'Continuar'
      );
      assert.ok(button, 'missing continue button');
      button.props.onPress();
      render();
    },
  };
}

function confirmationScreen(event, previousParticipation = null) {
  let participation = previousParticipation;
  const state = [];
  let cursor = 0;
  const contextUpdates = [];
  const navigationCalls = [];
  const backCalls = [];
  let tree;

  const resolveFrom = createRuntimeResolver({
    getState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    getRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    getContext() {
      return {
        participation,
        setParticipation(value) {
          contextUpdates.push(value);
          participation = value;
        },
      };
    },
  });

  const screen = loadModule(
    'screens/event-entry/EventConfirmationScreen.js',
    (name) => resolveFrom('screens/event-entry/EventConfirmationScreen.js', name)
  );

  function render() {
    cursor = 0;
    tree = screen.exports.default({
      route: { params: { event } },
      navigation: {
        reset: (payload) => navigationCalls.push(structuredClone(payload)),
        goBack: () => backCalls.push('goBack'),
      },
    });
  }

  render();
  return {
    contextUpdates,
    navigationCalls,
    backCalls,
    get participation() {
      return participation;
    },
    texts() {
      return nodes(tree)
        .filter((node) => node.type === 'Text')
        .map(textOf);
    },
    confirm() {
      const button = nodes(tree).find(
        (node) => node.type === 'Pressable' && textOf(node) === 'Confirmar entrada'
      );
      assert.ok(button, 'missing confirmation button');
      if (typeof button.props.onPress === 'function') {
        button.props.onPress();
      }
      render();
    },
    cancel() {
      const button = nodes(tree).find(
        (node) =>
          node.type === 'Pressable' &&
          (node.props.accessibilityLabel === 'Cancelar e voltar' ||
            textOf(node) === 'Voltar')
      );
      assert.ok(button, 'missing cancel/back button');
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

test('FILA code is case-insensitive and opens the queue event without logging the code', () => {
  for (const code of ['FILA', 'fila', 'Fila', 'fIlA']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    const event = enteredEvent(h);
    assert.equal(event.id, 'beast-arena-queue');
    assert.equal(event.hasArenaQueue, true);
    assert.deepEqual(h.consoleLogs, [], 'must not expose event code in console.log');
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
    assert.deepEqual(h.consoleLogs, []);
  }
});

test('event code ignores outer whitespace before normalizing its case', () => {
  const h = entryScreen();
  h.changeCode(' \tfIlA\r\n ');
  h.continue();
  assert.equal(enteredEvent(h).id, 'beast-arena-queue');
});

test('empty or whitespace-only event code displays clear error and does not navigate', () => {
  for (const code of ['', ' ', '\t\r\n']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    assert.deepEqual(h.navigationCalls, []);
    assert.ok(
      h.texts().includes('Informe o código do evento para continuar.'),
      'must display validation message for empty event code'
    );
  }
});

test('unknown event codes display clear error and do not navigate regardless of case', () => {
  for (const code of ['DESCONHECIDO', 'desconhecido', 'Desconhecido']) {
    const h = entryScreen();
    h.changeCode(code);
    h.continue();
    assert.deepEqual(h.navigationCalls, []);
    assert.ok(
      h
        .texts()
        .includes(
          'Código de evento não encontrado. Verifique o código informado na estação.'
        ),
      'must display validation message for unknown event code'
    );
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

test('EventEntryScreen does not offer QR Code scanning as an available feature', () => {
  const h = entryScreen();
  const fullText = h.texts().join(' ');
  assert.equal(
    fullText.toLowerCase().includes('qr code'),
    false,
    'QR Code scanner must not be advertised as available'
  );
});

test('confirming a FILA event displays event details and replaces prior finished context with a waiting participation', () => {
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
  assert.ok(h.texts().includes('Evento encontrado'));
  assert.ok(h.texts().includes('Evento com fila'));
  assert.ok(h.texts().includes('Local A'));
  assert.ok(h.texts().includes('Experiência A'));

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

test('confirming a LIVRE event replaces prior finished context with an active participation', () => {
  const event = {
    id: 'free-event',
    name: 'Evento livre',
    location: 'Local B',
    hasArenaQueue: false,
    experiences: [{ id: 'experience-b', name: 'Experiência B' }],
  };
  const previous = {
    event: { id: 'old-event' },
    status: 'finished',
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

test('canceling or going back on EventConfirmationScreen does not create a participation', () => {
  const event = {
    id: 'queue-event',
    name: 'BEAST Arena',
    location: 'Evento de demonstração',
    hasArenaQueue: true,
    experiences: [],
  };
  const h = confirmationScreen(event, null);
  h.cancel();

  assert.deepEqual(h.contextUpdates, []);
  assert.equal(h.participation, null);
  assert.deepEqual(h.navigationCalls, []);
  assert.deepEqual(h.backCalls, ['goBack']);
});

test('duplicate confirmation presses do not create a second participation or reset twice', () => {
  const event = {
    id: 'queue-event',
    name: 'BEAST Arena',
    location: 'Evento de demonstração',
    hasArenaQueue: true,
    experiences: [],
  };
  const h = confirmationScreen(event, null);
  h.confirm();
  h.confirm();

  assert.equal(h.contextUpdates.length, 1);
  assert.equal(h.navigationCalls.length, 1);
});

test('attempting to enter or confirm with an existing current participation (waiting or active) is blocked (rule D03)', () => {
  for (const status of ['waiting', 'active']) {
    const activeParticipation = Object.freeze({
      event: { id: 'existing-event', name: 'BEAST Arena' },
      status,
      queuePosition: status === 'waiting' ? 5 : null,
    });

    // 1. Bloqueio já na tela de código (EventEntryScreen)
    const entry = entryScreen(activeParticipation);
    entry.changeCode('FILA');
    entry.continue();
    assert.deepEqual(
      entry.navigationCalls,
      [],
      `EventEntryScreen must block navigation when participation status is "${status}"`
    );
    assert.ok(
      entry
        .texts()
        .some((text) => text.includes('Você já possui uma participação')),
      'EventEntryScreen must warn about existing active/waiting participation'
    );

    // 2. Bloqueio também na tela de confirmação (EventConfirmationScreen)
    const event = {
      id: 'new-event',
      name: 'Outro Evento',
      location: 'Local Novo',
      hasArenaQueue: false,
      experiences: [],
    };
    const confirmation = confirmationScreen(event, activeParticipation);
    confirmation.confirm();
    assert.deepEqual(
      confirmation.contextUpdates,
      [],
      `EventConfirmationScreen must not overwrite participation with status "${status}"`
    );
    assert.equal(confirmation.participation, activeParticipation);
    assert.deepEqual(confirmation.navigationCalls, []);
  }
});
