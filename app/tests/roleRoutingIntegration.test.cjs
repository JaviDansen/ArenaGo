// Exercita gerenciador, AuthProvider, ParticipationProvider e roteador juntos;
// somente transporte, armazenamento e views nativas são substituídos.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const { loadModule, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');

const qaRequire = createRequire(path.resolve(__dirname, '../../qa/regression/package.json'));
let deps;
try {
  deps = { React: qaRequire('react'), jsx: qaRequire('react/jsx-runtime'),
    Renderer: qaRequire('react-test-renderer'), Navigation: qaRequire('@react-navigation/core'),
    StackRouter: qaRequire('@react-navigation/routers').StackRouter };
} catch { deps = null; }
const skip = deps ? false : 'dependências de qa/regression não instaladas';

function createIntegration({ initialToken = null, initialUser, control = {} }) {
  const { React, jsx, Renderer, Navigation, StackRouter } = deps;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let user = initialUser;
  let token = initialToken;
  let refreshCount = 0;
  let generatedKeys = 0;
  const calls = [];
  const navRef = Navigation.createNavigationContainerRef();
  const unhandled = [];
  const storage = { isPersistent: true, getRefreshToken: async () => token,
    setRefreshToken: async (value) => {
      if (control.failWrite?.(value)) throw Object.assign(new Error('storage'), { kind: 'storage', isStorageError: true });
      token = value;
    }, clearRefreshToken: async () => { token = null; } };
  const transport = {
    async get(url) {
      calls.push(url);
      if (url === '/auth/me') {
        if (control.me) return control.me({ ...user });
        return { ...user };
      }
      if (url === '/participations/current') return { participation: null };
      if (url === '/participations/return-state') return { pendingEvaluationParticipationIds: [], recentFinalization: null };
      if (url === '/staff/events') return { events: control.events ?? [] };
      const entryMatch = url.match(/^\/staff\/events\/([^/]+)\/entry-control$/);
      if (entryMatch) return { eventId: entryMatch[1], externalQueueEnabled: true, canManage: false,pendingCall:null,canCall:false,canConfirm:false,canMarkAbsent:false,canRemove:false,
        observedAt: '2026-11-10T15:00:00.000Z', waitingCount: 0, waiting: [] };
      const experienceMatch = url.match(/^\/staff\/events\/([^/]+)\/experiences$/);
      if (experienceMatch) return { eventId: experienceMatch[1], experiences: control.experiences ?? [] };
      const stationMatch = url.match(/^\/staff\/events\/([^/]+)\/stations$/);
      if (stationMatch) return { eventId: stationMatch[1], stations: control.stations ?? [] };
      const queueMatch = url.match(/^\/staff\/events\/([^/]+)\/experiences\/([^/]+)\/queue$/);
      if (queueMatch) return { eventId: queueMatch[1], experienceId: queueMatch[2], waitingCount: 0,
        canCallWaitingEntries: false, firstWaitingQueueEntryId: null, acceptingNewEntries: false };
      const operationalMatch = url.match(/^\/staff\/events\/([^/]+)\/experiences\/([^/]+)\/stations\/([^/]+)\/operational-state$/);
      if (operationalMatch) return control.operational ?? { eventId: operationalMatch[1],
        experienceId: operationalMatch[2], stationId: operationalMatch[3], availability: 'available',
        canCall: false, waitingCount: 0, waiting: [], pending: null };
      throw new Error(`GET inesperado: ${url}`);
    },
    async post(url) {
      calls.push(url);
      if (url === '/auth/login' && user.roles.includes('admin')) {
        return { requires2FA: true, isTotpConfigured: true, tempToken: 'challenge', message: 'TOTP' };
      }
      if (url === '/auth/login' || url === '/auth/2fa/verify') {
        return { user: { ...user }, accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
      }
      if (url === '/auth/refresh') return { accessToken: 'new-access', refreshToken: `new-refresh-${++refreshCount}`, expiresIn: 900 };
      if (url === '/auth/logout') return { message: 'ok' };
      throw new Error(`POST inesperado: ${url}`);
    },
  };
  const http = loadModule('services/httpClient.js', (name) => {
    if (name === '../config/apiConfig') return { DEFAULT_HTTP_TIMEOUT_MS: 10000,
      resolveApiBaseUrl: () => 'http://127.0.0.1:3000/api/v1' };
    return require(name);
  }).exports;
  const client = http.createHttpClient({ fetchImpl: async (url, options) => {
    const route = new URL(url).pathname.replace('/api/v1', '');
    const result = control.http ? await control.http(route, options) : undefined;
    const value = result ?? (options.method === 'GET' ? await transport.get(route) : await transport.post(route));
    const status = value.statusCode ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
      text: async () => JSON.stringify(value.body ?? value) };
  } });
  const appStateListeners = new Set();
  const focusListeners = new Set();
  let screenFocused = true;
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const manualTimers = new Map();
  let manualNow = 0;
  let manualTimerSerial = 0;
  if (control.manualTimers) {
    globalThis.setTimeout = (fn, delay = 0, ...rest) => {
      if (delay >= 500) {
        const id = ++manualTimerSerial;
        manualTimers.set(id, { fn: () => fn(...rest), due: manualNow + delay });
        return { __manualId: id };
      }
      return origSetTimeout(fn, delay, ...rest);
    };
    globalThis.clearTimeout = (handle) => {
      if (handle && typeof handle === 'object' && handle.__manualId) {
        manualTimers.delete(handle.__manualId);
        return;
      }
      origClearTimeout(handle);
    };
  }

  const passthrough = ({ children }) => children;
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
  native.AppState = {
    currentState: 'active',
    addEventListener: (_, listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  };
  native.Platform = { OS: control.platformOS ?? 'web' };
  function FocusedStack(props) {
    const { state, descriptors, NavigationContent } = Navigation.useNavigationBuilder(StackRouter, props);
    return React.createElement(NavigationContent, null, descriptors[state.routes[state.index].key].render());
  }
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const directory = path.posix.dirname(relative);
    const { exports } = loadModule(relative, (name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react-native') return native;
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name === 'expo-crypto') return { randomUUID: () => `00000000-0000-4000-8000-${String(++generatedKeys).padStart(12, '0')}` };
      if (name === 'expo-secure-store') return control.secureStore ?? {};
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', SafeAreaProvider: passthrough };
      if (name === '@react-navigation/native-stack') return { createNativeStackNavigator: Navigation.createNavigatorFactory(FocusedStack) };
      if (name === '@react-navigation/native') {
        return {
          useIsFocused: () => {
            const [, bump] = React.useState(0);
            React.useEffect(() => {
              const fn = () => bump((n) => n + 1);
              focusListeners.add(fn);
              return () => focusListeners.delete(fn);
            }, []);
            return screenFocused;
          },
          NavigationContainer: ({ children }) => React.createElement(
            Navigation.BaseNavigationContainer,
            { ref: navRef, onUnhandledAction: (action) => unhandled.push(action) },
            children,
          ),
        };
      }
      const target = path.posix.normalize(path.posix.join(directory, name)).replace(/\.js$/, '');
      if (target === 'components/ui/AuthBackground') {
        return { AuthBackground: ({ children, ...props }) => React.createElement('View', props, children) };
      }
      if (target === 'theme') return createParticipantThemeStub();
      if (target === 'services/httpClient') return { ...http, httpClient: client };
      if (target === 'services/tokenStorage') return { defaultTokenStorage: storage };
      if (control.realAdmin && target === 'screens/admin/adminDemoLatency') {
        return { waitAdminDemoLatency: async () => {} };
      }
      if (control.realAdmin && (target.startsWith('screens/admin/') || target === 'data/adminDemoData')) {
        return load(`${target}.js`);
      }
      if (control.realStaff && ['screens/staff/StaffEventsNavigator', 'services/staffEventsService',
        'screens/staff/StaffEntryControlRealScreen', 'services/staffEntryService', 'services/staffEntryIntentStorage',
        'screens/staff/StaffStationOperationalScreen', 'services/staffIntentStorage',
        'services/staffDashboardService', 'services/staffOperationsService', 'screens/staff/useStaffPolling'].includes(target)) {
        return load(`${target}.js`);
      }
      if (target === 'screens/event-entry/EventEntryScreen' && control.modalFixture) {
        const Dialog = load('screens/staff/components/StaffConfirmDialog.js').default;
        return { __esModule: true, default: () => React.createElement(Dialog, { visible: true,
          title: 'Confirmação', onConfirm: () => { control.confirmed += 1; }, onCancel() {} }) };
      }
      if (target.startsWith('context/') || ['services/authService', 'services/participationService',
        'services/eventAdmissionService', 'screens/auth/AuthSessionGate', 'screens/auth/RolePendingScreen',
        'screens/staff/components/StaffConfirmDialog', 'screens/staff/components/StaffButton',
        'screens/staff/components/staffTheme'].includes(target)) {
        return load(`${target}.js`);
      }
      return { __esModule: true, default: ({ route }) => React.createElement('Text', null, route?.name ?? 'screen') };
    });
    cache.set(relative, exports);
    return exports;
  }
  const manager = load('services/authService.js').createAuthSessionManager({ client, tokenStorage: storage });
  const Gate = load('screens/auth/AuthSessionGate.js').default;
  const { AppNavigation } = load('App.js');
  let tree;
  return {
    manager, calls, unhandled,
    setUser(value) { user = value; },
    async mount() { await Renderer.act(async () => { tree = Renderer.create(React.createElement(Gate,
      { sessionManager: manager }, React.createElement(AppNavigation))); }); },
    async act(work) { await Renderer.act(work); },
    route() { const state = navRef.getRootState(); return state.routes[state.index].name; },
    routes() { return navRef.getRootState().routes.map((route) => route.name); },
    activeRoute() {
      let state = navRef.getRootState();
      let route = state.routes[state.index];
      while (route.state) { state = route.state; route = state.routes[state.index]; }
      return route.name;
    },
    storedToken() { return token; },
    navigate(name, params) { Renderer.act(() => navRef.navigate(name, params)); },
    back() { Renderer.act(() => navRef.goBack()); },
    hasText(text) { return tree.root.findAllByType('Text').some((node) => {
      const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
        : value && typeof value === 'object' ? flatten(value.props?.children) : String(value ?? '');
      return flatten(node.props.children).includes(text);
    }); },
    async press(label) {
      const buttons = tree.root.findAllByType('Pressable').filter((node) => node.props.accessibilityLabel === label);
      assert.equal(buttons.length, 1, `botão ${label}`);
      await Renderer.act(async () => { await buttons[0].props.onPress(); });
    },
    isDisabled(label) {
      const buttons = tree.root.findAllByType('Pressable').filter((node) => node.props.accessibilityLabel === label);
      assert.equal(buttons.length, 1, `botão ${label}`);
      return Boolean(buttons[0].props.disabled);
    },
    metricValueFor(label) {
      const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
        : value && typeof value === 'object' ? flatten(value.props?.children) : String(value ?? '');
      const cell = tree.root.findAllByType('View').find((v) => {
        const ch = (v.children ?? []).filter((c) => c && typeof c === 'object' && c.type === 'Text');
        return ch.length === 2 && flatten(ch[1].props.children) === label;
      });
      assert.ok(cell, `indicador "${label}" não encontrado`);
      const ch = cell.children.filter((c) => c && typeof c === 'object' && c.type === 'Text');
      return flatten(ch[0].props.children);
    },
    async setFocus(nextFocused) {
      screenFocused = nextFocused;
      await Renderer.act(async () => {
        for (const fn of [...focusListeners]) fn();
      });
    },
    async setAppState(nextState) {
      native.AppState.currentState = nextState;
      await Renderer.act(async () => {
        for (const listener of [...appStateListeners]) listener(nextState);
      });
    },
    pendingTimersCount() { return manualTimers.size; },
    async tickTimers(ms) {
      manualNow += ms;
      const due = [...manualTimers.entries()].filter(([, t]) => t.due <= manualNow);
      for (const [id] of due) manualTimers.delete(id);
      await Renderer.act(async () => {
        for (const [, timer] of due) await timer.fn();
        await new Promise((resolve) => origSetTimeout(resolve, 0));
      });
    },
    modal() { return tree.root.findByType('Modal'); },
    modals() { return tree.root.findAllByType('Modal'); },
    hasButton(label) { return tree.root.findAllByType('Pressable').some(node => node.props.accessibilityLabel === label); },
    handler(label) { return tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label).props.onPress; },
    confirmHandler() { return tree.root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'CONFIRMAR').props.onPress; },
    dispose() {
      try { if (tree) Renderer.act(() => tree.unmount()); } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }
    },
  };
}

const participant = { id: 'a', name: 'A', email: 'a@example.test', emailVerified: true,
  sessionId: '10000000-0000-4000-8000-000000000001',
  roles: ['participante'], hasCompletedQuestionnaire: true };

const adminUser = { ...participant, roles: ['admin', 'staff', 'participante'], hasCompletedQuestionnaire: false };

test('Admin: senha e desafio não abrem painel; TOTP e identidade confirmada abrem Heliom', { skip }, async () => {
  const identity = deferred();
  const control = { realAdmin: true, me: () => identity.promise };
  const app = createIntegration({ initialUser: adminUser, control });
  await app.mount();
  try {
    await app.act(() => app.manager.login({ email: adminUser.email, password: 'password' }));
    assert.equal(app.manager.getSnapshot().sessionStatus, 'admin_2fa_required');
    assert.equal(app.manager.getSnapshot().isAuthenticated, false);
    for (const name of ['AdminArea', 'AdminDemo', 'AdminPending', 'AdminPanel']) app.navigate(name);
    assert.ok(!app.routes().includes('AdminArea'));
    assert.ok(!app.hasText('Conectado como:'));
    let pending;
    await app.act(async () => { pending = app.manager.verifyAdminTwoFactor('123456'); });
    assert.equal(app.manager.getSnapshot().identityStatus, 'checking');
    assert.ok(!app.hasText('Conectado como:'));
    await app.act(async () => { identity.resolve(adminUser); await pending; });
    assert.deepEqual(app.routes(), ['AdminArea']);
    assert.equal(app.activeRoute(), 'AdminPanel');
    assert.ok(app.hasText('Sessão Admin autenticada com segundo fator'));
    assert.ok(app.hasText('nada aqui é salvo no servidor'));
    for (const name of ['MainTabs', 'StaffPending', 'StaffDemo', 'ProfileQuestionnaire', 'AdminDemo', 'AdminPending']) {
      app.navigate(name);
      assert.equal(app.activeRoute(), 'AdminPanel');
    }
    assert.ok(app.calls.includes('/auth/2fa/verify'));
    assert.ok(app.calls.includes('/auth/me'));
    assert.ok(!app.calls.some(url => url.startsWith('/admin/') || url.startsWith('/staff/')));
  } finally { app.dispose(); }
});

test('Admin: restauração válida reutiliza telas, retornos internos e logout real', { skip }, async () => {
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true } });
  await app.mount();
  try {
    assert.equal(app.activeRoute(), 'AdminPanel');
    assert.ok(app.calls.includes('/auth/refresh') && app.calls.includes('/auth/me'));
    assert.ok(!app.calls.includes('/auth/2fa/verify'), 'sessão já autenticada é restaurada pelo contrato real');
    await app.press('Gerenciar Eventos, 7 eventos na demonstração');
    assert.equal(app.activeRoute(), 'AdminEvents');
    assert.ok(app.hasText('Copa Noturna'));
    await app.press('← Painel');
    assert.equal(app.activeRoute(), 'AdminPanel');
    const params = { eventId: 'demo-admin-arena-xp', experienceId: 'demo-admin-exp-xp-dance',
      stationId: 'demo-admin-station-xp-dance-1' };
    for (const name of ['AdminCreateEvent', 'AdminEventDetail', 'AdminEventSchedule', 'AdminEventQueue',
      'AdminEventClose', 'AdminEventExperiences', 'AdminExperienceDetail', 'AdminStationDetail',
      'AdminEventStaff', 'AdminHistory', 'AdminEventBi', 'AdminOverview']) {
      app.navigate('AdminArea', { screen: name, params });
      await app.act(async () => {});
      assert.equal(app.activeRoute(), name);
      assert.ok(!app.hasText('não encontrada') && !app.hasText('não encontrado'), name);
      app.back();
      assert.equal(app.activeRoute(), 'AdminPanel');
    }
    await app.press('← Sair da conta');
    assert.equal(app.route(), 'Welcome');
    assert.equal(app.storedToken(), null);
    assert.equal(app.manager.getAccessToken(), null);
    assert.equal(app.calls.filter(url => url === '/auth/logout').length, 1);
    app.navigate('AdminArea', { screen: 'AdminPanel' });
    assert.equal(app.route(), 'Welcome');
  } finally { app.dispose(); }
});

test('Admin: mocks reiniciam em refresh, troca de Admin, papéis e novo login', { skip }, async () => {
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true } });
  await app.mount();
  try {
    const initialClock = '05/11/2026 09:00';
    assert.ok(app.hasText(initialClock));
    const staleAdvance = app.handler('Avançar relógio 1 hora');
    await app.press('Avançar relógio 1 hora');
    assert.ok(app.hasText('05/11/2026 10:00'));
    await app.act(() => app.manager.refreshSession());
    assert.ok(app.hasText(initialClock));
    await app.act(async () => staleAdvance());
    assert.ok(app.hasText(initialClock), 'callback anterior ao refresh não atua');
    const staleExit = app.handler('← Sair da conta');
    await app.act(() => app.manager.logout());
    const other = { ...adminUser, id: 'admin-b', name: 'Admin B',
      sessionId: '20000000-0000-4000-8000-000000000002' };
    app.setUser(other);
    await app.act(() => app.manager.login({ email: other.email, password: 'password' }));
    await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
    await app.act(async () => { staleAdvance(); staleExit(); });
    assert.equal(app.activeRoute(), 'AdminPanel');
    assert.ok(app.hasText('Conectado como: Admin B'));
    assert.ok(app.hasText(initialClock));
    app.setUser({ ...other, roles: ['staff', 'participante'] });
    await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.route(), 'StaffPending');
    for (const name of ['AdminArea', 'AdminDemo', 'AdminPending', 'AdminPanel']) app.navigate(name);
    assert.equal(app.route(), 'StaffPending');
    app.setUser({ ...other, roles: ['participante'], hasCompletedQuestionnaire: true });
    await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.route(), 'MainTabs');
    for (const name of ['AdminArea', 'AdminDemo', 'AdminPending', 'AdminPanel']) app.navigate(name);
    assert.equal(app.route(), 'MainTabs');
    app.setUser(other);
    await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.activeRoute(), 'AdminPanel');
    assert.ok(app.hasText(initialClock));
  } finally { app.dispose(); }
});

test('Admin: revogação remota retira a área e invalida ações guardadas', { skip }, async () => {
  const control = { realAdmin: true };
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control });
  await app.mount();
  try {
    const stale = app.handler('Avançar relógio 1 hora');
    control.http = async route => route === '/auth/me'
      ? { statusCode: 401, body: { code: 'SESSION_REVOKED' } } : undefined;
    await app.act(async () => { await app.manager.fetchCurrentUser().catch(() => {}); });
    assert.equal(app.manager.getSnapshot().isAuthenticated, false);
    assert.equal(app.route(), 'Login');
    assert.equal(app.storedToken(), null);
    await app.act(async () => stale());
    app.navigate('AdminArea', { screen: 'AdminEvents' });
    app.back();
    assert.equal(app.route(), 'Login');
    assert.ok(!app.hasText('Conectado como:'));
  } finally { app.dispose(); }
});

test('Admin: restauração recusada por falta de segundo fator não monta painel', { skip }, async () => {
  const control = { realAdmin: true, http: async route => route === '/auth/refresh'
    ? { statusCode: 401, body: { code: 'ADMIN_2FA_REQUIRED' } } : undefined };
  const app = createIntegration({ initialToken: 'stored-without-2fa', initialUser: adminUser, control });
  await app.mount();
  try {
    assert.equal(app.manager.getSnapshot().isAuthenticated, false);
    assert.ok(!app.hasText('Conectado como:'));
    app.navigate('AdminArea');
    assert.ok(!app.routes().includes('AdminArea'));
  } finally { app.dispose(); }
});

test('Admin: falha de revogação remota mantém logout local e painel inacessível', { skip }, async () => {
  const control = { realAdmin: true, http: async route => route === '/auth/logout'
    ? { statusCode: 503, body: { code: 'SERVICE_UNAVAILABLE' } } : undefined };
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control });
  await app.mount();
  try {
    await app.press('← Sair da conta');
    assert.equal(app.manager.getSnapshot().isAuthenticated, false);
    assert.ok(app.manager.getSnapshot().authNotice.includes('não foi possível confirmar a revogação'));
    assert.equal(app.storedToken(), null);
    app.navigate('AdminArea');
    assert.ok(!app.routes().includes('AdminArea'));
    assert.ok(!app.hasText('Conectado como:'));
  } finally { app.dispose(); }
});

test('integra sessão real, papéis, TOTP, provedores e isolamento da navegação', { skip }, async () => {
  const app = createIntegration({ initialUser: participant });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.equal(app.route(), 'MainTabs');
  app.navigate('EventEntry');
  assert.deepEqual(app.routes(), ['MainTabs', 'EventEntry']);
  const participantReads = app.calls.filter((url) => url === '/participations/current').length;
  await app.act(() => app.manager.refreshSession());
  assert.deepEqual(app.routes(), ['MainTabs', 'EventEntry'], 'refresh com mesmo papel preserva a pilha');
  assert.equal(app.calls.filter((url) => url === '/participations/current').length, participantReads,
    'provedor da mesma sessão permanece montado');
  app.setUser({ ...participant, roles: ['participante', 'staff'] });
  await app.act(() => app.manager.refreshSession());
  assert.deepEqual(app.routes(), ['StaffPending']);
  assert.ok(app.calls.filter((url) => url === '/participations/current').length > participantReads,
    'mudança de área remonta o provedor');
  app.navigate('MainTabs');
  app.back();
  assert.deepEqual(app.routes(), ['StaffPending']);
  app.setUser(participant);
  await app.act(() => app.manager.refreshSession());
  assert.deepEqual(app.routes(), ['MainTabs']);
  app.setUser({ ...participant, id: 'b', roles: ['admin', 'staff'] });
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.equal(app.manager.getSnapshot().isAuthenticated, false);
  assert.equal(app.manager.getSnapshot().sessionStatus, 'admin_2fa_required');
  await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
  assert.deepEqual(app.routes(), ['AdminArea']);
  app.navigate('StaffPending');
  assert.deepEqual(app.routes(), ['AdminArea']);
  await app.act(() => app.manager.logout());
  assert.equal(app.route(), 'Welcome');
  app.setUser({ ...participant, id: 'c', roles: ['staff'] });
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.deepEqual(app.routes(), ['StaffPending']);
  assert.ok(app.calls.includes('/auth/2fa/verify'));
  assert.ok(app.calls.includes('/participations/current'));
  app.dispose();
});

test('restauração real mantém questionário obrigatório para participante', { skip }, async () => {
  const app = createIntegration({ initialToken: 'stored', initialUser: { ...participant, hasCompletedQuestionnaire: false } });
  await app.mount();
  assert.equal(app.route(), 'ProfileQuestionnaire');
  app.navigate('MainTabs');
  assert.equal(app.route(), 'ProfileQuestionnaire');
  await app.act(() => app.manager.markQuestionnaireCompleted());
  app.navigate('MainTabs');
  assert.equal(app.route(), 'MainTabs');
  assert.ok(app.calls.includes('/auth/refresh'));
  assert.ok(app.calls.includes('/auth/me'));
  app.dispose();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('401 real no cliente renova, revalida Staff e substitui a navegação', { skip }, async () => {
  const control = { http: async (route, options) => {
    if (route !== '/protected') return undefined;
    return options.headers.Authorization === 'Bearer access'
      ? { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } }
      : { body: { ok: true } };
  } };
  const app = createIntegration({ initialUser: participant, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  app.navigate('EventEntry');
  app.setUser({ ...participant, roles: ['staff'] });
  await app.act(async () => { await app.manager.client.get('/protected', { auth: true }); });
  assert.deepEqual(app.routes(), ['StaffPending']);
  assert.ok(app.calls.includes('/auth/refresh'));
  app.dispose();
});

test('provedores recuperam rotação com falha de gravação sem novo POST', { skip }, async () => {
  let fail = true;
  const control = { failWrite: (value) => fail && value === 'new-refresh-1' };
  const app = createIntegration({ initialToken: 'stored', initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  assert.equal(app.manager.getSnapshot().identityStatus, 'error');
  fail = false;
  await app.act(() => app.manager.restoreSession());
  assert.equal(app.route(), 'StaffPending');
  assert.equal(app.calls.filter((url) => url === '/auth/refresh').length, 1);
  app.dispose();
});

test('logout durante /me de login deixa navegação pública e descarta resposta', { skip }, async () => {
  const entered = deferred(), response = deferred();
  const control = { me: () => { entered.resolve(); return response.promise; } };
  const app = createIntegration({ initialUser: participant, control });
  await app.mount();
  let login;
  await app.act(() => { login = app.manager.login({ email: participant.email, password: 'password' }); });
  await entered.promise;
  await app.act(() => app.manager.logout());
  response.resolve(participant);
  let result;
  await app.act(async () => { result = await login; });
  assert.equal(result.status, 'aborted');
  assert.equal(app.route(), 'Welcome');
  app.dispose();
});

test('modal protegido fica invisível e callback antigo não executa durante erro de identidade', { skip }, async () => {
  const entered = deferred(), response = deferred();
  const control = { modalFixture: true, confirmed: 0 };
  const app = createIntegration({ initialUser: participant, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  app.navigate('EventEntry');
  const oldConfirm = app.confirmHandler();
  control.me = () => { entered.resolve(); return response.promise; };
  let refresh;
  await app.act(() => { refresh = app.manager.refreshSession(); refresh.catch(() => {}); });
  await entered.promise;
  assert.equal(app.modal().props.visible, false);
  oldConfirm();
  response.reject(new Error('offline'));
  await app.act(async () => { await assert.rejects(refresh); });
  assert.equal(app.manager.getSnapshot().identityStatus, 'error');
  assert.equal(app.modal().props.visible, false);
  oldConfirm();
  assert.equal(control.confirmed, 0);
  app.dispose();
});

const staffEvent = { id: '11111111-1111-4111-8111-111111111111', name: 'Evento autorizado', status: 'open', effectivePhase: 'open' };

test('lista e painel exibem a fase efetiva em vez do status persistido', { skip }, async () => {
  for (const [effectivePhase, label] of [['scheduled', 'Agendado'], ['open', 'Aberto'],
    ['not_ready', 'Não está pronto'], ['closing', 'Em encerramento'], ['closed', 'Encerrado']]) {
    const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] },
      control: { realStaff: true, events: [{ ...staffEvent, status: 'scheduled', effectivePhase }] } });
    await app.mount();
    await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
    assert.ok(app.hasText(label));
    await app.press('Selecionar evento Evento autorizado');
    assert.ok(app.hasText(`Status: ${label}`));
    app.dispose();
  }
});
const realExperienceId = '33333333-3333-4333-8333-333333333333';
const realStation = { id: '44444444-4444-4444-8444-444444444444', experienceId: realExperienceId,
  label: 'Estação real', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };

test('tela real remove chamado somente após confirmação e atualiza estação sem reenvio', { skip }, async () => {
  const secure = new Map(); let posts = 0;
  const serviceId = '88888888-8888-4888-8888-888888888888';
  const entryId = '77777777-7777-4777-8777-777777777777';
  const control = { realStaff: true, platformOS: 'ios', events: [staffEvent],
    stations: [{ ...realStation, pendingServiceSessionId: serviceId }],
    experiences: [{ id: realExperienceId, name: 'Experiência real' }],
    secureStore: { isAvailableAsync: async () => true, getItemAsync: async k => secure.get(k) ?? null,
      setItemAsync: async (k, v) => { secure.set(k, v); }, deleteItemAsync: async k => { secure.delete(k); } },
    operational: { eventId: staffEvent.id, experienceId: realExperienceId, stationId: realStation.id,
      availability: 'available', canCall: false, waitingCount: 3, waiting: [
        { queueEntryId: '11111111-1111-4111-8111-111111111112', displayName: 'Bia', position: 1 },
        { queueEntryId: '11111111-1111-4111-8111-111111111113', displayName: 'Caio', position: 2 },
        { queueEntryId: '11111111-1111-4111-8111-111111111114', displayName: 'Dora', position: 3 },
      ], pending: {
        serviceSessionId: serviceId, queueEntryId: entryId, displayName: 'Ana', calledAt: '2026-11-11T15:00:00.000Z' } },
    http: async route => {
      if (!route.endsWith(`/service-sessions/${serviceId}/remove`)) return undefined;
      posts++; assert.ok([...secure.values()].some(raw => raw.includes('dispatching')));
      control.operational = { ...control.operational, canCall: true, pending: null };
      control.stations = [realStation];
      return { body: { serviceSession: { id: serviceId, status: 'canceled', cancelReason: 'staff_queue_removed',
        resolvedAt: '2026-11-11T15:01:00.000Z' }, queueEntry: { status: 'closed', closeReason: 'staff_queue_removed' },
      participation: { status: 'active', currentQueueEntryId: null } } };
    } };
  const app = createIntegration({ initialUser: { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] }, control });
  try {
    await app.mount(); await app.act(() => app.manager.login({ email: participant.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    await app.press('Selecionar estação Estação real da experiência Experiência real');
    assert.ok(app.hasText('Participante chamado: Ana'));
    assert.ok(app.hasText('Aguardando nesta experiência: 3'));
    for (const [position, name] of [[1, 'Bia'], [2, 'Caio'], [3, 'Dora']]) {
      assert.ok(app.hasText(`${position}. ${name}`));
      assert.ok(!app.hasText(`Remover ${name} da fila`));
    }
    assert.ok(app.hasText('Concluir atendimento'));
    assert.ok(app.hasText('Registrar ausência'));
    assert.ok(app.hasText('Remover da fila'));
    await app.press('Concluir atendimento'); assert.equal(app.modal().props.visible, true);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Registrar ausência'); assert.equal(app.modal().props.visible, true);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Remover da fila'); assert.equal(posts, 0);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Remover da fila'); await app.press('CONFIRMAR OPERAÇÃO');
    assert.equal(posts, 1); assert.ok(!app.hasText('Participante chamado: Ana'));
    assert.ok(app.hasText('Operação confirmada pelo servidor.'));
    assert.equal(app.hasButton('Entendi o resultado'), false);
    await app.press('Atualizar atendimento'); assert.equal(posts, 1);
  } finally { app.dispose(); }
});

test('painel real apresenta estações por experiência e abre atendimento diretamente', { skip }, async () => {
  const otherStation = { ...realStation, id: '55555555-5555-4555-8555-555555555555', label: 'Console 2' };
  const secondExperienceId = '77777777-7777-4777-8777-777777777777';
  const secondExperienceStation = { ...realStation, id: '88888888-8888-4888-8888-888888888888',
    experienceId: secondExperienceId };
  const control = { realStaff: true, events: [staffEvent], stations: [realStation, otherStation, secondExperienceStation], experiences: [
    { id: realExperienceId, name: 'Just Dance' },
    { id: secondExperienceId, name: 'PlayStation' },
    { id: '66666666-6666-4666-8666-666666666666', name: 'Sem estação' },
  ] };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  await app.press('Controle de Entrada');
  assert.ok(app.hasText('Fila de acesso ao evento'));
  await app.press('Voltar ao painel');
  assert.ok(app.hasText('Just Dance')); assert.ok(app.hasText('Nenhuma estação associada.'));
  assert.ok(app.hasText('PlayStation'));
  assert.ok(app.hasButton('Selecionar estação Estação real da experiência Just Dance'));
  assert.ok(app.hasButton('Selecionar estação Console 2 da experiência Just Dance'));
  assert.ok(app.hasButton('Selecionar estação Estação real da experiência PlayStation'));
  assert.equal(app.hasButton('Estações'), false);
  await app.press('Selecionar estação Estação real da experiência Just Dance');
  assert.ok(app.hasText('Fila compartilhada da experiência'));
  await app.press('Voltar ao painel'); await app.press('Selecionar estação Console 2 da experiência Just Dance');
  assert.ok(app.hasText('Fila de Just Dance'));
  assert.equal(app.calls.filter((url) => url === `/staff/events/${staffEvent.id}/experiences/${realExperienceId}/queue`).length, 2);
  app.back();
  assert.ok(app.hasText('Painel operacional'));
  await app.press('Selecionar estação Estação real da experiência PlayStation');
  assert.ok(app.hasText('Fila de PlayStation'));
  assert.ok(app.calls.includes(`/staff/events/${staffEvent.id}/experiences/${secondExperienceId}/stations/${secondExperienceStation.id}/operational-state`));
  await app.press('Voltar ao painel');
  await app.press('Controle de Entrada'); assert.ok(app.hasText('Fila de acesso ao evento'));
  app.dispose();
});

test('estação real chama diretamente pelo backend com intenção persistida e sem duplo envio', { skip }, async () => {
  const secure = new Map(); let posts = 0;
  const calledId = '77777777-7777-4777-8777-777777777777';
  const control = { realStaff: true, platformOS: 'ios', events: [staffEvent], stations: [realStation],
    experiences: [{ id: realExperienceId, name: 'Just Dance' }],
    secureStore: { isAvailableAsync: async () => true,
      getItemAsync: async key => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); },
      deleteItemAsync: async key => { secure.delete(key); } },
    operational: { eventId: staffEvent.id, experienceId: realExperienceId, stationId: realStation.id,
      availability: 'available', canCall: true, waitingCount: 1,
      waiting: [{ queueEntryId: calledId, displayName: 'Ana', position: 1 }], pending: null },
    http: async (route, options) => {
      if (route.endsWith('/queue')) return { body: { eventId: staffEvent.id, experienceId: realExperienceId,
        waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: calledId } };
      if (route.endsWith('/call-next')) { posts++; assert.ok(options.headers['Idempotency-Key']);
        assert.ok([...secure.values()].some(raw => raw.includes('dispatching')));
        return { statusCode: 201, body: { serviceSession: { id: '88888888-8888-4888-8888-888888888888',
          queueEntryId: calledId, experienceId: realExperienceId,
          station: { id: realStation.id, label: realStation.label }, status: 'pending' } } }; }
      return undefined;
    } };
  const app = createIntegration({ initialUser: { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] }, control });
  await app.mount(); await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  await app.press('Selecionar estação Estação real da experiência Just Dance');
  assert.ok(app.hasText('Ana'));
  const call = app.handler('Chamar próximo');
  await app.act(async () => { await Promise.all([call(), call()]); });
  assert.equal(app.modal().props.visible, false);
  assert.equal(posts, 1); assert.ok(app.hasText('Operação confirmada pelo servidor'));
  assert.ok(!app.hasText('Rafael T.'));
  app.dispose();
});

test('chamada direta da estação não reenvia após resposta incerta nem após atualizar', { skip }, async () => {
  const secure = new Map(); let posts = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'ios', events: [staffEvent], stations: [realStation],
    experiences: [{ id: realExperienceId, name: 'Experiência real' }],
    secureStore: { isAvailableAsync: async () => true, getItemAsync: async key => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); }, deleteItemAsync: async key => { secure.delete(key); } },
    operational: { eventId: staffEvent.id, experienceId: realExperienceId, stationId: realStation.id,
      availability: 'available', canCall: true, waitingCount: 1,
      waiting: [{ queueEntryId: '77777777-7777-4777-8777-777777777777', displayName: 'Ana', position: 1 }], pending: null },
    http: async (route) => {
      if (route.endsWith('/queue')) return { body: { eventId: staffEvent.id, experienceId: realExperienceId,
        waitingCount: 1, canCallWaitingEntries: true, firstWaitingQueueEntryId: '77777777-7777-4777-8777-777777777777' } };
      if (route.endsWith('/call-next')) { posts++; assert.ok([...secure.values()].some(raw => raw.includes('dispatching')));
        throw Object.assign(new Error('offline'), { isNetworkError: true }); }
      return undefined;
    } };
  const app = createIntegration({ initialUser: staffUser, control });
  try {
    await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    await app.press('Selecionar estação Estação real da experiência Experiência real');
    await app.press('Chamar próximo');
    assert.equal(posts, 1); assert.equal(app.modal().props.visible, false);
    assert.ok(app.hasText('Resultado incerto'));
    await app.press('Atualizar atendimento');
    assert.equal(posts, 1);
    assert.ok([...secure.values()].some(raw => raw.includes('dispatching')));
  } finally { app.dispose(); }
});

test('chamada direta da estação capturada antes do logout não envia POST', { skip }, async () => {
  let posts = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'ios', events: [staffEvent], stations: [realStation],
    experiences: [{ id: realExperienceId, name: 'Experiência real' }],
    secureStore: { isAvailableAsync: async () => true, getItemAsync: async () => null,
      setItemAsync: async () => {}, deleteItemAsync: async () => {} },
    operational: { eventId: staffEvent.id, experienceId: realExperienceId, stationId: realStation.id,
      availability: 'available', canCall: true, waitingCount: 1,
      waiting: [{ queueEntryId: '77777777-7777-4777-8777-777777777777', displayName: 'Ana', position: 1 }], pending: null },
    http: async route => { if (route.endsWith('/call-next')) posts++; return undefined; } };
  const app = createIntegration({ initialUser: staffUser, control });
  try {
    await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    await app.press('Selecionar estação Estação real da experiência Experiência real');
    const old = app.handler('Chamar próximo');
    await app.act(() => app.manager.logout()); await app.act(async () => old());
    assert.equal(posts, 0);
  } finally { app.dispose(); }
});

test('tela da estação recupera reconhecimento automático após exclusão ambígua', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const keyA = '50000000-0000-4000-8000-000000000001';
  const serviceId = '88888888-8888-4888-8888-888888888888', entryId = '77777777-7777-4777-8777-777777777777';
  const record = key => ({ userId: staffUser.id, sessionId: staffUser.sessionId, eventId: staffEvent.id,
    experienceId: realExperienceId, stationId: realStation.id, serviceSessionId: null,
    kind: 'call', key, phase: 'terminal', outcome: { kind: 'confirmed', result: { id: serviceId,
      queueEntryId: entryId, experienceId: realExperienceId, stationId: realStation.id,
      stationLabel: realStation.label, status: 'pending' } } });
  const values = new Map(), slot = `arenago.staff.operation.${staffUser.id}`;
  values.set(`${slot}.receipt`, JSON.stringify(record(keyA)));
  let rejectAfterDelete = true;
  const secureStore = { isAvailableAsync: async () => true, getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); if (key.endsWith('.receipt') && rejectAfterDelete) {
      rejectAfterDelete = false; throw new Error('exclusão confirmada com resposta perdida'); } } };
  const control = { realStaff: true, platformOS: 'ios', secureStore, events: [staffEvent], stations: [realStation],
    experiences: [{ id: realExperienceId, name: 'Just Dance' }] };
  async function open(restoring = false) {
    const app = createIntegration({ initialToken: restoring ? 'stored' : null, initialUser: staffUser, control });
    await app.mount();
    if (!restoring) await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    await app.press('Selecionar estação Estação real da experiência Just Dance'); return app;
  }
  const first = await open();
  assert.equal(first.hasButton('Entendi o resultado'), false);
  assert.equal(values.has(`${slot}.receipt`), false);
  assert.equal(JSON.parse(values.get(`${slot}.ack`)).status, 'pending');
  first.dispose();
  const restarted = await open(true);
  assert.equal(JSON.parse(values.get(`${slot}.ack`)).status, 'completed');
  assert.ok(restarted.hasText('Operação confirmada pelo servidor.'));
  assert.equal(restarted.hasButton('Entendi o resultado'), false);
  restarted.dispose();
});

test('painel Staff real exibe estação e fila e limpa os dados ao receber 403', { skip }, async () => {
  let denied = false;
  const control = { realStaff: true, events: [staffEvent], stations: [realStation],
    experiences: [{ id: realExperienceId, name: 'Experiência real' }], http: async (route) => {
    if (denied && route.endsWith('/queue')) return { statusCode: 403, body: { code: 'FORBIDDEN' } };
    return undefined;
  } };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  assert.ok(app.hasText('Painel operacional'));
  assert.ok(app.hasText('Estação real'));
  assert.equal(app.hasText('Experiência real'), true, 'painel exibe o nome da experiência no agrupamento');
  await app.press('Selecionar estação Estação real da experiência Experiência real');
  assert.ok(app.hasText('Pessoas em espera: 0'));
  assert.ok(!app.hasText('Rafael T.'));
  denied = true;
  await app.press('Atualizar fila');
  assert.ok(app.hasText('Acesso ao evento ou à experiência indisponível'));
  assert.ok(!app.hasText('Estação real'));
  assert.equal(app.hasButton('Chamar próximo'), false);
  await app.press('Voltar ao painel');
  await app.press('Voltar aos eventos');
  assert.ok(app.hasText('Eventos Staff'));
  app.dispose();
});

test('401 recuperável nas estações renova e revalida a sessão Staff', { skip }, async () => {
  let attempts = 0;
  const control = { realStaff: true, events: [staffEvent], stations: [realStation], http: async (route, options) => {
    if (!route.endsWith('/stations')) return undefined;
    attempts += 1;
    return options.headers.Authorization === 'Bearer access'
      ? { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } } : undefined;
  } };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  assert.ok(attempts >= 2);
  assert.ok(app.calls.includes('/auth/refresh'));
  assert.equal(app.manager.getSnapshot().identityStatus, 'verified');
  // A revalidação descarta a seleção antiga; nova seleção exige nova lista autorizada.
  assert.ok(!app.hasText('Estação real'));
  app.dispose();
});

test('401 terminal nas estações invalida sessão e remove o painel Staff', { skip }, async () => {
  const control = { realStaff: true, events: [staffEvent], http: async (route) =>
    route.endsWith('/stations') ? { statusCode: 401, body: { code: 'SESSION_REVOKED' } } : undefined };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  assert.equal(app.manager.getSnapshot().isAuthenticated, false);
  assert.equal(app.route(), 'Login');
  assert.ok(!app.hasText('Estação real'));
  app.dispose();
});

test('trocar evento Staff descarta estações e preserva status scheduled e closed', { skip }, async () => {
  const closedEvent = { id: '22222222-2222-4222-8222-222222222222', name: 'Evento encerrado', status: 'closed', effectivePhase: 'closed' };
  const control = { realStaff: true, events: [{ ...staffEvent, status: 'scheduled', effectivePhase: 'scheduled' }, closedEvent],
    experiences: [{ id: realExperienceId, name: 'Experiência real' }],
    http: async (route) => {
      if (route === `/staff/events/${staffEvent.id}/stations`) return { body: { eventId: staffEvent.id, stations: [realStation] } };
      if (route === `/staff/events/${closedEvent.id}/stations`) return { body: { eventId: closedEvent.id, stations: [] } };
      return undefined;
    } };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  assert.ok(app.hasText('Status: Agendado'));
  assert.ok(app.hasText('Estação real'));
  await app.press('Voltar aos eventos');
  await app.press('Selecionar evento Evento encerrado');
  assert.ok(app.hasText('Status: Encerrado'));
  assert.ok(app.hasText('Nenhuma estação encontrada'));
  assert.ok(!app.hasText('Estação real'));
  app.dispose();
});

test('Staff real consulta eventos, seleciona, volta e não aceita rota com ID manual', { skip }, async () => {
  const control = { realStaff: true, events: [staffEvent] };
  const app = createIntegration({ initialUser: { ...participant, roles: ['participante', 'staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.equal(app.route(), 'StaffPending');
  assert.ok(app.calls.includes('/staff/events'));
  assert.ok(app.hasText('Evento autorizado'));
  await app.press('Selecionar evento Evento autorizado');
  assert.ok(app.hasText('Status: Aberto'));
  assert.ok(app.hasText('Nenhuma estação encontrada'));
  await app.press('Voltar aos eventos');
  app.navigate('StaffPending', { screen: 'StaffEventHome', params: { eventId: '22222222-2222-4222-8222-222222222222' } });
  assert.ok(app.hasText('Atualize a lista para confirmar os eventos autorizados'));
  assert.ok(!app.hasText('Status: Aberto'));
  await app.press('Voltar aos eventos');
  control.events = [];
  await app.press('Atualizar eventos');
  assert.ok(app.hasText('Nenhum evento autorizado'));
  app.dispose();
});

test('Staff real trata erro de rede, atualização manual e troca de conta sem reaproveitar seleção', { skip }, async () => {
  let offline = true;
  const control = { realStaff: true, events: [staffEvent], http: async (route) => {
    if (route === '/staff/events' && offline) throw new Error('offline');
    return undefined;
  } };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.ok(app.hasText('Não foi possível conectar'));
  offline = false;
  await app.press('Atualizar eventos');
  await app.press('Selecionar evento Evento autorizado');
  assert.ok(app.hasText('Status: Aberto'));
  await app.act(() => app.manager.logout());
  control.events = [];
  app.setUser({ ...participant, id: 'b', email: 'b@example.test', roles: ['staff'] });
  await app.act(() => app.manager.login({ email: 'b@example.test', password: 'password' }));
  assert.ok(app.hasText('Nenhum evento autorizado'));
  assert.ok(!app.hasText('Evento autorizado'));
  app.navigate('StaffPending', { screen: 'StaffEventHome' });
  assert.ok(app.hasText('Atualize a lista para confirmar os eventos autorizados'));
  app.dispose();
});

test('revalidação limpa evento selecionado e revogação Staff remove a pilha real', { skip }, async () => {
  const control = { realStaff: true, events: [staffEvent] };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  control.events = [];
  await app.act(() => app.manager.refreshSession());
  assert.ok(app.hasText('Atualize a lista para confirmar os eventos autorizados'));
  assert.ok(!app.hasText('Status: Aberto'));
  await app.press('Voltar aos eventos');
  assert.ok(app.hasText('Nenhum evento autorizado'));
  app.setUser(participant);
  await app.act(() => app.manager.refreshSession());
  assert.equal(app.route(), 'MainTabs');
  app.navigate('StaffPending', { screen: 'StaffEventHome' });
  assert.equal(app.route(), 'MainTabs');
  app.dispose();
});

test('401 terminal na lista Staff usa o gerenciador real e remove a área protegida', { skip }, async () => {
  const control = { realStaff: true, http: async (route) => route === '/staff/events'
    ? { statusCode: 401, body: { code: 'SESSION_REVOKED' } } : undefined };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.equal(app.manager.getSnapshot().isAuthenticated, false);
  assert.equal(app.route(), 'Login');
  assert.ok(!app.hasText('Eventos Staff'));
  app.navigate('StaffEventHome');
  assert.equal(app.route(), 'Login');
  app.dispose();
});

test('401 recuperável na lista Staff renova sessão e obtém eventos com a identidade revalidada', { skip }, async () => {
  let attempts = 0;
  const control = { realStaff: true, http: async (route, options) => {
    if (route !== '/staff/events') return undefined;
    attempts += 1;
    return options.headers.Authorization === 'Bearer access'
      ? { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } }
      : { body: { events: [staffEvent] } };
  } };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  assert.equal(app.manager.getSnapshot().identityStatus, 'verified');
  assert.ok(app.calls.includes('/auth/refresh'));
  assert.ok(attempts >= 2);
  assert.ok(app.hasText('Evento autorizado'));
  app.dispose();
});

test('Controle de Entrada real confirma primeiro, desativa, reativa e volta preservando evento', { skip }, async () => {
  const values = new Map(), requests = [], at = '2026-11-10T15:00:00.000Z';
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  let pendingCall=null; let enabled = true, waiting = [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 },
    { participationId: 'abcdef00-0000-4000-8000-000000000005', displayName: 'Bia', position: 2 }];
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      requests.push({ route, method: options.method });
      if (options.method === 'GET') return { eventId: staffEvent.id, externalQueueEnabled: enabled, canManage: true,pendingCall,canCall:enabled&&!pendingCall&&waiting.length>0,canConfirm:!!pendingCall,canMarkAbsent:!!pendingCall,canRemove:!!pendingCall,
        observedAt: at, waitingCount: waiting.length, waiting };
      if (options.method === 'POST') {
        const isCall=route.endsWith('/call-next');
        let person;
        if(isCall){person=waiting.shift();waiting.forEach((p,i)=>p.position=i+1);pendingCall={id:'abcdef00-0000-4000-8000-000000000060',...person,calledAt:at};}
        else person=pendingCall;
        const call={id:pendingCall.id,participationId:person.participationId,status:isCall?'pending':'confirmed',calledAt:at,resolvedAt:isCall?null:at};
        if(!isCall)pendingCall=null;
        return {eventId:staffEvent.id,call,participation:{id:person.participationId,status:isCall?'waiting':'active',arenaEnteredAt:isCall?null:at,finishReason:null,externalQueueOrder:'1'},requeued:false};
      }
      const payload = JSON.parse(options.body), releasedCount = payload.enabled ? 0 : waiting.length;
      enabled = payload.enabled; if (!enabled) waiting = [];
      return { eventId: staffEvent.id, externalQueueEnabled: enabled, releasedCount, changedAt: at };
    } };
  const app = createIntegration({ initialUser: staffUser, control }); await app.mount();
  await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada');
  assert.ok(app.hasText('1. Ana')); assert.ok(!app.hasText('Confirmar entrada de Ana'));
  const call = app.handler('Chamar próximo');
  await app.act(async () => { await Promise.all([call(), call()]); });
  assert.equal(app.modal().props.visible, false);
  assert.equal(requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(app.hasButton('Entendi'), false);
  assert.ok(app.hasText('Participante chamado: Ana'));
  assert.ok(app.hasText('Confirmar entrada')); assert.ok(app.hasText('Marcar ausência')); assert.ok(app.hasText('Remover da fila'));
  await app.press('Marcar ausência'); assert.equal(app.modal().props.visible, true);
  await app.press('CANCELAR ALTERAÇÃO');
  await app.press('Remover da fila'); assert.equal(app.modal().props.visible, true);
  await app.press('CANCELAR ALTERAÇÃO');
  await app.press('Confirmar entrada'); await app.press('CONFIRMAR ALTERAÇÃO');
  assert.ok(app.hasText('Entrada confirmada pelo servidor')); assert.ok(app.hasText('1. Bia'));
  await app.press('Desativar fila externa'); assert.equal(app.modal().props.visible, true);
  await app.press('CANCELAR ALTERAÇÃO'); assert.equal(requests.filter(r => r.method === 'PATCH').length, 0);
  await app.press('Desativar fila externa'); await app.press('CONFIRMAR ALTERAÇÃO');
  assert.ok(app.hasText('Participantes liberados: 1')); assert.equal(app.hasButton('Entendi'), false);
  const reactivate = app.handler('Reativar fila externa');
  await app.act(async () => { await Promise.all([reactivate(), reactivate()]); });
  assert.equal(app.modal().props.visible, false);
  assert.equal(app.hasButton('Entendi'), false);
  assert.ok(app.hasText('Ninguém está aguardando')); await app.press('Voltar ao painel'); assert.ok(app.hasText('Painel operacional'));
  assert.equal(requests.filter(r => r.method === 'POST').length, 2); assert.equal(requests.filter(r => r.method === 'PATCH').length, 2);
  app.dispose();
});

test('chamada direta capturada antes do logout não envia operação na sessão seguinte', { skip }, async () => {
  const values = new Map(), at = '2026-11-10T15:00:00.000Z'; let mutations = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      if (options.method !== 'GET') { mutations++; throw new Error('não deve enviar'); }
      return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true,pendingCall:null,canCall:true,canConfirm:false,canMarkAbsent:false,canRemove:false, observedAt: at, waitingCount: 1,
        waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } };
  const app = createIntegration({ initialUser: staffUser, control }); await app.mount();
  await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada');
  const old = app.handler('Chamar próximo'); await app.act(() => app.manager.logout()); await app.act(async () => old());
  assert.equal(mutations, 0); assert.ok(!app.hasText('1. Ana')); app.dispose();
});

test('chamada direta externa mantém intenção incerta e não repete POST após atualização', { skip }, async () => {
  const values = new Map(), at = '2026-11-10T15:00:00.000Z'; let posts = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      if (options.method === 'POST') { posts++; assert.ok([...values.values()].some(raw => raw.includes('dispatching')));
        throw Object.assign(new Error('offline'), { isNetworkError: true }); }
      return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true, pendingCall: null,
        canCall: true, canConfirm: false, canMarkAbsent: false, canRemove: false, observedAt: at, waitingCount: 1,
        waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } };
  const app = createIntegration({ initialUser: staffUser, control });
  try {
    await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada');
    await app.press('Chamar próximo');
    assert.equal(posts, 1); assert.equal(app.modal().props.visible, false);
    assert.ok(app.hasText('O resultado de uma solicitação ainda não foi confirmado'));
    await app.press('Atualizar fila de entrada');
    assert.equal(posts, 1);
    assert.ok([...values.values()].some(raw => raw.includes('dispatching')));
  } finally { app.dispose(); }
});

test('recusa definitiva da entrada é reconhecida sem toque e preserva feedback', { skip }, async () => {
  const values = new Map(), at = '2026-11-10T15:00:00.000Z'; let posts = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      if (options.method === 'POST') { posts++; return { statusCode: 409, body: { code: 'ENTRY_NOT_FIRST' } }; }
      return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true, pendingCall: null,
        canCall: true, canConfirm: false, canMarkAbsent: false, canRemove: false, observedAt: at, waitingCount: 1,
        waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } };
  const app = createIntegration({ initialUser: staffUser, control });
  try {
    await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada');
    await app.press('Chamar próximo');
    assert.equal(posts, 1);
    assert.ok(app.hasText('A fila mudou. Confira o primeiro participante'));
    assert.equal(app.hasButton('Entendi'), false);
    assert.ok([...values.values()].some(raw => raw.includes('"phase":"acknowledged"')));
  } finally { app.dispose(); }
});

test('401 terminal no Controle de Entrada remove lista nominal e área Staff', { skip }, async () => {
  let revoked = false;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const app = createIntegration({ initialUser: staffUser, control: { realStaff: true, events: [staffEvent],
    http: async route => {
      if (revoked && route.endsWith('/entry-control')) return { statusCode: 401, body: { code: 'SESSION_REVOKED' } };
      if (route.endsWith('/entry-control')) return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true,pendingCall:null,canCall:true,canConfirm:false,canMarkAbsent:false,canRemove:false,
        observedAt: '2026-11-10T15:00:00.000Z', waitingCount: 1, waiting: [
          { participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } } });
  await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada'); assert.ok(app.hasText('1. Ana'));
  revoked = true; await app.press('Atualizar fila de entrada');
  assert.equal(app.route(), 'Login'); assert.ok(!app.hasText('1. Ana')); app.dispose();
});

test('AUD-01 + AUD-05: perda de autorização propaga entre painel e Controle de Entrada, fecha modal, invalida callbacks e preserva intenção persistida', { skip }, async () => {
  const at = '2026-11-10T15:00:00.000Z';
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };

  // Parte A: Controle de Entrada aberto detecta 403 em polling -> fecha modal, invalida callback e propaga bloqueio ao painel
  let denyEntry = false;
  let mutations = 0;
  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      platformOS: 'android',
      events: [staffEvent],
      stations: [realStation],
      experiences: [{ id: realExperienceId, name: 'Experiência real' }],
      secureStore: { isAvailableAsync: async () => true, getItemAsync: async () => null, setItemAsync: async () => {} },
      http: async (route, options) => {
        if (!route.includes('/entry-control')) return undefined;
        if (options.method !== 'GET') { mutations += 1; return { statusCode: 500, body: { code: 'UNEXPECTED' } }; }
        if (denyEntry) return { statusCode: 403, body: { code: 'STAFF_EVENT_FORBIDDEN' } };
        return {
          eventId: staffEvent.id,
          externalQueueEnabled: true,
          canManage: true,
          observedAt: at,
          pendingCall: null,
          canCall: true,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 2,
          waiting: [
            { participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 },
            { participationId: 'abcdef00-0000-4000-8000-000000000005', displayName: 'Bia', position: 2 },
          ],
        };
      },
    },
  });
  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    await app.press('Controle de Entrada');
    assert.ok(app.hasText('1. Ana'));
    assert.ok(app.hasText('2. Bia'));
    await app.press('Desativar fila externa');
    assert.equal(app.modal().props.visible, true);
    const staleConfirm = app.handler('CONFIRMAR ALTERAÇÃO');

    denyEntry = true;
    await app.tickTimers(5000);
    assert.ok(!app.hasText('1. Ana'));
    assert.ok(!app.hasText('2. Bia'));
    assert.equal(app.modals().every((m) => !m.props.visible), true);
    assert.equal(app.modals().length, 0);
    await app.act(async () => staleConfirm());
    assert.equal(mutations, 0, 'callback antigo não dispara mutação após 403');
    assert.ok(app.hasText('Acesso ao evento indisponível'));
    assert.equal(app.manager.getSnapshot().isAuthenticated, true, 'recusa no evento não invalida a sessão global');

    await app.press('Voltar ao painel');
    assert.ok(app.hasText('Painel operacional'));
    assert.ok(!app.hasText('Estação real'));
    assert.ok(app.hasText('SEM ACESSO'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);
  } finally {
    app.dispose();
  }

  // Parte B: Negativa identificada pelo painel em voo propaga à subtela aberta e preserva intenção dispatching persistida
  const values = new Map();
  let pendingStationsFlight = null;
  let postOffline = false;
  let posts = 0;
  const appPanelRevoke = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      platformOS: 'android',
      events: [staffEvent],
      experiences: [{ id: realExperienceId, name: 'Experiência real' }],
      secureStore: {
        isAvailableAsync: async () => true,
        getItemAsync: async (k) => values.get(k) ?? null,
        setItemAsync: async (k, v) => { values.set(k, v); },
      },
      http: async (route, options) => {
        if (route.endsWith('/stations')) {
          if (pendingStationsFlight) return pendingStationsFlight.promise;
          return { eventId: staffEvent.id, stations: [realStation] };
        }
        if (!route.includes('/entry-control')) return undefined;
        if (options.method === 'POST') {
          posts += 1;
          if (postOffline) throw Object.assign(new Error('offline'), { isNetworkError: true });
        }
        return {
          eventId: staffEvent.id,
          externalQueueEnabled: true,
          canManage: true,
          observedAt: at,
          pendingCall: null,
          canCall: true,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 1,
          waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }],
        };
      },
    },
  });
  try {
    await appPanelRevoke.mount();
    await appPanelRevoke.act(() => appPanelRevoke.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await appPanelRevoke.press('Selecionar evento Evento autorizado');
    pendingStationsFlight = deferred();
    await appPanelRevoke.press('Atualizar estações');
    await appPanelRevoke.press('Controle de Entrada');
    postOffline = true;
    await appPanelRevoke.press('Chamar próximo');
    assert.equal(posts, 1);
    assert.ok([...values.values()].some((raw) => raw.includes('dispatching')));

    // O GET em voo do painel (/stations) rejeita com 404 enquanto a subtela de Controle de Entrada está aberta
    await appPanelRevoke.act(async () => {
      pendingStationsFlight.resolve({ statusCode: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.ok(!appPanelRevoke.hasText('1. Ana'), 'informação nominal removida imediatamente na subtela aberta');
    assert.ok(appPanelRevoke.hasText('Acesso ao evento indisponível'));
    assert.equal(appPanelRevoke.hasButton('Chamar próximo'), false);
    assert.ok([...values.values()].some((raw) => raw.includes('dispatching')),
      'intenção persistida necessária à recuperação segura permanece intacta');
  } finally {
    appPanelRevoke.dispose();
  }
});

test('AUD-02 + AUD-05: bloqueio persiste em atualização manual, GET 403 concorrente, 500 posterior e troca de evento', { skip }, async () => {
  const at = '2026-11-10T15:00:00.000Z';
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const secondEvent = { id: '22222222-2222-4222-8222-222222222222', name: 'Segundo Evento', status: 'open', effectivePhase: 'open' };
  let mode = 'deny403';
  const defEntry = [];
  const defStations = [];

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      events: [staffEvent, secondEvent],
      experiences: [{ id: realExperienceId, name: 'Experiência real' }],
      http: async (route) => {
        if (route === `/staff/events/${secondEvent.id}/experiences`) {
          return { eventId: secondEvent.id, experiences: [{ id: realExperienceId, name: 'Outra Arena' }] };
        }
        if (route === `/staff/events/${secondEvent.id}/stations`) {
          return { eventId: secondEvent.id, stations: [{ ...realStation, label: 'Estação B' }] };
        }
        if (route === `/staff/events/${secondEvent.id}/entry-control`) {
          return {
            eventId: secondEvent.id, externalQueueEnabled: true, canManage: true, observedAt: at,
            pendingCall: null, canCall: true, canConfirm: false, canMarkAbsent: false, canRemove: false,
            waitingCount: 1, waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }],
          };
        }
        if (mode === 'deny403' && route.endsWith('/entry-control')) {
          return { statusCode: 403, body: { code: 'FORBIDDEN' } };
        }
        if (mode === 'deferred') {
          if (route.endsWith('/stations')) { const d = deferred(); defStations.push(d); return d.promise; }
          if (route.endsWith('/entry-control')) { const d = deferred(); defEntry.push(d); return d.promise; }
        }
        if (mode === 'err500' && route.endsWith('/entry-control')) {
          return { statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } };
        }
        if (route.endsWith('/stations')) return { eventId: staffEvent.id, stations: [realStation] };
        if (route.endsWith('/entry-control')) {
          return {
            eventId: staffEvent.id, externalQueueEnabled: true, canManage: true, observedAt: at,
            pendingCall: null, canCall: true, canConfirm: false, canMarkAbsent: false, canRemove: false,
            waitingCount: 1, waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }],
          };
        }
        return undefined;
      },
    },
  });

  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    assert.ok(!app.hasText('Estação real'));
    assert.ok(app.hasText('SEM ACESSO'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // Atualização manual pendente NÃO habilita card antes de confirmação positiva completa
    mode = 'deferred';
    await app.press('Atualizar estações');
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    assert.ok(app.hasText('SEM ACESSO'));
    await app.act(async () => {
      defStations[0].resolve({ eventId: staffEvent.id, stations: [realStation] });
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.ok(!app.hasText('Estação real'), 'não expõe estações enquanto entrada ainda revalida');
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // 500 posterior na revalidação NÃO desbloqueia acesso negado
    await app.act(async () => {
      defEntry[0].resolve({ statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } });
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.ok(!app.hasText('Estação real'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    mode = 'err500';
    await app.press('Atualizar estações');
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // Confirmação positiva 200 restaura painel, métricas associadas aos rótulos e botão
    mode = 'ok';
    await app.press('Atualizar estações');
    assert.ok(app.hasText('Estação real'));
    assert.equal(app.metricValueFor('Estações ativas'), '1/1');
    assert.equal(app.metricValueFor('Em atendimento'), '0');
    assert.equal(app.metricValueFor('Fila externa'), '1');
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // Troca de evento após negativa mantém novo evento funcional sem herdar bloqueio
    mode = 'deny403';
    await app.press('Atualizar estações');
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    await app.press('Voltar aos eventos');
    await app.press('Selecionar evento Segundo Evento');
    assert.ok(app.hasText('Estação B'));
    assert.equal(app.isDisabled('Controle de Entrada'), false);
  } finally {
    app.dispose();
  }
});

test('AUD-04 + AUD-05: retorno unificado, ciclo de vida foco/AppState no polling e experiência órfã controlada com React Navigation real', { skip }, async () => {
  const at = '2026-11-10T15:00:00.000Z';
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const unknownExpId = '99999999-9999-4999-8999-999999999999';
  const counts = { stations: 0, experiences: 0, entry: 0 };
  let includeOrphanStation = false;
  let resolveMissingExperience = false;

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      events: [staffEvent],
      http: async (route) => {
        if (route === `/staff/events/${staffEvent.id}/experiences`) {
          counts.experiences += 1;
          const list = [{ id: realExperienceId, name: 'Just Dance' }];
          if (resolveMissingExperience) list.push({ id: unknownExpId, name: 'Arena VR' });
          return { eventId: staffEvent.id, experiences: list };
        }
        if (route === `/staff/events/${staffEvent.id}/stations`) {
          counts.stations += 1;
          const list = [realStation];
          if (includeOrphanStation) {
            list.push({ id: '77777777-7777-4777-8777-777777777777', experienceId: unknownExpId,
              label: 'Estação VR', availability: 'available', pendingServiceSessionId: null });
          }
          return { eventId: staffEvent.id, stations: list };
        }
        if (route === `/staff/events/${staffEvent.id}/entry-control`) {
          counts.entry += 1;
          return {
            eventId: staffEvent.id, externalQueueEnabled: true, canManage: true, observedAt: at,
            pendingCall: null, canCall: false, canConfirm: false, canMarkAbsent: false, canRemove: false,
            waitingCount: 0, waiting: [],
          };
        }
        return undefined;
      },
    },
  });

  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    assert.deepEqual(counts, { stations: 1, experiences: 1, entry: 1 });

    // 1. Retorno de Controle de Entrada por botão interno e por retorno nativo (beforeRemove) executam revalidação equivalente
    await app.press('Controle de Entrada');
    assert.deepEqual(counts, { stations: 1, experiences: 1, entry: 2 }, 'abertura da subtela consulta apenas /entry-control');
    await app.press('Voltar ao painel');
    assert.deepEqual(counts, { stations: 2, experiences: 2, entry: 3 }, 'retorno por botão interno revalida painel completo (+1 em cada recurso)');

    await app.press('Controle de Entrada');
    assert.deepEqual(counts, { stations: 2, experiences: 2, entry: 4 }, 'nova abertura da subtela consulta apenas /entry-control');
    app.back();
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(app.hasText('Painel operacional'));
    assert.deepEqual(counts, { stations: 3, experiences: 3, entry: 5 }, 'retorno nativo revalida painel completo (+1 em cada recurso)');

    // 2. Retorno de Estação por botão interno e por retorno nativo (beforeRemove) executam revalidação equivalente
    await app.press('Selecionar estação Estação real da experiência Just Dance');
    await app.press('Voltar ao painel');
    assert.deepEqual(counts, { stations: 4, experiences: 4, entry: 6 });

    await app.press('Selecionar estação Estação real da experiência Just Dance');
    app.back();
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(app.hasText('Painel operacional'));
    assert.deepEqual(counts, { stations: 5, experiences: 5, entry: 7 });

    // 3. Perda de foco e segundo plano pausam polling; retomada reativa exatamente 1 ciclo de 5s
    await app.setFocus(false);
    await app.tickTimers(10000);
    assert.deepEqual(counts, { stations: 5, experiences: 5, entry: 7 }, 'sem foco não consulta em polling');

    await app.setFocus(true);
    await app.setAppState('background');
    await app.tickTimers(10000);
    assert.deepEqual(counts, { stations: 5, experiences: 5, entry: 7 }, 'em segundo plano não consulta em polling');

    await app.setAppState('active');
    includeOrphanStation = true;
    await app.tickTimers(5000);
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Polling atualizou estações (6) e entrada (8); estação órfã disparou exatamente 1 revalidação de experiências (6)
    assert.equal(counts.stations, 6);
    assert.equal(counts.entry, 8);
    assert.equal(counts.experiences, 6);
    assert.ok(app.hasText('Experiência não vinculada'));
    assert.equal(app.hasButton('Selecionar estação Estação VR da experiência Arena VR'), false);

    // Próximo ciclo de polling com inconsistência persistente NÃO dispara novas consultas de /experiences
    await app.tickTimers(5000);
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(counts.stations, 7);
    assert.equal(counts.experiences, 6, 'sem loop infinito diante de experiência ausente persistente');

    // Quando a experiência passa a existir no servidor, atualização confirma e habilita a estação
    resolveMissingExperience = true;
    await app.press('Atualizar estações');
    assert.ok(app.hasText('Arena VR'));
    assert.ok(!app.hasText('Experiência não vinculada'));
    assert.equal(app.hasButton('Selecionar estação Estação VR da experiência Arena VR'), true);
  } finally {
    app.dispose();
  }
});

test('R3-01, R3-02, R3-03 e R3-04: revalidação parcial não trava botão Atualizar estações, negativa concorrente na entrada propaga ao painel, 404 tardio de fila abandonada é ignorado e experiência desconhecida recupera após falha de rede', async () => {
  const unknownExperienceId = '99999999-9999-4999-8999-999999999999';
  const unknownStation = {
    id: '88888888-8888-4888-8888-888888888888',
    experienceId: unknownExperienceId,
    label: 'Estação Nova',
    availability: 'available',
    pendingServiceSessionId: null,
  };
  let stationsMode = 'ok';
  let experiencesMode = 'ok';
  let entryMode = 'ok';
  let includeUnknownStation = false;
  let includeUnknownExperience = false;
  let pendingQueueReq = null;
  let pendingEntryReqs = [];

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      events: [staffEvent],
      http: async (route, options) => {
        if (route.endsWith('/stations')) {
          if (stationsMode === 'deny403') throw Object.assign(new Error('403'), { status: 403 });
          if (stationsMode === 'err500') throw Object.assign(new Error('500'), { status: 500 });
          const list = [realStation];
          if (includeUnknownStation) list.push(unknownStation);
          return { eventId: staffEvent.id, stations: list };
        }
        if (route.endsWith('/experiences')) {
          if (experiencesMode === 'deny403') throw Object.assign(new Error('403'), { status: 403 });
          if (experiencesMode === 'networkOnce') {
            experiencesMode = 'ok';
            throw Object.assign(new Error('offline'), { isNetworkError: true });
          }
          const list = [{ id: realExperienceId, name: 'Just Dance' }];
          if (includeUnknownExperience) list.push({ id: unknownExperienceId, name: 'Beat Saber' });
          return { eventId: staffEvent.id, experiences: list };
        }
        if (route.endsWith('/queue')) {
          if (pendingQueueReq) return pendingQueueReq.promise;
          return {
            eventId: staffEvent.id,
            experienceId: realExperienceId,
            waitingCount: 0,
            firstWaitingQueueEntryId: null,
            waiting: [],
            activeCall: null,
          };
        }
        if (route.includes('/entry-control') && options.method === 'GET') {
          if (entryMode === 'deferred') {
            const d = deferred();
            pendingEntryReqs.push(d);
            return d.promise;
          }
          if (entryMode === 'deny403') throw Object.assign(new Error('403'), { status: 403 });
          if (entryMode === 'err500') throw Object.assign(new Error('500'), { status: 500 });
          return {
            eventId: staffEvent.id,
            externalQueueEnabled: true,
            canManage: true,
            observedAt: at,
            pendingCall: null,
            canCall: false,
            canConfirm: false,
            canMarkAbsent: false,
            canRemove: false,
            waitingCount: 0,
            waiting: [],
          };
        }
        return undefined;
      },
    },
  });

  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Evento autorizado');
    assert.ok(app.hasText('Just Dance'));

    // 1. R3-03: 404 tardio de fila já abandonada ao voltar ao painel não bloqueia o evento
    pendingQueueReq = deferred();
    await app.press('Selecionar estação Estação real da experiência Just Dance');
    await app.press('Voltar ao painel');
    await app.act(async () => {
      pendingQueueReq.reject(Object.assign(new Error('404'), { status: 404 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    pendingQueueReq = null;
    assert.ok(app.hasText('Just Dance'), '404 de fila abandonada não limpa painel');
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // 2. R3-02: na subtela Controle de Entrada, GET A pendente (403) + refresh manual GET B (500) propaga perda de acesso ao painel
    await app.press('Controle de Entrada');
    entryMode = 'deferred';
    pendingEntryReqs = [];
    // Polling dispara GET A
    const tickA = app.tickTimers(5000);
    // Operador dispara refresh manual que inicia GET B
    const manualB = app.press('Atualizar');
    assert.equal(pendingEntryReqs.length, 2);

    // GET A retorna 403 e GET B retorna 500
    await app.act(async () => {
      pendingEntryReqs[0].reject(Object.assign(new Error('403'), { status: 403 }));
      pendingEntryReqs[1].reject(Object.assign(new Error('500'), { status: 500 }));
      await Promise.all([tickA, manualB]);
    });
    assert.ok(app.hasText('Acesso ao evento indisponível'));

    await app.press('Voltar ao painel');
    assert.ok(app.hasText('SEM ACESSO'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // 3. R3-01: revalidação parcial (200 em stations, 200 em experiences, 500 em entry-control) mantém bloqueio mas reabilita botão "Atualizar estações"
    stationsMode = 'ok';
    experiencesMode = 'ok';
    entryMode = 'err500';
    await app.press('Atualizar estações');
    assert.ok(app.hasText('SEM ACESSO'));
    assert.ok(!app.hasText('Just Dance'), 'não expõe dados parciais antes de confirmação completa');
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    assert.equal(app.isDisabled('Atualizar estações'), false, 'botão Atualizar estações não fica preso em loading');

    // Nova tentativa após falha parcial com os três retornando 200 restaura o painel
    entryMode = 'ok';
    await app.press('Atualizar estações');
    assert.ok(app.hasText('Just Dance'));
    assert.equal(app.isDisabled('Controle de Entrada'), false);
    assert.equal(app.isDisabled('Atualizar estações'), false);

    // 4. R3-04: estação com experiência desconhecida cuja sincronização inicial falha por rede se recupera no próximo ciclo de 5s mantendo a mesma assinatura
    includeUnknownStation = true;
    includeUnknownExperience = true;
    experiencesMode = 'networkOnce';
    await app.tickTimers(5000);
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Primeira tentativa automática falhou com erro de rede, então ainda exibe Experiência não vinculada
    assert.ok(app.hasText('Experiência não vinculada'));

    // Próximo ciclo de 5s reexecuta pollExperiences() para a mesma assinatura e encontra Beat Saber
    await app.tickTimers(5000);
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(app.hasText('Beat Saber'));
    assert.ok(!app.hasText('Experiência não vinculada'));
    assert.equal(app.hasButton('Selecionar estação Estação Nova da experiência Beat Saber'), true);
  } finally {
    app.dispose();
  }
});
