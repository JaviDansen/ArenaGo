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
  onSecureSet,
  onSecureDelete,
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
        setItemAsync: async (key, value) => {
          if (onSecureSet) await onSecureSet(key, value);
          secureValues.set(key, value);
        },
        deleteItemAsync: async (key) => {
          if (onSecureDelete) await onSecureDelete(key);
          secureValues.delete(key);
        },
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
    assert.ok(h.hasExactText('Atualização indisponível · aguardando recuperação manual'));
  } finally {
    h.dispose();
  }
});

test('STAFF04-AUD-01: poll() em voo bloqueia reentrada, descarta resposta atrasada após refresh manual e respeita pausa em modal', { skip }, async () => {
  let opGets = 0;
  let deferredOp = null;
  let accessDeniedKind = null;
  const initialState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: 'Ana Clara', position: 1 }],
    pending: null,
  };
  const updatedState = {
    ...initialState,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_2, displayName: 'Camila Souza', position: 1 }],
  };
  const pendingState = {
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
  let nextState = initialState;

  const h = createStationHarness({
    onAccessDenied: (kind) => {
      accessDeniedKind = kind;
      void h.rerender({ accessDenied: true, accessDeniedKind: kind });
    },
    onGet: async (url) => {
      if (url.endsWith('/operational-state')) {
        opGets += 1;
        if (deferredOp) {
          const d = deferredOp.shift();
          if (d) return d.promise;
        }
        return nextState;
      }
      return {};
    },
  });

  try {
    await h.mount();
    assert.equal(opGets, 1);
    assert.ok(h.hasQueueRow(1, 'Ana Clara'));

    // 1. Dispara poll 1 pendente; segunda chamada de poll enquanto em voo não gera GET paralelo
    const poll1Deferred = deferred();
    const manualDeferred = deferred();
    deferredOp = [poll1Deferred, manualDeferred];
    let pPoll1;
    await h.act(async () => {
      pPoll1 = h.getPolling().read();
    });
    assert.equal(opGets, 2);
    await h.act(async () => {
      await h.getPolling().read();
    });
    assert.equal(opGets, 2, 'reentrada de poll no mesmo ciclo em voo é ignorada');

    // Refresh manual durante poll pendente conclui com estado novo; resposta atrasada do poll 1 é descartada
    let pManual;
    await h.act(async () => {
      pManual = h.handler('Atualizar atendimento')();
    });
    assert.equal(opGets, 3);
    await h.act(async () => {
      manualDeferred.resolve(updatedState);
      await pManual;
    });
    assert.ok(h.hasQueueRow(1, 'Camila Souza'));

    await h.act(async () => {
      poll1Deferred.resolve(initialState);
      await pPoll1;
    });
    assert.ok(h.hasQueueRow(1, 'Camila Souza'));
    assert.equal(h.hasText('Ana Clara'), false, 'resposta atrasada de poll não sobrescreve refresh recente');

    // 2. Modal aberto pausa polling e bloqueia poll.read direta; cancelar reabilita polling
    nextState = pendingState;
    await h.press('Atualizar atendimento');
    assert.equal(h.getPolling().enabled, true);
    await h.press('Concluir experiência');
    assert.equal(h.modals()[0].props.visible, true);
    assert.equal(h.getPolling().enabled, false);
    const getsDuringModal = opGets;
    await h.act(async () => {
      await h.getPolling().read();
    });
    assert.equal(opGets, getsDuringModal, 'poll() recusa execução enquanto modal estiver aberto');
    await h.press('Cancelar');
    assert.equal(h.modals().length, 0);
    assert.equal(h.getPolling().enabled, true);

    // 3. Negativa 403 em poll em voo não é descartada mesmo se refresh manual concorrente iniciar antes da resposta
    const poll403 = deferred();
    const concurrentManual = deferred();
    deferredOp = [poll403, concurrentManual];
    let pLate403;
    let pManualConcurrent;
    await h.act(async () => {
      pLate403 = h.getPolling().read();
      pManualConcurrent = h.handler('Atualizar atendimento')();
    });
    await h.act(async () => {
      poll403.reject(Object.assign(new Error('forbidden'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' }));
      await pLate403;
    });
    assert.equal(accessDeniedKind, 'denied');
    assert.equal(h.hasText('Ana Clara'), false);
    await h.act(async () => {
      concurrentManual.resolve(updatedState);
      await pManualConcurrent;
    });
    assert.equal(h.hasText('Camila Souza'), false);
  } finally {
    h.dispose();
  }
});

test('STAFF04-AUD-03: estágio busy precondition vs mutating e falhas transitórias de pré-condição sem POST nem recusa', { skip }, async () => {
  let stationsDeferred = null;
  let postDeferred = null;
  let preErrorMode = null;
  let postCalls = 0;

  const baseState = {
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
    ...baseState,
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
  let activeState = baseState;

  const h = createStationHarness({
    onGet: async (url) => {
      if (url.endsWith('/stations')) {
        if (stationsDeferred) {
          const d = stationsDeferred;
          stationsDeferred = null;
          return d.promise;
        }
        if (preErrorMode === 'network') throw Object.assign(new Error('offline'), { isNetworkError: true });
        if (preErrorMode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
        if (preErrorMode === '503') throw Object.assign(new Error('unavailable'), { status: 503 });
        if (preErrorMode === 'malformed') return { eventId: EV_A, stations: 'invalid' };
        return {
          eventId: EV_A,
          stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }],
        };
      }
      if (url.endsWith('/queue')) {
        return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
      }
      return activeState;
    },
    onPost: async () => {
      postCalls += 1;
      if (postDeferred) {
        const d = postDeferred;
        postDeferred = null;
        return d.promise;
      }
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
    },
  });

  const flush = () => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  try {
    await h.mount();

    // 1. Distingue pré-condição de processamento no servidor antes do POST
    stationsDeferred = deferred();
    postDeferred = deferred();
    let inflight;
    await h.act(async () => {
      inflight = h.handler('Chamar próximo')();
    });
    assert.ok(h.hasExactText('Verificando condições antes do envio...'));
    assert.equal(postCalls, 0);

    await h.act(async () => {
      stationsDeferred.resolve({
        eventId: EV_A,
        stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }],
      });
    });
    assert.ok(h.hasExactText('Processando operação no servidor...'));
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
      await inflight;
    });
    await flush();
    assert.ok(h.hasText('Participante chamado. Operação confirmada pelo servidor.'));

    // 2. Volta para waiting e valida todas as falhas transitórias de pré-condição sem POST nem texto de recusa
    h.secureValues.clear();
    activeState = baseState;
    await h.press('Atualizar atendimento');
    const postsBeforePreFailures = postCalls;
    for (const mode of ['network', 'timeout', '503', 'malformed']) {
      preErrorMode = mode;
      await h.press('Chamar próximo');
      await flush();
      assert.equal(postCalls, postsBeforePreFailures, `${mode}: zero POSTs enviados`);
      assert.ok(
        h.hasText('Não foi possível verificar se a operação pode ser realizada. Nenhuma alteração foi enviada.'),
        `${mode}: mensagem clara de pré-condição sem envio`,
      );
      assert.equal(h.hasText('Operação recusada'), false, `${mode}: não afirma recusa do servidor`);
      preErrorMode = null;
      await h.press('Atualizar atendimento');
    }
  } finally {
    h.dispose();
  }
});

test('STAFF04-AUD-04: 401/403 em pré-condição, mutação e cleanup_pending revoga de imediato; 404 com GET 200 mantém evento', { skip }, async () => {
  const flush = (h) => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const baseState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: 'Ana Clara', position: 1 }],
    pending: null,
  };
  const pendingState = {
    ...baseState,
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

  // Cenário 1: 403 na pré-condição da estação -> revoga imediatamente, zero POSTs e zero GET pós-falha
  {
    let deniedKind = null;
    let getsAfterMounted = 0;
    let mounted = false;
    let postCalls = 0;
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onGet: async (url) => {
        if (mounted && url.endsWith('/operational-state')) getsAfterMounted += 1;
        if (url.endsWith('/stations')) throw Object.assign(new Error('forbidden'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
        return baseState;
      },
      onPost: async () => { postCalls += 1; return {}; },
    });
    try {
      await h.mount();
      mounted = true;
      await h.press('Chamar próximo');
      assert.equal(deniedKind, 'denied');
      assert.equal(postCalls, 0);
      assert.equal(getsAfterMounted, 0, '403 na pré-condição não dispara refresh() adicional');
      assert.equal(h.hasText('Ana Clara'), false);
      assert.ok(h.hasText('Acesso à estação indisponível.'));
    } finally {
      h.dispose();
    }
  }

  // Cenário 2: 401 na mutação -> revoga imediatamente para session, preserva recibo no SecureStore e zero GET pós-401
  {
    let deniedKind = null;
    let opGetsAfterPost = 0;
    let posted = false;
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onGet: async (url) => {
        if (posted && url.endsWith('/operational-state')) opGetsAfterPost += 1;
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        return baseState;
      },
      onPost: async () => {
        posted = true;
        throw Object.assign(new Error('session revoked'), { status: 401, code: 'SESSION_REVOKED' });
      },
    });
    try {
      await h.mount();
      await h.press('Chamar próximo');
      assert.equal(deniedKind, 'session');
      assert.equal(opGetsAfterPost, 0);
      assert.equal(h.hasText('Ana Clara'), false);
      assert.ok(h.hasText('Sessão inválida. Entre novamente.'));
      assert.equal(h.secureValues.has(`arenago.staff.operation.${USER_1}`), false, 'chave primária removida após recibo gravado e clear concluído');
      const receipt = JSON.parse(h.secureValues.get(`arenago.staff.operation.${USER_1}.receipt`));
      assert.equal(receipt.phase, 'terminal');
      assert.equal(receipt.outcome.kind, 'rejected');
      assert.equal(receipt.outcome.status, 401);
      assert.equal(h.secureValues.has(`arenago.staff.operation.${USER_1}.ack`), false);
    } finally {
      h.dispose();
    }
  }

  // Cenário 3: 403 na mutação + falha ao gravar recibo (rejected_cleanup_pending) revoga de imediato e preserva dispatching
  {
    let deniedKind = null;
    let opGetsAfterPost = 0;
    let posted = false;
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (key, raw) => {
        if (key.endsWith('.receipt') || JSON.parse(raw).phase === 'terminal') throw new Error('secure-write-failed');
      },
      onGet: async (url) => {
        if (posted && url.endsWith('/operational-state')) opGetsAfterPost += 1;
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        return baseState;
      },
      onPost: async () => {
        posted = true;
        throw Object.assign(new Error('forbidden'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
      },
    });
    try {
      await h.mount();
      await h.press('Chamar próximo');
      assert.equal(deniedKind, 'denied');
      assert.equal(opGetsAfterPost, 0);
      assert.equal(h.hasText('Ana Clara'), false);
      const saved = JSON.parse(h.secureValues.get(`arenago.staff.operation.${USER_1}`));
      assert.equal(saved.phase, 'dispatching');
      assert.equal(h.secureValues.has(`arenago.staff.operation.${USER_1}.receipt`), false);
      assert.equal(h.secureValues.has(`arenago.staff.operation.${USER_1}.ack`), false);
    } finally {
      h.dispose();
    }
  }

  // Cenário 4: 404 RESOURCE_NOT_FOUND ao concluir atendimento seguido de GET 200 mantém o evento sem chamar onStationNotFound
  {
    let deniedKind = null;
    let notFoundCalls = 0;
    let resolved = false;
    const h = createStationHarness({
      initialStation: { id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: SESS_1 },
      onAccessDenied: (kind) => { deniedKind = kind; },
      onStationNotFound: async () => { notFoundCalls += 1; return { outcome: 'event_denied', kind: 'denied' }; },
      onGet: async (url) => {
        if (url.endsWith('/stations')) {
          return {
            eventId: EV_A,
            stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: resolved ? null : SESS_1 }],
          };
        }
        if (url.endsWith('/operational-state')) {
          return resolved ? { ...baseState, waitingCount: 0, waiting: [], canCall: false } : pendingState;
        }
        return {};
      },
      onPost: async () => {
        resolved = true;
        throw Object.assign(new Error('not found'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
      },
    });
    try {
      await h.mount();
      await h.press('Concluir experiência');
      await h.press('CONFIRMAR OPERAÇÃO');
      await flush(h);
      assert.equal(notFoundCalls, 0, '404 na resolução com GET 200 não dispara verificação destrutiva de estação');
      assert.equal(deniedKind, null);
      assert.ok(h.hasText('O atendimento ou recurso informado não foi encontrado no servidor.'));
    } finally {
      h.dispose();
    }
  }
});

test('STAFF04-AUD-04 e AUD-07 (Estação): trava de UI/polling ANTES de recordTerminal/clear concluir, troca de conta e GET 401/403 entre reserve e dispatch', { skip }, async () => {
  const flush = (h) => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const primaryKey = `arenago.staff.operation.${USER_1}`;
  const receiptKey = `${primaryKey}.receipt`;
  const USER_2 = 'abcdef00-0000-4000-8000-000000000002';
  const SESSION_2 = '10000000-0000-4000-8000-000000000002';
  const baseState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: 'Ana Clara', position: 1 }],
    pending: null,
  };
  const pendingState = {
    ...baseState,
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

  // A. POST recebe 401/403 com recordTerminal() e clear() deliberadamente pendentes: trava já antes de resolver armazenamento
  for (const [httpStatus, code, expectedKind, expectedText] of [
    [401, 'SESSION_REVOKED', 'session', 'Sessão inválida. Entre novamente.'],
    [403, 'STAFF_EVENT_FORBIDDEN', 'denied', 'Acesso à estação indisponível.'],
  ]) {
    let deniedKind = null;
    let deniedCalls = 0;
    let getsAfterPost = 0;
    let posted = false;
    const recordGate = deferred();
    const clearGate = deferred();
    const deletedKeys = [];
    let staleHandler = null;

    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedCalls += 1;
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (key) => {
        if (key === receiptKey) await recordGate.promise;
      },
      onSecureDelete: async (key) => {
        deletedKeys.push(key);
        if (key === primaryKey) await clearGate.promise;
      },
      onGet: async (url) => {
        if (posted && url.endsWith('/operational-state')) getsAfterPost += 1;
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: SESS_1 }] };
        }
        return pendingState;
      },
      onPost: async () => {
        posted = true;
        throw Object.assign(new Error('auth-denied'), { status: httpStatus, code });
      },
    });
    try {
      await h.mount();
      await h.press('Concluir experiência');
      staleHandler = h.handler('CONFIRMAR OPERAÇÃO');
      let inflightOp;
      await h.act(async () => {
        inflightOp = staleHandler();
      });

      // Antes de recordTerminal resolver: UI limpa, modal fechado, onAccessDenied já notificado
      assert.equal(deniedCalls, 1);
      assert.equal(deniedKind, expectedKind);
      assert.equal(getsAfterPost, 0);
      assert.equal(h.hasText('Ana Clara'), false);
      assert.ok(h.hasText(expectedText));
      assert.equal(h.modals().length, 0);
      assert.equal(h.getPolling().enabled, false);
      assert.equal(h.secureValues.has(receiptKey), false);
      assert.equal(JSON.parse(h.secureValues.get(primaryKey)).phase, 'dispatching');

      // Resolve recordTerminal -> .receipt escrito, mas clear() ainda pendente
      await h.act(async () => {
        recordGate.resolve();
      });
      assert.equal(JSON.parse(h.secureValues.get(receiptKey)).outcome.status, httpStatus);
      assert.equal(h.secureValues.has(primaryKey), true, 'chave primária ainda presente antes de clear concluir');

      // Resolve clear() -> chave primária limpa legitimamente e .receipt preservado
      await h.act(async () => {
        clearGate.resolve();
        await inflightOp;
      });
      await flush(h);
      assert.equal(deniedCalls, 1, 'não duplica onAccessDenied no retorno tardio');
      assert.deepEqual(deletedKeys, [primaryKey]);
      assert.equal(h.secureValues.has(primaryKey), false);
      assert.equal(JSON.parse(h.secureValues.get(receiptKey)).outcome.status, httpStatus);
      assert.equal(getsAfterPost, 0);
    } finally {
      recordGate.resolve();
      clearGate.resolve();
      h.dispose();
    }
  }

  // B. Troca de conta durante persistência de recusa 403 mantém .receipt da conta 1 e libera conta 2
  {
    const recordGate = deferred();
    let user2State = false;
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (key) => {
        if (key === receiptKey) await recordGate.promise;
      },
      onGet: async (url) => {
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        return user2State
          ? { ...baseState, waiting: [{ queueEntryId: ENTRY_1, displayName: 'Participante Conta 2', position: 1 }] }
          : baseState;
      },
      onPost: async () => {
        throw Object.assign(new Error('403'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
      },
    });
    try {
      await h.mount();
      let opPromise;
      await h.act(async () => {
        opPromise = h.handler('Chamar próximo')();
      });
      assert.equal(h.hasText('Ana Clara'), false);

      user2State = true;
      await h.rerender({
        accessDenied: false,
        auth: {
          isAuthenticated: true,
          user: { id: USER_2, roles: ['staff'] },
          sessionId: SESSION_2,
          isIdentityVerified: () => true,
          getSessionEpoch: () => 2,
          getIdentityRevision: () => 2,
        },
      });
      await h.act(async () => {
        recordGate.resolve();
        await opPromise;
      });
      await flush(h);
      assert.equal(JSON.parse(h.secureValues.get(receiptKey)).outcome.status, 403);
      assert.ok(h.hasQueueRow(1, 'Participante Conta 2'));
      assert.equal(h.isDisabled('Chamar próximo'), false);
    } finally {
      recordGate.resolve();
      h.dispose();
    }
  }

  // C. GET 403 durante reserve() cancela APENAS reserved e não dispara dispatch() nem POST; GET 200 atrasado e 503 posterior ficam bloqueados
  {
    let mode = 'ok';
    let postCalls = 0;
    let dispatchWritten = false;
    let pollDeferred = null;
    const reserveGate = deferred();
    let holdNextReserve = false;
    let deniedKind = null;
    const deletedKeys = [];
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (key, raw) => {
        const parsed = JSON.parse(raw);
        if (parsed.phase === 'dispatching') dispatchWritten = true;
        if (holdNextReserve && key === primaryKey && parsed.phase === 'reserved') {
          holdNextReserve = false;
          await reserveGate.promise;
        }
      },
      onSecureDelete: async (key) => { deletedKeys.push(key); },
      onGet: async (url) => {
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        if (mode === 'poll_deferred') {
          pollDeferred = deferred();
          return pollDeferred.promise;
        }
        if (mode === '503') throw Object.assign(new Error('503'), { status: 503 });
        return baseState;
      },
      onPost: async () => { postCalls += 1; return {}; },
    });
    try {
      await h.mount();
      mode = 'poll_deferred';
      let pPoll;
      await h.act(async () => { pPoll = h.getPolling().read(); });
      const slowPoll = pollDeferred;

      mode = 'ok';
      holdNextReserve = true;
      let pCall;
      await h.act(async () => { pCall = h.handler('Chamar próximo')(); });

      // Enquanto reserve pende, GET anterior recebe 403 -> trava UI imediatamente
      await h.act(async () => {
        slowPoll.reject(Object.assign(new Error('403'), { status: 403 }));
        await pPoll;
      });
      assert.equal(deniedKind, 'denied');
      assert.equal(h.hasText('Ana Clara'), false);

      // Finaliza reserve -> cancela APENAS reserved sem chegar a dispatch nem POST
      await h.act(async () => {
        reserveGate.resolve();
        await pCall;
      });
      assert.equal(postCalls, 0);
      assert.equal(dispatchWritten, false);
      assert.deepEqual(deletedKeys, [primaryKey]);
      assert.equal(h.secureValues.has(primaryKey), false);
    } finally {
      reserveGate.resolve();
      h.dispose();
    }
  }

  // D. GET 401 durante dispatch() preserva dispatching de forma conservadora e aborta POST
  {
    let mode = 'ok';
    let postCalls = 0;
    let pollDeferred = null;
    const dispatchGate = deferred();
    let holdNextDispatch = false;
    let deniedKind = null;
    const deletedKeys = [];
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (key, raw) => {
        const parsed = JSON.parse(raw);
        if (holdNextDispatch && key === primaryKey && parsed.phase === 'dispatching') {
          holdNextDispatch = false;
          await dispatchGate.promise;
        }
      },
      onSecureDelete: async (key) => { deletedKeys.push(key); },
      onGet: async (url) => {
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        if (mode === 'poll_deferred') {
          pollDeferred = deferred();
          return pollDeferred.promise;
        }
        return baseState;
      },
      onPost: async () => { postCalls += 1; return {}; },
    });
    try {
      await h.mount();
      mode = 'poll_deferred';
      let pPoll;
      await h.act(async () => { pPoll = h.getPolling().read(); });
      const slowPoll = pollDeferred;

      mode = 'ok';
      holdNextDispatch = true;
      let pCall;
      await h.act(async () => { pCall = h.handler('Chamar próximo')(); });

      await h.act(async () => {
        slowPoll.reject(Object.assign(new Error('401'), { status: 401 }));
        await pPoll;
      });
      assert.equal(deniedKind, 'session');

      await h.act(async () => {
        dispatchGate.resolve();
        await pCall;
      });
      assert.equal(postCalls, 0);
      assert.deepEqual(deletedKeys, []);
      assert.equal(JSON.parse(h.secureValues.get(primaryKey)).phase, 'dispatching');
    } finally {
      dispatchGate.resolve();
      h.dispose();
    }
  }
});

test('STAFF04-AUD-08 (tela Estação): 401/403 em leitura preliminar paralela revoga imediatamente mesmo após 503 irmão ou com irmã pendente e descarta GET 200 atrasado', { skip }, async () => {
  const baseState = {
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: ST_1,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: 'Ana Clara', position: 1 }],
    pending: null,
  };

  // Caso 1: /queue falha primeiro com 503, GET /operational-state fica em voo e /stations falha depois com 403
  {
    const qGate = deferred();
    const sGate = deferred();
    let opDeferred = null;
    let deniedKind = null;
    let postCalls = 0;
    const h = createStationHarness({
      onAccessDenied: (kind) => { deniedKind = kind; },
      onGet: (url) => {
        if (url.endsWith('/queue')) return qGate.promise;
        if (url.endsWith('/stations')) return sGate.promise;
        if (opDeferred) {
          const d = opDeferred;
          opDeferred = null;
          return d.promise;
        }
        return Promise.resolve(baseState);
      },
      onPost: async () => { postCalls += 1; return {}; },
    });
    try {
      await h.mount();
      assert.ok(h.hasQueueRow(1, 'Ana Clara'));

      // Inicia Chamar próximo; /queue rejeita 503 primeiro, e o refresh(true) pós-503 fica em voo (opDeferred)
      const slowOpRead = deferred();
      let pCall;
      await h.act(async () => { pCall = h.handler('Chamar próximo')(); });
      opDeferred = slowOpRead;
      await h.act(async () => {
        qGate.reject(Object.assign(new Error('503'), { status: 503 }));
        await pCall;
      });
      assert.equal(deniedKind, null);
      assert.equal(postCalls, 0);

      // /stations rejeita posteriormente com 403 -> revoga imediatamente e invalida slowOpRead 200 atrasado
      await h.act(async () => {
        sGate.reject(Object.assign(new Error('403'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' }));
      });
      assert.equal(deniedKind, 'denied');
      assert.equal(h.hasText('Ana Clara'), false);
      assert.ok(h.hasText('Acesso à estação indisponível.'));

      await h.act(async () => {
        slowOpRead.resolve(baseState);
      });
      assert.equal(h.hasText('Ana Clara'), false, 'resposta 200 atrasada não restaura dados protegidos');
    } finally {
      qGate.resolve({ eventId: EV_A, experienceId: EXP_1, waitingCount: 0, canCallWaitingEntries: false, firstWaitingQueueEntryId: null });
      sGate.resolve({ eventId: EV_A, stations: [] });
      h.dispose();
    }
  }

  // Caso 2: /stations rejeita com 401 enquanto /queue permanece pendente -> bloqueia ANTES da resolução de /queue
  {
    const qGate = deferred();
    const sGate = deferred();
    let deniedKind = null;
    let postCalls = 0;
    const h = createStationHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onGet: (url) => {
        if (url.endsWith('/queue')) return qGate.promise;
        if (url.endsWith('/stations')) return sGate.promise;
        return Promise.resolve(baseState);
      },
      onPost: async () => { postCalls += 1; return {}; },
    });
    try {
      await h.mount();
      let pCall;
      await h.act(async () => { pCall = h.handler('Chamar próximo')(); });
      await h.act(async () => {
        sGate.reject(Object.assign(new Error('401'), { status: 401, code: 'SESSION_REVOKED' }));
        await pCall;
      });
      // Antes de resolver qGate:
      assert.equal(deniedKind, 'session');
      assert.equal(postCalls, 0);
      assert.equal(h.hasText('Ana Clara'), false);
      assert.ok(h.hasText('Sessão inválida. Entre novamente.'));
    } finally {
      qGate.resolve({ eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 });
      h.dispose();
    }
  }
});

test('STAFF04-AUD-09 (tela Estação): isola feedback tardio entre contas, sessões, estações, visitas e contextos bloqueados, e preserva revalidação GET 200 legítima', { skip }, async () => {
  const USER_2 = 'abcdef00-0000-4000-8000-000000000002';
  const SESSION_2 = '10000000-0000-4000-8000-000000000002';
  const makeState = (stId, name) => ({
    eventId: EV_A,
    experienceId: EXP_1,
    stationId: stId,
    availability: 'available',
    canCall: true,
    waitingCount: 1,
    waiting: [{ queueEntryId: ENTRY_1, displayName: name, position: 1 }],
    pending: null,
  });

  // Cenários 1 a 6: POST 403 + falha tardia em recordTerminal (rejected_cleanup_pending) nunca vaza feedback visual para outro contexto/visita, mas preserva intenção persistida
  for (const transition of ['other_account', 'new_session_same_account', 'other_station_same_event', 'exit_and_return_same_station', 'other_blocked_context']) {
    const recordGate = deferred();
    let currentStationId = ST_1;
    let participantName = 'Ana Clara';
    const h = createStationHarness({
      onSecureSet: async (key) => {
        if (key.endsWith('.receipt')) {
          await recordGate.promise;
          throw new Error('receipt-write-failed');
        }
      },
      onGet: async (url) => {
        if (url.endsWith('/stations')) {
          return { eventId: EV_A, stations: [{ id: currentStationId, experienceId: EXP_1, label: 'Cabine', availability: 'available', pendingServiceSessionId: null }] };
        }
        if (url.endsWith('/queue')) {
          return { eventId: EV_A, experienceId: EXP_1, waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: ENTRY_1 };
        }
        return makeState(currentStationId, participantName);
      },
      onPost: async () => {
        throw Object.assign(new Error('403'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
      },
    });

    try {
      await h.mount();
      let inflight;
      await h.act(async () => { inflight = h.handler('Chamar próximo')(); });

      if (transition === 'other_account') {
        participantName = 'Fila Conta 2';
        await h.rerender({
          auth: {
            isAuthenticated: true,
            user: { id: USER_2, roles: ['staff'] },
            sessionId: SESSION_2,
            isIdentityVerified: () => true,
            getSessionEpoch: () => 2,
            getIdentityRevision: () => 2,
          },
        });
      } else if (transition === 'new_session_same_account') {
        participantName = 'Fila Nova Sessão';
        await h.rerender({
          auth: {
            isAuthenticated: true,
            user: { id: USER_1, roles: ['staff'] },
            sessionId: SESSION_2,
            isIdentityVerified: () => true,
            getSessionEpoch: () => 2,
            getIdentityRevision: () => 1,
          },
        });
      } else if (transition === 'other_station_same_event') {
        currentStationId = ST_2;
        participantName = 'Fila Estação 2';
        await h.rerender({
          station: { id: ST_2, experienceId: EXP_1, label: 'Cabine 02', availability: 'available', pendingServiceSessionId: null },
        });
      } else if (transition === 'exit_and_return_same_station') {
        currentStationId = ST_2;
        await h.rerender({
          station: { id: ST_2, experienceId: EXP_1, label: 'Cabine 02', availability: 'available', pendingServiceSessionId: null },
        });
        currentStationId = ST_1;
        participantName = 'Retorno Estação 1';
        await h.rerender({
          station: { id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: null },
        });
      } else {
        await h.rerender({
          station: { id: ST_2, experienceId: EXP_1, label: 'Cabine 02', availability: 'available', pendingServiceSessionId: null },
          accessDenied: true,
          accessDeniedKind: 'session',
        });
      }

      await h.act(async () => {
        recordGate.resolve();
        await inflight;
      });

      assert.equal(
        h.hasText('Recusa registrada pelo servidor, mas a limpeza local falhou'),
        false,
        `${transition}: não publica feedback tardio fora do escopo/visita original`,
      );
      // Persistência histórica da intenção original permanece intacta em dispatching (pois .receipt falhou)
      assert.equal(JSON.parse(h.secureValues.get(`arenago.staff.operation.${USER_1}`)).phase, 'dispatching');
    } finally {
      recordGate.resolve();
      h.dispose();
    }
  }

  // Cenários 7 e 8: após negativa 403, erro transitório 503 em Atualizar atendimento NÃO reabilita, mas GET 200 legítimo revalida
  {
    let opMode = 'ok';
    const h = createStationHarness({
      onGet: async (url) => {
        if (opMode === '403') throw Object.assign(new Error('403'), { status: 403 });
        if (opMode === '503') throw Object.assign(new Error('503'), { status: 503 });
        if (url.endsWith('/operational-state')) return makeState(ST_1, 'Ana Revalidada');
        return {};
      },
      onPost: async () => ({}),
    });
    try {
      await h.mount();
      opMode = '403';
      await h.press('Atualizar atendimento');
      assert.ok(h.hasText('Acesso à estação indisponível.'));
      assert.equal(h.getPolling().enabled, false);

      // Erro transitório 503 mantém trava 'denied' e polling desligado
      opMode = '503';
      await h.press('Atualizar atendimento');
      assert.ok(h.hasText('Acesso à estação indisponível.'));
      assert.equal(h.getPolling().enabled, false);

      // Revalidação GET 200 legítima recupera o acesso sem falhar em coordinator.readStationState
      opMode = 'ok';
      await h.press('Atualizar atendimento');
      assert.ok(h.hasQueueRow(1, 'Ana Revalidada'));
      assert.equal(h.getPolling().enabled, true);
    } finally {
      h.dispose();
    }
  }
});

test('STAFF04-AUD-10 (tela Estação): exibe "Registrando resultado com segurança..." em recordTerminal/clear sem indicar sucesso prematuro nem expor 403', { skip }, async () => {
  const flush = (h) => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const primaryKey = `arenago.staff.operation.${USER_1}`;
  const receiptKey = `${primaryKey}.receipt`;
  const ackKey = `${primaryKey}.ack`;
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
    ...waitingState,
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
  let postGate = null;
  let receiptGate = null;
  let clearGate = null;
  let ackGate = null;

  const h = createStationHarness({
    onSecureSet: async (key) => {
      if (receiptGate && key === receiptKey) {
        const g = receiptGate;
        receiptGate = null;
        await g.deferred.promise;
        if (g.fail) throw g.fail;
      }
      if (ackGate && key === ackKey) {
        const g = ackGate;
        ackGate = null;
        await g.promise;
      }
    },
    onSecureDelete: async (key) => {
      if (clearGate && key === primaryKey) {
        const g = clearGate;
        clearGate = null;
        await g.promise;
      }
    },
    onGet: async (url) => {
      if (url.endsWith('/stations')) {
        return {
          eventId: EV_A,
          stations: [{ id: ST_1, experienceId: EXP_1, label: 'Cabine 01', availability: 'available', pendingServiceSessionId: activeState.pending?.serviceSessionId ?? null }],
        };
      }
      if (url.endsWith('/queue')) {
        return { eventId: EV_A, experienceId: EXP_1, waitingCount: activeState.waitingCount, canCallWaitingEntries: activeState.canCall, firstWaitingQueueEntryId: activeState.waiting[0]?.queueEntryId ?? null };
      }
      return activeState;
    },
    onPost: () => postGate.promise,
  });

  try {
    await h.mount();

    // 1, 2, 4 e 6: servidor pendente -> recordTerminal pendente -> clear pendente -> reconhecimento posterior
    postGate = deferred();
    receiptGate = { deferred: deferred(), fail: null };
    clearGate = deferred();
    ackGate = deferred();
    const rGate1 = receiptGate.deferred;
    const cGate1 = clearGate;
    const aGate1 = ackGate;

    let pOp;
    await h.act(async () => { pOp = h.handler('Chamar próximo')(); });
    assert.ok(h.hasExactText('Processando operação no servidor...'));

    activeState = calledState;
    await h.act(async () => {
      postGate.resolve({
        serviceSession: {
          id: SESS_1,
          queueEntryId: ENTRY_1,
          experienceId: EXP_1,
          station: { id: ST_1, label: 'Cabine 01' },
          status: 'pending',
          calledAt: '2026-11-19T15:00:00.000Z',
        },
      });
    });
    assert.ok(h.hasExactText('Registrando resultado com segurança...'));
    assert.equal(h.hasText('Participante chamado. Operação confirmada pelo servidor.'), false, 'sem confirmação visual antes da persistência');

    await h.act(async () => { rGate1.resolve(); });
    assert.ok(h.hasExactText('Registrando resultado com segurança...'), 'permanece registrando durante clear primário');

    await h.act(async () => {
      cGate1.resolve();
      await pOp;
    });
    // Dispara ciclo de reconhecimento em próxima leitura/efeito ou verifica confirmação
    aGate1.resolve();
    await flush(h);
    assert.ok(h.hasText('Participante chamado. Operação confirmada pelo servidor.'));

    // 3: recusa definitiva não-auth (409) com persistência pendente também usa 'Registrando resultado com segurança...'
    h.secureValues.clear();
    await h.press('Atualizar atendimento');
    postGate = deferred();
    receiptGate = { deferred: deferred(), fail: null };
    const rGate409 = receiptGate.deferred;
    await h.press('Concluir experiência');
    let pReject;
    await h.act(async () => { pReject = h.handler('CONFIRMAR OPERAÇÃO')(); });
    assert.ok(h.hasExactText('Processando operação no servidor...'));

    await h.act(async () => {
      postGate.reject(Object.assign(new Error('not-pending'), { status: 409, code: 'SERVICE_NOT_PENDING' }));
    });
    assert.ok(h.hasExactText('Registrando resultado com segurança...'));
    await h.act(async () => {
      rGate409.resolve();
      await pReject;
    });
    await flush(h);
    assert.ok(h.hasText('A chamada já não está pendente.'));

    // 8: resultado desconhecido (timeout) nunca mostra 'Registrando resultado com segurança...' nem sucesso
    h.secureValues.clear();
    await h.press('Atualizar atendimento');
    postGate = deferred();
    await h.press('Concluir experiência');
    let pUncertain;
    await h.act(async () => { pUncertain = h.handler('CONFIRMAR OPERAÇÃO')(); });
    await h.act(async () => {
      postGate.reject(Object.assign(new Error('timeout'), { isTimeout: true, outcomeUnknown: true }));
      await pUncertain;
    });
    await flush(h);
    assert.equal(h.hasText('Registrando resultado com segurança...'), false);
    assert.ok(h.hasText('O resultado exige verificação ou reconciliação.'));
  } finally {
    h.dispose();
  }
});
