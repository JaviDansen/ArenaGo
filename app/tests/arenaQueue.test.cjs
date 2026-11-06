const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

const appDirectory = path.resolve(__dirname, '..');

function queueParticipation(overrides = {}) {
  return {
    event: {
      id: 'event-with-queue',
      name: 'Evento com fila',
      experiences: [{ id: 'experience-a', name: 'Experiência A' }],
    },
    status: 'waiting',
    queuePosition: 5,
    experienceQueue: null,
    activeExperience: null,
    experienceParticipations: { 'experience-a': 2 },
    customData: { preserved: true },
    ...overrides,
  };
}

function queueScreen(initialParticipation) {
  let participation = initialParticipation;
  const state = [];
  let cursor = 0;
  const updates = [];
  let tree;

  const internalModules = new Map();
  const native = Object.fromEntries(
    [
      'ActivityIndicator',
      'Image',
      'Pressable',
      'ScrollView',
      'SafeAreaView',
      'Text',
      'View',
    ].map((name) => [name, name])
  );
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
        useState(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [
            state[index],
            (value) => {
              state[index] =
                typeof value === 'function' ? value(state[index]) : value;
            },
          ];
        },
        useRef(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = { current: initial };
          return state[index];
        },
        useContext: () => ({
          participation,
          setParticipation(value) {
            updates.push(value);
            participation = value;
          },
        }),
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

  const screen = loadModule('screens/arena/ArenaQueueScreen.js', (name) =>
    resolveFrom('screens/arena/ArenaQueueScreen.js', name)
  );

  function render() {
    cursor = 0;
    tree = screen.exports.default();
  }

  render();
  return {
    updates,
    get participation() {
      return participation;
    },
    texts() {
      return nodes(tree)
        .filter((node) => node.type === 'Text')
        .map(textOf);
    },
    press(label) {
      const button = nodes(tree).find(
        (node) =>
          node.type === 'Pressable' &&
          (node.props.accessibilityLabel === label || textOf(node) === label)
      );
      assert.ok(button, `missing button: ${label}`);
      if (typeof button.props.onPress === 'function') {
        button.props.onPress();
      }
      if (participation) render();
    },
  };
}

function assertActiveWithoutQueue(actual, before) {
  assert.notEqual(actual, before);
  assert.equal(actual.status, 'active');
  assert.equal(actual.queuePosition, null);
  for (const key of Object.keys(before).filter(
    (key) => !['status', 'queuePosition'].includes(key)
  )) {
    assert.equal(actual[key], before[key], `property changed: ${key}`);
  }
  assert.equal(before.status, 'waiting');
  assert.equal(before.queuePosition, 5);
}

test('ArenaQueueScreen displays event name, waiting state, demonstrative queue position and release instructions', () => {
  const before = queueParticipation();
  const h = queueScreen(before);
  const texts = h.texts();

  assert.ok(texts.includes('Evento com fila'), 'renders event name from participation');
  assert.ok(texts.includes('Você está na fila'), 'renders waiting title');
  assert.ok(texts.includes('Sua posição:'), 'renders position label');
  assert.ok(texts.includes('5º'), 'renders formatted queue position');
  assert.ok(
    texts.includes('POSIÇÃO DEMONSTRATIVA'),
    'identifies simulated queue position clearly'
  );
  assert.ok(
    texts.includes('SIMULAÇÃO DE DESENVOLVIMENTO'),
    'identifies development simulation controls clearly'
  );
  assert.ok(
    texts.includes(
      'O tempo de permanência só começa quando sua entrada for liberada.'
    ),
    'explains stay duration rule'
  );
});

test('release button activates the participation, clears queue position and preserves other data', () => {
  const before = queueParticipation();
  const h = queueScreen(before);
  h.press('Simular entrada liberada');

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0], h.participation);
  assertActiveWithoutQueue(h.participation, before);
});

test('queue-disabled button performs the same active transition without losing participation data', () => {
  const before = queueParticipation();
  const h = queueScreen(before);
  h.press('Simular staff desativando fila');

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0], h.participation);
  assertActiveWithoutQueue(h.participation, before);
});

test('requesting to leave queue asks for confirmation first and canceling keeps participation in queue', () => {
  const before = queueParticipation();
  const h = queueScreen(before);

  h.press('Sair da fila');
  assert.deepEqual(
    h.updates,
    [],
    'pressing Sair da fila must open confirmation before canceling participation'
  );
  assert.equal(h.participation, before);
  assert.ok(
    h.texts().includes('Deseja sair da fila externa?'),
    'confirmation prompt must be displayed'
  );

  h.press('Manter na fila');
  assert.deepEqual(h.updates, []);
  assert.equal(h.participation, before);
  assert.equal(h.participation.status, 'waiting');
  assert.equal(h.participation.queuePosition, 5);
  assert.equal(
    h.texts().includes('Deseja sair da fila externa?'),
    false,
    'confirmation prompt must close after canceling exit'
  );
});

test('confirming leave-queue removes the current participation and loses queue position (rule D02)', () => {
  const before = queueParticipation();
  const h = queueScreen(before);

  h.press('Sair da fila');
  assert.deepEqual(h.updates, []);

  h.press('Confirmar saída');
  assert.deepEqual(h.updates, [null]);
  assert.equal(h.participation, null);
  assert.equal(before.status, 'waiting');
  assert.equal(before.queuePosition, 5);
});

test('duplicate transition presses are ignored once a transition has started', () => {
  const before = queueParticipation();
  const h = queueScreen(before);

  h.press('Simular entrada liberada');
  h.press('Simular staff desativando fila');

  assert.equal(
    h.updates.length,
    1,
    'second transition action must be ignored after participation leaves waiting state'
  );
  assert.equal(h.participation.status, 'active');
});
