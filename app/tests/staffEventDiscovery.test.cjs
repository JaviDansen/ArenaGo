const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { parseStaffEvents, createStaffEventsStore } = loadModule('services/staffEventsService.js', require).exports;
const event = { id: '11111111-1111-4111-8111-111111111111', name: 'Evento real', status: 'open' };
const identity = (userId = 'a', epoch = 1, revision = 1) => ({ userId, epoch, revision });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };

test('lista Staff aceita somente o contrato conhecido e preserva o ID para seleção', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseStaffEvents({ events: [event] }))), [event]);
  assert.equal(parseStaffEvents({ events: [] }).length, 0);
  for (const body of [null, {}, { events: null }, { events: [{ ...event, id: 'outro' }] },
    { events: [{ ...event, name: '' }] }, { events: [{ ...event, status: 'unknown' }] },
    { events: [event, event] }]) assert.throws(() => parseStaffEvents(body));
});

test('fase efetiva é preservada separadamente e valores desconhecidos são recusados', () => {
  for (const effectivePhase of ['scheduled', 'open', 'not_ready', 'closing', 'closed']) {
    const parsed = parseStaffEvents({ events: [{ ...event, status: 'scheduled', effectivePhase }] });
    assert.equal(parsed[0].status, 'scheduled');
    assert.equal(parsed[0].effectivePhase, effectivePhase);
  }
  assert.throws(() => parseStaffEvents({ events: [{ ...event, effectivePhase: 'unknown' }] }));
});

test('consulta autenticada, seleção e atualização manual removem seleção anterior', async () => {
  let current = identity();
  const calls = [];
  let response = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async (...args) => { calls.push(args); return response; } },
    getIdentity: () => current });
  store.setIdentity(current);
  assert.equal(store.select(event.id), false, 'seleção aguarda resposta autorizada');
  await store.refresh();
  assert.equal(calls[0][0], '/staff/events');
  assert.equal(calls[0][1].auth, true);
  assert.equal(store.select('11111111-1111-4111-8111-111111111112'), false);
  assert.equal(store.select(event.id), true);
  assert.equal(store.getSnapshot().selected.id, event.id);
  response = { events: [] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.getSnapshot().selected, null);
});

test('401 e falha de rede limpam dados e permitem atualização posterior', async () => {
  const current = identity();
  let outcome = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  } }, getIdentity: () => current });
  store.setIdentity(current);
  await store.refresh();
  store.select(event.id);
  outcome = Object.assign(new Error('unauthorized'), { status: 401 });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'session');
  assert.equal(store.getSnapshot().selected, null);
  assert.equal(store.getSnapshot().events.length, 0);
  outcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'network');
  outcome = { events: [event] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
});

test('troca de conta, geração, revisão e respostas fora de ordem descartam dados antigos', async () => {
  let current = identity();
  const requests = [];
  const store = createStaffEventsStore({ client: { get: () => { const pending = deferred(); requests.push(pending); return pending.promise; } },
    getIdentity: () => current });
  store.setIdentity(current);
  const first = store.refresh();
  const second = store.refresh();
  requests[1].resolve({ events: [] });
  await second;
  requests[0].resolve({ events: [event] });
  await first;
  assert.equal(store.getSnapshot().events.length, 0);

  const third = store.refresh();
  current = identity('b', 2, 2);
  store.setIdentity(current);
  requests[2].resolve({ events: [event] });
  await third;
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.select(event.id), false);
  current = identity('b', 2, 3);
  assert.equal(store.isCurrent(), false, 'revalidação bloqueia imediatamente o estado anterior');
  store.setIdentity(null);
  assert.equal(store.getSnapshot().selected, null);
});

test('consulta silenciosa preserva seleção e descarta resposta após troca de identidade', async () => {
  let current = identity(), response = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async () => response }, getIdentity: () => current });
  store.setIdentity(current); await store.refresh(); store.select(event.id);
  response = { events: [{ ...event, effectivePhase: 'closing' }] };
  await store.refreshSilent();
  assert.equal(store.getSnapshot().selected.effectivePhase, 'closing');
  const waiting = deferred();
  response = waiting.promise;
  const old = store.refreshSilent();
  current = identity('new', 2, 2); store.setIdentity(current);
  waiting.resolve({ events: [event] }); await old;
  assert.equal(store.getSnapshot().selected, null);
});

// ============================================================================
// Testes de interface e integração de navegação Staff (STAFF-01)
// Cobre as seções 10.1 (Seleção de Eventos) e 10.2 (Painel Operacional)
// ============================================================================

const qaRequire = createRequire(path.resolve(__dirname, '../../qa/regression/package.json'));
let uiDeps;
try {
  uiDeps = {
    React: qaRequire('react'),
    jsx: qaRequire('react/jsx-runtime'),
    Renderer: qaRequire('react-test-renderer'),
    Navigation: qaRequire('@react-navigation/core'),
    StackRouter: qaRequire('@react-navigation/routers').StackRouter,
  };
} catch {
  uiDeps = null;
}
const skipUi = uiDeps ? false : 'dependências de qa/regression não instaladas';

function createStaffUiHarness({ initialAuth, onGet, onLogout }) {
  const { React, jsx, Renderer, Navigation, StackRouter } = uiDeps;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const navRef = Navigation.createNavigationContainerRef();
  const pollingRegistrations = [];
  let authState = initialAuth;

  const eventsSvc = loadModule('services/staffEventsService.js', require).exports;
  const opsSvc = loadModule('services/staffOperationsService.js', require).exports;
  const dashSvc = loadModule('services/staffDashboardService.js', (name) => {
    if (name === './staffOperationsService') return opsSvc;
    return require(name);
  }).exports;

  const native = Object.fromEntries(
    ['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((n) => [n, n]),
  );
  native.StyleSheet = { create: (s) => s };
  native.AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };

  function FocusedStack(props) {
    const { state, descriptors, NavigationContent } = Navigation.useNavigationBuilder(StackRouter, props);
    return React.createElement(NavigationContent, null, descriptors[state.routes[state.index].key].render());
  }

  const client = {
    get: (url, opts) => onGet(url, opts),
  };

  const makeAuth = () => ({
    ...authState,
    httpClient: client,
    logout: async () => {
      await onLogout?.();
    },
  });

  const EntryStub = ({ event, onBack }) => React.createElement(
    'View',
    null,
    React.createElement('Text', null, `EntryControl:${event.id}`),
    React.createElement(
      'Pressable',
      { accessibilityRole: 'button', accessibilityLabel: 'Voltar do controle', onPress: onBack },
      React.createElement('Text', null, 'Voltar ao painel'),
    ),
  );

  const StationStub = ({ event, experience, station }) => React.createElement(
    'View',
    null,
    React.createElement('Text', null, `StationOp:${event.id}:${experience.id}:${station.id}`),
  );

  const AuthCtx = React.createContext(null);

  const { default: StaffEventsNavigator } = loadModule('screens/staff/StaffEventsNavigator.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator: Navigation.createNavigatorFactory(FocusedStack) };
    }
    if (name === '@react-navigation/native') {
      return { useIsFocused: () => true };
    }
    if (name === '../../components/ui/AuthBackground') {
      return { AuthBackground: ({ children, ...props }) => React.createElement('View', props, children) };
    }
    if (name === '../../context/AuthContext') {
      return { AuthContext: AuthCtx, useAuth: () => React.useContext(AuthCtx) };
    }
    if (name === '../../services/staffEventsService') return eventsSvc;
    if (name === '../../services/staffDashboardService') return dashSvc;
    if (name === './StaffEntryControlRealScreen') return { __esModule: true, default: EntryStub };
    if (name === './StaffStationOperationalScreen') return { __esModule: true, default: StationStub };
    if (name === './useStaffPolling') {
      return {
        useStaffPolling(enabled, read, intervalMs, scope) {
          pollingRegistrations.push({ enabled, intervalMs, scope });
        },
      };
    }
    return require(name);
  }).exports;

  const textOf = (node) => (typeof node === 'string'
    ? node
    : (node?.children ?? []).map(textOf).join(''));

  const wrapper = (currentAuth) => React.createElement(
    Navigation.BaseNavigationContainer,
    { ref: navRef },
    React.createElement(
      AuthCtx.Provider,
      { value: currentAuth },
      React.createElement(StaffEventsNavigator),
    ),
  );

  let tree;
  return {
    pollingRegistrations,
    async mount() {
      await Renderer.act(async () => {
        tree = Renderer.create(wrapper(makeAuth()));
      });
    },
    async updateAuth(nextAuth) {
      authState = nextAuth;
      await Renderer.act(async () => {
        tree.update(wrapper(makeAuth()));
      });
    },
    allTexts() {
      return tree.root.findAllByType('Text').map(textOf);
    },
    hasText(fragment) {
      return this.allTexts().some((t) => t.includes(fragment));
    },
    textOccurrences(exact) {
      return this.allTexts().filter((t) => t === exact).length;
    },
    hasButton(label) {
      return tree.root.findAllByType('Pressable')
        .some((n) => n.props.accessibilityLabel === label);
    },
    async press(label) {
      const matches = tree.root.findAllByType('Pressable')
        .filter((n) => n.props.accessibilityLabel === label);
      assert.equal(matches.length, 1, `esperado exatamente 1 botão "${label}"`);
      await Renderer.act(async () => {
        await matches[0].props.onPress?.();
      });
    },
    async settle() {
      await Renderer.act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    },
    dispose() {
      Renderer.act(() => tree.unmount());
    },
  };
}

const makeAuthIdentity = (userId = '10000000-0000-4000-8000-000000000001', epoch = 1, revision = 1) => ({
  isAuthenticated: true,
  user: { id: userId, roles: ['staff'] },
  isIdentityVerified: () => true,
  getSessionEpoch: () => epoch,
  getIdentityRevision: () => revision,
});

const EV_A = '11111111-1111-4111-8111-111111111111';
const EV_B = '22222222-2222-4222-8222-222222222222';
const EXP_1 = '33333333-3333-4333-8333-333333333333';
const EXP_2 = '44444444-4444-4444-8444-444444444444';
const EXP_EMPTY = '55555555-5555-4555-8555-555555555555';
const ST_1 = '66666666-6666-4666-8666-666666666666';
const ST_2 = '77777777-7777-4777-8777-777777777777';
const ST_3 = '88888888-8888-4888-8888-888888888888';
const SESS_1 = '99999999-9999-4999-8999-999999999999';
const CALL_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PART_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('STAFF-01 UI (10.1): Seleção de Eventos cobre carregamento, erro vs vazio, fases reais, resposta atrasada, troca de conta e logout', { skip: skipUi }, async () => {
  const eventsDeferreds = [];
  let logoutCalls = 0;
  let scenario = 'deferred';

  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onLogout: () => { logoutCalls += 1; },
    onGet: (url) => {
      if (url !== '/staff/events') return Promise.resolve({});
      if (scenario === 'deferred') {
        const d = deferred();
        eventsDeferreds.push(d);
        return d.promise;
      }
      if (scenario === 'network') return Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
      if (scenario === 'empty') return Promise.resolve({ events: [] });
      if (scenario === 'ready') {
        return Promise.resolve({
          events: [
            { id: EV_A, name: 'Arena UNDB Real', status: 'open', effectivePhase: 'open' },
            { id: EV_B, name: 'Evento Em Preparo', status: 'scheduled', effectivePhase: 'not_ready' },
          ],
        });
      }
      return Promise.resolve({ events: [] });
    },
  });

  try {
    // 1. Estado de carregamento inicial e marca ArenaGO / STAFF / Eventos Staff
    await rig.mount();
    assert.ok(rig.hasText('Arena'));
    assert.ok(rig.hasText('GO'));
    assert.ok(rig.hasText('STAFF'));
    assert.ok(rig.hasText('Eventos Staff'));
    assert.ok(rig.hasText('Carregando eventos...'));
    assert.ok(!rig.hasText('Nenhum evento autorizado para esta conta.'));

    // Troca de conta enquanto requisição da conta u-1 estava pendente -> resposta atrasada descartada
    scenario = 'network';
    await rig.updateAuth(makeAuthIdentity('u-2', 2, 1));
    eventsDeferreds[0].resolve({
      events: [{ id: EV_A, name: 'Evento Conta Antiga', status: 'open', effectivePhase: 'open' }],
    });
    await rig.settle();

    // 2. Falha de rede NÃO mostra estado vazio, exibe alerta específico de rede
    assert.ok(!rig.hasText('Evento Conta Antiga'));
    assert.ok(rig.hasText('Não foi possível conectar ao servidor'));
    assert.ok(!rig.hasText('Nenhum evento autorizado para esta conta.'));

    // 3. Lista realmente vazia após atualizar
    scenario = 'empty';
    await rig.press('Atualizar eventos');
    assert.ok(rig.hasText('Nenhum evento autorizado para esta conta.'));

    // 4. Lista autorizada com eventos reais e sem dados inventados de mockup
    scenario = 'ready';
    await rig.press('Atualizar eventos');
    assert.ok(rig.hasText('Arena UNDB Real'));
    assert.ok(rig.hasText('Aberto'));
    assert.ok(rig.hasText('Disponível para operar'));
    assert.ok(rig.hasText('Evento Em Preparo'));
    assert.ok(rig.hasText('Não está pronto'));
    assert.ok(!rig.hasText('4 Estações'), 'não exibe contagem fictícia quando contrato não informa');

    // 5. Polling de 60s configurado na seleção e logout funcionando no rodapé
    assert.ok(rig.pollingRegistrations.some((r) => r.intervalMs === 60000 && r.enabled === true));
    await rig.press('Sair da conta');
    assert.equal(logoutCalls, 1);
  } finally {
    rig.dispose();
  }
});

test('STAFF-01 UI (10.2): Painel Operacional exibe resumo real, Controle de Entrada, agrupamento de estações, falha parcial e navegação sem mistura de eventos', { skip: skipUi }, async () => {
  let failEntry = false;
  let entryPendingCall = {
    id: CALL_1,
    participationId: PART_1,
    displayName: 'Carlos Eduardo',
    calledAt: '2026-11-17T15:00:00.000Z',
  };
  let externalQueueEnabled = true;
  let waitingCount = 2;

  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      if (url === '/staff/events') {
        return Promise.resolve({
          events: [
            { id: EV_A, name: 'Arena Neon UNDB', status: 'open', effectivePhase: 'open' },
            { id: EV_B, name: 'Torneio Fechado', status: 'closed', effectivePhase: 'closed' },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        return Promise.resolve({
          eventId: EV_A,
          experiences: [
            { id: EXP_1, name: 'Just Dance' },
            { id: EXP_2, name: 'Street Fighter' },
            { id: EXP_EMPTY, name: 'Simulador Sem Estação' },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        return Promise.resolve({
          eventId: EV_A,
          stations: [
            { id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: SESS_1 },
            { id: ST_2, experienceId: EXP_1, label: 'Estação 02', availability: 'unavailable', pendingServiceSessionId: null },
            { id: ST_3, experienceId: EXP_2, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        if (failEntry) return Promise.reject(Object.assign(new Error('unavailable'), { status: 500 }));
        return Promise.resolve({
          eventId: EV_A,
          externalQueueEnabled,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          waitingCount,
          waiting: waitingCount === 2
            ? [
                { participationId: PART_1, displayName: 'Ana', position: 1 },
                { participationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', displayName: 'Bia', position: 2 },
              ]
            : [],
          pendingCall: entryPendingCall,
        });
      }
      if (url === `/staff/events/${EV_A}/experiences/${EXP_2}/queue`) {
        return Promise.resolve({
          eventId: EV_A,
          experienceId: EXP_2,
          waitingCount: 0,
          canCallWaitingEntries: false,
          firstWaitingQueueEntryId: null,
        });
      }
      if (url === `/staff/events/${EV_B}/experiences`) {
        return Promise.resolve({ eventId: EV_B, experiences: [] });
      }
      if (url === `/staff/events/${EV_B}/stations`) {
        return Promise.resolve({ eventId: EV_B, stations: [] });
      }
      if (url === `/staff/events/${EV_B}/entry-control`) {
        return Promise.resolve({
          eventId: EV_B,
          externalQueueEnabled: false,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          waitingCount: 0,
          waiting: [],
          pendingCall: null,
        });
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    await rig.press('Selecionar evento Arena Neon UNDB');
    await rig.settle();

    // 1. Nome do evento não repetido e ausência de dados fictícios dos mockups
    assert.equal(rig.textOccurrences('Arena Neon UNDB'), 1, 'nome do evento aparece uma única vez no painel');
    assert.ok(rig.hasText('Painel operacional'));
    assert.ok(rig.hasText('Status: Aberto'));
    assert.ok(!rig.hasText('128'), 'não exibe contagem fictícia do mockup');
    assert.ok(!rig.hasText('05 de dez'), 'não exibe data fictícia do mockup');

    // 2. Métricas reais do resumo (2 disponíveis de 3 estações, 1 em atendimento, 2 na fila externa)
    assert.ok(rig.hasText('Estações ativas'));
    assert.ok(rig.hasText('Em atendimento'));
    assert.ok(rig.hasText('Fila externa'));
    assert.equal(rig.textOccurrences('2/3'), 1, 'métrica real de estações ativas');
    assert.equal(rig.textOccurrences('1'), 1, 'métrica real de estações em atendimento');
    assert.equal(rig.textOccurrences('2'), 1, 'métrica real da fila externa');
    assert.ok(rig.pollingRegistrations.some((r) => r.intervalMs === 5000 && r.enabled === true));

    // 3. Controle de Entrada diferencia chamada pendente e fila ativa
    assert.ok(rig.hasText('Controle de Entrada'));
    assert.ok(rig.hasText('Chamada pendente: Carlos Eduardo · 2 aguardando'));
    assert.ok(rig.hasText('FILA ATIVA'));
    assert.equal(rig.textOccurrences('Chamada pendente'), 1, 'badge específico de chamada pendente');

    // 4. Estações agrupadas por experiência + atendimento pendente vs disponível/indisponível
    assert.ok(rig.hasText('3 estações'));
    assert.ok(rig.hasText('Just Dance'));
    assert.ok(rig.hasText('Street Fighter'));
    assert.ok(rig.hasText('Simulador Sem Estação'));
    assert.ok(rig.hasText('Nenhuma estação associada.'));
    assert.ok(rig.hasText('Atendimento pendente nesta estação'));
    assert.ok(rig.hasText('Sem atendimento pendente'));
    assert.ok(rig.hasText('Disponível'));
    assert.ok(rig.hasText('Indisponível'));
    assert.ok(rig.hasText('Chamado'));

    // 5. Navegar ao Controle de Entrada e voltar atualizando o resumo para fila desativada sem chamada pendente
    await rig.press('Controle de Entrada');
    assert.ok(rig.hasText(`EntryControl:${EV_A}`));
    externalQueueEnabled = false;
    entryPendingCall = null;
    waitingCount = 0;
    await rig.press('Voltar do controle');
    await rig.settle();
    assert.ok(rig.hasText('Fila externa desativada · entrada direta'));
    assert.ok(rig.hasText('FILA INATIVA'));

    // 6. Falha parcial em /entry-control mostra indisponível sem apagar experiências/estações
    failEntry = true;
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(rig.hasText('Estado da fila externa indisponível'));
    assert.ok(rig.hasText('INDISPONÍVEL'));
    assert.ok(rig.hasText('Just Dance'), 'estações/experiências preservadas em falha parcial');

    // 7. Navegar para a estação correta de Street Fighter e retornar ao painel
    await rig.press('Selecionar estação Estação 01 da experiência Street Fighter');
    await rig.settle();
    assert.ok(rig.hasText(`StationOp:${EV_A}:${EXP_2}:${ST_3}`));
    await rig.press('Voltar ao painel');
    assert.ok(rig.hasText('Painel operacional'));

    // 8. Trocar para evento B sem misturar estações ou dados do evento A
    failEntry = false;
    await rig.press('Voltar aos eventos');
    await rig.press('Selecionar evento Torneio Fechado');
    await rig.settle();
    assert.ok(rig.hasText('Status: Encerrado'));
    assert.ok(rig.hasText('Nenhuma estação encontrada neste evento.'));
    assert.ok(!rig.hasText('Just Dance'));
    assert.ok(!rig.hasText('Arena Neon UNDB'));
  } finally {
    rig.dispose();
  }
});
