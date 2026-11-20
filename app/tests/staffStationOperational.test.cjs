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
const skip = deps ? false : 'dependências de qa/regression não instaladas';

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
  const nativeStub = Object.fromEntries(['Modal', 'Pressable', 'Text', 'View'].map((n) => [n, n]));
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
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;
})();

test('STAFF-02: formatElapsedSinceCall formata MM:SS, HH:MM:SS e usa fallback seguro sem alterar regras temporais', () => {
  const calledAt = '2026-11-19T15:00:00.000Z';
  const baseMs = Date.parse(calledAt);

  assert.deepEqual(pureSections.formatElapsedSinceCall(calledAt, baseMs + 23_000), {
    label: 'Chamado há 00:23',
    live: true,
  });
  assert.deepEqual(pureSections.formatElapsedSinceCall(calledAt, baseMs + 3_725_000), {
    label: 'Chamado há 01:02:05',
    live: true,
  });
  // Pequeno desvio negativo de relógio (< 60s) limita em 00:00
  assert.deepEqual(pureSections.formatElapsedSinceCall(calledAt, baseMs - 10_000), {
    label: 'Chamado há 00:00',
    live: true,
  });
  // Desvio negativo grande (> 60s), tempo excessivo (> 24h) ou timestamp inválido caem no fallback seguro
  assert.deepEqual(pureSections.formatElapsedSinceCall(calledAt, baseMs - 120_000), {
    label: 'Chamada pendente',
    live: false,
  });
  assert.deepEqual(pureSections.formatElapsedSinceCall(calledAt, baseMs + 25 * 60 * 60 * 1000), {
    label: 'Chamada pendente',
    live: false,
  });
  assert.deepEqual(pureSections.formatElapsedSinceCall('invalido', baseMs), {
    label: 'Chamada pendente',
    live: false,
  });
  assert.deepEqual(pureSections.formatElapsedSinceCall(null, baseMs), {
    label: 'Chamada pendente',
    live: false,
  });
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
  let eventCurrentFlag = true;

  const native = Object.fromEntries(
    ['ActivityIndicator', 'Modal', 'Pressable', 'Text', 'View'].map((name) => [name, name]),
  );
  native.StyleSheet = { create: (styles) => styles };
  native.Platform = { OS: 'ios' };

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
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;

  const StaffStationOperationalScreen = loadModule('screens/staff/StaffStationOperationalScreen.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === 'expo-crypto') {
      return { randomUUID: () => `50000000-0000-4000-8000-${String(++keySerial).padStart(12, '0')}` };
    }
    if (name === '../../context/AuthContext') return authModule;
    if (name === '../../services/staffOperationsService') return opsSvc;
    if (name === '../../services/staffIntentStorage') return intentStorageSvc;
    if (name === '../admin/components/AdminLiveUI') return adminLiveUi;
    if (name === './components/StaffStationSections') return stationSections;
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
      onAccessDenied,
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
      if ('eventCurrent' in patch) eventCurrentFlag = patch.eventCurrent;
      await Renderer.act(async () => {
        tree.update(renderEl());
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

test('STAFF-02: apresentação dos Estados A/B, ordem FIFO exata do servidor, fila vazia, estação indisponível e encerramento operacional', { skip }, async () => {
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
    // 1. Carregamento inicial sem dados inventados
    await h.mount();
    assert.ok(h.hasText('Cabine 01'));
    assert.ok(h.hasText('Simulador F1'));
    assert.ok(h.hasText('Arena Oficial UNDB'));
    assert.ok(h.hasText('Carregando atendimento...'));
    assert.ok(!h.hasText('Fila vazia'));
    assert.ok(!h.hasText('Street Fighter'));
    assert.ok(!h.hasText('BEAST Arena'));

    // 2. Estado A com fila FIFO não-alfabética e nomes longos
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

    assert.ok(h.hasText('DISPONÍVEL'));
    assert.ok(h.hasText('FILA DA EXPERIÊNCIA'));
    assert.ok(h.hasText('3 aguardando'));
    assert.ok(h.hasText('Fila compartilhada entre as estações'));
    assert.equal(h.hasButton('Fila compartilhada entre as estações'), false, 'informação compartilhada não é clicável');
    assert.ok(h.hasText('ATENDIMENTO ATUAL'));
    assert.ok(h.hasText('Nenhum participante chamado'));
    assert.ok(h.hasText('Fila e atendimento atualizados automaticamente'));
    assert.equal(h.isDisabled('Chamar próximo'), false);

    // Ordem FIFO oficial preservada (Zélia antes de Alberto antes de Bruno)
    const texts = h.allTexts();
    const idxZelia = texts.indexOf(longName);
    const idxAlberto = texts.indexOf('Alberto Silva');
    const idxBruno = texts.indexOf('Bruno Rocha');
    assert.ok(idxZelia > -1 && idxAlberto > idxZelia && idxBruno > idxAlberto, 'ordem FIFO exata preservada');

    // 3. Estado A com fila vazia (não confunde vazio com erro de conexão)
    stateResponse = {
      ...stateResponse,
      canCall: false,
      waitingCount: 0,
      waiting: [],
    };
    await h.press('Atualizar atendimento');
    assert.ok(h.hasText('0 aguardando'));
    assert.ok(h.hasText('Fila vazia'));
    assert.ok(h.hasText('Nenhuma pessoa aguardando nesta experiência.'));
    assert.ok(!h.hasText('Falha de conexão'));
    assert.equal(h.isDisabled('Chamar próximo'), true);

    // 4. Estação indisponível mantém fila visível e bloqueia Chamar próximo
    stateResponse = {
      ...stateResponse,
      availability: 'unavailable',
      canCall: false,
      waitingCount: 1,
      waiting: [{ queueEntryId: ENTRY_2, displayName: 'Alberto Silva', position: 1 }],
    };
    await h.press('Atualizar atendimento');
    assert.ok(h.hasText('INDISPONÍVEL'));
    assert.ok(h.hasText('1 aguardando'));
    assert.ok(h.hasText('Alberto Silva'));
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
    assert.ok(h.hasText('DISPONÍVEL'));
    assert.equal(h.isDisabled('Chamar próximo'), true);
    assert.ok(h.hasText('Novas chamadas não estão liberadas'));

    // 6. Estado B com atendimento pendente exibe tempo decorrido confiável e ações sem Chamar próximo
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
    assert.ok(h.hasText('Alberto Silva'));
    assert.ok(h.hasText('Em atendimento'));
    assert.ok(h.hasText('Chamado há 00:23'));
    assert.equal(h.hasButton('Chamar próximo'), false);
    assert.equal(h.isDisabled('Concluir experiência'), false);
    assert.equal(h.isDisabled('Marcar ausência'), false);
    assert.equal(h.isDisabled('Remover da fila'), false);
    // Participante chamado não aparece duplicado na lista de espera
    assert.equal(h.allTexts().filter((t) => t === 'Alberto Silva').length, 1);
  } finally {
    h.dispose();
  }
});

test('STAFF-02: resposta tardia em troca de estação/evento, logout com modal aberto, falha stale, polling sem POST e recibos persistidos', { skip }, async () => {
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
    assert.ok(h.hasText('Cabine 02'));
    assert.ok(h.hasText('Pessoa Estação 02'));
    assert.ok(!h.hasText('Pessoa Estação Antiga'));

    // 2. Falha transitória no polling marca stale, bloqueia todas as ações e não envia POST
    await h.act(async () => {
      const pollPromise = h.getPolling().read();
      assert.equal(reqs.length, 3);
      reqs[2].d.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
      await pollPromise;
    });
    assert.ok(h.hasText('Dados da estação possivelmente desatualizados'));
    assert.equal(h.isDisabled('Concluir experiência'), true);
    assert.equal(h.isDisabled('Marcar ausência'), true);
    assert.equal(h.isDisabled('Remover da fila'), true);
    assert.equal(postCount, 0);

    // Recuperação pelo próximo polling limpa stale sem disparar POST
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
    assert.equal(postCount, 0);

    // 3. Abrir modal e receber accessDenied (propagação do painel) fecha modal, limpa nomes e bloqueia callback antigo
    await h.press('Concluir experiência');
    assert.equal(h.modals()[0].props.visible, true);
    const staleConfirm = h.handler('CONFIRMAR OPERAÇÃO');
    await h.rerender({ accessDenied: true });
    assert.ok(!h.hasText('Chamado 02'));
    assert.ok(!h.hasText('Pessoa Estação 02'));
    assert.equal(h.modals().length, 0);
    await h.act(async () => staleConfirm());
    assert.equal(postCount, 0);

    // Reabilita acesso e troca para outro evento: intenção reservada persistida bloqueia operações
    await h.rerender({
      accessDenied: false,
      event: { id: EV_B, name: 'Evento B' },
      station: { id: ST_1, experienceId: EXP_1, label: 'Cabine B1', availability: 'available', pendingServiceSessionId: null },
    });
    const evBIdx = reqs.length - 1;
    h.secureValues.set(slot, JSON.stringify({
      kind: 'call', userId: USER_1, sessionId: SESSION_1, eventId: EV_B,
      experienceId: EXP_1, stationId: ST_1, serviceSessionId: null,
      key: '50000000-0000-4000-8000-000000000099', phase: 'reserved',
    }));
    await h.act(async () => {
      reqs[evBIdx].d.resolve({
        eventId: EV_B, experienceId: EXP_1, stationId: ST_1, availability: 'available', canCall: true,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_1, displayName: 'Pessoa Evento B', position: 1 }],
        pending: null,
      });
    });
    assert.ok(h.hasText('Solicitação registrada, ainda não enviada.'));
    assert.equal(h.isDisabled('Chamar próximo'), true);
    assert.ok(h.hasButton('Descartar solicitação não enviada'));

    // Intenção pendente de outra estação também bloqueia novas mutações na estação atual
    h.secureValues.set(slot, JSON.stringify({
      kind: 'call', userId: USER_1, sessionId: SESSION_1, eventId: EV_B,
      experienceId: EXP_1, stationId: ST_2, serviceSessionId: null,
      key: '50000000-0000-4000-8000-000000000098', phase: 'dispatching',
    }));
    await h.act(async () => {
      const refreshOther = h.handler('Atualizar atendimento')();
      const idxOther = reqs.length - 1;
      reqs[idxOther].d.resolve({
        eventId: EV_B, experienceId: EXP_1, stationId: ST_1, availability: 'available', canCall: true,
        waitingCount: 1, waiting: [{ queueEntryId: ENTRY_1, displayName: 'Pessoa Evento B', position: 1 }],
        pending: null,
      });
      await refreshOther;
    });
    assert.ok(h.hasText('Há uma operação pendente em outra sessão, evento ou estação desta conta.'));
    assert.equal(h.isDisabled('Chamar próximo'), true);
    h.secureValues.delete(slot);

    // 4. 404 na estação limpa dados nominais mas não aciona onAccessDenied global (coerência com R3-03)
    await h.act(async () => {
      const refresh404 = h.handler('Atualizar atendimento')();
      const idx404 = reqs.length - 1;
      reqs[idx404].d.reject(Object.assign(new Error('not-found'), { status: 404 }));
      await refresh404;
    });
    assert.ok(!h.hasText('Pessoa Evento B'));
    assert.ok(h.hasText('Acesso à estação indisponível.'));
    assert.deepEqual(deniedKinds, []);

    // 5. 403 na estação limpa dados nominais E propaga onAccessDenied('denied')
    await h.act(async () => {
      const refresh403 = h.handler('Atualizar atendimento')();
      const idx403 = reqs.length - 1;
      reqs[idx403].d.reject(Object.assign(new Error('forbidden'), { status: 403 }));
      await refresh403;
    });
    assert.deepEqual(deniedKinds, ['denied']);

    // 6. Logout desmonta contexto operacional sem manter dados ou permitir mutações
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
  } finally {
    h.dispose();
  }
});
