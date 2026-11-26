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
  onSecureSet,
  onSecureDelete,
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
        setItemAsync: async (key, value) => {
          if (onSecureSet) await onSecureSet(key, value);
          secureValues.set(key, value);
        },
        deleteItemAsync: async (key) => {
          if (onSecureDelete) await onSecureDelete(key);
          deleteCalls += 1;
          secureValues.delete(key);
        },
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
  const syncFeedback = loadModule('screens/staff/components/StaffSyncFeedback.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
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

// ============================================================================
// 3. Testes unitários de StaffSyncFeedback e cobertura STAFF-04 da tela Entrada
// ============================================================================

const pureSyncFeedback = (() => {
  const nativeStub = Object.fromEntries(['Text', 'View'].map((n) => [n, n]));
  nativeStub.StyleSheet = { create: (s) => s };
  const adminTheme = loadModule('screens/admin/components/adminTheme.js', require).exports;
  const adminLiveUi = loadModule('screens/admin/components/AdminLiveUI.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === './adminTheme') return adminTheme;
    return require(name);
  }).exports;
  return loadModule('screens/staff/components/StaffSyncFeedback.js', (name) => {
    if (name === 'react') return require('react');
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return nativeStub;
    if (name === '../../admin/components/AdminLiveUI') return adminLiveUi;
    return require(name);
  }).exports;
})();

test('STAFF-04: StaffSyncFeedback cobre indicadores honestos, confirmações específicas, códigos reais de recusa e fallback seguro', () => {
  const {
    resolveStaffPollingIndicator,
    describeEntryConfirmed,
    describeEntryRejection,
    describeEntryNotice,
    describeStationConfirmed,
    describeStationRejection,
    describeStationFeedback,
  } = pureSyncFeedback;

  // Indicadores de polling em todos os estados obrigatórios
  assert.equal(resolveStaffPollingIndicator({ hidden: true }), null);
  assert.equal(
    resolveStaffPollingIndicator({ verifying: true }).text,
    'Atualização indisponível · verificando autorização',
  );
  assert.equal(
    resolveStaffPollingIndicator({ loading: true }).text,
    'Atualização temporariamente pausada · carregamento em andamento',
  );
  assert.equal(
    resolveStaffPollingIndicator({ stale: true, pollingEnabled: true, visible: true, intervalSeconds: 5 }).text,
    'Dados desatualizados · tentando atualizar a cada 5s',
  );
  assert.equal(
    resolveStaffPollingIndicator({ stale: true, pollingEnabled: true, visible: false, intervalSeconds: 5 }).text,
    'Dados desatualizados · atualização temporariamente pausada',
  );
  assert.equal(
    resolveStaffPollingIndicator({ recoverableError: true, pollingEnabled: true, visible: true, intervalSeconds: 60 }).text,
    'Atualização indisponível · aguardando recuperação (a cada 60s)',
  );
  assert.equal(
    resolveStaffPollingIndicator({ recoverableError: true, pollingEnabled: true, visible: false, intervalSeconds: 5 }).text,
    'Atualização temporariamente pausada',
  );
  assert.equal(
    resolveStaffPollingIndicator({ unavailableError: true, pollingEnabled: false, visible: true }).text,
    'Atualização indisponível · aguardando recuperação manual',
  );
  assert.equal(
    resolveStaffPollingIndicator({ pollingEnabled: false, visible: true }).text,
    'Atualização temporariamente pausada',
  );
  assert.equal(
    resolveStaffPollingIndicator({ pollingEnabled: true, visible: true, intervalSeconds: 5 }).text,
    'Atualização automática ativa · a cada 5s',
  );
  // Cadência separada para Eventos e fase (60s) e ausência de afirmação automática sob accessUncertain
  assert.equal(
    resolveStaffPollingIndicator({ pollingEnabled: true, visible: true, intervalSeconds: 60, subject: 'Eventos e fase' }).text,
    'Eventos e fase: atualização automática ativa · a cada 60s',
  );
  assert.equal(
    resolveStaffPollingIndicator({ stale: true, pollingEnabled: true, visible: true, intervalSeconds: 60, subject: 'Eventos e fase' }).text,
    'Eventos e fase: dados desatualizados · tentando atualizar a cada 60s',
  );
  assert.equal(
    resolveStaffPollingIndicator({ stale: true, pollingEnabled: true, visible: false, intervalSeconds: 60, subject: 'Eventos e fase' }).text,
    'Eventos e fase: dados desatualizados · atualização temporariamente pausada',
  );
  assert.equal(
    resolveStaffPollingIndicator({ unavailableError: true, pollingEnabled: false, visible: true, intervalSeconds: 60, subject: 'Eventos e fase' }).text,
    'Eventos e fase: atualização indisponível · aguardando recuperação manual',
  );

  // Confirmações do Controle de Entrada (incluindo absent com requeued true vs false)
  assert.equal(describeEntryConfirmed('call', {}), 'Participante chamado pelo servidor.');
  assert.equal(describeEntryConfirmed('confirm_call', {}), 'Entrada confirmada pelo servidor.');
  assert.equal(
    describeEntryConfirmed('absent', { requeued: true }),
    'Ausência registrada pelo servidor. Participante retornou ao fim da fila externa.',
  );
  assert.equal(
    describeEntryConfirmed('absent', { requeued: false }),
    'Ausência registrada pelo servidor. Após o corte de entrada, o participante não retornou à fila externa.',
  );
  assert.equal(describeEntryConfirmed('remove', {}), 'Participante removido da fila externa pelo servidor.');
  assert.equal(describeEntryConfirmed('toggle', { externalQueueEnabled: true }), 'Fila externa reativada pelo servidor.');
  assert.equal(
    describeEntryConfirmed('toggle', { externalQueueEnabled: false, releasedCount: 3 }),
    'Fila externa desativada pelo servidor. Participantes liberados: 3.',
  );

  // Recusas reais do Controle de Entrada + fallback seguro
  for (const [code, fragment] of [
    ['ENTRY_NOT_FIRST', 'A fila mudou. Confira o primeiro participante'],
    ['ENTRY_QUEUE_EMPTY', 'A fila externa está vazia'],
    ['ENTRY_CALL_PENDING', 'Já existe uma chamada externa pendente'],
    ['ENTRY_CALL_REQUIRED', 'necessário chamar um participante'],
    ['ENTRY_CALL_NOT_PENDING', 'já não está pendente'],
    ['EVENT_ENTRY_UNAVAILABLE', 'não é permitida no estado atual'],
    ['RESOURCE_NOT_FOUND', 'chamada ou recurso informado não foi encontrado'],
    ['STAFF_EVENT_FORBIDDEN', 'acesso a este evento não está disponível'],
    ['SESSION_REVOKED', 'Sessão inválida'],
  ]) {
    assert.ok(describeEntryRejection(code).includes(fragment), code);
  }
  assert.ok(describeEntryRejection(null, 401).includes('Sessão inválida'));
  assert.ok(describeEntryRejection(null, 403).includes('acesso a este evento não está disponível'));
  assert.ok(describeEntryRejection(null, 404).includes('chamada ou recurso informado não foi encontrado'));
  const unknownEntryMsg = describeEntryRejection('PG_ERROR_23505');
  assert.ok(unknownEntryMsg.includes('Operação recusada pelo servidor'));
  assert.equal(unknownEntryMsg.includes('PG_ERROR_23505'), false);
  assert.equal(describeEntryNotice({ outcome: { kind: 'rejected', code: 'ENTRY_CALL_PENDING' } }), describeEntryRejection('ENTRY_CALL_PENDING'));

  // Estações: confirmações, recusas e feedbacks especiais
  assert.equal(describeStationConfirmed({ status: 'pending' }), 'Participante chamado. Operação confirmada pelo servidor.');
  assert.equal(describeStationConfirmed({ status: 'completed' }), 'Atendimento concluído. Operação confirmada pelo servidor.');
  assert.equal(describeStationConfirmed({ status: 'canceled' }), 'Participante removido da fila. Operação confirmada pelo servidor.');
  assert.equal(describeStationConfirmed({ status: 'absent', requeued: true }), 'Ausência registrada; participante retornou ao fim da fila.');
  assert.equal(describeStationConfirmed({ status: 'absent', requeued: false }), 'Ausência registrada; participante não retornou à fila após o corte.');
  for (const [code, fragment] of [
    ['QUEUE_EMPTY', 'fila da experiência está vazia'],
    ['STATION_UNAVAILABLE', 'estação não está disponível'],
    ['STATION_HAS_PENDING_CALL', 'já possui um atendimento pendente'],
    ['SERVICE_NOT_PENDING', 'chamada já não está pendente'],
    ['EVENT_OPERATION_ENDED', 'não é permitida no estado atual'],
    ['QUEUE_ENTRY_NOT_WAITING', 'A fila mudou'],
    ['RESOURCE_NOT_FOUND', 'atendimento ou recurso informado não foi encontrado'],
  ]) {
    assert.ok(describeStationRejection(code).includes(fragment), code);
  }
  assert.ok(describeStationRejection(null, 401).includes('Sessão inválida'));
  assert.ok(describeStationRejection(null, 403).includes('acesso a este evento não está disponível'));
  assert.ok(describeStationRejection(null, 404).includes('atendimento ou recurso informado não foi encontrado'));
  const unknownStationMsg = describeStationRejection('RAW_INTERNAL_ERR');
  assert.ok(unknownStationMsg.includes('Operação recusada pelo servidor'));
  assert.equal(unknownStationMsg.includes('RAW_INTERNAL_ERR'), false);
  for (const preCase of [
    { kind: 'rejected', phase: 'precondition', network: true, code: null },
    { kind: 'rejected', phase: 'precondition', timeout: true, network: true, transient: true, code: null },
    { kind: 'rejected', phase: 'precondition', status: 503, transient: true, code: null },
    { kind: 'rejected', phase: 'precondition', status: null, transient: true, code: null },
  ]) {
    const preFeedback = describeStationFeedback(preCase);
    assert.equal(preFeedback.tone, 'warning');
    assert.equal(preFeedback.text, 'Não foi possível verificar se a operação pode ser realizada. Nenhuma alteração foi enviada. Atualize os dados antes de tentar novamente.');
  }
  assert.ok(describeStationFeedback({ kind: 'rejected', phase: 'precondition', status: 403, transient: false, code: 'STAFF_EVENT_FORBIDDEN' }).text.includes('acesso a este evento não está disponível'));
  assert.ok(describeStationFeedback({ kind: 'rejected', phase: 'precondition', status: 401, transient: false, code: null }).text.includes('Sessão inválida'));
  assert.ok(describeStationFeedback({ kind: 'rejected', phase: 'precondition', status: 404, transient: false, code: null }).text.includes('atendimento ou recurso informado não foi encontrado'));
  assert.ok(describeStationFeedback({ kind: 'rejected', phase: 'precondition', status: 409, transient: false, code: 'STATION_UNAVAILABLE' }).text.includes('estação não está disponível'));
  assert.ok(describeStationFeedback({ kind: 'blocked' }).text.includes('estado operacional mudou'));
  assert.ok(describeStationFeedback({ kind: 'confirmed_cleanup_pending' }).text.includes('reconhecimento local ainda não foi concluído'));
  assert.ok(describeStationFeedback({ kind: 'rejected_cleanup_pending' }).text.includes('Recusa registrada pelo servidor'));
  assert.ok(describeStationFeedback({ kind: 'storage_error' }).text.includes('Armazenamento seguro indisponível'));
  assert.ok(describeStationFeedback({ kind: 'uncertain' }).text.includes('O resultado exige verificação ou reconciliação. Não repita a operação.'));
});

test('STAFF-04 tela Controle de Entrada: recuperação automática após erro inicial, busy, absent requeued vs corte e códigos de recusa', { skip }, async () => {
  const entrySlot = `arenago.staff.entry.${USER_1}`;
  let getMode = 'timeout';
  let postDeferred = null;
  let postMode = 'absent_requeue';
  let postCalls = 0;

  let currentState = buildState({
    enabled: true,
    pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
    waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
  });

  const h = createEntryScreenHarness({
    onGet: async () => {
      if (getMode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
      if (getMode === '503') throw Object.assign(new Error('503'), { status: 503 });
      if (getMode === 'malformed') return { eventId: EV_A, waitingCount: 4, waiting: [] };
      return currentState;
    },
    onPost: async () => {
      postCalls += 1;
      if (postDeferred) {
        const d = postDeferred;
        postDeferred = null;
        return d.promise;
      }
      if (postMode === 'absent_requeue') {
        currentState = buildState({
          enabled: true,
          pendingCall: null,
          waiting: [
            { participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 },
            { participationId: PART_1, displayName: 'Ana Clara', position: 2 },
          ],
        });
        return {
          eventId: EV_A,
          call: { id: CALL_1, participationId: PART_1, status: 'absent', calledAt: AT, resolvedAt: AT },
          participation: { id: PART_1, status: 'waiting', arenaEnteredAt: null, finishReason: null, externalQueueOrder: '3' },
          requeued: true,
        };
      }
      if (postMode === 'absent_cutoff') {
        currentState = buildState({
          enabled: true,
          pendingCall: null,
          waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
        });
        return {
          eventId: EV_A,
          call: { id: CALL_1, participationId: PART_1, status: 'absent', calledAt: AT, resolvedAt: AT },
          participation: { id: PART_1, status: 'finished', arenaEnteredAt: null, finishReason: 'external_absence_after_entry_cutoff', externalQueueOrder: null },
          requeued: false,
        };
      }
      if (postMode.startsWith('reject:')) {
        throw Object.assign(new Error('conflict'), { status: 409, code: postMode.slice('reject:'.length) });
      }
      throw Object.assign(new Error('bad'), { status: 400, code: 'INTERNAL_UNMAPPED_ERR' });
    },
  });

  const flush = () => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  // 1. Falha inicial por timeout habilita recuperação automática (5s) e não fabrica fila vazia
  await h.mount();
  assert.ok(h.hasText('Não foi possível conectar. Verifique sua conexão e atualize.'));
  assert.ok(h.hasExactText('Atualização indisponível · aguardando recuperação (a cada 5s)'));
  assert.equal(h.getPolling().enabled, true);
  assert.ok(!h.hasText('Ninguém está aguardando'));

  // 503 e payload inválido continuam em erro elegível para recuperação
  getMode = '503';
  await h.act(async () => { await h.getPolling().read(); });
  assert.ok(h.hasText('Não foi possível consultar a fila de entrada. Tente atualizar.'));
  assert.equal(h.getPolling().enabled, true);

  getMode = 'malformed';
  await h.act(async () => { await h.getPolling().read(); });
  assert.equal(h.getPolling().enabled, true);

  // Recuperação automática por GET lê SecureStore e preserva intenção dispatching bloqueante
  h.secureValues.set(entrySlot, JSON.stringify({
    userId: USER_1,
    sessionId: SESSION_1,
    eventId: EV_A,
    key: '50000000-0000-4000-8000-000000000091',
    kind: 'call',
    participationId: null,
    callId: null,
    enabled: null,
    phase: 'dispatching',
  }));
  getMode = 'ok';
  await h.act(async () => { await h.getPolling().read(); });
  assert.ok(h.hasExactText('Ana Clara'));
  assert.ok(h.hasText('O resultado de uma solicitação ainda não foi confirmado'));
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  assert.equal(postCalls, 0);

  // Intenção reservada (não enviada) exibe aviso distinto e pode ser descartada com segurança
  h.secureValues.set(entrySlot, JSON.stringify({
    userId: USER_1,
    sessionId: SESSION_1,
    eventId: EV_A,
    key: '50000000-0000-4000-8000-000000000092',
    kind: 'call',
    participationId: null,
    callId: null,
    enabled: null,
    phase: 'reserved',
  }));
  await h.press('Atualizar fila de entrada');
  assert.ok(h.hasText('Há uma solicitação registrada que ainda não foi enviada.'));
  assert.equal(h.isDisabled('Confirmar entrada'), true);
  await h.press('Descartar solicitação não enviada');
  assert.equal(h.isDisabled('Confirmar entrada'), false);

  // 2. Estado busy durante POST exibe processamento explícito e pausa polling
  postDeferred = deferred();
  await h.press('Marcar ausência');
  let inflightAbsent;
  await h.act(async () => {
    inflightAbsent = h.handler('CONFIRMAR ALTERAÇÃO')();
  });
  assert.ok(h.hasExactText('Processando operação no servidor...'));
  assert.equal(h.getPolling().enabled, false);
  currentState = buildState({
    enabled: true,
    pendingCall: null,
    waiting: [
      { participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 },
      { participationId: PART_1, displayName: 'Ana Clara', position: 2 },
    ],
  });
  await h.act(async () => {
    postDeferred.resolve({
      eventId: EV_A,
      call: { id: CALL_1, participationId: PART_1, status: 'absent', calledAt: AT, resolvedAt: AT },
      participation: { id: PART_1, status: 'waiting', arenaEnteredAt: null, finishReason: null, externalQueueOrder: '3' },
      requeued: true,
    });
    await inflightAbsent;
  });
  await flush();
  assert.ok(h.hasText('Ausência registrada pelo servidor. Participante retornou ao fim da fila externa.'));

  // 3. Ausência após o corte (requeued: false) não afirma reinserção
  currentState = buildState({
    enabled: true,
    pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
    waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
  });
  await h.press('Atualizar fila de entrada');
  postMode = 'absent_cutoff';
  await h.press('Marcar ausência');
  await h.press('CONFIRMAR ALTERAÇÃO');
  await flush();
  assert.ok(h.hasText('Ausência registrada pelo servidor. Após o corte de entrada, o participante não retornou à fila externa.'));

  // 4. Recusa com código real do backend e fallback seguro sem vazar detalhes internos
  currentState = buildState({
    enabled: true,
    pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
    waiting: [],
  });
  await h.press('Atualizar fila de entrada');
  postMode = 'reject:ENTRY_CALL_NOT_PENDING';
  await h.press('Confirmar entrada');
  await h.press('CONFIRMAR ALTERAÇÃO');
  await flush();
  assert.ok(h.hasText('A chamada externa já não está pendente. Confira o estado atualizado.'));

  postMode = 'reject_unknown';
  await h.press('Confirmar entrada');
  await h.press('CONFIRMAR ALTERAÇÃO');
  await flush();
  assert.ok(h.hasText('Operação recusada pelo servidor.'));
  assert.equal(h.hasText('INTERNAL_UNMAPPED_ERR'), false);
  h.unmount();
});

test('STAFF04-AUD-03: StaffEntryControlRealScreen distingue preparação, despacho, servidor, reconhecimento e descarte com promessas controladas', { skip }, async () => {
  const EV_B = '22222222-2222-4222-8222-222222222222';
  const entrySlot = `arenago.staff.entry.${USER_1}`;
  let secureSetGates = [];
  let postDeferred = null;
  let postCalls = 0;
  let activeEventId = EV_A;
  const makeStateFor = (evId, withCall = true) => ({
    eventId: evId,
    externalQueueEnabled: true,
    canManage: true,
    observedAt: AT,
    pendingCall: withCall ? { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT } : null,
    waitingCount: 1,
    waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
    canCall: !withCall,
    canConfirm: withCall,
    canMarkAbsent: withCall,
    canRemove: withCall,
  });
  let currentState = makeStateFor(EV_A, true);

  const reservedSeed = new Map([
    [entrySlot, JSON.stringify({
      userId: USER_1,
      sessionId: SESSION_1,
      eventId: EV_A,
      key: '50000000-0000-4000-8000-000000000093',
      kind: 'call',
      participationId: null,
      callId: null,
      enabled: null,
      phase: 'reserved',
    })],
  ]);

  const h = createEntryScreenHarness({
    secureInitial: reservedSeed,
    onSecureSet: async (_, raw) => {
      const parsed = JSON.parse(raw);
      const gate = secureSetGates.find((g) => g.phase === parsed.phase);
      if (gate) {
        secureSetGates = secureSetGates.filter((g) => g !== gate);
        await gate.deferred.promise;
        if (gate.fail) throw gate.fail;
      }
    },
    onGet: async () => ({ ...currentState, eventId: activeEventId }),
    onPost: async () => {
      postCalls += 1;
      if (postDeferred) {
        const d = postDeferred;
        postDeferred = null;
        return d.promise;
      }
      currentState = makeStateFor(activeEventId, false);
      return {
        eventId: activeEventId,
        call: { id: CALL_1, participationId: PART_1, status: 'confirmed', calledAt: AT, resolvedAt: AT },
        participation: { id: PART_1, status: 'active', arenaEnteredAt: AT, finishReason: null, externalQueueOrder: '1' },
        requeued: false,
      };
    },
  });

  const flush = () => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  await h.mount();

  // 1. Cancelamento efetivo de intenção reservada exibe mensagem específica de descarte
  const cancelGate = deferred();
  secureSetGates.push({ phase: 'cancelled', deferred: cancelGate });
  let pCancel;
  await h.act(async () => {
    pCancel = h.handler('Descartar solicitação não enviada')();
  });
  assert.ok(h.hasExactText('Descartando solicitação não enviada...'));
  assert.equal(h.hasText('Processando operação no servidor...'), false);
  assert.equal(h.hasText('Preparando solicitação com segurança...'), false);
  await h.act(async () => {
    cancelGate.resolve();
    await pCancel;
  });
  await flush();
  assert.equal(h.hasText('Descartando solicitação não enviada...'), false);

  // 2. Nova solicitação: reserve pendente -> 'Preparando solicitação com segurança...'
  //    dispatch pendente (com pending.phase === 'reserved') -> 'Registrando envio seguro...' (NÃO descarte!)
  //    POST pendente -> 'Processando operação no servidor...'
  //    acknowledge pendente -> 'Finalizando reconhecimento seguro local...'
  const reserveGate = deferred();
  const dispatchGate = deferred();
  const ackGate = deferred();
  secureSetGates.push(
    { phase: 'reserved', deferred: reserveGate },
    { phase: 'dispatching', deferred: dispatchGate },
    { phase: 'acknowledged', deferred: ackGate },
  );
  postDeferred = deferred();

  await h.press('Confirmar entrada');
  let pMutate;
  await h.act(async () => {
    pMutate = h.handler('CONFIRMAR ALTERAÇÃO')();
  });
  assert.ok(h.hasExactText('Preparando solicitação com segurança...'));
  assert.equal(h.hasText('Descartando solicitação não enviada...'), false);
  assert.equal(postCalls, 0);

  await h.act(async () => {
    reserveGate.resolve();
  });
  assert.equal(JSON.parse(h.secureValues.get(entrySlot)).phase, 'reserved');
  assert.ok(h.hasExactText('Registrando envio seguro...'));
  assert.equal(h.hasText('Descartando solicitação não enviada...'), false);
  assert.equal(postCalls, 0);

  await h.act(async () => {
    dispatchGate.resolve();
  });
  assert.equal(JSON.parse(h.secureValues.get(entrySlot)).phase, 'dispatching');
  assert.ok(h.hasExactText('Processando operação no servidor...'));
  assert.equal(postCalls, 1);

  currentState = makeStateFor(EV_A, false);
  await h.act(async () => {
    postDeferred.resolve({
      eventId: EV_A,
      call: { id: CALL_1, participationId: PART_1, status: 'confirmed', calledAt: AT, resolvedAt: AT },
      participation: { id: PART_1, status: 'active', arenaEnteredAt: AT, finishReason: null, externalQueueOrder: '1' },
      requeued: false,
    });
    await pMutate;
  });
  assert.ok(h.hasExactText('Finalizando reconhecimento seguro local...'));

  await h.act(async () => {
    ackGate.resolve();
  });
  await flush();
  assert.ok(h.hasText('Entrada confirmada pelo servidor.'));

  // 3. Falha durante persistência (reserve falha) limpa busy e permite operação posterior normalmente
  const failingReserve = deferred();
  secureSetGates.push({ phase: 'reserved', deferred: failingReserve, fail: new Error('write-fail') });
  currentState = makeStateFor(EV_A, true);
  await h.press('Atualizar fila de entrada');
  await h.press('Confirmar entrada');
  let pFailMutate;
  await h.act(async () => {
    pFailMutate = h.handler('CONFIRMAR ALTERAÇÃO')();
  });
  assert.ok(h.hasExactText('Preparando solicitação com segurança...'));
  await h.act(async () => {
    failingReserve.resolve();
    await pFailMutate;
  });
  await flush();
  assert.equal(h.hasText('Preparando solicitação com segurança...'), false);
  assert.ok(h.hasText('Não foi possível verificar o registro seguro da solicitação.'));

  // Após atualizar e limpar erro de persistência, nova operação percorre os estágios normais
  h.secureValues.delete(entrySlot);
  await h.press('Atualizar fila de entrada');
  const nextAckGate = deferred();
  secureSetGates.push({ phase: 'acknowledged', deferred: nextAckGate });
  await h.press('Confirmar entrada');
  await h.press('CONFIRMAR ALTERAÇÃO');
  assert.ok(h.hasExactText('Finalizando reconhecimento seguro local...'));

  // 4. Troca de contexto durante reconhecimento pendente isola busyStage e notice do contexto antigo
  activeEventId = EV_B;
  currentState = makeStateFor(EV_B, true);
  await h.rerender({ event: { id: EV_B, name: 'Arena Evento B' } });
  await h.act(async () => {
    nextAckGate.resolve();
  });
  await flush();
  assert.equal(h.hasText('Entrada confirmada pelo servidor.'), false);
  assert.equal(h.hasText('Finalizando reconhecimento seguro local...'), false);
  h.unmount();
});

test('STAFF04-AUD-04: 401/403 em mutação na tela Controle de Entrada revoga antes de storage.finish terminar; 404 com GET 200 preserva acesso', { skip }, async () => {
  const flush = (h) => h.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const pendingState = buildState({
    enabled: true,
    pendingCall: { id: CALL_1, participationId: PART_1, displayName: 'Ana Clara', calledAt: AT },
    waiting: [{ participationId: PART_2, displayName: 'Lucas Ferreira', position: 1 }],
  });

  // 1. 403 e 401 em mutação notificam onAccessDenied e limpam dados ANTES da gravação local terminal finalizar
  for (const [httpStatus, code, expectedKind, expectedAlert] of [
    [403, 'STAFF_EVENT_FORBIDDEN', 'denied', 'Acesso ao evento indisponível'],
    [401, 'SESSION_REVOKED', 'session', 'Sessão inválida'],
  ]) {
    let deniedKind = null;
    let posted = false;
    let getsAfterPost = 0;
    const finishGate = deferred();
    const h = createEntryScreenHarness({
      onAccessDenied: (kind) => {
        deniedKind = kind;
        void h.rerender({ accessDenied: true, accessDeniedKind: kind });
      },
      onSecureSet: async (_, raw) => {
        if (JSON.parse(raw).phase === 'terminal') await finishGate.promise;
      },
      onGet: async () => {
        if (posted) getsAfterPost += 1;
        return pendingState;
      },
      onPost: async () => {
        posted = true;
        throw Object.assign(new Error('auth error'), { status: httpStatus, code });
      },
    });
    await h.mount();
    await h.press('Confirmar entrada');
    let pendingConfirm;
    await h.act(async () => {
      pendingConfirm = h.handler('CONFIRMAR ALTERAÇÃO')();
    });
    await flush(h);

    // ANTES de storage.finish resolver: interface e trava já estão bloqueadas sem GET adicional
    assert.equal(deniedKind, expectedKind);
    assert.equal(getsAfterPost, 0, `${httpStatus}: não dispara GET extra após negativa em mutação`);
    assert.equal(h.hasText('Ana Clara'), false);
    assert.equal(h.hasText('Lucas Ferreira'), false);
    assert.ok(h.hasText(expectedAlert));
    assert.equal(h.getPolling().enabled, false);

    // Após finish resolver: resultado terminal fica gravado na intenção original
    await h.act(async () => {
      finishGate.resolve();
      await pendingConfirm;
    });
    assert.equal(h.getDeleteCalls(), 0, `${httpStatus}: recibo preservado no SecureStore`);
    assert.equal(JSON.parse(h.secureValues.get(`arenago.staff.entry.${USER_1}`)).outcome.status, httpStatus);
    h.unmount();
  }

  // 2. 404 RESOURCE_NOT_FOUND na mutação + GET 200 mantém tela ativa sem revogar o evento
  let deniedOn404 = null;
  let after404 = false;
  const h404 = createEntryScreenHarness({
    onAccessDenied: (kind) => { deniedOn404 = kind; },
    onGet: async () => (
      after404
        ? buildState({ enabled: true, pendingCall: null, waiting: [] })
        : pendingState
    ),
    onPost: async () => {
      after404 = true;
      throw Object.assign(new Error('not found'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
    },
  });
  await h404.mount();
  await h404.press('Confirmar entrada');
  await h404.press('CONFIRMAR ALTERAÇÃO');
  await flush(h404);
  assert.equal(deniedOn404, null);
  assert.ok(h404.hasText('A chamada ou recurso informado não foi encontrado no servidor. Confira o estado atualizado.'));
  h404.unmount();
});
