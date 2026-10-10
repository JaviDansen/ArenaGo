const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

function queueParticipation() {
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
  };
}

function queueScreen(initialParticipation) {
  let participation = initialParticipation;
  const updates = [];
  let tree;
  const native = Object.fromEntries(['Pressable', 'Text'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
  const screen = loadModule('screens/arena/ArenaQueueScreen.js', (name) => {
    if (name === 'react') return {
      useContext: () => ({
        participation,
        setParticipation(value) {
          updates.push(value);
          participation = value;
        },
      }),
    };
    if (name === 'react-native') return native;
    if (name === '../../components/ScreenContainer') {
      return { __esModule: true, default: 'ScreenContainer' };
    }
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  });

  function render() {
    tree = screen.exports.default();
  }

  render();
  return {
    updates,
    get participation() { return participation; },
    press(label) {
      const button = nodes(tree).find((node) =>
        node.type === 'Pressable' && textOf(node) === label);
      assert.ok(button, `missing button: ${label}`);
      assert.equal(typeof button.props.onPress, 'function');
      button.props.onPress();
      if (participation) render();
    },
  };
}

function assertActiveWithoutQueue(actual, before) {
  assert.notEqual(actual, before);
  assert.equal(actual.status, 'active');
  assert.equal(actual.queuePosition, null);
  for (const key of Object.keys(before).filter((key) =>
    !['status', 'queuePosition'].includes(key))) {
    assert.equal(actual[key], before[key], `property changed: ${key}`);
  }
  assert.equal(before.status, 'waiting');
  assert.equal(before.queuePosition, 5);
}

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

test('leave-queue button removes the current participation', () => {
  const before = queueParticipation();
  const h = queueScreen(before);
  h.press('Sair da fila');

  assert.deepEqual(h.updates, [null]);
  assert.equal(h.participation, null);
  assert.equal(before.status, 'waiting');
  assert.equal(before.queuePosition, 5);
});
