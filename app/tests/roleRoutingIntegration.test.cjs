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
    StackRouter: qaRequire('@react-navigation/routers').StackRouter, TabRouter: qaRequire('@react-navigation/routers').TabRouter };
} catch { deps = null; }
const skip = deps ? false : 'dependências de qa/regression não instaladas';

function createIntegration({ initialToken = null, initialUser, control = {} }) {
  const { React, jsx, Renderer, Navigation, StackRouter, TabRouter } = deps;
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
      if (url === '/admin/events') return { items: [], nextCursor: null };
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
  const native = Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'RefreshControl', 'ScrollView', 'Switch', 'Text', 'TextInput', 'View'].map((name) => [name, name]));
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
  function FocusedTabs(props) {
    const { state, descriptors, navigation, NavigationContent } = Navigation.useNavigationBuilder(TabRouter, props);
    return React.createElement(NavigationContent, null, descriptors[state.routes[state.index].key].render(),
      props.tabBar?.({ state, descriptors, navigation }));
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
      if (name === '@react-navigation/bottom-tabs') return { createBottomTabNavigator: Navigation.createNavigatorFactory(FocusedTabs) };
      if (name === '@react-navigation/native-stack') return { createNativeStackNavigator: Navigation.createNavigatorFactory(FocusedStack) };
      if (name === '@react-native-community/datetimepicker') return { __esModule: true, default: 'DateTimePicker' };
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
          usePreventRemove: Navigation.usePreventRemove,
          NavigationContainer: ({ children }) => React.createElement(
            Navigation.BaseNavigationContainer,
            { ref: navRef, onUnhandledAction: (action) => unhandled.push(action) },
            children,
          ),
        };
      }
      const target = path.posix.normalize(path.posix.join(directory, name)).replace(/\.js$/, '');
      if (target === 'assets/images/logo-arenago.png') return { uri: target };
      if (control.realStaff && target === 'assets/images/logo-arenago-staff.png') return { uri: target };
      if (target === 'components/ui/AuthBackground') {
        return { AuthBackground: ({ children, ...props }) => React.createElement('View', props, children) };
      }
      if (target === 'theme') return createParticipantThemeStub();
      if (target === 'services/httpClient') return { ...http, httpClient: client };
      if (target === 'services/tokenStorage') return { defaultTokenStorage: storage };
      if (control.realAdmin && target === 'screens/admin/adminDemoLatency') {
        return { waitAdminDemoLatency: async () => {} };
      }
      if (control.realAdmin && (target.startsWith('screens/admin/') || target === 'data/adminDemoData' ||
        ['services/adminEventsService', 'services/adminEventSetupService'].includes(target))) {
        return load(`${target}.js`);
      }
      if (control.realStaff && ['screens/staff/StaffEventsNavigator', 'services/staffEventsService',
        'screens/staff/StaffEntryControlRealScreen', 'services/staffEntryService', 'services/staffEntryIntentStorage',
        'screens/staff/StaffStationOperationalScreen', 'screens/staff/components/StaffStationSections',
        'services/staffIntentStorage', 'services/staffDashboardService', 'services/staffOperationsService',
        'screens/staff/useStaffPolling', 'screens/staff/components/StaffLiveScreen',
        'screens/admin/components/AdminLiveUI', 'screens/admin/components/adminTheme'].includes(target)) {
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
    inputValue(label) {
      return tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label)?.props.value;
    },
    async input(label, value) {
      const field = tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
      assert.ok(field, label);
      await Renderer.act(async () => field.props.onChangeText(value));
    },
    navigate(name, params) { Renderer.act(() => navRef.navigate(name, params)); },
    back() { Renderer.act(() => navRef.goBack()); },
    popActive() {
      const root = navRef.getRootState();
      Renderer.act(() => navRef.dispatch({ type: 'POP', payload: { count: 1 }, target: root.routes[root.index].state.key }));
    },
    hasText(text) { return tree.root.findAllByType('Text').some((node) => {
      const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
        : value && typeof value === 'object' ? flatten(value.props?.children) : String(value ?? '');
      return flatten(node.props.children).includes(text);
    }); },
    hasExactText(text) { return tree.root.findAllByType('Text').some((node) => {
      const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
        : value && typeof value === 'object' ? flatten(value.props?.children) : String(value ?? '');
      return flatten(node.props.children) === String(text);
    }); },
    hasQueueRow(position, displayName, status = 'Aguardando') {
      const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
        : value && typeof value === 'object' ? flatten(value.props?.children) : String(value ?? '');
      return tree.root.findAllByType('View').some((row) => {
        const ch = (row.children ?? []).filter((node) => node && typeof node === 'object' && node.type === 'View');
        if (ch.length !== 2) return false;
        const leftTexts = ch[0].findAllByType('Text').map((t) => flatten(t.props.children));
        const rightTexts = ch[1].findAllByType('Text').map((t) => flatten(t.props.children));
        return leftTexts.length === 1
          && leftTexts[0] === String(position)
          && rightTexts.length === 2
          && rightTexts.includes(displayName)
          && rightTexts.includes(status);
      });
    },
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
    buttonProps(label) {
      const buttons = tree.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel === label);
      assert.equal(buttons.length, 1, `botão ${label}`);
      return buttons[0].props;
    },
    async activateButton(label) {
      const props = this.buttonProps(label);
      if (!props.disabled) await Renderer.act(async () => { await props.onPress?.(); });
    },
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

test('ADMIN-05: Home e listagem abrem o fluxo, cinco etapas preservam UUID e retomada lê o evento salvo', { skip }, async () => {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const path = `/admin/events/${eventId}`;
  const writes = [];
  let saved;
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: {
    realAdmin: true, http: async (route, options) => {
      if (!route.startsWith('/admin/')) return undefined;
      if (options.method === 'POST') {
        writes.push(route);
        assert.equal(route, '/admin/events');
        const body = JSON.parse(options.body);
        saved = { ...body, id: eventId, effectivePhase: 'scheduled', readiness: { ready: false } };
        return { statusCode: 201, body: { event: saved } };
      }
      if (route === '/admin/events') return { items: saved ? [saved] : [], nextCursor: null };
      assert.ok(saved);
      if (route === path) return { event: saved };
      if (route === path + '/experiences') return { eventId, items: [] };
      assert.equal(route, path + '/readiness');
      return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled', ready: false,
        acceptingNewParticipations: false, missing: ['EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: false, hasVerifiedActiveStaff: false } };
    },
  } });
  await app.mount();
  try {
    await app.press('Criar evento');
    assert.equal(app.activeRoute(), 'AdminEventSetup');
    assert.equal(app.hasButton('Sair da conta'), false);
    await app.input('Nome do evento', 'Nome provisório');
    await app.press('Voltar para Home');
    assert.ok(app.hasText('Sair da configuração?'));
    await app.press('Cancelar');
    assert.equal(app.activeRoute(), 'AdminEventSetup');
    await app.press('Voltar para Home');
    await app.press('Sair do fluxo');
    assert.equal(app.activeRoute(), 'Home');
    await app.press('Gerenciar eventos');
    assert.equal(app.activeRoute(), 'AdminEvents');
    await app.press('Criar evento');
    await app.press('Voltar aos eventos');
    assert.equal(app.activeRoute(), 'AdminEvents');
    await app.press('Criar evento');
    assert.ok(app.hasText('20% do fluxo'));
    await app.input('Nome do evento', 'Encontro de novembro');
    await app.press('Gerar código');
    await app.press('Continuar');
    assert.ok(app.hasText('40% do fluxo'));
    await app.input('Data de início', '25/11/2090');
    await app.input('Hora de início', '14:00');
    await app.input('Data de término oficial', '25/11/2090');
    await app.input('Hora de término oficial', '18:00');
    await app.press('Voltar uma etapa');
    const advanceIdentity = app.handler('Continuar');
    await app.act(async () => { advanceIdentity(); advanceIdentity(); });
    assert.ok(app.hasText('40% do fluxo'));
    assert.deepEqual(writes, []);
    await app.press('Criar evento e continuar');
    assert.ok(app.hasText('60% do fluxo'));
    await app.press('Voltar uma etapa');
    await app.press('Voltar uma etapa');
    assert.ok(app.hasText(saved.accessCode));
    assert.match(saved.accessCode, /^ARENA-[A-F0-9]{8}$/);
    assert.ok(!app.hasButton('Gerar código'));
    await app.press('Continuar');
    await app.press('Continuar');
    await app.press('Continuar');
    assert.ok(app.hasText('80% do fluxo'));
    await app.press('Voltar uma etapa');
    assert.ok(app.hasText('60% do fluxo'));
    await app.press('Continuar');
    await app.press('Continuar');
    assert.ok(app.hasText('100% do fluxo'));
    await app.press('Voltar uma etapa');
    assert.ok(app.hasText('80% do fluxo'));
    await app.press('Continuar');
    assert.ok(app.hasText('Configuração pendente'));
    assert.ok(!app.hasText('Pronto para operar'));
    await app.press('Salvar e revisar depois');
    assert.ok(app.hasText('Evento salvo com sucesso'));
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.ok(app.hasText(saved.name));
    await app.press('Continuar configuração');
    assert.ok(app.hasText('60% do fluxo'));
    await app.press('Voltar uma etapa');
    await app.press('Voltar uma etapa');
    await app.press('Voltar ao painel');
    await app.press('Voltar aos eventos');
    assert.ok(app.hasButton('Acessar evento ' + saved.name));
    assert.deepEqual(writes, ['/admin/events']);
  } finally { app.dispose(); }
});

test('ADMIN-05: equipe confirma revogação, revisa os checks e conclui um evento pronto ainda agendado', { skip }, async () => {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const exp = 'abcdef00-0000-4000-8000-000000000002', station = 'abcdef00-0000-4000-8000-000000000003';
  const path = '/admin/events/' + eventId, at = '2090-11-01T00:00:00Z';
  const grant = { id: 'abcdef00-0000-4000-8000-000000000004', userId: 'abcdef00-0000-4000-8000-000000000005',
    eventId, role: 'staff', grantedAt: at, revokedAt: null };
  const email = 'equipe@example.test';
  let staff = false, revocations = 0;
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: {
    realAdmin: true, http: async (route, options) => {
      if (!route.startsWith('/admin/')) return undefined;
      const event = { id: eventId, name: 'Encontro das oficinas', timezone: 'UTC', accessCode: 'OFICINAS',
        startsAt: '2090-12-01T10:00:00Z', officialEndsAt: '2090-12-01T14:00:00Z', operationalDeadlineAt: '2090-12-01T14:00:00Z',
        externalQueueEnabled: false, readiness: { ready: staff }, effectivePhase: 'scheduled' };
      if (route === '/admin/events') { assert.equal(options.method, 'GET'); return { items: [event], nextCursor: null }; }
      if (route === path) return { event };
      if (route === path + '/experiences') return { eventId, items: [{ id: exp, eventId, name: 'Oficina',
        stations: [{ id: station, experienceId: exp, label: 'Mesa', availability: 'available' }] }] };
      if (route === path + '/readiness') return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled',
        acceptingNewParticipations: false, ready: staff, missing: staff ? [] : ['VERIFIED_ACTIVE_STAFF'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: staff } };
      assert.equal(options.method, 'POST');
      if (route === '/admin/roles/grant') {
        assert.deepEqual(JSON.parse(options.body), { role: 'staff', eventId, email });
        staff = true;
        return { grant };
      }
      assert.equal(route, '/admin/roles/revoke');
      assert.deepEqual(JSON.parse(options.body), { grantId: grant.id });
      revocations++;
      staff = false;
      return { grant: { ...grant, revokedAt: at } };
    },
  } });
  await app.mount();
  try {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Encontro das oficinas');
    await app.press('Continuar configuração');
    await app.press('Continuar');
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    assert.ok(app.hasText('O evento tem Staff elegível.'));
    await app.press('Revogar acesso de ' + email);
    await app.press('Cancelar');
    assert.equal(revocations, 0);
    await app.press('Revogar acesso de ' + email);
    await app.press('Revogar acesso');
    assert.equal(revocations, 1);
    assert.ok(app.hasText('O evento ainda precisa de Staff elegível.'));
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    await app.press('Continuar');
    assert.ok(app.hasText('Experiências: 1 · Estações: 1'));
    assert.ok(app.hasText('Fase: Agendado'));
    await app.press('Concluir configuração');
    assert.ok(app.hasText('Evento criado com sucesso'));
    assert.ok(app.hasText('Pronto para operar'));
    await app.press('Voltar para a Home Admin');
    assert.equal(app.activeRoute(), 'Home');
  } finally { app.dispose(); }
});

test('ADMIN-05: painel pronto oferece retomada de estação salva com resposta perdida na mesma sessão', { skip }, async () => {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const experienceId = 'abcdef00-0000-4000-8000-000000000002';
  const path = '/admin/events/' + eventId;
  const station = { id: 'abcdef00-0000-4000-8000-000000000003', experienceId, label: 'Mesa', availability: 'available',
    pendingServiceSessionId: null };
  const writes = [];
  const event = { id: eventId, name: 'Evento com estação', accessCode: 'ESTACAO', timezone: 'UTC',
    startsAt: '2090-12-01T10:00:00Z', officialEndsAt: '2090-12-01T14:00:00Z', operationalDeadlineAt: '2090-12-01T14:00:00Z',
    externalQueueEnabled: false, effectivePhase: 'scheduled' };
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: {
    realAdmin: true, http: async (route, options) => {
      const ready = writes.length > 0;
      const detail = { ...event, readiness: { ready } };
      if (route === '/admin/events') return { items: [detail], nextCursor: null };
      if (route === path) return { event: detail };
      if (route === path + '/experiences') return { eventId, items: [{ id: experienceId, eventId, name: 'Oficina',
        stations: ready ? [station] : [] }] };
      if (route === path + '/readiness') return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled',
        acceptingNewParticipations: false, ready, missing: ready ? [] : ['EXPERIENCE_WITH_AVAILABLE_STATION'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: ready, hasVerifiedActiveStaff: true } };
      if (route === path + '/experiences/' + experienceId + '/stations') {
        assert.equal(options.method, 'POST');
        writes.push({ headers: { ...options.headers }, body: options.body });
        if (writes.length === 1) throw new Error('Resposta perdida após commit');
        return { statusCode: 201, body: { station } };
      }
    },
  } });
  await app.mount();
  try {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Evento com estação');
    await app.press('Continuar configuração');
    await app.press('Adicionar estação a Oficina');
    await app.input('Identificação da estação', station.label);
    await app.press('Salvar estação');
    assert.ok(app.hasButton('Repetir a mesma solicitação'));
    await app.press('Voltar ao painel');
    await app.press('Sair do fluxo');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.ok(app.hasText('Pronto para operar'));
    await app.press('Continuar configuração');
    assert.ok(app.hasText(station.label));
    assert.equal(writes.length, 1);
    await app.press('Repetir a mesma solicitação');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    assert.ok(!app.hasButton('Repetir a mesma solicitação'));
  } finally { app.dispose(); }
});

for (const scenario of ['encerrar sessão', 'trocar conta', 'closing', 'closed']) {
  test(`ADMIN-05: confirmação após POST pendente — ${scenario}`, { skip }, async () => {
    const eventId = 'abcdef00-0000-4000-8000-000000000001';
    const path = '/admin/events/' + eventId;
    const pending = deferred();
    const ended = scenario === 'closing' || scenario === 'closed';
    const phase = ended ? scenario : 'scheduled';
    const name = 'Evento do POST pendente';
    let saved, posts = 0;
    const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: {
      realAdmin: true, http: async (route, options) => {
        if (route === '/admin/events' && options.method === 'POST') {
          posts++;
          const body = JSON.parse(options.body);
          await pending.promise;
          saved = { ...body, id: eventId, effectivePhase: phase, readiness: { ready: ended } };
          return { statusCode: 201, body: { event: saved } };
        }
        if (route === path) return { event: saved };
        if (route === path + '/experiences') return { eventId, items: [] };
        if (route === path + '/readiness') return { eventId, effectivePhase: phase, statusStored: phase,
          acceptingNewParticipations: false, ready: ended, missing: ended ? [] : ['VERIFIED_ACTIVE_STAFF'],
          checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
            hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: ended } };
      },
    } });
    await app.mount();
    try {
      await app.press('Criar evento');
      await app.input('Nome do evento', name);
      await app.input('Código de acesso', 'PENDENTE');
      await app.press('Continuar');
      await app.input('Data de início', '25/11/2090');
      await app.input('Hora de início', '14:00');
      await app.input('Data de término oficial', '25/11/2090');
      await app.input('Hora de término oficial', '18:00');
      const confirmCreate = app.handler('Criar evento e continuar');
      await app.act(async () => { confirmCreate(); confirmCreate(); });
      assert.equal(posts, 1);
      assert.ok(app.hasText('Salvando...'));

      assert.equal(app.hasButton('Sair da conta'), false);
      if (scenario === 'trocar conta' || scenario === 'encerrar sessão') {
        await app.act(() => app.manager.logout());
        if (scenario === 'trocar conta') {
          const other = { ...adminUser, id: 'admin-b', email: 'b@example.test',
            sessionId: '20000000-0000-4000-8000-000000000002' };
          app.setUser(other);
          await app.act(() => app.manager.login({ email: other.email, password: 'password' }));
          await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
          assert.equal(app.manager.getSnapshot().user.id, other.id);
          assert.equal(app.activeRoute(), 'Home');
        }
        await app.act(async () => { pending.resolve(); });
        assert.ok(!app.hasText(name));
      } else {
        await app.act(async () => { pending.resolve(); });
          assert.ok(app.hasText('Evento salvo em encerramento'));
          assert.ok(!app.hasText('Pronto para operar'));
          await app.act(async () => { confirmCreate(); });
          assert.equal(posts, 1);
          await app.press('Abrir painel do evento');
          assert.equal(app.activeRoute(), 'AdminRealEvent');
          assert.ok(app.hasText(name));
      }
      assert.equal(posts, 1);
    } finally { pending.resolve(); app.dispose(); }
  });
}

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
    assert.equal(app.activeRoute(), 'Home');
    assert.ok(app.hasText('Painel Administrativo'));
    assert.ok(app.hasText('Somente administradores autorizados podem alterar eventos, permissões e dados operacionais.'));
    for (const name of ['MainTabs', 'StaffPending', 'StaffDemo', 'ProfileQuestionnaire', 'AdminDemo', 'AdminPending']) {
      app.navigate(name);
      assert.equal(app.activeRoute(), 'Home');
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
    assert.equal(app.activeRoute(), 'Home');
    assert.ok(app.calls.includes('/auth/refresh') && app.calls.includes('/auth/me'));
    assert.ok(!app.calls.includes('/auth/2fa/verify'), 'sessão já autenticada é restaurada pelo contrato real');
    await app.press('Gerenciar eventos');
    assert.equal(app.activeRoute(), 'AdminEvents');
    assert.ok(app.hasText('Nenhum evento encontrado'));
    await app.press('Voltar para Home');
    assert.equal(app.activeRoute(), 'Home');
    await app.press('Gerenciar eventos');
    await app.press('Histórico');
    assert.equal(app.activeRoute(), 'Histórico');
    assert.ok(app.hasText('Em implementação'));
    assert.equal(app.hasButton('Sair da conta'), false);
    await app.press('Voltar para Home');
    assert.equal(app.activeRoute(), 'Home');
    await app.press('BI');
    assert.equal(app.activeRoute(), 'BI');
    assert.equal(app.hasButton('Sair da conta'), false);
    await app.press('Voltar para Home');
    assert.equal(app.activeRoute(), 'Home');
    for (const name of ['AdminCreateEvent', 'AdminEventDetail', 'AdminEventSchedule']) {
      app.navigate(name); assert.equal(app.activeRoute(), 'Home');
    }
    await app.press('Sair da conta');
    assert.equal(app.route(), 'Welcome');
    assert.equal(app.storedToken(), null);
    assert.equal(app.manager.getAccessToken(), null);
    assert.equal(app.calls.filter(url => url === '/auth/logout').length, 1);
    app.navigate('AdminArea', { screen: 'AdminPanel' });
    assert.equal(app.route(), 'Welcome');
  } finally { app.dispose(); }
});

test('Admin: painel real retorna à mesma rota da lista e mantém informações no UUID selecionado', { skip }, async () => {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const detailPath = `/admin/events/${eventId}`;
  const selected = { id: eventId, name: 'Evento Selecionado', effectivePhase: 'scheduled', timezone: 'America/Sao_Paulo',
    startsAt: '2090-11-05T15:00:00Z', officialEndsAt: '2090-11-05T20:00:00Z', readiness: { ready: true },
    operationalDeadlineAt: '2090-11-05T20:30:00.000000Z', updatedAt: '2090-11-01T00:00:00.000000Z', accessCode: 'ARENA-TESTE' };
  let readinessReads = 0;
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    http: async (route, options) => {
      if (!route.startsWith('/admin/')) return undefined;
      assert.equal(options.method, 'GET');
      if (route === '/admin/events') return { items: [selected], nextCursor: null };
      if (route === detailPath) return { event: selected };
      if (route === `${detailPath}/readiness`) {
        readinessReads++;
        return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled', ready: true, missing: [],
          checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
            hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: true }, acceptingNewParticipations: false };
      }
      assert.fail(`Rota Admin inesperada: ${route}`);
    },
  } });
  await app.mount();
  try {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Evento Selecionado');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.equal(app.hasButton('Sair da conta'), false);
    assert.ok(app.hasText('Pronto para operar'));
    assert.equal(readinessReads, 1);
    await app.press('Equipe Staff');
    assert.equal(app.activeRoute(), 'AdminEventManagementInfo');
    assert.ok(app.hasText('Evento Selecionado'));
    assert.ok(app.hasText('Esta área ainda não permite alterações'));
    assert.equal(readinessReads, 1);
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.equal(readinessReads, 2);
    await app.press('Informações e horários');
    assert.equal(app.activeRoute(), 'AdminEventManagementInfo');
    assert.equal(app.hasButton('Sair da conta'), false);
    for (const text of ['Informações gerais', 'Datas e horários', 'Acesso ao evento', 'ARENA-TESTE']) assert.ok(app.hasText(text));
    assert.equal(readinessReads, 3);
    await app.press('Editar nome');
    await app.input('Nome do evento', 'Alteração não salva');
    await app.press('Voltar ao painel');
    assert.ok(app.hasText('Alterações não salvas'));
    await app.press('Permanecer editando');
    await app.press('Voltar ao painel');
    await app.press('Descartar alterações');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.equal(readinessReads, 4);
    await app.press('Voltar aos eventos');
    assert.equal(app.activeRoute(), 'AdminEvents');
    await app.press('Acessar evento Evento Selecionado');
    await app.press('BI');
    assert.equal(app.activeRoute(), 'BI');
    assert.ok(app.hasText('Em implementação'));
  } finally { app.dispose(); }
});

test('ADMIN-04: painel abre estrutura por UUID, edita em contexto e reconsulta a prontidão no retorno', { skip }, async () => {
  const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
  const eventId = id(1), base = '/admin/events/' + eventId;
  const selected = { id: eventId, name: 'Encontro', effectivePhase: 'scheduled', timezone: 'America/Fortaleza',
    startsAt: '2090-11-05T15:00:00Z', officialEndsAt: '2090-11-05T20:00:00Z', readiness: { ready: true } };
  const station = { id: id(4), experienceId: id(3), label: 'Mesa', availability: 'available', pendingServiceSessionId: null };
  const groups = [{ id: id(2), eventId, name: 'Oficina', stations: [] }, { id: id(3), eventId, name: 'Arena', stations: [station] }];
  let reads = 0;
  let eligibleStaff = true;
  const writes = [];
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    http: async (route, options) => {
      if (route === '/admin/events') return { items: [selected], nextCursor: null };
      if (route === base) return { event: selected };
      if (route === base + '/experiences') return { eventId, items: groups };
      if (route === base + '/experiences/' + groups[1].id + '/stations' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        writes.push([route, body]);
        const created = { ...station, id: id(5), availability: 'available', label: body.label };
        groups[1].stations.push(created);
        return { station: created };
      }
      if (route === base + '/readiness') {
        reads++;
        const available = groups.some(group => group.stations.some(row => row.availability === 'available'));
        const ready = available && eligibleStaff;
        return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled', ready, acceptingNewParticipations: false,
          missing: [...(!available ? ['EXPERIENCE_WITH_AVAILABLE_STATION'] : []), ...(!eligibleStaff ? ['VERIFIED_ACTIVE_STAFF'] : [])],
          checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
            hasExperienceWithAvailableStation: available, hasVerifiedActiveStaff: eligibleStaff } };
      }
      if (options.method === 'PATCH') {
        writes.push([route, JSON.parse(options.body)]);
        const target = groups[1].stations.find(row => route === '/staff/events/' + eventId + '/stations/' + row.id + '/availability');
        if (target) {
          target.availability = JSON.parse(options.body).availability;
          return { stationId: target.id, availability: target.availability, pendingServiceSessionId: null };
        }
        assert.fail('PATCH fora da estação selecionada');
      }
    },
  } });
  try {
    await app.mount();
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Encontro');
    await app.press('Experiências e estações');
    assert.ok(app.hasText('2 experiências · 1 estação'));
    assert.equal(app.hasButton('Sair da conta'), false);
    assert.equal(app.handler('Catálogo · Em breve'), undefined);
    await app.press('Editar experiência Arena');
    assert.equal(app.inputValue('Nome da experiência'), 'Arena');
    await app.input('Nome da experiência', 'Rascunho');
    await app.press('Cancelar');
    await app.press('Mesa, Arena, Disponível');
    assert.ok(app.hasText('Sem chamada pendente'));
    await app.press('Editar identificação');
    assert.equal(app.inputValue('Identificação da estação'), 'Mesa');
    await app.press('Cancelar');
    await app.press('Tornar indisponível');
    await app.press('Cancelar');
    assert.equal(writes.length, 0);
    await app.press('Tornar indisponível');
    await app.press('Confirmar');
    assert.deepEqual(writes, [['/staff/events/' + eventId + '/stations/' + station.id + '/availability', { availability: 'unavailable' }]]);
    assert.ok(app.hasText('Indisponível'));
    await app.press('Voltar à estrutura');
    assert.ok(app.hasButton('Mesa, Arena, Indisponível'));
    const beforeReturn = reads;
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.ok(reads > beforeReturn);
    assert.ok(app.hasText('Encontro'));
    assert.ok(app.hasButton('Configuração pendente'));
    await app.press('Configuração pendente');
    await app.press('Consultar Experiências e estações');
    assert.ok(app.hasButton('Mesa, Arena, Indisponível'));
    await app.press('Adicionar estação em Arena');
    await app.input('Identificação da estação', 'Pista');
    await app.press('Confirmar gravação');
    assert.ok(app.hasText('Experiência selecionada'));
    assert.ok(app.hasText('2 experiências · 2 estações'));
    assert.ok(app.hasButton('Pista, Arena, Disponível'));
    assert.ok(app.hasText('Pronto para operar'));
    assert.equal(app.hasButton('Adicionar estação em Oficina'), false);
    await app.press('Ver todas as experiências');
    assert.ok(app.hasButton('Adicionar estação em Oficina'));
    eligibleStaff = false;
    await app.press('Atualizar');
    assert.ok(app.hasText('Configuração pendente'));
    assert.ok(app.hasButton('Pista, Arena, Disponível'));
    eligibleStaff = true;
    await app.press('Pista, Arena, Disponível');
    await app.press('Tornar indisponível');
    await app.press('Confirmar');
    assert.ok(app.hasText('Configuração pendente'));
    await app.press('Voltar ao painel');
    assert.ok(app.hasButton('Equipe Staff'));
    assert.ok(app.hasButton('Configuração pendente'));
  } finally { app.dispose(); }
});

const reviewPendingStructure = 'Revisar operações pendentes de experiências e estações';
function structureIntegration({ initialStation = false, write, read, platformOS = 'web' } = {}) {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const experienceId = 'abcdef00-0000-4000-8000-000000000002';
  const station = { id: 'abcdef00-0000-4000-8000-000000000003', experienceId, label: 'Mesa', availability: 'available',
    pendingServiceSessionId: null };
  const group = { id: experienceId, eventId, name: 'Oficina', stations: initialStation ? [station] : [] };
  const db = { phase: 'scheduled', name: 'Evento de estrutura', eligibleStaff: true };
  const path = '/admin/events/' + eventId;
  const stationPath = path + '/experiences/' + experienceId + '/stations';
  const availabilityPath = '/staff/events/' + eventId + '/stations/' + station.id + '/availability';
  const requests = [];
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    platformOS, http: async (route, options) => {
      requests.push({ route, method: options.method, key: options.headers['Idempotency-Key'], body: options.body });
      if (options.method === 'POST' && route === stationPath) {
        return write ? write({ db, group, station, route, options }) : { statusCode: 201, body: { station } };
      }
      if (options.method === 'PATCH' && route === availabilityPath) return write({ db, group, station, route, options });
      if (options.method !== 'GET') return;
      const override = read?.({ route, path, group, eventId });
      if (override) return override;
      const available = group.stations.some(row => row.availability === 'available');
      const ready = available && db.eligibleStaff;
      const event = { id: eventId, name: db.name, accessCode: 'ESTRUTURA', timezone: 'UTC', effectivePhase: db.phase,
        startsAt: '2090-12-01T10:00:00Z', officialEndsAt: '2090-12-01T14:00:00Z', operationalDeadlineAt: '2090-12-01T14:30:00Z',
        externalQueueEnabled: false, readiness: { ready } };
      if (route === '/admin/events') return { items: [event], nextCursor: null };
      if (route === path) return { event };
      if (route === path + '/experiences') return { eventId, items: [group] };
      if (route === path + '/readiness') return { eventId, statusStored: db.phase, effectivePhase: db.phase, ready,
        acceptingNewParticipations: false,
        missing: [...(!available ? ['EXPERIENCE_WITH_AVAILABLE_STATION'] : []), ...(!db.eligibleStaff ? ['VERIFIED_ACTIVE_STAFF'] : [])],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: available, hasVerifiedActiveStaff: db.eligibleStaff } };
    } } });
  async function openPanel() {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento ' + db.name);
  }
  async function fillStation(button, submit, label = station.label) {
    await app.press(button);
    await app.input('Identificação da estação', label);
    await app.press(submit);
  }
  return { app, db, path, stationPath, availabilityPath, requests, openPanel, fillStation };
}

test('ADMIN-04: recuperação do wizard no painel pronto em closing, recusa do replay e consulta em closed', { skip }, async () => {
  let posts = 0;
  const h = structureIntegration({ initialStation: true, write: ({ db }) => {
    if (++posts === 1) {
      throw new Error('Resultado do POST desconhecido');
    }
    db.phase = 'closed';
    return { statusCode: 409, body: { code: 'EVENT_OPERATION_ENDED' } };
  } });
  const { app, db, path, stationPath, requests } = h;
  db.eligibleStaff = false;
  try {
    await app.mount();
    await h.openPanel();
    await app.press('Continuar configuração');
    await h.fillStation('Adicionar estação a Oficina', 'Salvar estação', 'Estação nova');
    db.eligibleStaff = true;
    db.phase = 'closing';
    await app.press('Voltar ao painel');
    await app.press('Sair do fluxo');
    assert.ok(app.hasText('Pronto para operar'));
    assert.equal(app.hasButton('Continuar configuração'), false);
    const offset = requests.length;
    await app.press(reviewPendingStructure);
    assert.ok(app.hasButton('Mesa, Oficina, Disponível'));
    assert.equal(posts, 1);
    assert.ok(requests.slice(offset).some(entry => entry.route === path + '/experiences' && entry.method === 'GET'));
    await app.press('Repetir a mesma solicitação');
    const writes = requests.filter(entry => entry.route === stationPath && entry.method === 'POST');
    assert.equal(writes.length, 2);
    assert.ok(writes[0].key);
    assert.deepEqual(writes[1], writes[0]);
    assert.ok(app.hasText('A operação do evento já terminou.'));
    assert.ok(app.hasButton('Encerrar tentativa'));
    assert.equal(app.hasButton('Repetir a mesma solicitação'), false);
    assert.equal(app.handler('Adicionar estação em Oficina'), undefined);
    await app.press('Consultar recurso');
    await app.press('Encerrar tentativa');
    assert.ok(app.hasText('pode ter sido salvo'));
    await app.press('Confirmar');
    await app.press('Voltar ao painel');
    assert.equal(app.hasButton(reviewPendingStructure), false);
    assert.equal(posts, 2);
  } finally { app.dispose(); }
});

test('ADMIN-04: wizard reconhece operação da gestão e retoma com a chave e o corpo originais', { skip }, async () => {
  let posts = 0;
  const h = structureIntegration({ write: ({ group, station }) => {
    group.stations = [station];
    if (++posts === 1) throw new Error('Resposta perdida');
    return { statusCode: 201, body: { station } };
  } });
  const { app, requests, stationPath } = h;
  try {
    await app.mount();
    await h.openPanel();
    await app.press('Experiências e estações');
    await h.fillStation('Adicionar estação em Oficina', 'Confirmar gravação');
    await app.press('Voltar ao painel');
    assert.equal(app.hasText('Alterações não salvas'), false);
    await app.press('Continuar configuração');
    assert.ok(app.hasButton(reviewPendingStructure));
    assert.equal(posts, 1);
    await app.press(reviewPendingStructure);
    assert.ok(app.hasButton('Repetir a mesma solicitação'));
    await app.press('Voltar à configuração');
    assert.equal(app.activeRoute(), 'AdminEventSetup');
    await app.press('Repetir a mesma solicitação');
    const writes = requests.filter(entry => entry.route === stationPath && entry.method === 'POST');
    assert.equal(writes.length, 2);
    assert.ok(writes[0].key);
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(app.hasButton(reviewPendingStructure), false);
  } finally { app.dispose(); }
});

test('ADMIN-04: rascunho protege retorno visual, ação Android e remoção programática da rota', { skip }, async () => {
  let pendingRead;
  const h = structureIntegration({ platformOS: 'android', read: ({ route, path, group, eventId }) => {
    if (pendingRead && route === path + '/experiences') return pendingRead.promise.then(() => ({ eventId, items: [group] }));
  }, write: ({ group, station, options }) => {
    group.stations = [{ ...station, label: JSON.parse(options.body).label }];
    return { statusCode: 201, body: { station: group.stations[0] } };
  } });
  const { app } = h;
  try {
    await app.mount();
    await h.openPanel();
    await app.press('Experiências e estações');
    await app.press('Adicionar experiência');
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    for (const exit of [() => app.press('Voltar ao painel'), () => app.back(), () => app.popActive()]) {
      await app.press('Experiências e estações');
      await app.press('Editar experiência Oficina');
      await app.input('Nome da experiência', 'Rascunho');
      await exit();
      assert.ok(app.hasText('Alterações não salvas'));
      await app.press('Continuar editando');
      assert.equal(app.inputValue('Nome da experiência'), 'Rascunho');
      await exit();
      await app.press('Descartar alterações');
      assert.equal(app.activeRoute(), 'AdminRealEvent');
      assert.ok(app.hasText(h.db.name));
    }
    assert.equal(h.requests.filter(entry => entry.method === 'PATCH').length, 0);
    await app.press('Experiências e estações');
    await app.press('Adicionar estação em Oficina');
    await app.input('Identificação da estação', 'Rascunho descartado');
    pendingRead = deferred();
    const refresh = app.handler('Atualizar');
    await app.act(async () => { refresh(); });
    await app.press('Voltar ao painel');
    await app.press('Descartar alterações');
    await app.act(async () => { pendingRead.resolve(); });
    pendingRead = null;
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    await app.press('Experiências e estações');
    assert.equal(app.inputValue('Identificação da estação'), undefined);
    await h.fillStation('Adicionar estação em Oficina', 'Confirmar gravação', 'Salva');
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
  } finally { app.dispose(); }
});

for (const switchAccount of [false, true]) {
  test(`ADMIN-04: PATCH tardio no mesmo cliente após ${switchAccount ? 'troca de conta' : 'logout'}`, { skip }, async () => {
    const response = deferred();
    const h = structureIntegration({ initialStation: true, write: ({ options }) => {
      if (options.method === 'POST') throw new Error('Resultado do cadastro desconhecido');
      return response.promise;
    } });
    const { app, db, availabilityPath } = h;
    try {
      await app.mount();
      const client = app.manager.client;
      await h.openPanel();
      await app.press('Experiências e estações');
      await h.fillStation('Adicionar estação em Oficina', 'Confirmar gravação', 'Estação pendente');
      assert.ok(app.hasButton('Repetir a mesma solicitação'));
      await app.press('Mesa, Oficina, Disponível');
      await app.press('Tornar indisponível');
      const oldConfirm = app.handler('Confirmar');
      await app.act(async () => { oldConfirm(); });
      const writes = () => h.requests.filter(entry => entry.route === availabilityPath && entry.method === 'PATCH');
      assert.equal(writes().length, 1);
      assert.equal(app.hasButton('Voltar ao painel'), true);
      assert.equal(app.buttonProps('Voltar ao painel').disabled, true);
      assert.equal(app.buttonProps('Voltar ao painel').accessibilityState.disabled, true);
      const routeBeforeBack = app.activeRoute();
      await app.activateButton('Voltar ao painel');
      assert.equal(app.activeRoute(), routeBeforeBack);
      await app.act(() => app.manager.logout());
      if (switchAccount) {
        const other = { ...adminUser, id: 'admin-b', email: 'b@example.test',
          sessionId: '20000000-0000-4000-8000-000000000002' };
        app.setUser(other);
        await app.act(() => app.manager.login({ email: other.email, password: 'password' }));
        await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
        db.name = 'Evento da sessão seguinte';
        await h.openPanel();
        assert.equal(app.hasButton(reviewPendingStructure), false);
        await app.press('Experiências e estações');
      }
      await app.act(async () => {
        response.resolve({ stationId: availabilityPath.split('/').at(-2), availability: 'unavailable', pendingServiceSessionId: null });
        oldConfirm();
      });
      assert.equal(app.manager.client, client);
      assert.equal(writes().length, 1);
      assert.equal(app.hasButton(reviewPendingStructure), false);
      if (switchAccount) {
        assert.ok(app.hasText(db.name));
        assert.ok(app.hasButton('Mesa, Oficina, Disponível'));
        assert.equal(app.hasButton('Repetir a mesma solicitação'), false);
        assert.ok(!app.hasText('Estado solicitado confirmado'));
      } else assert.equal(app.route(), 'Welcome');
    } finally { app.dispose(); }
  });
}

test('ADMIN-04: voltar é habilitado após PATCH concluído na mesma sessão', { skip }, async () => {
  const response = deferred();
  const h = structureIntegration({ initialStation: true, write: () => response.promise });
  const { app, availabilityPath } = h;
  try {
    await app.mount();
    await h.openPanel();
    await app.press('Experiências e estações');
    await app.press('Mesa, Oficina, Disponível');
    await app.press('Tornar indisponível');
    const confirm = app.handler('Confirmar');
    await app.act(async () => { confirm(); });
    assert.equal(app.buttonProps('Voltar ao painel').disabled, true);
    await app.act(async () => {
      response.resolve({ stationId: availabilityPath.split('/').at(-2), availability: 'unavailable', pendingServiceSessionId: null });
    });
    assert.equal(app.buttonProps('Voltar ao painel').disabled, false);
    assert.equal(app.buttonProps('Voltar ao painel').accessibilityState.disabled, false);
    await app.activateButton('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
  } finally { app.dispose(); }
});

test('Admin: refresh e troca de conta invalidam logout antigo', { skip }, async () => {
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true } });
  await app.mount();
  try {
    const staleExit = app.handler('Sair da conta');
    await app.act(() => app.manager.refreshSession());
    assert.equal(app.activeRoute(), 'Home');
    await app.act(() => app.manager.logout());
    const other = { ...adminUser, id: 'admin-b', sessionId: '20000000-0000-4000-8000-000000000002' };
    app.setUser(other);
    await app.act(() => app.manager.login({ email: other.email, password: 'password' }));
    await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
    await app.act(async () => staleExit());
    assert.equal(app.activeRoute(), 'Home');
    assert.ok(!app.hasText('MODO DEMONSTRAÇÃO'));
    app.setUser({ ...other, roles: ['staff', 'participante'] });
    await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.route(), 'StaffPending');
    app.navigate('AdminArea'); assert.equal(app.route(), 'StaffPending');
    app.setUser({ ...other, roles: ['participante'], hasCompletedQuestionnaire: true });
    await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.route(), 'MainTabs');
    app.navigate('AdminArea'); assert.equal(app.route(), 'MainTabs');
    app.setUser(other); await app.act(() => app.manager.fetchCurrentUser());
    assert.equal(app.activeRoute(), 'Home');
  } finally { app.dispose(); }
});

test('Admin: revogação remota retira a área e invalida ações guardadas', { skip }, async () => {
  const control = { realAdmin: true };
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control });
  await app.mount();
  try {
    const stale = app.handler('Sair da conta');
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
    await app.press('Sair da conta');
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
    assert.ok(app.hasText('ATENDIMENTO ATUAL'));
    assert.ok(app.hasText('Ana'));
    assert.ok(app.hasText('Em atendimento'));
    assert.ok(app.hasText('FILA DA EXPERIÊNCIA'));
    assert.ok(app.hasText('3 aguardando'));
    assert.ok(app.hasText('Fila compartilhada entre as estações'));
    assert.equal(app.hasButton('Chamar próximo'), false);
    for (const [position, name] of [[1, 'Bia'], [2, 'Caio'], [3, 'Dora']]) {
      assert.ok(app.hasText(String(position)));
      assert.ok(app.hasText(name));
      assert.ok(!app.hasText(`Remover ${name} da fila`));
    }
    assert.ok(app.hasButton('Concluir experiência'));
    assert.ok(app.hasButton('Marcar ausência'));
    assert.ok(app.hasButton('Remover da fila'));
    await app.press('Concluir experiência'); assert.equal(app.modal().props.visible, true);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Marcar ausência'); assert.equal(app.modal().props.visible, true);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Remover da fila'); assert.equal(posts, 0);
    await app.press('CANCELAR OPERAÇÃO'); assert.equal(posts, 0);
    await app.press('Remover da fila'); await app.press('CONFIRMAR OPERAÇÃO');
    assert.equal(posts, 1); assert.ok(!app.hasText('Em atendimento'));
    assert.ok(app.hasText('Nenhum participante chamado'));
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
  assert.ok(app.hasText('Fila compartilhada entre as estações'));
  assert.equal(app.hasButton('Atualizar fila'), false, 'sem botão duplicado de atualização');
  await app.press('Voltar ao painel'); await app.press('Selecionar estação Console 2 da experiência Just Dance');
  assert.ok(app.hasText('Console 2'));
  assert.ok(app.hasText('Just Dance'));
  assert.ok(app.hasText('FILA DA EXPERIÊNCIA'));
  assert.equal(app.calls.filter((url) => url === `/staff/events/${staffEvent.id}/experiences/${realExperienceId}/queue`).length, 2);
  app.back();
  assert.ok(app.hasText('Painel operacional'));
  await app.press('Selecionar estação Estação real da experiência PlayStation');
  assert.ok(app.hasText('PlayStation'));
  assert.ok(app.hasText('FILA DA EXPERIÊNCIA'));
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
  assert.ok(app.hasText('0 aguardando'));
  assert.ok(app.hasText('Fila vazia'));
  assert.ok(!app.hasText('Rafael T.'));
  denied = true;
  await app.press('Atualizar atendimento');
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
    assert.equal(app.hasButton('Voltar aos eventos'), true);
    assert.equal(app.hasButton('Sair da conta'), false);

    await app.press('Controle de Entrada');
    assert.deepEqual(counts, { stations: 2, experiences: 2, entry: 4 }, 'nova abertura da subtela consulta apenas /entry-control');
    app.back();
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(app.hasText('Painel operacional'));
    assert.deepEqual(counts, { stations: 3, experiences: 3, entry: 5 }, 'retorno nativo revalida painel completo (+1 em cada recurso)');
    assert.equal(app.hasButton('Voltar aos eventos'), true);

    // 2. Retorno de Estação por botão interno e por retorno nativo (beforeRemove) executam revalidação equivalente
    await app.press('Selecionar estação Estação real da experiência Just Dance');
    await app.press('Voltar ao painel');
    assert.deepEqual(counts, { stations: 4, experiences: 4, entry: 6 });

    await app.press('Selecionar estação Estação real da experiência Just Dance');
    app.back();
    await app.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(app.hasText('Painel operacional'));
    assert.deepEqual(counts, { stations: 5, experiences: 5, entry: 7 });
    assert.equal(app.hasButton('Voltar aos eventos'), true);

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
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const at = '2026-11-10T15:00:00.000Z';
  const unknownExperienceId = '99999999-9999-4999-8999-999999999999';
  const unknownStation = {
    id: '88888888-8888-4888-8888-888888888888',
    experienceId: unknownExperienceId,
    label: 'Estação Nova',
    availability: 'available',
    pendingServiceSessionId: null,
  };
  let failNextExperienceRead = false;
  let experienceReads = 0;
  let entryMode = 'ok';
  let includeUnknownStation = false;
  let includeUnknownExperience = false;
  let pendingQueueReq = null;
  let queueReads = 0;
  const pendingEntryReqs = [];

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      platformOS: 'android',
      secureStore: { isAvailableAsync: async () => true, getItemAsync: async () => null, setItemAsync: async () => {} },
      events: [staffEvent],
      http: async (route, options) => {
        if (route.endsWith('/stations')) {
          const list = [realStation];
          if (includeUnknownStation) list.push(unknownStation);
          return { eventId: staffEvent.id, stations: list };
        }
        if (route.endsWith('/experiences')) {
          experienceReads += 1;
          if (failNextExperienceRead) {
            failNextExperienceRead = false;
            throw new Error('offline');
          }
          const list = [{ id: realExperienceId, name: 'Just Dance' }];
          if (includeUnknownExperience) list.push({ id: unknownExperienceId, name: 'Beat Saber' });
          return { eventId: staffEvent.id, experiences: list };
        }
        if (route.endsWith('/queue')) {
          queueReads += 1;
          if (pendingQueueReq) return pendingQueueReq.promise;
          return undefined;
        }
        if (route.includes('/entry-control') && options.method === 'GET') {
          if (entryMode === 'deferred') {
            const d = deferred();
            pendingEntryReqs.push(d);
            return d.promise;
          }
          if (entryMode === 'err500') return { statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } };
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
    assert.equal(queueReads, 1, 'leitura de fila iniciada antes do retorno ao painel');
    assert.ok(app.hasText('Estação real'));
    await app.press('Voltar ao painel');
    await app.act(async () => {
      pendingQueueReq.resolve({ statusCode: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
    });
    pendingQueueReq = null;
    assert.ok(app.hasText('Just Dance'), '404 de fila abandonada não limpa painel');
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // 2. R3-02: na subtela Controle de Entrada, GET A pendente (403) + refresh manual GET B (500) propaga perda de acesso ao painel
    await app.press('Controle de Entrada');
    entryMode = 'deferred';
    await app.tickTimers(5000);
    assert.equal(pendingEntryReqs.length, 1, 'o polling inicia o GET A');
    await app.press('Atualizar fila de entrada');
    assert.equal(pendingEntryReqs.length, 2);

    await app.act(async () => {
      pendingEntryReqs[0].resolve({ statusCode: 403, body: { code: 'STAFF_EVENT_FORBIDDEN' } });
    });
    await app.act(async () => {
      pendingEntryReqs[1].resolve({ statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } });
    });
    assert.ok(app.hasText('Acesso ao evento indisponível'));

    await app.press('Voltar ao painel');
    assert.ok(app.hasText('SEM ACESSO'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // 3. R3-01: revalidação parcial (200 em stations, 200 em experiences, 500 em entry-control) mantém bloqueio mas reabilita botão "Atualizar estações"
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
    failNextExperienceRead = true;
    const readsBeforeOrphan = experienceReads;
    await app.tickTimers(5000);
    // Primeira tentativa automática falhou com erro de rede, então ainda exibe Experiência não vinculada
    assert.equal(experienceReads, readsBeforeOrphan + 1);
    assert.ok(app.hasText('Experiência não vinculada'));

    // Próximo ciclo de 5s reexecuta pollExperiences() para a mesma assinatura e encontra Beat Saber
    await app.tickTimers(5000);
    assert.equal(experienceReads, readsBeforeOrphan + 2);
    assert.ok(app.hasText('Beat Saber'));
    assert.ok(!app.hasText('Experiência não vinculada'));
    assert.equal(app.hasButton('Selecionar estação Estação Nova da experiência Beat Saber'), true);
  } finally {
    pendingQueueReq?.resolve({ statusCode: 500 });
    for (const request of pendingEntryReqs) request.resolve({ statusCode: 500 });
    app.dispose();
  }
});

test('STAFF-02: estados A e B da Estação, fila compartilhada, proteção a duplo toque, conclusão, ausência (reinserção e corte), indisponibilidade e negativa 403 propagada', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const secure = new Map();
  const opKey = `arenago.staff.operation.${staffUser.id.toLowerCase()}`;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const secondStation = {
    id: '55555555-5555-4555-8555-555555555555',
    experienceId: realExperienceId,
    label: 'Estação 02',
    availability: 'unavailable',
    pendingServiceSessionId: null,
    pendingCalledAt: null,
  };
  const primaryStation = {
    ...realStation,
    label: 'Estação Alpha',
    availability: 'available',
    pendingServiceSessionId: null,
    pendingCalledAt: null,
  };
  const entryA = '77777777-7777-4777-8777-777777777771';
  const entryB = '77777777-7777-4777-8777-777777777772';
  const entryC = '77777777-7777-4777-8777-777777777773';
  const entryRequeued = '77777777-7777-4777-8777-777777777779';
  const sessionA = '88888888-8888-4888-8888-888888888881';
  const sessionB = '88888888-8888-4888-8888-888888888882';
  const sessionC = '88888888-8888-4888-8888-888888888883';

  let waiting = [
    { queueEntryId: entryA, displayName: 'Mariana Costa', position: 1 },
    { queueEntryId: entryB, displayName: 'Lucas Ferreira', position: 2 },
    { queueEntryId: entryC, displayName: 'Rafael Oliveira', position: 3 },
  ];
  let pendingCall = null;
  let requeueOnAbsent = true;
  let denyOperational = false;
  let pendingCallDeferred = null;
  const posts = [];
  const postLog = [];

  const syncStations = () => [
    {
      ...primaryStation,
      pendingServiceSessionId: pendingCall?.serviceSessionId ?? null,
      pendingCalledAt: pendingCall?.calledAt ?? null,
    },
    secondStation,
  ];
  const makeOperational = (stationObj) => {
    const isPrimary = stationObj.id === primaryStation.id;
    const activePending = isPrimary ? pendingCall : null;
    const isAvailable = stationObj.availability === 'available';
    return {
      eventId: staffEvent.id,
      experienceId: realExperienceId,
      stationId: stationObj.id,
      availability: stationObj.availability,
      canCall: isAvailable && !activePending && waiting.length > 0,
      waitingCount: waiting.length,
      waiting: waiting.map((row, idx) => ({ ...row, position: idx + 1 })),
      pending: activePending,
    };
  };

  const control = {
    realStaff: true,
    manualTimers: true,
    platformOS: 'ios',
    events: [{ ...staffEvent, name: 'Torneio Real UNDB' }],
    experiences: [{ id: realExperienceId, name: 'Just Dance Pro' }],
    secureStore: {
      isAvailableAsync: async () => true,
      getItemAsync: async (k) => secure.get(k) ?? null,
      setItemAsync: async (k, v) => { secure.set(k, v); },
      deleteItemAsync: async (k) => { secure.delete(k); },
    },
    http: async (route, options) => {
      if (route.endsWith('/stations')) return { eventId: staffEvent.id, stations: syncStations() };
      if (route.endsWith('/queue')) {
        return {
          eventId: staffEvent.id,
          experienceId: realExperienceId,
          observedAt: '2026-11-10T15:00:00.000Z',
          waitingCount: waiting.length,
          acceptingNewEntries: true,
          canCallWaitingEntries: waiting.length > 0,
          firstWaitingQueueEntryId: waiting[0]?.queueEntryId ?? null,
        };
      }
      if (route.endsWith('/operational-state')) {
        if (denyOperational) return { statusCode: 403, body: { code: 'STAFF_EVENT_FORBIDDEN' } };
        const st = route.includes(secondStation.id) ? secondStation : primaryStation;
        return makeOperational(st);
      }
      if (options.method === 'POST' && route.endsWith('/call-next')) {
        posts.push('call-next');
        postLog.push({ route, idempotencyKey: options.headers?.['Idempotency-Key'] ?? null });
        if (pendingCallDeferred) {
          const d = pendingCallDeferred;
          pendingCallDeferred = null;
          await d.promise;
        }
        const next = waiting.shift();
        const sid = posts.length === 1 ? sessionA : posts.length === 3 ? sessionB : sessionC;
        pendingCall = {
          serviceSessionId: sid,
          queueEntryId: next.queueEntryId,
          displayName: next.displayName,
          calledAt: new Date(Date.now() - 23_000).toISOString(),
        };
        return {
          statusCode: 201,
          body: {
            serviceSession: {
              id: sid,
              queueEntryId: next.queueEntryId,
              experienceId: realExperienceId,
              station: { id: primaryStation.id, label: primaryStation.label },
              status: 'pending',
              calledAt: pendingCall.calledAt,
            },
          },
        };
      }
      if (options.method === 'POST' && route.endsWith('/complete')) {
        posts.push('complete');
        postLog.push({ route, idempotencyKey: options.headers?.['Idempotency-Key'] ?? null });
        const sid = pendingCall.serviceSessionId;
        pendingCall = null;
        return {
          body: {
            serviceSession: { id: sid, status: 'completed', resolvedAt: new Date().toISOString() },
            queueEntry: { status: 'closed', closeReason: 'completed' },
            participation: { status: 'active', currentQueueEntryId: null },
          },
        };
      }
      if (options.method === 'POST' && route.endsWith('/absent')) {
        posts.push('absent');
        postLog.push({ route, idempotencyKey: options.headers?.['Idempotency-Key'] ?? null });
        const prev = pendingCall;
        pendingCall = null;
        if (requeueOnAbsent) {
          waiting.push({ queueEntryId: entryRequeued, displayName: prev.displayName, position: waiting.length + 1 });
          return {
            body: {
              serviceSession: { id: prev.serviceSessionId, status: 'absent' },
              previousQueueEntry: { id: prev.queueEntryId, status: 'closed', closeReason: 'absent' },
              requeued: true,
              newQueueEntry: { id: entryRequeued, status: 'waiting', queueOrder: '4', position: waiting.length },
            },
          };
        }
        return {
          body: {
            serviceSession: { id: prev.serviceSessionId, status: 'absent' },
            previousQueueEntry: { id: prev.queueEntryId, status: 'closed', closeReason: 'absent' },
            requeued: false,
            newQueueEntry: null,
          },
        };
      }
      return undefined;
    },
  };

  const app = createIntegration({ initialUser: staffUser, control });
  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Torneio Real UNDB');
    await app.press('Selecionar estação Estação Alpha da experiência Just Dance Pro');

    // Estado A: estação disponível com fila FIFO real e sem valores fictícios dos mockups
    assert.ok(app.hasExactText('Estação Alpha'));
    assert.ok(app.hasExactText('DISPONÍVEL'));
    assert.equal(app.hasExactText('INDISPONÍVEL'), false);
    assert.ok(app.hasExactText('Just Dance Pro'));
    assert.ok(app.hasExactText('Torneio Real UNDB'));
    assert.ok(!app.hasText('Street Fighter'), 'não usa nome fixo do mockup');
    assert.ok(!app.hasText('BEAST Arena'), 'não usa evento fixo do mockup');
    assert.ok(app.hasExactText('FILA DA EXPERIÊNCIA'));
    assert.ok(app.hasExactText('3 aguardando'));
    assert.ok(app.hasQueueRow(1, 'Mariana Costa'));
    assert.ok(app.hasQueueRow(2, 'Lucas Ferreira'));
    assert.ok(app.hasQueueRow(3, 'Rafael Oliveira'));
    assert.ok(app.hasText('Fila compartilhada entre as estações'));
    assert.ok(app.hasExactText('ATENDIMENTO ATUAL'));
    assert.ok(app.hasExactText('Nenhum participante chamado'));
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));
    assert.equal(app.isDisabled('Chamar próximo'), false);
    assert.equal(app.hasButton('Atualizar fila'), false, 'sem botão duplicado de atualizar');
    assert.equal(app.hasButton('Voltar ao painel'), true);

    // Transição A -> B com duplo toque bloqueado em voo e limpeza de recibo após ack no SecureStore
    pendingCallDeferred = deferred();
    let callPromise;
    await app.act(async () => {
      const tap = app.handler('Chamar próximo');
      callPromise = Promise.all([tap(), tap()]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(posts.length, 1, 'duplo toque não envia segundo POST');
    assert.equal(app.isDisabled('Chamar próximo'), true);
    assert.equal(JSON.parse(secure.get(opKey)).phase, 'dispatching');
    await app.act(async () => {
      pendingCallDeferred.resolve();
      await callPromise;
    });
    assert.equal(secure.get(opKey) ?? null, null, 'intenção principal removida após ack');
    assert.equal(secure.get(`${opKey}.receipt`) ?? null, null);
    assert.equal(secure.get(`${opKey}.ack`) ?? null, null);

    assert.ok(app.hasExactText('Mariana Costa'));
    assert.ok(app.hasExactText('Em atendimento'));
    assert.ok(app.hasText('Chamado há 00:'));
    assert.ok(app.hasExactText('2 aguardando'));
    assert.ok(app.hasQueueRow(1, 'Lucas Ferreira'));
    assert.ok(app.hasQueueRow(2, 'Rafael Oliveira'));
    assert.equal(app.hasButton('Chamar próximo'), false, 'não exibe Chamar próximo durante atendimento pendente');
    assert.ok(app.hasButton('Concluir experiência'));
    assert.ok(app.hasButton('Marcar ausência'));
    assert.ok(app.hasButton('Remover da fila'));

    // Concluir experiência exige confirmação e libera estação para Estado A
    await app.press('Concluir experiência');
    assert.equal(app.modal().props.visible, true);
    await app.press('CONFIRMAR OPERAÇÃO');
    assert.ok(app.hasText('Operação confirmada pelo servidor.'));
    assert.ok(app.hasExactText('Nenhum participante chamado'));
    assert.equal(app.isDisabled('Chamar próximo'), false);

    // Chamar próximo (Lucas Ferreira) e Marcar ausência com reinserção no fim da fila
    await app.press('Chamar próximo');
    assert.ok(app.hasExactText('Lucas Ferreira'));
    assert.ok(app.hasExactText('Em atendimento'));
    requeueOnAbsent = true;
    await app.press('Marcar ausência');
    await app.press('CONFIRMAR OPERAÇÃO');
    assert.ok(app.hasText('Ausência registrada; participante retornou ao fim da fila.'));
    assert.ok(app.hasExactText('2 aguardando'));
    assert.ok(app.hasQueueRow(1, 'Rafael Oliveira'));
    assert.ok(app.hasQueueRow(2, 'Lucas Ferreira'));

    // Chamar próximo (Rafael Oliveira) e Marcar ausência após corte (sem reinserção)
    await app.press('Chamar próximo');
    requeueOnAbsent = false;
    await app.press('Marcar ausência');
    await app.press('CONFIRMAR OPERAÇÃO');
    assert.ok(app.hasText('Ausência registrada; participante não retornou à fila após o corte.'));
    assert.ok(app.hasExactText('1 aguardando'));
    assert.ok(app.hasQueueRow(1, 'Lucas Ferreira'));

    // Segunda estação da mesma experiência (INDISPONÍVEL) compartilha a mesma fila e bloqueia Chamar próximo
    await app.press('Voltar ao painel');
    await app.press('Selecionar estação Estação 02 da experiência Just Dance Pro');
    assert.ok(app.hasExactText('Estação 02'));
    assert.ok(app.hasExactText('INDISPONÍVEL'));
    assert.equal(app.hasExactText('DISPONÍVEL'), false);
    assert.ok(app.hasExactText('1 aguardando'));
    assert.ok(app.hasQueueRow(1, 'Lucas Ferreira'));
    assert.equal(app.isDisabled('Chamar próximo'), true);

    // Negativa 403 em /operational-state limpa dados nominais e propaga bloqueio ao painel
    denyOperational = true;
    await app.tickTimers(5000);
    assert.ok(!app.hasText('Lucas Ferreira'));
    assert.ok(!app.hasText('Atualização'));
    assert.ok(app.hasText('Acesso ao evento ou à experiência indisponível'));
    await app.press('Voltar ao painel');
    assert.ok(app.hasExactText('SEM ACESSO'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    assert.deepEqual(posts, ['call-next', 'complete', 'call-next', 'absent', 'call-next', 'absent']);
    assert.equal(postLog.length, 6);
    assert.equal(postLog[0].route, `/staff/events/${staffEvent.id}/experiences/${realExperienceId}/stations/${primaryStation.id}/call-next`);
    assert.equal(postLog[1].route, `/staff/events/${staffEvent.id}/service-sessions/${sessionA}/complete`);
    assert.equal(postLog[3].route, `/staff/events/${staffEvent.id}/service-sessions/${sessionB}/absent`);
    assert.equal(postLog[5].route, `/staff/events/${staffEvent.id}/service-sessions/${sessionC}/absent`);
    assert.ok(postLog.every((entry) => uuidRe.test(entry.idempotencyKey)), 'toda mutação envia Idempotency-Key UUID');
  } finally {
    pendingCallDeferred?.resolve();
    app.dispose();
  }
});

test('STAFF02-AUD-01: 404 contextual em operational-state protege cache nominal ao voltar ao painel, cobre casos A/B/C, invalida modal e preserva SecureStore', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const event1 = { ...staffEvent, id: staffEvent.id, name: 'Torneio Primário' };
  const event2 = { ...staffEvent, id: '66666666-6666-4666-8666-666666666666', name: 'Torneio Secundário' };
  const exp1 = { id: realExperienceId, name: 'Just Dance Pro' };
  const station1 = { ...realStation, id: realStation.id, label: 'Estação Alpha', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };
  const station2 = { ...realStation, id: '55555555-5555-4555-8555-555555555556', label: 'Estação Secundária', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };
  const secure = new Map();
  const opKey = `arenago.staff.operation.${staffUser.id.toLowerCase()}`;
  let deleteCalls = 0;
  let postCount = 0;
  let station1Label = 'Estação Alpha';
  let operational404 = false;
  let verifyDeferred = null;
  let panelExpDeferred = null;
  let stations500 = false;
  let stations404 = false;
  let stations401 = false;
  let panelEntry500 = false;

  const entryWaiting = [
    {
      participationId: '12121212-1212-4121-8121-121212121211',
      displayName: 'Fila Entrada Um',
      position: 1,
    },
    {
      participationId: '12121212-1212-4121-8121-121212121212',
      displayName: 'Fila Entrada Dois',
      position: 2,
    },
  ];

  const entryNominal = (eventId) => {
    const pendingCall = eventId === event1.id ? {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      participationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      displayName: 'JulianaEntrada',
      calledAt: '2026-11-10T14:58:00.000Z',
    } : null;
    const hasPending = Boolean(pendingCall);
    return {
      eventId,
      externalQueueEnabled: true,
      canManage: true,
      observedAt: '2026-11-10T15:00:00.000Z',
      pendingCall,
      canCall: !hasPending,
      canConfirm: hasPending,
      canMarkAbsent: hasPending,
      canRemove: hasPending,
      waitingCount: entryWaiting.length,
      waiting: entryWaiting,
    };
  };

  const operationalPayload = (eventId, st) => ({
    eventId,
    experienceId: exp1.id,
    stationId: st.id,
    availability: 'available',
    canCall: false,
    waitingCount: 1,
    waiting: [{ queueEntryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', displayName: 'PedroFila', position: 1 }],
    pending: {
      serviceSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      queueEntryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      displayName: 'LucasCalled',
      calledAt: new Date(Date.now() - 10_000).toISOString(),
    },
  });

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      platformOS: 'ios',
      events: [event1, event2],
      experiences: [exp1],
      secureStore: {
        isAvailableAsync: async () => true,
        getItemAsync: async (k) => secure.get(k) ?? null,
        setItemAsync: async (k, v) => { secure.set(k, v); },
        deleteItemAsync: async (k) => { deleteCalls += 1; secure.delete(k); },
      },
      http: async (route, options) => {
        if (options.method === 'POST' && !route.startsWith('/auth/')) {
          postCount += 1;
          return { statusCode: 500, body: { code: 'UNEXPECTED_POST' } };
        }
        if (route === `/staff/events/${event1.id}/stations`) {
          if (verifyDeferred) {
            const d = verifyDeferred;
            verifyDeferred = null;
            return d.promise;
          }
          if (stations401) return { statusCode: 401, body: { code: 'SESSION_REVOKED' } };
          if (stations404) return { statusCode: 404, body: { code: 'RESOURCE_NOT_FOUND' } };
          if (stations500) return { statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } };
          return { eventId: event1.id, stations: [{ ...station1, label: station1Label }] };
        }
        if (route === `/staff/events/${event2.id}/stations`) {
          return { eventId: event2.id, stations: [station2] };
        }
        if (route === `/staff/events/${event1.id}/experiences` && panelExpDeferred) {
          const d = panelExpDeferred;
          panelExpDeferred = null;
          return d.promise;
        }
        if (route.endsWith('/entry-control')) {
          if (panelEntry500 && route.includes(event1.id)) {
            return { statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } };
          }
          return entryNominal(route.includes(event2.id) ? event2.id : event1.id);
        }
        if (route.endsWith('/queue')) {
          const eid = route.includes(event2.id) ? event2.id : event1.id;
          return {
            eventId: eid,
            experienceId: exp1.id,
            observedAt: '2026-11-10T15:00:00.000Z',
            waitingCount: 1,
            acceptingNewEntries: true,
            canCallWaitingEntries: true,
            firstWaitingQueueEntryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          };
        }
        if (route.endsWith('/operational-state')) {
          if (route.includes(event1.id) && operational404) {
            return { statusCode: 404, body: { code: 'RESOURCE_NOT_FOUND' } };
          }
          const eid = route.includes(event2.id) ? event2.id : event1.id;
          const st = route.includes(event2.id) ? station2 : { ...station1, label: station1Label };
          return operationalPayload(eid, st);
        }
        return undefined;
      },
    },
  });

  try {
    await app.mount();
    await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
    await app.press('Selecionar evento Torneio Primário');
    assert.ok(app.hasText('Chamada pendente: JulianaEntrada · 2 aguardando'));
    assert.equal(app.metricValueFor('Fila externa'), '2');
    assert.ok(app.hasText('Estação Alpha'));
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // Abre estação e abre modal de confirmação antes de receber 404 em polling
    await app.press('Selecionar estação Estação Alpha da experiência Just Dance Pro');
    assert.ok(app.hasExactText('LucasCalled'));
    assert.ok(app.hasQueueRow(1, 'PedroFila'));
    await app.press('Concluir experiência');
    assert.equal(app.modal().props.visible, true);
    const staleConfirm = app.buttonProps('CONFIRMAR OPERAÇÃO').onPress;

    operational404 = true;
    verifyDeferred = deferred();
    await app.tickTimers(5000);
    assert.ok(!app.hasText('LucasCalled'));
    assert.ok(!app.hasText('PedroFila'));
    assert.ok(app.modals().every((m) => !m.props.visible), '404 fecha modal aberto');
    assert.ok(app.hasText('Verificando acesso à estação...'));
    await app.act(async () => { await staleConfirm(); });
    assert.equal(postCount, 0, 'callback antigo de confirmação não envia POST após 404');

    // Retorna ao Painel antes do retorno de GET /stations -> cache nominal não reaparece
    await app.press('Voltar ao painel');
    assert.ok(!app.hasText('JulianaEntrada'), 'nome em cache da entrada não vaza durante verificação');
    assert.ok(!app.hasText('Estação Alpha'));
    assert.ok(app.hasText('Verificando acesso ao evento...'));
    assert.ok(app.hasExactText('VERIFICANDO'));
    assert.equal(app.metricValueFor('Estações ativas'), '—');
    assert.equal(app.metricValueFor('Em atendimento'), '—');
    assert.equal(app.metricValueFor('Fila externa'), '—');
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    assert.equal(app.isDisabled('Atualizar estações'), true);

    // Caso A (200 no fallback): não publica lista de verificação direto no Painel e reabre com nova rodada limpa
    station1Label = 'Estação Recuperada';
    panelExpDeferred = deferred();
    await app.act(async () => {
      verifyDeferred.resolve({ eventId: event1.id, stations: [{ ...station1, label: 'Estação Só Verificação', pendingCalledAt: null }] });
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.ok(!app.hasText('Estação Só Verificação'), 'fallback 200 não publica stations direto na UI');
    assert.ok(!app.hasText('JulianaEntrada'));
    await app.act(async () => {
      panelExpDeferred.resolve({ eventId: event1.id, experiences: [exp1] });
    });
    assert.ok(app.hasText('Estação Recuperada'));
    assert.ok(app.hasText('JulianaEntrada'));
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // Caso C (500 em fallback): oculta dados nominais, bloqueia exposição parcial e recupera via Atualizar estações
    operational404 = true;
    stations500 = true;
    await app.press('Selecionar estação Estação Recuperada da experiência Just Dance Pro');
    assert.ok(!app.hasText('LucasCalled'));
    assert.ok(app.hasText('Não foi possível consultar a estação.'));
    assert.ok(app.hasText('Atualização indisponível · aguardando recuperação'));

    stations500 = false;
    panelEntry500 = true;
    await app.press('Voltar ao painel');
    assert.ok(!app.hasText('JulianaEntrada'), 'erro parcial em revalidação mantém ocultação nominal');
    assert.ok(!app.hasText('Estação Recuperada'));
    assert.ok(app.hasExactText('INDISPONÍVEL'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);
    assert.equal(app.isDisabled('Atualizar estações'), false);

    panelEntry500 = false;
    await app.press('Atualizar estações');
    assert.ok(app.hasText('Estação Recuperada'));
    assert.ok(app.hasText('JulianaEntrada'));
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // Troca de evento enquanto verificação está pendente descarta negativa tardia do evento anterior
    verifyDeferred = deferred();
    await app.press('Selecionar estação Estação Recuperada da experiência Just Dance Pro');
    await app.press('Voltar ao painel');
    await app.press('Voltar aos eventos');
    await app.press('Selecionar evento Torneio Secundário');
    await app.act(async () => {
      verifyDeferred.resolve({ statusCode: 403, body: { code: 'STAFF_EVENT_FORBIDDEN' } });
    });
    assert.ok(app.hasText('Estação Secundária'));
    assert.equal(app.hasExactText('SEM ACESSO'), false);
    assert.equal(app.isDisabled('Controle de Entrada'), false);

    // Caso B (404 em fallback) + preservação de intenção pendente no SecureStore
    await app.press('Voltar aos eventos');
    operational404 = false;
    await app.press('Selecionar evento Torneio Primário');
    assert.ok(app.hasText('Estação Recuperada'));
    const otherIntent = {
      key: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: staffUser.id,
      sessionId: staffUser.sessionId,
      eventId: event2.id,
      stationId: station2.id,
      experienceId: exp1.id,
      serviceSessionId: null,
      kind: 'call',
      phase: 'reserved',
    };
    secure.set(opKey, JSON.stringify(otherIntent));
    operational404 = true;
    stations404 = true;
    await app.press('Selecionar estação Estação Recuperada da experiência Just Dance Pro');
    assert.ok(!app.hasText('LucasCalled'));
    assert.ok(app.hasText('Acesso à estação indisponível.'));
    assert.ok(!app.hasText('Atualização'));
    assert.equal(deleteCalls, 0, '404 não apaga intenção persistida no SecureStore');
    assert.equal(JSON.parse(secure.get(opKey)).eventId, event2.id);
    await app.press('Voltar ao painel');
    assert.ok(app.hasExactText('SEM ACESSO'));
    assert.ok(!app.hasText('JulianaEntrada'));
    assert.equal(app.isDisabled('Controle de Entrada'), true);

    // Caso B (401 no fallback): invalida sessão com segurança e remove UI Staff
    await app.press('Voltar aos eventos');
    operational404 = false;
    stations404 = false;
    await app.press('Selecionar evento Torneio Primário');
    operational404 = true;
    stations401 = true;
    await app.press('Selecionar estação Estação Recuperada da experiência Just Dance Pro');
    assert.equal(app.route(), 'Login');
    assert.equal(app.manager.getSnapshot().isAuthenticated, false);
    assert.ok(!app.hasText('JulianaEntrada'));
    assert.equal(postCount, 0);
  } finally {
    verifyDeferred?.resolve({ statusCode: 500 });
    panelExpDeferred?.resolve({ statusCode: 500 });
    app.dispose();
  }
});

test('STAFF02-AUD-02: saída rápida (A -> Painel e A -> Painel -> B) descarta atualização pós-operação em voo e preserva fila da Estação B', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const expA = { id: '31111111-1111-4111-8111-111111111111', name: 'Exp Alpha' };
  const expB = { id: '32222222-2222-4222-8222-222222222222', name: 'Exp Beta' };
  const stationA = { id: '41111111-1111-4111-8111-111111111111', experienceId: expA.id, label: 'Estação A', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };
  const stationB = { id: '42222222-2222-4222-8222-222222222222', experienceId: expB.id, label: 'Estação B', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };
  const secure = new Map();
  let queueAReads = 0;
  let queueBReads = 0;
  let waitingA = [{ queueEntryId: '77777777-7777-4777-8777-777777777701', displayName: 'Alice A', position: 1 }];
  let pendingA = null;
  let deferNextStationsPoll = false;
  let stationsPollDeferred = null;

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      platformOS: 'android',
      events: [staffEvent],
      experiences: [expA, expB],
      secureStore: {
        isAvailableAsync: async () => true,
        getItemAsync: async (k) => secure.get(k) ?? null,
        setItemAsync: async (k, v) => { secure.set(k, v); },
        deleteItemAsync: async (k) => { secure.delete(k); },
      },
      http: async (route, options) => {
        if (route.endsWith('/stations')) {
          if (deferNextStationsPoll) {
            deferNextStationsPoll = false;
            stationsPollDeferred = deferred();
            return stationsPollDeferred.promise;
          }
          return {
            eventId: staffEvent.id,
            stations: [
              {
                ...stationA,
                pendingServiceSessionId: pendingA?.serviceSessionId ?? null,
                pendingCalledAt: pendingA?.calledAt ?? null,
              },
              stationB,
            ],
          };
        }
        if (route.includes(expA.id) && route.endsWith('/queue')) {
          queueAReads += 1;
          return {
            eventId: staffEvent.id,
            experienceId: expA.id,
            observedAt: '2026-11-10T15:00:00.000Z',
            waitingCount: waitingA.length,
            acceptingNewEntries: true,
            canCallWaitingEntries: waitingA.length > 0,
            firstWaitingQueueEntryId: waitingA[0]?.queueEntryId ?? null,
          };
        }
        if (route.includes(expB.id) && route.endsWith('/queue')) {
          queueBReads += 1;
          return {
            eventId: staffEvent.id,
            experienceId: expB.id,
            observedAt: '2026-11-10T15:00:00.000Z',
            waitingCount: 1,
            acceptingNewEntries: true,
            canCallWaitingEntries: true,
            firstWaitingQueueEntryId: '77777777-7777-4777-8777-777777777702',
          };
        }
        if (route.includes(stationA.id) && route.endsWith('/operational-state')) {
          return {
            eventId: staffEvent.id,
            experienceId: expA.id,
            stationId: stationA.id,
            availability: 'available',
            canCall: !pendingA && waitingA.length > 0,
            waitingCount: waitingA.length,
            waiting: waitingA.map((row, idx) => ({ ...row, position: idx + 1 })),
            pending: pendingA,
          };
        }
        if (route.includes(stationB.id) && route.endsWith('/operational-state')) {
          return {
            eventId: staffEvent.id,
            experienceId: expB.id,
            stationId: stationB.id,
            availability: 'available',
            canCall: true,
            waitingCount: 1,
            waiting: [{ queueEntryId: '77777777-7777-4777-8777-777777777702', displayName: 'Beatriz B', position: 1 }],
            pending: null,
          };
        }
        if (options.method === 'POST' && route.endsWith('/call-next')) {
          const next = waitingA.shift();
          pendingA = {
            serviceSessionId: '88888888-8888-4888-8888-888888888801',
            queueEntryId: next.queueEntryId,
            displayName: next.displayName,
            calledAt: new Date(Date.now() - 5000).toISOString(),
          };
          deferNextStationsPoll = true;
          return {
            statusCode: 201,
            body: {
              serviceSession: {
                id: pendingA.serviceSessionId,
                queueEntryId: next.queueEntryId,
                experienceId: expA.id,
                station: { id: stationA.id, label: stationA.label },
                status: 'pending',
                calledAt: pendingA.calledAt,
              },
            },
          };
        }
        if (options.method === 'POST' && route.endsWith('/complete')) {
          const sid = pendingA.serviceSessionId;
          pendingA = null;
          deferNextStationsPoll = true;
          return {
            body: {
              serviceSession: { id: sid, status: 'completed', resolvedAt: new Date().toISOString() },
              queueEntry: { status: 'closed', closeReason: 'completed' },
              participation: { status: 'active', currentQueueEntryId: null },
            },
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

    // Fluxo A -> Painel com onChanged().pollStations() ainda em voo
    await app.press('Selecionar estação Estação A da experiência Exp Alpha');
    await app.press('Chamar próximo');
    assert.ok(stationsPollDeferred, 'onChanged aguardando pollStations de A');
    const queueABeforeReturn = queueAReads;
    await app.press('Voltar ao painel');
    await app.act(async () => {
      stationsPollDeferred.resolve({ eventId: staffEvent.id, stations: [stationA, stationB] });
      stationsPollDeferred = null;
    });
    assert.equal(queueAReads, queueABeforeReturn, 'A -> Painel descarta pollQueue tardio da experiência A');

    // Fluxo A -> Painel -> B com onChanged().pollStations() ainda em voo
    await app.press('Selecionar estação Estação A da experiência Exp Alpha');
    await app.press('Concluir experiência');
    await app.press('CONFIRMAR OPERAÇÃO');
    assert.ok(stationsPollDeferred, 'onChanged após conclusão aguardando pollStations de A');
    const queueABeforeSwitch = queueAReads;

    await app.press('Voltar ao painel');
    await app.press('Selecionar estação Estação B da experiência Exp Beta');
    assert.ok(app.hasExactText('Estação B'));
    assert.ok(app.hasQueueRow(1, 'Beatriz B'));
    assert.equal(queueBReads >= 1, true);

    await app.act(async () => {
      stationsPollDeferred.resolve({ eventId: staffEvent.id, stations: [stationA, stationB] });
      stationsPollDeferred = null;
    });
    assert.equal(queueAReads, queueABeforeSwitch, 'A -> Painel -> B não dispara pollQueue residual para Exp A');
    assert.ok(app.hasExactText('Estação B'));
    assert.ok(app.hasQueueRow(1, 'Beatriz B'));
    assert.ok(app.hasExactText('1 aguardando'));
  } finally {
    stationsPollDeferred?.resolve({ eventId: staffEvent.id, stations: [stationA, stationB] });
    app.dispose();
  }
});

test('STAFF02-AUD-05 + AUD-06: indicador de polling espelha modal, foco, AppState e erro transitório, testa Remover da fila e bloqueio em erro incerto', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const secure = new Map();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const station = { ...realStation, label: 'Estação Pulso', availability: 'available', pendingServiceSessionId: null };
  let operationalReads = 0;
  let operationalMode = 'ok';
  let callShouldNetworkFail = false;
  let postLog = [];
  let waiting = [{ queueEntryId: '77777777-7777-4777-8777-777777777711', displayName: 'Carla Nogueira', position: 1 }];
  let pendingCall = null;

  const app = createIntegration({
    initialUser: staffUser,
    control: {
      realStaff: true,
      manualTimers: true,
      platformOS: 'android',
      events: [staffEvent],
      experiences: [{ id: realExperienceId, name: 'Ritmo Live' }],
      secureStore: {
        isAvailableAsync: async () => true,
        getItemAsync: async (k) => secure.get(k) ?? null,
        setItemAsync: async (k, v) => { secure.set(k, v); },
        deleteItemAsync: async (k) => { secure.delete(k); },
      },
      http: async (route, options) => {
        if (route.endsWith('/stations')) {
          return {
            eventId: staffEvent.id,
            stations: [{
              ...station,
              pendingServiceSessionId: pendingCall?.serviceSessionId ?? null,
              pendingCalledAt: pendingCall?.calledAt ?? null,
            }],
          };
        }
        if (route.endsWith('/queue')) {
          return {
            eventId: staffEvent.id,
            experienceId: realExperienceId,
            observedAt: '2026-11-10T15:00:00.000Z',
            waitingCount: waiting.length,
            acceptingNewEntries: true,
            canCallWaitingEntries: waiting.length > 0,
            firstWaitingQueueEntryId: waiting[0]?.queueEntryId ?? null,
          };
        }
        if (route.endsWith('/operational-state')) {
          operationalReads += 1;
          if (operationalMode === '500') return { statusCode: 500, body: { code: 'INTERNAL_SERVER_ERROR' } };
          if (operationalMode === '403') return { statusCode: 403, body: { code: 'STAFF_EVENT_FORBIDDEN' } };
          return {
            eventId: staffEvent.id,
            experienceId: realExperienceId,
            stationId: station.id,
            availability: 'available',
            canCall: !pendingCall && waiting.length > 0,
            waitingCount: waiting.length,
            waiting: waiting.map((row, idx) => ({ ...row, position: idx + 1 })),
            pending: pendingCall,
          };
        }
        if (options.method === 'POST' && route.endsWith('/call-next')) {
          postLog.push({ route, idempotencyKey: options.headers?.['Idempotency-Key'] ?? null });
          if (callShouldNetworkFail) throw new Error('offline');
          const next = waiting.shift();
          pendingCall = {
            serviceSessionId: '88888888-8888-4888-8888-888888888811',
            queueEntryId: next.queueEntryId,
            displayName: next.displayName,
            calledAt: new Date(Date.now() - 8000).toISOString(),
          };
          return {
            statusCode: 201,
            body: {
              serviceSession: {
                id: pendingCall.serviceSessionId,
                queueEntryId: next.queueEntryId,
                experienceId: realExperienceId,
                station: { id: station.id, label: station.label },
                status: 'pending',
                calledAt: pendingCall.calledAt,
              },
            },
          };
        }
        if (options.method === 'POST' && route.endsWith('/remove')) {
          postLog.push({ route, idempotencyKey: options.headers?.['Idempotency-Key'] ?? null });
          const sid = pendingCall.serviceSessionId;
          pendingCall = null;
          return {
            body: {
              serviceSession: { id: sid, status: 'canceled', cancelReason: 'staff_queue_removed', resolvedAt: new Date().toISOString() },
              queueEntry: { status: 'closed', closeReason: 'staff_queue_removed' },
              participation: { status: 'active', currentQueueEntryId: null },
            },
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
    await app.press('Selecionar estação Estação Pulso da experiência Ritmo Live');

    assert.equal(operationalReads, 1);
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));
    await app.tickTimers(5000);
    assert.equal(operationalReads, 2);

    // Remover da fila + pausa de polling durante modal aberto
    await app.press('Chamar próximo');
    assert.ok(app.hasExactText('Carla Nogueira'));
    await app.press('Remover da fila');
    assert.equal(app.modal().props.visible, true);
    assert.ok(app.hasExactText('Atualização temporariamente pausada'));
    assert.equal(app.hasText('Atualização automática ativa'), false);
    const readsDuringModal = operationalReads;
    await app.tickTimers(5000);
    assert.equal(operationalReads, readsDuringModal, 'modal aberto pausa polling de operational-state');

    await app.press('CONFIRMAR OPERAÇÃO');
    assert.ok(app.hasText('Operação confirmada pelo servidor.'));
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));
    assert.equal(postLog[1].route, `/staff/events/${staffEvent.id}/service-sessions/88888888-8888-4888-8888-888888888811/remove`);
    assert.ok(uuidRe.test(postLog[1].idempotencyKey));

    // Perda de foco e segundo plano pausam polling; retomada reativa
    await app.setFocus(false);
    assert.ok(app.hasExactText('Atualização temporariamente pausada'));
    const readsBeforeBlur = operationalReads;
    await app.tickTimers(5000);
    assert.equal(operationalReads, readsBeforeBlur);

    await app.setFocus(true);
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));
    await app.tickTimers(5000);
    assert.equal(operationalReads, readsBeforeBlur + 1);

    await app.setAppState('background');
    assert.ok(app.hasExactText('Atualização temporariamente pausada'));
    const readsBeforeBg = operationalReads;
    await app.tickTimers(5000);
    assert.equal(operationalReads, readsBeforeBg);

    await app.setAppState('active');
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));
    await app.tickTimers(5000);
    assert.equal(operationalReads, readsBeforeBg + 1);

    // Erro transitório em polling sinaliza dados desatualizados e recupera ao voltar 200
    operationalMode = '500';
    await app.tickTimers(5000);
    assert.ok(app.hasExactText('Dados desatualizados · tentando atualizar a cada 5s'));
    operationalMode = 'ok';
    await app.tickTimers(5000);
    assert.ok(app.hasExactText('Atualização automática ativa · a cada 5s'));

    // Erro de rede durante mutação coloca estado incerto bloqueando repetição sem POST duplicado
    waiting = [{ queueEntryId: '77777777-7777-4777-8777-777777777712', displayName: 'Diego Costa', position: 1 }];
    await app.press('Atualizar atendimento');
    callShouldNetworkFail = true;
    await app.press('Chamar próximo');
    assert.ok(app.hasText('O resultado exige verificação ou reconciliação. Não repita a operação.'));
    assert.equal(app.isDisabled('Chamar próximo'), true);
    assert.equal(postLog.length, 3);

    // Negativa 403 em polling oculta totalmente o indicador de polling
    operationalMode = '403';
    await app.tickTimers(5000);
    assert.ok(!app.hasText('Atualização'));
    assert.ok(app.hasText('Acesso ao evento ou à experiência indisponível'));
  } finally {
    app.dispose();
  }
});
