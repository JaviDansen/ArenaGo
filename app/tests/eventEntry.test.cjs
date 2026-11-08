const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

const event = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Arena real', timezone: 'America/Sao_Paulo',
  startsAt: '2026-11-08T10:00:00.000Z', officialEndsAt: '2026-11-08T20:00:00.000Z',
  operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: true,
};
const eligible = { eligible: true, blockingReasons: [] };

function screenRig(path, context, params = {}) {
  const state = [], calls = [];
  let cursor = 0, tree;
  const react = {
    useContext: () => context,
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  };
  const module = loadModule(path, (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return {
      Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput',
      StyleSheet: { create: (styles) => styles },
    };
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  }).exports;
  function render() {
    cursor = 0;
    tree = module.default({
      route: { params },
      navigation: {
        navigate: (name, value) => calls.push({ name, value }),
        reset: (value) => calls.push({ reset: value }),
      },
    });
  }
  function button(label) {
    const result = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(result, `Botão ausente: ${label}`);
    return result;
  }
  render();
  return {
    calls, render, button,
    text: () => textOf(tree),
    input(value) { nodes(tree).find((node) => node.type === 'TextInput').props.onChangeText(value); render(); },
  };
}

test('consulta real envia o código sem mudar sua caixa e navega somente após resposta válida', async () => {
  const requests = [];
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: async (code) => { requests.push(code); return { kind: 'found', event, eligibility: eligible }; },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  rig.input('  AbC-42  ');
  await rig.button('Continuar').props.onPress();
  assert.deepEqual(requests, ['AbC-42']);
  assert.deepEqual(structuredClone(rig.calls), [{ name: 'EventConfirmation', value: { event, eligibility: eligible } }]);
});

test('código vazio não consulta o backend nem navega', async () => {
  let count = 0;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: async () => { count++; return { kind: 'error', message: 'Evento inexistente' }; },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  await rig.button('Continuar').props.onPress();
  assert.equal(count, 0);
  rig.render();
  assert.match(rig.text(), /Digite o código do evento/);
  assert.deepEqual(rig.calls, []);
});

test('consulta inexistente e resposta tardia após logout não navegam', async () => {
  let resolve, current = true;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => current,
    lookupEvent: () => new Promise((done) => { resolve = done; }),
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  rig.input('ABC');
  const pending = rig.button('Continuar').props.onPress();
  current = false;
  resolve({ kind: 'found', event, eligibility: eligible });
  await pending;
  assert.deepEqual(rig.calls, []);
  context.lookupEvent = async () => ({ kind: 'error', message: 'Evento inexistente' });
  rig.render();
  await rig.button('Continuar').props.onPress();
  assert.deepEqual(rig.calls, []);
});

test('ineligibilidade mostra motivo real e impede POST', async () => {
  let count = 0;
  const context = {
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => { count++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } });
  assert.match(rig.text(), /PROFILE_INCOMPLETE/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress();
  assert.equal(count, 0);
  assert.deepEqual(rig.calls, []);
});

test('ingresso confirmado navega uma vez; toque duplo não duplica POST', async () => {
  let resolve, count = 0;
  const context = {
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
    confirmEventEntry: () => { count++; return new Promise((done) => { resolve = done; }); },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  const button = rig.button('Confirmar entrada');
  const first = button.props.onPress();
  await button.props.onPress();
  assert.equal(count, 1);
  resolve({ kind: 'complete' });
  await first;
  assert.deepEqual(structuredClone(rig.calls), [{ reset: { index: 0, routes: [{ name: 'MainTabs' }] } }]);
  assert.doesNotMatch(rig.text(), /Demonstração|queuePosition|Local A/);
});

test('ingresso confirmado sem sincronização só repete GET', async () => {
  let posts = 0, reads = 0;
  const context = {
    admission: { status: 'confirmed_unsynced', event, confirmedParticipationId: '22222222-2222-4222-8222-222222222222',
      error: 'Atualize sem repetir o ingresso.' }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => { posts++; return { kind: 'complete' }; },
    retryEntrySync: async () => { reads++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  assert.match(rig.text(), /Atualize sem repetir/);
  await rig.button('Atualizar participação').props.onPress();
  assert.equal(posts, 0);
  assert.equal(reads, 1);
  assert.equal(rig.calls.length, 1);
});

test('erro HTTP na confirmação preserva a tela e informa o problema', async () => {
  const context = {
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => ({ kind: 'error', message: 'Evento encerrado' }),
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  await rig.button('Confirmar entrada').props.onPress();
  assert.deepEqual(rig.calls, []);
  context.admission = { status: 'error', event, error: 'Evento encerrado' };
  rig.render();
  assert.match(rig.text(), /Evento encerrado/);
});
