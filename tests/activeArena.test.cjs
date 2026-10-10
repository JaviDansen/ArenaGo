const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const experiences = [
  { id: 'experience-a', name: 'Experience A', queueSize: 3 },
  { id: 'experience-b', name: 'Experience B', queueSize: 5 },
];

function participation(overrides = {}) {
  return {
    event: { id: 'event-1', experiences },
    status: 'active',
    queuePosition: null,
    experienceQueue: null,
    activeExperience: { experienceId: experiences[0].id },
    experienceParticipations: {},
    ...overrides,
  };
}

function arena(initial) {
  let current = initial;
  const queue = [];
  const alerts = [];
  const navigationCalls = [];
  const native = Object.fromEntries(['Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
  native.Alert = { alert: (...args) => alerts.push(args) };
  const screen = loadModule('screens/arena/ActiveArenaScreen.js', (name) => {
    if (name === 'react') return {
      useContext: () => ({ participation: current, setParticipation: (update) => queue.push(update) }),
      useEffect() {},
    };
    if (name === 'react-native') return native;
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  }, ['handleSimulateStaffCheck', 'handleSimulateAbsence', 'handleJoinExperienceQueue',
    'handleLeaveExperienceQueue', 'handleSimulateExperienceCall', 'handleLeaveArena']);

  function render() {
    Object.freeze(current);
    Object.freeze(current.experienceParticipations);
    Object.freeze(current.activeExperience);
    Object.freeze(current.experienceQueue);
    screen.exports.default({ navigation: { navigate: (name) => navigationCalls.push(name) } });
  }

  render();
  return {
    get participation() { return current; },
    alerts,
    navigationCalls,
    queueParticipation(update) { queue.push(update); },
    act(callback) {
      callback(screen.context.__capture);
      for (const update of queue.splice(0)) {
        current = typeof update === 'function' ? update(current) : update;
      }
      render();
    },
  };
}

test('staff check records the first completion and preserves the rest of the participation', () => {
  for (const counters of [{}, undefined]) {
    const before = participation({ experienceParticipations: counters, customData: { answer: 42 } });
    const h = arena(before);
    h.act((c) => c.handleSimulateStaffCheck());
    assert.deepEqual({ ...h.participation.experienceParticipations }, { 'experience-a': 1 });
    assert.equal(h.participation.activeExperience, null);
    for (const key of Object.keys(before).filter((key) => !['activeExperience', 'experienceParticipations'].includes(key))) {
      assert.equal(h.participation[key], before[key]);
    }
    assert.equal(before.activeExperience.experienceId, 'experience-a');
    assert.equal(before.experienceParticipations, counters);
    assert.deepEqual(h.navigationCalls, []);
  }
});

test('staff check increments an existing count without changing other experience counts', () => {
  const before = participation({ experienceParticipations: { 'experience-a': 4, 'experience-b': 2 } });
  const h = arena(before);
  h.act((c) => c.handleSimulateStaffCheck());
  assert.deepEqual({ ...h.participation.experienceParticipations }, { 'experience-a': 5, 'experience-b': 2 });
  assert.deepEqual(before.experienceParticipations, { 'experience-a': 4, 'experience-b': 2 });
});

test('completion allows joining the same experience again and counts only after another staff check', () => {
  const h = arena(participation());
  h.act((c) => c.handleSimulateStaffCheck());
  const counters = h.participation.experienceParticipations;
  h.act((c) => c.handleJoinExperienceQueue(experiences[0]));
  assert.equal(h.participation.experienceQueue.experienceId, 'experience-a');
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleSimulateExperienceCall());
  assert.equal(h.participation.activeExperience.experienceId, 'experience-a');
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleSimulateStaffCheck());
  assert.equal(h.participation.experienceParticipations['experience-a'], 2);
  h.act((c) => c.handleJoinExperienceQueue(experiences[1]));
  assert.equal(h.participation.experienceQueue.experienceId, 'experience-b');
  assert.deepEqual({ ...h.participation.experienceParticipations }, { 'experience-a': 2 });
});

test('staff check without an active experience preserves the participation unchanged', () => {
  for (const activeExperience of [null, undefined]) {
    const before = participation({ activeExperience, experienceParticipations: { 'experience-a': 3 } });
    const h = arena(before);
    h.act((c) => c.handleSimulateStaffCheck());
    assert.equal(h.participation, before);
  }
});

test('two staff checks in the same batch count an active experience only once', () => {
  const h = arena(participation());
  h.act((c) => { c.handleSimulateStaffCheck(); c.handleSimulateStaffCheck(); });
  assert.deepEqual({ ...h.participation.experienceParticipations }, { 'experience-a': 1 });
  assert.equal(h.participation.activeExperience, null);
});

test('staff check uses the latest participation, active experience ID and count', () => {
  const h = arena(participation());
  const latest = participation({ activeExperience: { experienceId: 'experience-b' },
    experienceParticipations: { 'experience-a': 2, 'experience-b': 7 }, customData: { answer: 42 } });
  h.act((c) => { h.queueParticipation(latest); c.handleSimulateStaffCheck(); });
  assert.deepEqual({ ...h.participation.experienceParticipations }, { 'experience-a': 2, 'experience-b': 8 });
  assert.equal(h.participation.customData, latest.customData);
  assert.equal(h.participation.activeExperience, null);
});

test('staff check does not count an experience already cleared by an earlier state update', () => {
  const h = arena(participation());
  const latest = participation({ activeExperience: null, experienceParticipations: { 'experience-a': 2 } });
  h.act((c) => { h.queueParticipation(latest); c.handleSimulateStaffCheck(); });
  assert.equal(h.participation, latest);
});

test('absence, leaving a queue, joining, being called and leaving the Arena never count completions', () => {
  const counters = { 'experience-a': 4, 'experience-b': 3 };
  const h = arena(participation({ experienceParticipations: counters }));
  h.act((c) => c.handleSimulateAbsence());
  assert.equal(h.participation.activeExperience, null);
  assert.deepEqual({ ...h.participation.experienceQueue }, { experienceId: 'experience-a', position: 4 });
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleLeaveExperienceQueue());
  assert.equal(h.participation.experienceQueue, null);
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleJoinExperienceQueue(experiences[1]));
  assert.equal(h.participation.experienceQueue.experienceId, 'experience-b');
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleSimulateExperienceCall());
  assert.equal(h.participation.activeExperience.experienceId, 'experience-b');
  assert.equal(h.participation.experienceParticipations, counters);
  h.act((c) => c.handleLeaveArena());
  h.act(() => h.alerts[0][2].find((button) => button.style === 'destructive').onPress());
  assert.equal(h.participation.status, 'finished');
  assert.equal(h.participation.activeExperience, null);
  assert.equal(h.participation.experienceParticipations, counters);
  assert.deepEqual(h.navigationCalls, ['Evaluation']);
});
