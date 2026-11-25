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
const USER_1 = 'abcdef00-0000-4000-8000-000000000001';
const SESSION_1 = '10000000-0000-4000-8000-000000000001';
const PART_1 = '77777777-7777-4777-8777-777777777771';
const PART_2 = '77777777-7777-4777-8777-777777777772';
const CALL_1 = '88888888-8888-4888-8888-888888888881';
const CALL_2 = '88888888-8888-4888-8888-888888888882';
const AT = '2026-11-19T15:00:00.000Z';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// ============================================================================
// 1. Testes unitários do helper puro de horário formatado da chamada
// ============================================================================

const pureEntrySections = (() => {
  const nativeStub = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map((n) => [n, n]));
  nativeStub.StyleSheet = { create: (s) => s };
  const adminTheme = loadModule('screens/admin/components/adminTheme.js', require).exports;
  const adminLiveUi = loadModule('screens/admin/components/AdminLiveUI.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === './adminTheme') return adminTheme;
    return require(name);
  }).exports;
  const stationSections = loadModule('screens/staff/components/StaffStationSections.js', (name) => {
    if (name === 'react') return require('react');
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;
  return loadModule('screens/staff/components/StaffEntrySections.js', (name) => {
    if (name === 'react') return require('react');
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    if (name === './StaffStationSections') return stationSections;
    return require(name);
  }).exports;
})();

test('STAFF-03: formatEntryCallTimestamp formata instante ISO válido e descarta entradas inválidas', () => {
  assert.equal(pureEntrySections.formatEntryCallTimestamp('2026-11-19T15:30:12.000Z', { timeZone: 'UTC' }), 'Chamado às 15:30');
  assert.equal(pureEntrySections.formatEntryCallTimestamp('2026-11-19T15:05:00.123456Z', { timeZone: 'America/Sao_Paulo' }), 'Chamado às 12:05');
  assert.equal(pureEntrySections.formatEntryCallTimestamp('', { timeZone: 'UTC' }), null);
  assert.equal(pureEntrySections.formatEntryCallTimestamp('invalido', { timeZone: 'UTC' }), null);
  assert.equal(pureEntrySections.formatEntryCallTimestamp(null), null);
});

test('STAFF03-AUD-03: getDisableAffectedCount soma waitingCount e eventual chamada pendente', () => {
  assert.equal(pureEntrySections.getDisableAffectedCount(0, null), 0);
  assert.equal(pureEntrySections.getDisableAffectedCount(2, null), 2);
  assert.equal(pureEntrySections.getDisableAffectedCount(2, { id: CALL_1 }), 3);
  assert.equal(pureEntrySections.getDisableAffectedCount(0, { id: CALL_1 }), 1);
});

// ============================================================================
// 2. Harness real React + React Test Renderer para StaffEntryControlRealScreen
// ============================================================================

function createEntryScreenHarness({
  initialEvent = { id: EV_A, name: 'Arena Oficial UNDB' },
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
  onPatch,
  onAccessDenied = () => {},
  secureInitial = new Map(),
  secureAvailable = true,
  platformOS = 'android',
  getNow = () => Date.parse('2026-11-19T15:00:23.000Z'),
} = {}) {
  const { React, jsx, Renderer } = deps;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const secureValues = new Map(secureInitial);
  let deleteCalls = 0;
  let keySerial = 0;
  let pollingRegistration = null;
  let authState = initialAuth;
  let eventProp = initialEvent;
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
  native.Platform = { OS: platformOS };
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
  const entryStorageSvc = loadModule('services/staffEntryIntentStorage.js', (name) => {
    if (name === 'react-native') return native;
    if (name === 'expo-secure-store') {
      return {
        isAvailableAsync: async () => secureAvailable,
        getItemAsync: async (key) => secureValues.get(key) ?? null,
        setItemAsync: async (key, value) => { secureValues.set(key, value); },
        deleteItemAsync: async (key) => { deleteCalls += 1; secureValues.delete(key); },
      };
    }
    if (name === './staffEntryService') return entrySvc;
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
  const entrySections = loadModule('screens/staff/components/StaffEntrySections.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    if (name === './StaffStationSections') return stationSections;
    return require(name);
  }).exports;

  const StaffEntryControlRealScreen = loadModule('screens/staff/StaffEntryControlRealScreen.js', (name) => {
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
    if (name === '../../services/staffEntryService') return entrySvc;
    if (name === '../../services/staffEntryIntentStorage') return entryStorageSvc;
    if (name === '../admin/components/AdminLiveUI') return adminLiveUi;
    if (name === './components/StaffEntrySections') return entrySections;
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
    patch: (url, body, opts) => onPatch(url, body, opts),
  };

  const renderEl = () => React.createElement(
    AuthCtx.Provider,
    { value: { ...authState, httpClient } },
    React.createElement(StaffEntryControlRealScreen, {
      event: eventProp,
      isEventCurrent: () => eventCurrentFlag,
      accessDenied: accessDeniedProp,
      accessDeniedKind: accessDeniedKindProp,
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
    getDeleteCalls: () => deleteCalls,
    getPolling: () => pollingRegistration,
    async mount() {
      await Renderer.act(async () => {
        tree = Renderer.create(renderEl());
      });
    },
    async rerender(patch = {}) {
      if ('auth' in patch) authState = patch.auth;
      if ('event' in patch) eventProp = patch.event;
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
    hasEntryRow(position, displayName, isNext = false) {
      return tree.root.findAllByType('View').some((row) => {
        const children = (row.children ?? []).filter((n) => n && typeof n === 'object' && n.type === 'View');
        if (children.length < 2 || children.length > 3) return false;
        const left = children[0].findAllByType('Text').map((n) => flatten(n.props.children).trim());
        const right = children[1].findAllByType('Text').map((n) => flatten(n.props.children).trim());
        const badge = children[2] ? children[2].findAllByType('Text').map((n) => flatten(n.props.children).trim()) : [];
        return left.length === 1
          && left[0] === String(position)
          && right.includes(displayName)
          && (isNext ? badge.includes('PRÓXIMO') : badge.length === 0);
      });
    },
    pressables(label) {
      return tree.root.findAllByType('Pressable').filter((n) => n.props.accessibilityLabel === label);
    },
    hasButton(label) {
      return this.pressables(label).length > 0;
    },
    isDisabled(label) {
      const matches = this.pressables(label);
      assert.equal(matches.length, 1, `botão esperado: ${label}`);
      return Boolean(matches[0].props.disabled);
    },
    handler(label) {
      const matches = this.pressables(label);
      assert.equal(matches.length, 1, `handler esperado: ${label}`);
      return matches[0].props.onPress;
    },
    async press(label) {
      const fn = this.handler(label);
      assert.ok(fn, `botão ${label} não deve estar desabilitado ao pressionar`);
      await Renderer.act(async () => {
        await fn();
      });
    },
    modals() {
      return tree.root.findAllByType('Modal');
    },
    safeViews() {
      return tree.root.findAllByType('SafeAreaView');
    },
    scrollViews() {
      return tree.root.findAllByType('ScrollView');
    },
    unmount() {
      tree.unmount();
    },
  };
}

function buildState({
  enabled = true,
  canManage = true,
  pendingCall = null,
  waiting = [],
  canCall = enabled && canManage && !pendingCall && waiting.length > 0,
  canConfirm = enabled && canManage && Boolean(pendingCall),
  canMarkAbsent = enabled && canManage && Boolean(pendingCall),
  canRemove = enabled && canManage && Boolean(pendingCall),
} = {}) {
  return {
    eventId: EV_A,
    externalQueueEnabled: enabled,
    canManage,
    observedAt: AT,
    pendingCall,
    canCall,
    canConfirm,
    canMarkAbsent,
    canRemove,
    waitingCount: waiting.length,
    waiting,
  };
}

test('STAFF-03 tela Controle de Entrada: fila vazia, fila inativa, resumo e polling honesto', { skip }, async () => {
  let serverState = buildState({ enabled: true, waiting: [] });
  const h = createEntryScreenHarness({
    onGet: async () => serverState,
  });

  await h.mount();
  assert.ok(h.hasExactText('Controle de Entrada'));
  assert.ok(h.hasExactText('Arena Oficial UNDB'));
  assert.ok(h.hasExactText('FILA ATIVA'));
  assert.ok(h.hasText('Ninguém está aguardando na fila de entrada.'));
  assert.ok(h.hasExactText('Nenhum participante chamado'));
  assert.equal(h.isDisabled('Chamar próximo'), true);
  assert.equal(h.isDisabled('Desativar fila externa'), false);
  assert.ok(h.hasExactText('Atualização automática ativa · a cada 5s'));
  assert.equal(h.getPolling().enabled, true);

  await h.setFocused(false);
  assert.ok(h.hasExactText('Atualização temporariamente pausada'));
  await h.setFocused(true);
  assert.ok(h.hasExactText('Atualização automática ativa · a cada 5s'));

  await h.setAppState('background');
  assert.ok(h.hasExactText('Atualização temporariamente pausada'));
  await h.setAppState('active');
  assert.ok(h.hasExactText('Atualização automática ativa · a cada 5s'));

  // Fila inativa -> FILA INATIVA e Reativar habilitado
  serverState = buildState({ enabled: false, waiting: [] });
  await h.press('Atualizar fila de entrada');
  assert.ok(h.hasExactText('FILA INATIVA'));
  assert.equal(h.isDisabled('Chamar próximo'), true);
  assert.equal(h.isDisabled('Reativar fila externa'), false);
  h.unmount();
});

test('STAFF-03 tela Controle de Entrada: chamada destacada sem duplicidade, clique duplo e confirmação', { skip }, async () => {
  const requests = [];
  let waiting = [
    { participationId: PART_1, displayName: 'Mariana Costa', position: 1 },
    { participationId: PART_2, displayName: 'Lucas Ferreira', position: 2 },
  ];
  let pendingCall = null;
  const h = createEntryScreenHarness({
    getNow: () => Date.parse('2026-11-19T15:00:23.000Z'),
    onGet: async () => buildState({ enabled: true, pendingCall, waiting }),
    onPost: async (route, _body, opts) => {
      requests.push({ route, key: opts?.headers?.['Idempotency-Key'] });
      if (route.endsWith('/call-next')) {
        const person = waiting.shift();
        waiting = waiting.map((item, idx) => ({ ...item, position: idx + 1 }));
        pendingCall = { id: CALL_1, participationId: person.participationId, displayName: person.displayName, calledAt: AT };
        return {
          eventId: EV_A,
          call: { id: CALL_1, participationId: person.participationId, status: 'pending', calledAt: AT, resolvedAt: null },
          participation: { id: person.participationId, status: 'waiting', arenaEnteredAt: null, finishReason: null, externalQueueOrder: '1' },
          requeued: false,
        };
      }
      if (route.endsWith('/confirm')) {
        const personId = pendingCall.participationId;
        pendingCall = null;
        return {
          eventId: EV_A,
          call: { id: CALL_1, participationId: personId, status: 'confirmed', calledAt: AT, resolvedAt: AT },
          participation: { id: personId, status: 'active', arenaEnteredAt: AT, finishReason: null, externalQueueOrder: '1' },
          requeued: false,
        };
      }
      throw new Error(`POST inesperado: ${route}`);
    },
  });

  await h.mount();
  assert.equal(h.hasEntryRow(1, 'Mariana Costa', true), true);
  assert.equal(h.hasEntryRow(2, 'Lucas Ferreira', false), true);
  assert.equal(h.isDisabled('Chamar próximo'), false);

  // Clique duplo em "Chamar próximo" gera exatamente 1 POST
  const callHandler = h.handler('Chamar próximo');
  await h.act(async () => {
    await Promise.all([callHandler(), callHandler()]);
  });
  assert.equal(requests.length, 1);
  assert.equal(h.modals()[0].props.visible, false);

  // Participante chamada aparece em destaque no card de chamada e não duplicada na fila
  assert.ok(h.hasExactText('Mariana Costa'));
  assert.ok(h.hasExactText('CHAMADA PENDENTE'));
  assert.ok(h.hasExactText('Chamado há 00:23'));
  assert.ok(h.hasText('Chamado às '));
  assert.equal(h.hasEntryRow(1, 'Mariana Costa', false), false);
  assert.equal(h.hasEntryRow(1, 'Mariana Costa', true), false);
  assert.equal(h.hasEntryRow(1, 'Lucas Ferreira', false), true);
  assert.equal(h.hasButton('Chamar próximo'), false);

  // Modal de confirmação preserva SafeAreaView + ScrollView e nome do participante
  await h.press('Confirmar entrada');
  assert.equal(h.modals()[0].props.visible, true);
  assert.ok(h.safeViews().length >= 1);
  assert.ok(h.scrollViews().length >= 1);
  assert.ok(h.hasExactText('Confirmar entrada presencial?'));
  await h.press('CONFIRMAR ALTERAÇÃO');

  assert.equal(requests.length, 2);
  assert.ok(h.hasText('Entrada confirmada pelo servidor.'));
  assert.equal(h.hasEntryRow(1, 'Lucas Ferreira', true), true);
  assert.equal(h.hasText('Mariana Costa'), false);
  h.unmount();
});

test('STAFF03-AUD-05 + STAFF03-AUD-08 tela Controle de Entrada mantém comunicação coerente entre resumo operacional e chamada em todos os estados', { skip }, async () => {
  const summaryRestrictedMsg = 'O ingresso de novos participantes e alterações da fila externa estão indisponíveis. As ações sobre chamadas pendentes dependem das permissões atuais.';
  const legacyContradictoryMsg = 'O evento não permite entradas ou alterações da fila neste momento.';
  let mode = 'all_allowed';
  const h = createEntryScreenHarness({
    onGet: async () => {
      if (mode === 'unavailable') throw { status: 503, code: 'SERVICE_UNAVAILABLE' };
      if (mode === 'network') throw Object.assign(new Error('offline'), { isNetworkError: true });
      if (mode === 'all_allowed') {
        return buildState({
          enabled: true,
          canManage: true,
          pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
          waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
          canCall: false,
          canConfirm: true,
          canMarkAbsent: true,
          canRemove: true,
        });
      }
      if (mode === 'residual') {
        return buildState({
          enabled: true,
          canManage: false,
          pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
          waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
          canCall: false,
          canConfirm: false,
          canMarkAbsent: true,
          canRemove: true,
        });
      }
      if (mode === 'all_blocked') {
        return buildState({
          enabled: true,
          canManage: false,
          pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
          waiting: [],
          canCall: false,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
        });
      }
      return buildState({ enabled: false, canManage: true, pendingCall: null, waiting: [] });
    },
  });

  // 1. Operação normal: sem aviso indevido de indisponibilidade no resumo ou na chamada
  await h.mount();
  assert.equal(h.isDisabled('Confirmar entrada'), false);
  assert.equal(h.isDisabled('Marcar ausência'), false);
  assert.equal(h.isDisabled('Remover da fila'), false);
  assert.equal(h.hasText('A confirmação de entrada está indisponível.'), false);
  assert.equal(h.hasText(summaryRestrictedMsg), false);
  assert.equal(h.hasText(legacyContradictoryMsg), false);

  // 2. Janela residual: resumo e card da chamada comunicam restrição sem contradição
  mode = 'residual';
  await h.press('Atualizar fila de entrada');
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  assert.equal(h.isDisabled('Marcar ausência'), false);
  assert.equal(h.isDisabled('Remover da fila'), false);
  assert.equal(h.isDisabled('Desativar fila externa'), true);
  assert.ok(h.hasText(summaryRestrictedMsg));
  assert.ok(h.hasText('A confirmação de entrada está indisponível. Ainda é possível registrar ausência ou remover o participante chamado.'));
  assert.equal(h.hasText(legacyContradictoryMsg), false);

  // 3. Dados desatualizados (stale) preservam aviso de desatualização e bloqueiam ações
  mode = 'network';
  await h.act(async () => { await h.getPolling().read(); });
  assert.ok(h.hasText('Dados de entrada possivelmente desatualizados. Atualize antes de operar.'));
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  assert.equal(h.isDisabled('Marcar ausência'), true);
  assert.equal(h.isDisabled('Remover da fila'), true);

  // 4. Todas as ações bloqueadas pelo servidor: resumo e card refletem bloqueio integral
  mode = 'all_blocked';
  await h.press('Atualizar fila de entrada');
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  assert.equal(h.isDisabled('Marcar ausência'), true);
  assert.equal(h.isDisabled('Remover da fila'), true);
  assert.ok(h.hasText(summaryRestrictedMsg));
  assert.ok(h.hasText('As ações sobre a chamada externa estão indisponíveis no estado atual do evento.'));
  assert.equal(h.hasText(legacyContradictoryMsg), false);

  // 5. Fila inativa com gestão permitida: sem aviso indevido de !canManage
  mode = 'inactive';
  await h.press('Atualizar fila de entrada');
  assert.ok(h.hasExactText('FILA INATIVA'));
  assert.equal(h.hasText(summaryRestrictedMsg), false);
  assert.equal(h.isDisabled('Chamar próximo'), true);
  assert.equal(h.isDisabled('Reativar fila externa'), false);

  // 6. Indisponibilidade operacional
  mode = 'unavailable';
  await h.press('Atualizar fila de entrada');
  assert.ok(h.hasText('Não foi possível consultar a fila de entrada. Tente atualizar.'));
  h.unmount();
});

test('STAFF03-AUD-03 card D06 e modal de desativação refletem affectedCount observado em todos os 4 cenários e preservam releasedCount do servidor', { skip }, async () => {
  const PART_3 = '77777777-7777-4777-8777-777777777773';
  const scenarios = [
    {
      label: '0 aguardando, sem chamada',
      state: buildState({ enabled: true, waiting: [], pendingCall: null }),
      expectedText: 'No estado observado, 0 participantes serão liberados.',
      releasedCount: 0,
    },
    {
      label: '2 aguardando, sem chamada',
      state: buildState({
        enabled: true,
        waiting: [
          { participationId: PART_1, displayName: 'Bruno', position: 1 },
          { participationId: PART_2, displayName: 'Carlos', position: 2 },
        ],
        pendingCall: null,
      }),
      expectedText: 'No estado observado, 2 participantes aguardando serão liberados.',
      releasedCount: 2,
    },
    {
      label: '2 aguardando + 1 chamada pendente = 3',
      state: buildState({
        enabled: true,
        waiting: [
          { participationId: PART_2, displayName: 'Bruno', position: 1 },
          { participationId: PART_3, displayName: 'Carlos', position: 2 },
        ],
        pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana', calledAt: AT },
      }),
      expectedText: 'No estado observado, 3 participantes (2 aguardando e 1 em chamada pendente) serão liberados.',
      releasedCount: 3,
    },
    {
      label: '0 aguardando + 1 chamada pendente = 1',
      state: buildState({
        enabled: true,
        waiting: [],
        pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana', calledAt: AT },
      }),
      expectedText: 'No estado observado, 1 participante (incluindo a chamada pendente) será liberado.',
      releasedCount: 1,
    },
  ];

  for (const scenario of scenarios) {
    let current = scenario.state;
    const h = createEntryScreenHarness({
      onGet: async () => current,
      onPatch: async (_route, payload) => {
        current = buildState({ enabled: payload.enabled, waiting: [], pendingCall: null });
        return { eventId: EV_A, externalQueueEnabled: payload.enabled, releasedCount: scenario.releasedCount, changedAt: AT };
      },
    });
    await h.mount();
    assert.ok(h.hasText(scenario.expectedText), `card deve exibir contagem correta (${scenario.label})`);
    assert.ok(h.hasText('quantidade final será confirmada pelo servidor'));
    if (scenario.state.pendingCall) {
      // Não duplica pessoa chamada na lista FIFO nem altera waitingCount
      assert.equal(h.hasEntryRow(1, 'Ana', false), false);
      assert.equal(h.hasEntryRow(1, 'Ana', true), false);
      assert.ok(h.hasExactText(`${scenario.state.waitingCount} aguardando`));
    }
    await h.press('Desativar fila externa');
    assert.equal(h.modals()[0].props.visible, true);
    assert.ok(h.hasText(scenario.expectedText), `modal deve exibir contagem correta (${scenario.label})`);
    await h.press('CONFIRMAR ALTERAÇÃO');
    assert.ok(h.hasText(`Participantes liberados: ${scenario.releasedCount}.`));
    h.unmount();
  }
});

test('STAFF03-AUD-04 invalida modal obsoleto ao trocar chamada, perder permissão, chegar leitura em voo ou mudar contagem D06', { skip }, async () => {
  let posts = 0;
  let patches = 0;
  let serverState = buildState({
    enabled: true,
    pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana', calledAt: AT },
    waiting: [{ participationId: PART_2, displayName: 'Bruno', position: 1 }],
  });
  let inFlightRead = null;

  const h = createEntryScreenHarness({
    onGet: async () => (inFlightRead ? inFlightRead.promise : serverState),
    onPost: async () => { posts += 1; throw new Error('não deveria enviar POST obsoleto'); },
    onPatch: async () => { patches += 1; throw new Error('não deveria enviar PATCH obsoleto'); },
  });

  await h.mount();

  // Cenário 1: Staff A abre confirmação de Ana; Staff B resolve Ana e chama Bruno -> modal fecha e callback antigo gera 0 POSTs
  await h.press('Confirmar entrada');
  assert.equal(h.modals()[0].props.visible, true);
  const staleAnaConfirm = h.handler('CONFIRMAR ALTERAÇÃO');

  serverState = buildState({
    enabled: true,
    pendingCall: { id: CALL_2, participationId: PART_2, displayName: 'Bruno', calledAt: AT },
    waiting: [],
  });
  await h.act(async () => { await h.getPolling().read(); });
  assert.equal(h.modals()[0].props.visible, false);
  assert.ok(h.hasText('A chamada externa ou as permissões mudaram. Confira o estado atualizado antes de confirmar.'));
  assert.ok(h.hasExactText('Bruno'));
  await h.act(async () => { await staleAnaConfirm(); });
  assert.equal(posts, 0);
  assert.equal(h.getPolling().enabled, true);

  // Cenário 2: Leitura iniciada em voo ANTES da abertura do modal chega depois com mudança de permissão (corte)
  inFlightRead = deferred();
  const pendingPoll = h.getPolling().read();
  await h.press('Confirmar entrada');
  assert.equal(h.modals()[0].props.visible, true);
  const staleCutoffConfirm = h.handler('CONFIRMAR ALTERAÇÃO');

  const cutoffState = buildState({
    enabled: true,
    canManage: false,
    pendingCall: { id: CALL_2, participationId: PART_2, displayName: 'Bruno', calledAt: AT },
    waiting: [],
    canCall: false,
    canConfirm: false,
    canMarkAbsent: true,
    canRemove: true,
  });
  const resolveFlight = inFlightRead.resolve;
  inFlightRead = null;
  serverState = cutoffState;
  await h.act(async () => {
    resolveFlight(cutoffState);
    await pendingPoll;
  });
  assert.equal(h.modals()[0].props.visible, false);
  assert.ok(h.hasText('A chamada externa ou as permissões mudaram. Confira o estado atualizado antes de confirmar.'));
  await h.act(async () => { await staleCutoffConfirm(); });
  assert.equal(posts, 0);

  // Cenário 3: Modal de desativação D06 aberto com 1 afetado -> fila ganha novo participante (2 afetados) -> modal fecha sem PATCH
  serverState = buildState({
    enabled: true,
    canManage: true,
    pendingCall: null,
    waiting: [{ participationId: PART_1, displayName: 'Ana', position: 1 }],
  });
  await h.press('Atualizar fila de entrada');
  await h.press('Desativar fila externa');
  assert.equal(h.modals()[0].props.visible, true);
  const staleToggleConfirm = h.handler('CONFIRMAR ALTERAÇÃO');

  serverState = buildState({
    enabled: true,
    canManage: true,
    pendingCall: null,
    waiting: [
      { participationId: PART_1, displayName: 'Ana', position: 1 },
      { participationId: PART_2, displayName: 'Bruno', position: 2 },
    ],
  });
  await h.act(async () => { await h.getPolling().read(); });
  assert.equal(h.modals()[0].props.visible, false);
  assert.ok(h.hasText('A quantidade de participantes na fila externa mudou. Confira o estado atualizado antes de desativar.'));
  await h.act(async () => { await staleToggleConfirm(); });
  assert.equal(patches, 0);

  // Cenário 4: Cancelar modal não executa mutação e polling permanece ativo
  await h.press('Desativar fila externa');
  assert.equal(h.modals()[0].props.visible, true);
  await h.press('CANCELAR ALTERAÇÃO');
  assert.equal(h.modals()[0].props.visible, false);
  assert.equal(patches, 0);
  assert.equal(h.getPolling().enabled, true);
  h.unmount();
});

test('STAFF-03 modal seguro, incerteza dispatching e limpeza imediata em revogação 403/401', { skip }, async () => {
  let mode = 'ok';
  let deniedReason = null;
  let posts = 0;
  const initial = buildState({
    enabled: true,
    pendingCall: { id: CALL_2, participationId: PART_1, displayName: 'Pedro Henrique', calledAt: AT },
    waiting: [{ participationId: PART_2, displayName: 'Beatriz Alves', position: 1 }],
  });

  const h = createEntryScreenHarness({
    onGet: async () => {
      if (mode === '403') throw { status: 403, code: 'STAFF_EVENT_FORBIDDEN' };
      if (mode === '401') throw { status: 401, code: 'SESSION_REVOKED' };
      return initial;
    },
    onPost: async () => {
      posts += 1;
      throw Object.assign(new Error('offline'), { isNetworkError: true });
    },
    onAccessDenied: (kind) => {
      deniedReason = kind;
      void h.rerender({ accessDenied: true, accessDeniedKind: kind });
    },
  });

  await h.mount();
  await h.press('Marcar ausência');
  assert.equal(h.modals()[0].props.visible, true);

  // Perda de rede durante confirmação gera estado incerto bloqueante sem apagar intenção
  await h.press('CONFIRMAR ALTERAÇÃO');
  assert.equal(posts, 1);
  assert.ok(h.hasText('O resultado de uma solicitação ainda não foi confirmado'));
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  assert.equal(h.isDisabled('Desativar fila externa'), true);
  assert.equal(h.secureValues.size > 0, true);
  assert.equal(h.getDeleteCalls(), 0);

  // 403 limpa imediatamente dados nominais e preserva intenção persistida em SecureStore
  mode = '403';
  await h.press('Atualizar fila de entrada');
  assert.equal(deniedReason, 'denied');
  assert.equal(h.hasText('Pedro Henrique'), false);
  assert.equal(h.hasText('Beatriz Alves'), false);
  assert.ok(h.hasText('Acesso ao evento indisponível'));
  assert.equal(h.secureValues.size > 0, true);
  assert.equal(h.getDeleteCalls(), 0);
  h.unmount();

  // 401 também fecha modal aberto e descarta callbacks pendentes antes da entrega
  let denied401 = null;
  let postMutations = 0;
  const h401 = createEntryScreenHarness({
    onGet: async () => (denied401 === 'trigger' ? Promise.reject({ status: 401, code: 'SESSION_REVOKED' }) : initial),
    onPost: async () => { postMutations += 1; },
    onAccessDenied: (kind) => {
      denied401 = kind;
      void h401.rerender({ accessDenied: true, accessDeniedKind: kind });
    },
  });
  await h401.mount();
  await h401.press('Remover da fila');
  assert.equal(h401.modals()[0].props.visible, true);
  const staleConfirm = h401.handler('CONFIRMAR ALTERAÇÃO');

  denied401 = 'trigger';
  await h401.act(async () => { await h401.getPolling().read(); });
  assert.equal(denied401, 'session');
  assert.equal(h401.modals().length, 0);
  await h401.act(async () => { await staleConfirm(); });
  assert.equal(postMutations, 0);
  assert.equal(h401.hasText('Pedro Henrique'), false);
  assert.ok(h401.hasText('Sessão inválida'));
  h401.unmount();
});
