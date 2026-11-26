const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const qaRequire = createRequire(path.resolve(__dirname, '../../qa/regression/package.json'));
let deps = null;
try {
  deps = {
    React: qaRequire('react'),
    jsx: qaRequire('react/jsx-runtime'),
    Renderer: qaRequire('react-test-renderer'),
  };
} catch {
  deps = null;
}
const skip = deps ? false : 'dependências de qa/regression não instaladas (npm ci em qa/regression)';

const EV_A = '11111111-1111-4111-8111-111111111111';
const EV_B = '22222222-2222-4222-8222-222222222222';
const EXP_1 = '33333333-3333-4333-8333-333333333333';
const ST_1 = '44444444-4444-4444-8444-444444444444';
const ST_2 = '55555555-5555-4555-8555-555555555555';
const USER_1 = 'abcdef00-0000-4000-8000-000000000001';
const SESSION_1 = '10000000-0000-4000-8000-000000000001';
const ENTRY_1 = '77777777-7777-4777-8777-777777777771';
const ENTRY_2 = '77777777-7777-4777-8777-777777777772';
const ENTRY_3 = '77777777-7777-4777-8777-777777777773';
const SESS_1 = '88888888-8888-4888-8888-888888888881';

// Normaliza objetos criados dentro do contexto VM para o contexto do teste (STAFF02-AUD-04).
const plain = (value) => JSON.parse(JSON.stringify(value));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// ============================================================================
// 1. Testes unitários puros do indicador seguro de tempo desde a chamada
// ============================================================================

const pureSections = (() => {
  const nativeStub = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map((n) => [n, n]));
  nativeStub.StyleSheet = { create: (s) => s };
  const adminTheme = loadModule('screens/admin/components/adminTheme.js', require).exports;
  const adminLiveUi = loadModule('screens/admin/components/AdminLiveUI.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === './adminTheme') return adminTheme;
    return require(name);
  }).exports;
  return loadModule('screens/staff/components/StaffStationSections.js', (name) => {
    if (name === 'react') return require('react');
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;
})();

test('STAFF-02: formatElapsedSinceCall formata MM:SS, HH:MM:SS e usa fallback seguro sem alterar regras temporais', () => {
  const calledAt = '2026-11-19T15:00:00.000Z';
  const baseMs = Date.parse(calledAt);

  const check = (inputAt, nowMs, expected) => {
    const result = pureSections.formatElapsedSinceCall(inputAt, nowMs);
    assert.equal(result.label, expected.label);
    assert.equal(result.live, expected.live);
    assert.deepEqual(plain(result), expected);
  };

  check(calledAt, baseMs + 23_000, { label: 'Chamado há 00:23', live: true });
  check(calledAt, baseMs + 3_725_000, { label: 'Chamado há 01:02:05', live: true });
  // Pequeno desvio negativo de relógio (< 60s) limita em 00:00
  check(calledAt, baseMs - 10_000, { label: 'Chamado há 00:00', live: true });
  // Desvio negativo grande (> 60s), tempo excessivo (> 24h) ou timestamp inválido caem no fallback seguro
  check(calledAt, baseMs - 120_000, { label: 'Chamada pendente', live: false });
  check(calledAt, baseMs + 25 * 60 * 60 * 1000, { label: 'Chamada pendente', live: false });
  check('invalido', baseMs, { label: 'Chamada pendente', live: false });
  check(null, baseMs, { label: 'Chamada pendente', live: false });
});

// ============================================================================
// 2. Harness real React + React Test Renderer para StaffStationOperationalScreen
// ============================================================================

function createStationHarness({
  initialEvent = { id: EV_A, name: 'Arena Oficial UNDB' },
  initialExperience = { id: EXP_1, name: 'Simulador F1' },
  initialStation = { id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null },
  initialAuth = {
    isAuthenticated: true,
    user: { id: USER_1, roles: ['staff'] },
    sessionId: SESSION_1,
    isIdentityVerified: () => true,
    getSessionEpoch: () => 1,
    getIdentityRevision: () => 1,
  },
  onGet,
  onPost,
  onChanged = () => {},
  onRefresh = () => {},
  onAccessDenied = () => {},
  onStationNotFound,
  secureInitial = new Map(),
  secureAvailable = true,
  getNow = () => Date.parse('2026-11-19T15:00:23.000Z'),
} = {}) {
  const { React, jsx, Renderer } = deps;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const secureValues = new Map(secureInitial);
  let keySerial = 0;
  let pollingRegistration = null;
  let authState = initialAuth;
  let eventProp = initialEvent;
  let experienceProp = initialExperience;
  let stationProp = initialStation;
  let accessDeniedProp = false;
  let accessDeniedKindProp = 'denied';
  let eventCurrentFlag = true;
  let focused = true;
  const focusListeners = new Set();
  const appStateListeners = new Set();

  const native = Object.fromEntries(
    ['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]),
  );
  native.StyleSheet = { create: (styles) => styles };
  native.Platform = { OS: 'ios' };
  native.AppState = {
    currentState: 'active',
    addEventListener: (_, listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  };

  const AuthCtx = React.createContext(null);
  const authModule = { AuthContext: AuthCtx, useAuth: () => React.useContext(AuthCtx) };

  const entrySvc = loadModule('services/staffEntryService.js', require).exports;
  const opsSvc = loadModule('services/staffOperationsService.js', (name) => {
    if (name === './staffEntryService.js' || name === './staffEntryService') return entrySvc;
    return require(name);
  }).exports;
  const intentStorageSvc = loadModule('services/staffIntentStorage.js', (name) => {
    if (name === 'react-native') return native;
    if (name === 'expo-secure-store') {
      return {
        isAvailableAsync: async () => secureAvailable,
        getItemAsync: async (key) => secureValues.get(key) ?? null,
        setItemAsync: async (key, value) => { secureValues.set(key, value); },
        deleteItemAsync: async (key) => { secureValues.delete(key); },
      };
    }
    return require(name);
  }).exports;

  const adminTheme = loadModule('screens/admin/components/adminTheme.js', require).exports;
  const adminLiveUi = loadModule('screens/admin/components/AdminLiveUI.js', (name) => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === './adminTheme') return adminTheme;
    return require(name);
  }).exports;
  const stationSections = loadModule('screens/staff/components/StaffStationSections.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;
  const syncFeedback = loadModule('screens/staff/components/StaffSyncFeedback.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;

  const StaffStationOperationalScreen = loadModule('screens/staff/StaffStationOperationalScreen.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/native') {
      return {
        useIsFocused: () => {
          const [, bump] = React.useState(0);
          React.useEffect(() => {
            const fn = () => bump((n) => n + 1);
            focusListeners.add(fn);
            return () => focusListeners.delete(fn);
          }, []);
          return focused;
        },
      };
    }
    if (name === 'expo-crypto') {
      return { randomUUID: () => `50000000-0000-4000-8000-${String(++keySerial).padStart(12, '0')}` };
    }
    if (name === '../../context/AuthContext') return authModule;
    if (name === '../../services/staffOperationsService') return opsSvc;
    if (name === '../../services/staffIntentStorage') return intentStorageSvc;
    if (name === '../admin/components/AdminLiveUI') return adminLiveUi;
    if (name === './components/StaffStationSections') return stationSections;
    if (name === './components/StaffSyncFeedback') return syncFeedback;
    if (name === './useStaffPolling') {
      return {
        useStaffPolling(enabled, read, intervalMs, scope) {
          pollingRegistration = { enabled, read, intervalMs, scope };
        },
      };
    }
    return require(name);
  }).exports.default;

  const httpClient = {
    get: (url, opts) => onGet(url, opts),
    post: (url, body, opts) => onPost(url, body, opts),
  };

  const renderEl = () => React.createElement(
    AuthCtx.Provider,
    { value: { ...authState, httpClient } },
    React.createElement(StaffStationOperationalScreen, {
      event: eventProp,
      experience: experienceProp,
      station: stationProp,
      isEventCurrent: () => eventCurrentFlag,
      onChanged,
      onRefresh,
      accessDenied: accessDeniedProp,
      accessDeniedKind: accessDeniedKindProp,
      onAccessDenied,
      onStationNotFound,
      getNow,
    }),
  );

  let tree = null;
  const flatten = (value) => (Array.isArray(value)
    ? value.map(flatten).join('')
    : value && typeof value === 'object'
      ? flatten(value.props?.children)
      : String(value ?? ''));

  return {
    secureValues,
    getPolling: () => pollingRegistration,
    async mount() {
      await Renderer.act(async () => {
        tree = Renderer.create(renderEl());
      });
    },
    async rerender(patch = {}) {
      if ('auth' in patch) authState = patch.auth;
      if ('event' in patch) eventProp = patch.event;
      if ('experience' in patch) experienceProp = patch.experience;
      if ('station' in patch) stationProp = patch.station;
      if ('accessDenied' in patch) accessDeniedProp = patch.accessDenied;
      if ('accessDeniedKind' in patch) accessDeniedKindProp = patch.accessDeniedKind;
      if ('eventCurrent' in patch) eventCurrentFlag = patch.eventCurrent;
      await Renderer.act(async () => {
        tree.update(renderEl());
      });
    },
    async setFocused(nextFocused) {
      focused = nextFocused;
      await Renderer.act(async () => {
        for (const fn of [...focusListeners]) fn();
      });
    },
    async setAppState(nextState) {
      native.AppState.currentState = nextState;
      await Renderer.act(async () => {
        for (const fn of [...appStateListeners]) fn(nextState);
      });
    },
    async act(work) {
      await Renderer.act(work);
    },
    allTexts() {
      return tree.root.findAllByType('Text').map((n) => flatten(n.props.children));
    },
    hasText(fragment) {
      return this.allTexts().some((t) => t.includes(fragment));
    },
    hasExactText(exact) {
      return this.allTexts().some((t) => t.trim() === exact);
    },
    hasQueueRow(position, name, status = 'Aguardando') {
      return tree.root.findAllByType('View').some((node) => {
        const texts = node.findAllByType('Text').map((t) => flatten(t.props.children).trim());
        return texts.length === 3
          && texts[0] === String(position)
          && texts[1] === name
          && texts[2] === status;
      });
    },
    pressables(label) {
      return tree.root.findAllByType('Pressable').filter((n) => n.props.accessibilityLabel === label);
    },
    hasButton(label) {
      return this.pressables(label).length > 0;
    },
    isDisabled(label) {
      const found = this.pressables(label);
      assert.equal(found.length, 1, `botão único esperado: ${label}`);
      return Boolean(found[0].props.disabled);
    },
    handler(label) {
      const found = this.pressables(label);
      assert.equal(found.length, 1, `handler único esperado: ${label}`);
      return found[0].props.onPress;
    },
    async press(label) {
      const found = this.pressables(label);
      assert.equal(found.length, 1, `botão único esperado: ${label}`);
      await Renderer.act(async () => {
        await found[0].props.onPress?.();
      });
    },
    modals() {
      return tree.root.findAllByType('Modal');
    },
    async triggerPoll() {
      assert.ok(pollingRegistration && pollingRegistration.enabled, 'polling deve estar habilitado');
      await Renderer.act(async () => {
        await pollingRegistration.read();
      });
    },
    dispose() {
      if (tree) Renderer.act(() => tree.unmount());
    },
  };
}

test('STAFF-02: apresentação dos Estados A/B, ordem FIFO exata com linhas posicionais, fila vazia, indisponível e indicador de polling', { skip }, async () => {
  const initialRead = deferred();
  let stateResponse = null;

  const h = createStationHarness({
    onGet: (url) => {
      if (url.endsWith('/operational-state')) {
        return stateResponse ? Promise.resolve(stateResponse) : initialRead.promise;
      }
      return Promise.resolve({});
    },
  });

  try {
    // 1. Carregamento inicial sem dados inventados; polling pausado durante loading
    await h.mount();
    assert.ok(h.hasExactText('Cabine 01'));
    assert.ok(h.hasExactText('Simulador F1'));
    assert.ok(h.hasExactText('Arena Oficial UNDB'));
    assert.ok(h.hasExactText('Carregando atendimento...'));
    assert.ok(h.hasText('Atualização temporariamente pausada'));
    assert.ok(!h.hasText('Atualização automática ativa'));
    assert.equal(h.getPolling().enabled, false);
    assert.ok(!h.hasText('Fila vazia'));
    assert.ok(!h.hasText('Street Fighter'));
    assert.ok(!h.hasText('BEAST Arena'));

    // 2. Estado A com fila FIFO não-alfabética, nomes longos e validação posicional
    const longName = 'Zélia Maria Aparecida da Conceição Cavalcante Júnior';
    stateResponse = {
      eventId: EV_A,
      experienceId: EXP_1,
      stationId: ST_1,
      availability: 'available',
      canCall: true,
      waitingCount: 3,
      waiting: [
        { queueEntryId: ENTRY_1, displayName: longName, position: 1 },
        { queueEntryId: ENTRY_2, displayName: 'Alberto Silva', position: 2 },
        { queueEntryId: ENTRY_3, displayName: 'Bruno Rocha', position: 3 },
      ],
      pending: null,
    };
    await h.act(async () => { initialRead.resolve(stateResponse); });

    assert.equal(h.hasExactText('DISPONÍVEL'), true);
    assert.equal(h.hasExactText('INDISPONÍVEL'), false);
    assert.equal(h.hasExactText('FILA DA EXPERIÊNCIA'), true);
    assert.equal(h.hasExactText('3 aguardando'), true);
    assert.equal(h.hasQueueRow(1, longName), true);
    assert.equal(h.hasQueueRow(2, 'Alberto Silva'), true);
    assert.equal(h.hasQueueRow(3, 'Bruno Rocha'), true);
    assert.equal(h.hasExactText('Fila compartilhada entre as estações'), true);
    assert.equal(h.hasButton('Fila compartilhada entre as estações'), false, 'informação compartilhada não é clicável');
    assert.equal(h.hasExactText('ATENDIMENTO ATUAL'), true);
    assert.equal(h.hasExactText('Nenhum participante chamado'), true);
    assert.ok(h.hasText('Atualização automática ativa'));
    assert.equal(h.getPolling().enabled, true);
    assert.equal(h.isDisabled('Chamar próximo'), false);

    // Pausa por perda de foco e segundo plano reflete imediatamente no indicador
    await h.setFocused(false);
    assert.ok(h.hasText('Atualização temporariamente pausada'));
    assert.ok(!h.hasText('Atualização automática ativa'));
    await h.setFocused(true);
    assert.ok(h.hasText('Atualização automática ativa'));
    await h.setAppState('background');
    assert.ok(h.hasText('Atualização temporariamente pausada'));
    await h.setAppState('active');
    assert.ok(h.hasText('Atualização automática ativa'));

    // 3. Estado A com fila vazia (não confunde vazio com erro de conexão)
    stateResponse = {
      ...stateResponse,
      canCall: false,
      waitingCount: 0,
      waiting: [],
    };
    await h.press('Atualizar atendimento');
    assert.equal(h.hasExactText('0 aguardando'), true);
    assert.equal(h.hasExactText('Fila vazia'), true);
    assert.equal(h.hasExactText('Nenhuma pessoa aguardando nesta experiência.'), true);
    assert.ok(!h.hasText('Falha de conexão'));
    assert.equal(h.isDisabled('Chamar próximo'), true);

    // 4. Estação indisponível usa badge exato INDISPONÍVEL e bloqueia Chamar próximo
    stateResponse = {
      ...stateResponse,
      availability: 'unavailable',
      canCall: false,
      waitingCount: 1,
      waiting: [{ queueEntryId: ENTRY_2, displayName: 'Alberto Silva', position: 1 }],
    };
    await h.press('Atualizar atendimento');
    assert.equal(h.hasExactText('INDISPONÍVEL'), true);
    assert.equal(h.hasExactText('DISPONÍVEL'), false);
    assert.equal(h.hasQueueRow(1, 'Alberto Silva'), true);
    assert.equal(h.isDisabled('Chamar próximo'), true);

    // 5. Encerramento operacional (disponível + fila > 0 + canCall=false) mantém Chamar próximo desabilitado
    stateResponse = {
      ...stateResponse,
      availability: 'available',
      canCall: false,
      waitingCount: 1,
      waiting: [{ queueEntryId: ENTRY_2, displayName: 'Alberto Silva', position: 1 }],
    };
    await h.press('Atualizar atendimento');
    assert.equal(h.hasExactText('DISPONÍVEL'), true);
    assert.equal(h.isDisabled('Chamar próximo'), true);
    assert.ok(h.hasText('Novas chamadas não estão liberadas'));

    // 6. Estado B com atendimento pendente exibe modal responsivo SafeArea + ScrollView e pausa polling enquanto modal abre
    stateResponse = {
      ...stateResponse,
      availability: 'available',
      canCall: false,
      waitingCount: 1,
      waiting: [{ queueEntryId: ENTRY_3, displayName: 'Bruno Rocha', position: 1 }],
      pending: {
        serviceSessionId: SESS_1,
        queueEntryId: ENTRY_2,
        displayName: 'Alberto Silva',
        calledAt: '2026-11-19T15:00:00.000Z',
      },
    };
    await h.press('Atualizar atendimento');
    assert.equal(h.hasExactText('Alberto Silva'), true);
    assert.equal(h.hasExactText('Em atendimento'), true);
    assert.equal(h.hasExactText('Chamado há 00:23'), true);
    assert.equal(h.hasQueueRow(1, 'Bruno Rocha'), true);
    assert.equal(h.hasButton('Chamar próximo'), false);
    assert.equal(h.isDisabled('Concluir experiência'), false);
    assert.equal(h.isDisabled('Marcar ausência'), false);
    assert.equal(h.isDisabled('Remover da fila'), false);
    assert.equal(h.allTexts().filter((t) => t === 'Alberto Silva').length, 1);

    // STAFF02-AUD-07 + STAFF02-AUD-05: abrir modal pausa polling no indicador/hook e envolve conteúdo em SafeAreaView + ScrollView
    await h.press('Concluir experiência');
    const modal = h.modals()[0];
    assert.equal(modal.props.visible, true);
    assert.equal(modal.findAllByType('SafeAreaView').length, 1);
    assert.equal(modal.findAllByType('ScrollView').length, 1);
    assert.equal(h.getPolling().enabled, false);
    assert.ok(h.hasText('Atualização temporariamente pausada'));
    assert.ok(!h.hasText('Atualização automática ativa'));
    await h.act(async () => { modal.props.onRequestClose(); });
    assert.equal(h.modals()[0].props.visible, false);
    assert.equal(h.getPolling().enabled, true);
    assert.ok(h.hasText('Atualização automática ativa'));
  } finally {
    h.dispose();
  }
});

test('STAFF-02 + STAFF02-AUD-01/05: troca de estação/evento, stale/erro no indicador, verificação contextual 404 (200 vs 403/404/401/500), modal aberto e SecureStore', { skip }, async () => {
  const reqs = [];
  let postCount = 0;
  let deniedKinds = [];
  const slot = `arenago.staff.operation.${USER_1}`;

  const h = createStationHarness({
    onGet: (url) => {
      const d = deferred();
      reqs.push({ url, d });
      return d.promise;
    },
    onPost: async () => {
      postCount += 1;
      return {};
    },
    onAccessDenied: (kind) => deniedKinds.push(kind),
  });

  try {
    await h.mount();
    assert.equal(reqs.length, 1);

    // 1. Troca de estação descarta resposta tardia da estação anterior
    await h.rerender({
      station: { id: ST_2, experienceId: EXP_1, label: 'Cabine 02', availability: 'available', pendingServiceSessionId: null },
    });
    assert.equal(reqs.length, 2);

    await h.act(async () => {
      reqs[1].d.resolve({
        eventId: EV_A, experienceId: EXP_1, stationId: ST_2, availability: 'available', canCall: false,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_2, displayName: 'Pessoa Estação 02', position: 1 }],
        pending: { serviceSessionId: SESS_1, queueEntryId: ENTRY_1, displayName: 'Chamado 02', calledAt: '2026-11-19T15:00:00.000Z' },
      });
    });
    await h.act(async () => {
      reqs[0].d.resolve({
        eventId: EV_A, experienceId: EXP_1, stationId: ST_1, availability: 'available', canCall: true,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_3, displayName: 'Pessoa Estação Antiga', position: 1 }],
        pending: null,
      });
    });
    assert.equal(h.hasExactText('Cabine 02'), true);
    assert.equal(h.hasExactText('Chamado 02'), true);
    assert.ok(!h.hasText('Pessoa Estação Antiga'));

    // 2. Falha transitória no polling marca stale + indicador 'Dados desatualizados' sem enviar POST
    await h.act(async () => {
      const pollPromise = h.getPolling().read();
      assert.equal(reqs.length, 3);
      reqs[2].d.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
      await pollPromise;
    });
    assert.ok(h.hasText('Dados da estação possivelmente desatualizados'));
    assert.ok(h.hasText('Dados desatualizados'));
    assert.ok(!h.hasText('Atualização automática ativa'));
    assert.equal(h.isDisabled('Concluir experiência'), true);
    assert.equal(h.isDisabled('Marcar ausência'), true);
    assert.equal(h.isDisabled('Remover da fila'), true);
    assert.equal(postCount, 0);

    // Recuperação pelo próximo polling limpa stale e volta indicador ativo
    await h.act(async () => {
      const pollRecover = h.getPolling().read();
      assert.equal(reqs.length, 4);
      reqs[3].d.resolve({
        eventId: EV_A, experienceId: EXP_1, stationId: ST_2, availability: 'available', canCall: false,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_2, displayName: 'Pessoa Estação 02', position: 1 }],
        pending: { serviceSessionId: SESS_1, queueEntryId: ENTRY_1, displayName: 'Chamado 02', calledAt: '2026-11-19T15:00:00.000Z' },
      });
      await pollRecover;
    });
    assert.equal(h.isDisabled('Concluir experiência'), false);
    assert.ok(h.hasText('Atualização automática ativa'));
    assert.equal(postCount, 0);

    // 3. Poll em voo recebe 404 com modal aberto -> fecha modal, invalida callback antigo, consulta /stations = 200 (Caso A), preserva SecureStore e zero POST
    const reservedRecord = JSON.stringify({
      kind: 'call', userId: USER_1, sessionId: SESSION_1, eventId: EV_A,
      experienceId: EXP_1, stationId: ST_2, serviceSessionId: null,
      key: '50000000-0000-4000-8000-000000000091', phase: 'dispatching',
    });
    h.secureValues.set(slot, reservedRecord);
    let poll404;
    let idxOp404;
    await h.act(async () => {
      poll404 = h.getPolling().read();
      idxOp404 = reqs.length - 1;
    });
    await h.press('Concluir experiência');
    assert.equal(h.modals()[0].props.visible, true);
    const staleConfirm = h.handler('CONFIRMAR OPERAÇÃO');

    let idxVerifyStations;
    await h.act(async () => {
      reqs[idxOp404].d.reject(Object.assign(new Error('not-found'), { status: 404 }));
      await new Promise((r) => setTimeout(r, 0));
      idxVerifyStations = reqs.length - 1;
    });
    assert.match(reqs[idxVerifyStations].url, /\/stations$/);
    assert.ok(h.hasText('Verificando acesso à estação...'));
    assert.ok(!h.hasText('Chamado 02'));
    assert.ok(!h.hasText('Pessoa Estação 02'));
    assert.equal(h.modals().every((m) => !m.props.visible), true);

    await h.act(async () => { await staleConfirm(); });
    assert.equal(postCount, 0, 'callback antigo neutralizado após 404');

    await h.act(async () => {
      reqs[idxVerifyStations].d.resolve({ eventId: EV_A, stations: [] });
      await poll404;
    });
    assert.equal(h.hasExactText('Acesso à estação indisponível.'), true);
    assert.deepEqual(deniedKinds, [], 'Caso A (/stations=200) mantém negativa local à estação sem bloquear evento');
    assert.ok(!h.hasText('Atualização automática ativa'));
    assert.ok(!h.hasText('Dados desatualizados'));
    assert.equal(h.secureValues.get(slot), reservedRecord, 'intenção persistida preservada no SecureStore');
    h.secureValues.delete(slot);

    // 4. Caso C: 404 em /operational-state com verificação /stations retornando 500 -> bloqueia, mostra erro e permite atualizar
    await h.act(async () => {
      const refresh500 = h.handler('Atualizar atendimento')();
      const idxOp = reqs.length - 1;
      reqs[idxOp].d.reject(Object.assign(new Error('not-found'), { status: 404 }));
      await new Promise((r) => setTimeout(r, 0));
      const idxVer = reqs.length - 1;
      assert.match(reqs[idxVer].url, /\/stations$/);
      reqs[idxVer].d.reject(Object.assign(new Error('server-error'), { status: 500 }));
      await refresh500;
    });
    assert.equal(h.hasExactText('Não foi possível consultar a estação.'), true);
    assert.deepEqual(deniedKinds, []);

    // 5. Caso B: 404 em /operational-state com /stations retornando 403 -> propaga onAccessDenied('denied')
    await h.act(async () => {
      const refreshVerify403 = h.handler('Atualizar atendimento')();
      const idxOp = reqs.length - 1;
      reqs[idxOp].d.reject(Object.assign(new Error('not-found'), { status: 404 }));
      await new Promise((r) => setTimeout(r, 0));
      const idxVer = reqs.length - 1;
      reqs[idxVer].d.reject(Object.assign(new Error('forbidden'), { status: 403 }));
      await refreshVerify403;
    });
    assert.deepEqual(deniedKinds, ['denied']);

    // 6. Erro inicial 500 indica 'Atualização indisponível' e reabilita acesso em novo evento B com intenção bloqueante
    await h.rerender({
      event: { id: EV_B, name: 'Evento B' },
      station: { id: ST_1, experienceId: EXP_1, label: 'Cabine B1', availability: 'available', pendingServiceSessionId: null },
    });
    await h.act(async () => {
      const idxB500 = reqs.length - 1;
      reqs[idxB500].d.reject(Object.assign(new Error('unavailable'), { status: 500 }));
    });
    assert.ok(h.hasText('Atualização indisponível'));
    assert.ok(!h.hasText('Atualização automática ativa'));

    h.secureValues.set(slot, JSON.stringify({
      kind: 'call', userId: USER_1, sessionId: SESSION_1, eventId: EV_B,
      experienceId: EXP_1, stationId: ST_1, serviceSessionId: null,
      key: '50000000-0000-4000-8000-000000000099', phase: 'reserved',
    }));
    await h.act(async () => {
      const retryB = h.handler('Atualizar atendimento')();
      const idxB = reqs.length - 1;
      reqs[idxB].d.resolve({
        eventId: EV_B, experienceId: EXP_1, stationId: ST_1, availability: 'available', canCall: true,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_1, displayName: 'Pessoa Evento B', position: 1 }],
        pending: null,
      });
      await retryB;
    });
    assert.ok(h.hasText('Solicitação registrada, ainda não enviada.'));
    assert.equal(h.isDisabled('Chamar próximo'), true);
    assert.ok(h.hasButton('Descartar solicitação não enviada'));
    h.secureValues.delete(slot);

    // 7. Logout desmonta contexto operacional sem manter dados ou permitir mutações
    await h.rerender({
      auth: {
        isAuthenticated: false,
        user: null,
        sessionId: null,
        isIdentityVerified: () => false,
        getSessionEpoch: () => 2,
        getIdentityRevision: () => 2,
      },
    });
    assert.ok(!h.hasText('Pessoa Evento B'));
    assert.equal(h.hasButton('Chamar próximo'), false);
    assert.equal(postCount, 0);
  } finally {
    h.dispose();
  }
});

test('STAFF-04 tela Estação: recuperação automática após erro inicial (preservando SecureStore), processamento busy, confirmações específicas e códigos de recusa', { skip }, async () => {
  const slot = `arenago.staff.operation.${USER_1}`;
  let getMode = 'timeout';
  let postDeferred = null;
  let postMode = 'call';
  let postCalls = 0;

  const waitingState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: 'Ana Clara', position: 1 }],
    pending: null,
  };
  const calledState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: false,
    waitingCount: 0,
    waiting: [],
    pending: {
      serviceSessionId: SESS_1,
      queueEntryId: ENTRY_1,
      displayName: 'Ana Clara',
      calledAt: '2026-11-19T15:00:00.000Z',
    },
  };
  let activeState = waitingState;

  const h = createStationHarness({
    onGet: async (url) => {
      if (url.endsWith('/stations')) {
        if (getMode === '404_then_500') throw Object.assign(new Error('500'), { status: 500 });
        return {
          eventId: EV_A,
          stations: [{
            id: ST_1,
            experienceId: EXP_1,
            label: 'Cabine 01',
            availability: activeState.availability,
            pendingServiceSessionId: activeState.pending?.serviceSessionId ?? null,
          }],
        };
      }
      if (url.endsWith('/queue')) {
        return {
          eventId: EV_A,
          experienceId: EXP_1,
          waitingCount: activeState.waitingCount,
          canCallWaitingEntries: activeState.canCall,
          firstWaitingQueueEntryId: activeState.waiting[0]?.queueEntryId ?? null,
        };
      }
      if (getMode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
      if (getMode === '503') throw Object.assign(new Error('503'), { status: 503 });
      if (getMode === 'malformed') return { eventId: EV_A, experienceId: EXP_1, stationId: ST_1, waitingCount: 9, waiting: [] };
      if (getMode === '404_then_500') throw Object.assign(new Error('404'), { status: 404 });
      return activeState;
    },
    onPost: async () => {
      postCalls += 1;
      if (postDeferred) {
        const currentDeferred = postDeferred;
        postDeferred = null;
        return currentDeferred.promise;
      }
      if (postMode === 'call') {
        activeState = calledState;
        return {
          serviceSession: {
            id: SESS_1,
            queueEntryId: ENTRY_1,
            experienceId: EXP_1,
            station: { id: ST_1, label: 'Cabine 01' },
            status: 'pending',
            calledAt: '2026-11-19T15:00:00.000Z',
          },
        };
      }
      if (postMode === 'complete') {
        activeState = waitingState;
        return {
          serviceSession: { id: SESS_1, status: 'completed', resolvedAt: '2026-11-19T15:05:00.000Z' },
          queueEntry: { status: 'closed', closeReason: 'completed' },
          participation: { status: 'active', currentQueueEntryId: null },
        };
      }
      if (postMode === 'remove_called') {
        activeState = waitingState;
        return {
          serviceSession: { id: SESS_1, status: 'canceled', cancelReason: 'staff_queue_removed', resolvedAt: '2026-11-19T15:05:00.000Z' },
          queueEntry: { status: 'closed', closeReason: 'staff_queue_removed' },
          participation: { status: 'active', currentQueueEntryId: null },
        };
      }
      if (postMode.startsWith('reject:')) {
        throw Object.assign(new Error('conflict'), { status: 409, code: postMode.slice('reject:'.length) });
      }
      if (postMode === 'reject_unknown') {
        throw Object.assign(new Error('bad-request'), { status: 400, code: 'INTERNAL_SQL_STATE_XYZ' });
      }
      throw Object.assign(new Error('timeout'), { isTimeout: true, outcomeUnknown: true });
    },
  });

  const flush = () => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  try {
    // 1. Falha inicial por timeout classifica como network, habilita recuperação automática (5s) e não inventa fila vazia
    await h.mount();
    assert.ok(h.hasExactText('Falha de conexão. Atualize a estação.'));
    assert.ok(h.hasExactText('Atualização indisponível · aguardando recuperação (a cada 5s)'));
    assert.equal(h.getPolling().enabled, true);
    assert.ok(!h.hasText('Fila vazia'));

    // 503 e payload inválido mantêm estado de erro elegível para recuperação
    getMode = '503';
    await h.triggerPoll();
    assert.ok(h.hasExactText('Não foi possível consultar a estação.'));
    assert.equal(h.getPolling().enabled, true);

    getMode = 'malformed';
    await h.triggerPoll();
    assert.ok(h.hasExactText('Não foi possível consultar a estação.'));
    assert.equal(h.getPolling().enabled, true);

    // Recuperação automática lê SecureStore antes de liberar ready: intenção dispatching permanece bloqueando mutações
    const dispatchingRecord = JSON.stringify({
      kind: 'call', userId: USER_1, sessionId: SESSION_1, eventId: EV_A,
      experienceId: EXP_1, stationId: ST_1, serviceSessionId: null,
      key: '50000000-0000-4000-8000-000000000077', phase: 'dispatching',
    });
    h.secureValues.set(slot, dispatchingRecord);
    getMode = 'ok';
    await h.triggerPoll();
    assert.ok(h.hasQueueRow(1, 'Ana Clara'));
    assert.ok(h.hasText('Resultado incerto. Não repita a operação'));
    assert.equal(h.isDisabled('Chamar próximo'), true);
    assert.equal(postCalls, 0);

    // Limpa intenção para testar busy + confirmação específica de chamada, conclusão e remoção
    h.secureValues.delete(slot);
    await h.press('Atualizar atendimento');
    assert.equal(h.isDisabled('Chamar próximo'), false);

    postDeferred = deferred();
    const callHandler = h.handler('Chamar próximo');
    let inflightCall;
    await h.act(async () => {
      inflightCall = callHandler();
    });
    assert.ok(h.hasExactText('Processando operação no servidor...'));
    assert.equal(h.getPolling().enabled, false, 'polling pausado durante operação em andamento');
    await h.act(async () => {
      await callHandler(); // duplo toque bloqueado enquanto busy
    });
    assert.equal(postCalls, 1);
    activeState = calledState;
    await h.act(async () => {
      postDeferred.resolve({
        serviceSession: {
          id: SESS_1,
          queueEntryId: ENTRY_1,
          experienceId: EXP_1,
          station: { id: ST_1, label: 'Cabine 01' },
          status: 'pending',
          calledAt: '2026-11-19T15:00:00.000Z',
        },
      });
      await inflightCall;
    });
    await flush();
    assert.ok(h.hasText('Participante chamado. Operação confirmada pelo servidor.'));

    // Recusa com código real SERVICE_NOT_PENDING mostra mensagem contextual clara
    postMode = 'reject:SERVICE_NOT_PENDING';
    await h.press('Concluir experiência');
    await h.press('CONFIRMAR OPERAÇÃO');
    await flush();
    assert.ok(h.hasText('A chamada já não está pendente. Atualize o atendimento antes de decidir a próxima ação.'));

    // Código desconhecido nunca expõe detalhe interno ao operador
    postMode = 'reject_unknown';
    await h.press('Concluir experiência');
    await h.press('CONFIRMAR OPERAÇÃO');
    await flush();
    assert.ok(h.hasText('Operação recusada pelo servidor. Atualize o atendimento antes de decidir a próxima ação.'));
    assert.equal(h.hasText('INTERNAL_SQL_STATE_XYZ'), false);

    // Concluir atendimento confirmado exibe ação específica
    postMode = 'complete';
    await h.press('Concluir experiência');
    await h.press('CONFIRMAR OPERAÇÃO');
    await flush();
    assert.ok(h.hasText('Atendimento concluído. Operação confirmada pelo servidor.'));

    // Chamar novamente e remover da fila exibe ação específica
    postMode = 'call';
    await h.press('Chamar próximo');
    await flush();
    postMode = 'remove_called';
    await h.press('Remover da fila');
    await h.press('CONFIRMAR OPERAÇÃO');
    await flush();
    assert.ok(h.hasText('Participante removido da fila. Operação confirmada pelo servidor.'));

    // Caso C (404 -> /stations 500) mantém acesso incerto SEM polling automático (preservando STAFF02-AUD-01)
    getMode = '404_then_500';
    await h.press('Atualizar atendimento');
    assert.equal(h.getPolling().enabled, false);
    assert.ok(h.hasExactText('Atualização indisponível · aguardando recuperação'));
  } finally {
    h.dispose();
  }
});
