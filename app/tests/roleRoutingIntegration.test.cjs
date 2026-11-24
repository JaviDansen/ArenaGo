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
} catch (cause) {
  throw new Error('Falha ao carregar o harness obrigatório de roteamento. Confira as dependências em qa/regression (npm ci).', { cause });
}

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
  const passthrough = ({ children }) => children;
  const native = Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'RefreshControl', 'ScrollView', 'Switch', 'Text', 'TextInput', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
  native.AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
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
      if (name === '@react-navigation/native') return { useIsFocused: () => true, usePreventRemove: Navigation.usePreventRemove, NavigationContainer: ({ children }) =>
        React.createElement(Navigation.BaseNavigationContainer, { ref: navRef, onUnhandledAction: (action) => unhandled.push(action) }, children) };
      const target = path.posix.normalize(path.posix.join(directory, name));
      if (target === 'assets/images/logo-arenago.png' || target === 'assets/images/logo-arenago-admin.png') return { uri: target };
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
        ['services/adminEventsService', 'services/adminEventSetupService', 'services/adminEventOperationService'].includes(target))) {
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
  const { createAuthSessionManager } = load('services/authService.js');
  const manager = createAuthSessionManager({ client, tokenStorage: storage });
  const Gate = load('screens/auth/AuthSessionGate.js').default;
  const { AppNavigation } = load('App.js');
  let tree;
  return {
    manager, calls, unhandled,
    setUser(value) { user = value; },
    async mount() { await Renderer.act(async () => { tree = Renderer.create(React.createElement(Gate,
      { sessionManager: manager }, React.createElement(AppNavigation))); }); },
    async replaceProvider(nextUser) {
      user = nextUser;
      token = 'refresh-replacement';
      const nextManager = createAuthSessionManager({ client, tokenStorage: storage });
      await Renderer.act(async () => {
        tree.update(React.createElement(Gate, { key: 'replacement', sessionManager: nextManager },
          React.createElement(AppNavigation)));
      });
      return nextManager;
    },
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
    textsInView(testID) {
      const views = tree.root.findAllByType('View').filter(node => node.props.testID === testID);
      assert.equal(views.length, 1, testID);
      return views[0].findAllByType('Text').map(node => String(node.props.children));
    },
    async press(label) {
      const buttons = tree.root.findAllByType('Pressable').filter((node) => node.props.accessibilityLabel === label);
      assert.equal(buttons.length, 1, `botão ${label}`);
      await Renderer.act(async () => { await buttons[0].props.onPress(); });
    },
    modal() { return tree.root.findByType('Modal'); },
    hasButton(label) { return tree.root.findAllByType('Pressable').some(node => node.props.accessibilityLabel === label); },
    buttonProps(label) {
      const buttons = tree.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel === label);
      assert.equal(buttons.length, 1, `botão ${label}`);
      return buttons[0].props;
    },
    scrollContainingButton(label) {
      let node = tree.root.findAllByType('Pressable').find(button => button.props.accessibilityLabel === label);
      while (node && node.type !== 'ScrollView') node = node.parent;
      return node;
    },
    async activateButton(label) {
      const props = this.buttonProps(label);
      if (!props.disabled) await Renderer.act(async () => { await props.onPress?.(); });
    },
    handler(label) { return tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label).props.onPress; },
    confirmHandler() { return tree.root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'CONFIRMAR').props.onPress; },
    dispose() { Renderer.act(() => tree.unmount()); },
  };
}

function staffMember(grant, email, eligible = true, name = 'Pessoa Staff') {
  return { grantId: grant.id, userId: grant.userId, name, email, grantedAt: grant.grantedAt, eligible };
}

test('ADMIN-06: gestão e wizard recuperam operações Staff nos dois sentidos e preservam o rascunho no retorno', async () => {
  const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
  const eventId = id(1), path = '/admin/events/' + eventId, email = 'staff@example.test';
  const at = '2090-11-01T00:00:00Z', writes = [];
  const grant = { id: id(2), userId: id(3), eventId, role: 'staff', grantedAt: at, revokedAt: null };
  const event = { id: eventId, name: 'Evento Staff', timezone: 'UTC', accessCode: 'STAFF', startsAt: at,
    officialEndsAt: '2090-11-02T00:00:00Z', operationalDeadlineAt: '2090-11-02T00:00:00Z',
    effectivePhase: 'scheduled', readiness: { ready: false }, externalQueueEnabled: false };
  let eligible = false, unavailable = false;
  const applied = new Map(), replays = [];
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: {
    realAdmin: true, http: async (route, options) => {
      if (!route.startsWith('/admin/')) return undefined;
      if (route === '/admin/events') return { items: [event], nextCursor: null };
      if (route === path) return { event };
      if (route === path + '/experiences') return { eventId, items: [] };
      if (route === path + '/staff') return { eventId, items: eligible ? [staffMember(grant, email)] : [] };
      if (route === path + '/readiness') {
        if (unavailable) return { statusCode: 503, body: {} };
        return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled', acceptingNewParticipations: false,
          ready: false, missing: ['EXPERIENCE_WITH_AVAILABLE_STATION', ...(eligible ? [] : ['VERIFIED_ACTIVE_STAFF'])],
          checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
            hasExperienceWithAvailableStation: false, hasVerifiedActiveStaff: eligible } };
      }
      assert.ok(['/admin/roles/grant', '/admin/roles/revoke'].includes(route));
      assert.equal(options.method, 'POST');
      const key = options.headers['Idempotency-Key'];
      assert.ok(key);
      const request = { route, key, body: options.body };
      writes.push(request);
      if (applied.has(key)) {
        const previous = applied.get(key);
        assert.deepEqual(request, previous.request);
        replays.push(key);
        return previous.response;
      }
      eligible = route.endsWith('/grant');
      const response = { statusCode: eligible ? 201 : 200, body: { grant: eligible ? grant : { ...grant, revokedAt: at } } };
      applied.set(key, { request, response });
      throw new Error('Resposta perdida após aplicação');
    },
  } });
  await app.mount();
  try {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Evento Staff');
    await app.press('Configuração pendente');
    unavailable = true;
    await app.press('Consultar Equipe Staff');
    assert.ok(app.hasText('Prontidão Staff indisponível.'));
    unavailable = false;
    await app.press('Tentar novamente');
    await app.input('E-mail do usuário', email);
    app.back();
    assert.ok(app.hasText('Descartar e-mail não enviado?'));
    await app.press('Cancelar');
    assert.equal(app.inputValue('E-mail do usuário'), email);
    await app.press('Conceder Staff');
    assert.equal(writes.length, 0);
    await app.press('Confirmar concessão');
    assert.ok(app.hasText('Resultado incerto'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    const previousRetry = app.handler('Repetir concessão para ' + email);
    await app.press('Voltar ao painel');
    await app.press('Descartar alterações');
    await app.press('Continuar configuração');
    await app.press('Continuar');
    assert.ok(app.hasText('O evento tem Staff elegível.'));
    assert.equal(writes.length, 1);
    const retryFromSetup = app.handler('Repetir concessão para ' + email);
    await app.act(async () => { retryFromSetup(); previousRetry(); retryFromSetup(); });
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    await app.press('Revogar acesso de ' + email);
    await app.press('Revogar acesso');
    assert.ok(app.hasText('Resultado incerto'));
    await app.act(async () => app.back());
    await app.press('Equipe Staff');
    assert.ok(app.hasText('O evento ainda precisa de Staff elegível.'));
    assert.equal(writes.length, 3);
    unavailable = true;
    await app.press('Repetir revogação para ' + email);
    assert.deepEqual(writes[3], writes[2]);
    assert.equal(writes.length, 4);
    assert.equal(applied.size, 2);
    assert.deepEqual(replays, [writes[0].key, writes[2].key]);
    assert.ok(app.hasText('Prontidão Staff indisponível.'));
    assert.deepEqual(JSON.parse(writes[3].body), { grantId: grant.id });
    assert.ok(app.hasText('Revogação confirmada.'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    assert.equal(app.hasButton('Revogar acesso de ' + email), false);
  } finally { app.dispose(); }
});

const participant = { id: 'a', name: 'A', email: 'a@example.test', emailVerified: true,
  sessionId: '10000000-0000-4000-8000-000000000001',
  roles: ['participante'], hasCompletedQuestionnaire: true };

const adminUser = { ...participant, roles: ['admin', 'staff', 'participante'], hasCompletedQuestionnaire: false };

const operationAt = '2090-11-23T13:00:00.000000Z';
function operationView(n, overrides = {}) {
  return { eventId: 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0'), name: 'Arena Operação ' + n,
    timezone: 'America/Sao_Paulo', effectivePhase: 'open', observedAt: operationAt, startsAt: '2090-11-23T12:00:00Z',
    officialEndsAt: '2090-11-23T13:40:00Z', operationalDeadlineAt: '2090-11-23T13:55:00Z',
    closureMode: null, closureRequestedAt: null, adminDeadlineAt: null, externalQueueEnabled: true, activeParticipants: 0,
    externalWaitingParticipants: 3, canSetExternalQueue: true, canClose: true, ...overrides };
}
function operationHarness(views, onWrite, onRead = view => view, onPanelRead = (_, response) => response) {
  const writes = [], reads = [], panelReads = [];
  const eventFrom = view => ({ ...view, id: view.eventId, readiness: { ready: true } });
  const readiness = view => ({
    eventId: view.eventId, effectivePhase: view.effectivePhase,
    statusStored: ['closed', 'closing', 'open'].includes(view.effectivePhase) ? view.effectivePhase : 'scheduled',
    ready: true, missing: [], observedAt: view.observedAt, acceptingNewParticipations: view.canSetExternalQueue,
    checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
      hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: true },
  });
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    async http(route, options) {
      if (route === '/admin/events') return { items: views.filter(v => v.effectivePhase !== 'closed').map(eventFrom), nextCursor: null };
      const view = views.find(v => route === '/admin/events/' + v.eventId || route.startsWith('/admin/events/' + v.eventId + '/'));
      if (!view) return undefined;
      const path = '/admin/events/' + view.eventId;
      if (route === path || route === path + '/readiness') {
        panelReads.push(route);
        return onPanelRead(route, route === path ? { event: eventFrom(view) } : readiness(view));
      }
      if (route === path + '/operation') {
        assert.equal(options.method, 'GET');
        assert.ok(options.headers.Authorization);
        reads.push(view.eventId);
        return onRead(view);
      }
      assert.ok(['/external-queue', '/close'].some(suffix => route === path + suffix));
      const mutation = { route, method: options.method, body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] };
      assert.ok(mutation.key);
      writes.push(mutation);
      return onWrite(view, mutation);
    },
  } });
  return { app, writes, reads, panelReads, async enter(view) {
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento ' + view.name);
    await app.press('Operação do evento');
  } };
}

function pendingPanelClosure({ onPanelRead, mode = 'immediate' } = {}) {
  const a = operationView(1), b = operationView(2), write = deferred();
  const rig = operationHarness([a, b], () => write.promise, undefined, onPanelRead);
  const path = '/admin/events/' + a.eventId;
  return {
    ...rig, a, b, write,
    readsFor: view => rig.panelReads.filter(route => ['/admin/events/' + view.eventId, '/admin/events/' + view.eventId + '/readiness'].includes(route)),
    async confirm() {
      await rig.enter(a);
      await rig.app.press(mode === 'immediate' ? 'Encerrar imediatamente' : 'Encerramento controlado');
      await rig.app.input('Justificativa', 'Encerrar a operação');
      if (mode === 'controlled') {
        await rig.app.input('Data de encerramento', '23/11/2090');
        await rig.app.input('Hora de encerramento', '10:30');
      }
      await rig.app.press('Revisar operação');
      await rig.app.press('Confirmar operação');
      assert.equal(rig.writes.length, 1);
      assert.equal(rig.writes[0].route, path + '/close');
      assert.equal(rig.writes[0].method, 'POST');
    },
    async finish() {
      const deadline = mode === 'controlled' ? '2090-11-23T13:30:00.000000Z' : operationAt;
      await rig.app.act(async () => {
        Object.assign(a, { effectivePhase: mode === 'controlled' ? 'closing' : 'closed', closureMode: mode,
          closureRequestedAt: operationAt, adminDeadlineAt: deadline, canClose: false, canSetExternalQueue: false });
        write.resolve({ eventId: a.eventId, closureMode: mode, status: a.effectivePhase, newEntriesClosedAt: operationAt,
          effectiveOperationalDeadlineAt: deadline, externalWaitingFinalized: 3 });
      });
    },
  };
}

test('F1-R01: fechamento confirmado após voltar atualiza o painel com uma única escrita', async () => {
  const rig = pendingPanelClosure();
  const { app, a, writes } = rig;
  await app.mount();
  try {
    await rig.confirm();
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.ok(app.hasText('Aberto'));
    const before = rig.readsFor(a);
    assert.equal(before.length, 4);
    await rig.finish();
    assert.deepEqual(rig.readsFor(a), [...before, ...before.slice(-2)]);
    assert.ok(app.hasText('Encerrado'));
    assert.ok(!app.hasText('Aberto'));
    assert.equal(writes.length, 1);
  } finally { app.dispose(); }
});

test('F1-R02: revogar o último Staff após voltar atualiza a prontidão oficial', async () => {
  const write = deferred(), at = operationAt, email = 'ultimo-staff@example.test';
  const rig = structureIntegration({ initialStation: true, write: () => write.promise });
  const { app, db, requests } = rig;
  const grant = { id: operationView(21).eventId, userId: operationView(22).eventId,
    eventId: rig.path.split('/').at(-1), role: 'staff', grantedAt: at, revokedAt: null };
  db.roster = [staffMember(grant, email)];
  const panelReads = () => requests.filter(({ method, route }) =>
    method === 'GET' && [rig.path, rig.path + '/readiness'].includes(route)).map(({ route }) => route);
  await app.mount();
  try {
    await rig.openPanel();
    await app.press('Equipe Staff');
    await app.press('Revogar acesso de ' + email);
    await app.press('Revogar acesso');
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.ok(app.hasText('Pronto para operar'));
    const before = panelReads();
    assert.equal(before.length, 6);
    await app.act(async () => {
      db.roster = [];
      db.eligibleStaff = false;
      write.resolve({ grant: { ...grant, revokedAt: at } });
    });
    assert.deepEqual(panelReads(), [...before, rig.path, rig.path + '/readiness']);
    assert.ok(app.hasButton('Configuração pendente'));
    assert.ok(!app.hasText('Pronto para operar'));
    await app.press('Configuração pendente');
    assert.ok(app.hasText('Autorize pelo menos um integrante Staff ativo'));
    const writes = requests.filter(({ route, method }) => route.startsWith('/admin/') && method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].route, '/admin/roles/revoke');
    assert.equal(writes[0].method, 'POST');
    assert.deepEqual(JSON.parse(writes[0].body), { grantId: grant.id });
    assert.ok(writes[0].key);
  } finally { app.dispose(); }
});

test('F1-R03: detalhe e prontidão anteriores não substituem a leitura posterior', async () => {
  const held = new Map();
  let hold = false;
  const rig = pendingPanelClosure({ onPanelRead(route, response) {
    if (!hold) return response;
    const pending = deferred();
    held.set(route, { ...pending, response });
    return pending.promise;
  } });
  const { app, a, writes } = rig;
  await app.mount();
  try {
    await rig.confirm();
    hold = true;
    await app.press('Voltar ao painel');
    assert.equal(held.size, 2);
    assert.ok(app.hasText('Carregando evento...'));
    hold = false;
    // Marca o detalhe novo independentemente do selo, que usa a prontidão.
    a.name = 'Nome da leitura mais recente';
    await rig.finish();
    assert.equal(rig.readsFor(a).length, 6);
    assert.ok(app.hasText(a.name));
    assert.ok(app.hasText('Encerrado'));
    await app.act(async () => {
      for (const pending of held.values()) pending.resolve(pending.response);
    });
    assert.ok(app.hasText(a.name));
    assert.ok(app.hasText('Encerrado'));
    assert.ok(!app.hasText('Arena Operação 1'));
    assert.ok(!app.hasText('Aberto'));
    assert.equal(rig.readsFor(a).length, 6);
    assert.equal(writes.length, 1);
  } finally {
    for (const pending of held.values()) pending.resolve(pending.response);
    app.dispose();
  }
});

for (const replaceSession of [false, true]) {
  test(replaceSession ? 'F1-R05: sessão substituída ignora conclusão antiga para o mesmo UUID' :
    'F1-R04/R08: conclusão de A não recarrega B e A lê o estado ao remontar', async () => {
    const rig = pendingPanelClosure({ mode: 'controlled' });
    const { app, a, b, writes } = rig;
    await app.mount();
    try {
      await rig.confirm();
      if (replaceSession) {
        await app.replaceProvider({ ...adminUser, id: 'admin-f1', sessionId: operationView(93).eventId });
        await app.press('Gerenciar eventos');
        await app.press('Acessar evento ' + a.name);
      } else {
        await app.press('Voltar ao painel');
        await app.press('Voltar aos eventos');
        await app.press('Acessar evento ' + b.name);
      }
      const displayed = replaceSession ? a : b;
      const before = [...rig.panelReads];
      await rig.finish();
      assert.deepEqual(rig.panelReads, before);
      assert.ok(app.hasText(displayed.name));
      assert.ok(app.hasText('Aberto'));
      assert.ok(!app.hasText('Encerrando'));
      if (!replaceSession) {
        await app.press('Voltar aos eventos');
        await app.press('Acessar evento ' + a.name);
        assert.deepEqual(rig.panelReads, [...before, '/admin/events/' + a.eventId, '/admin/events/' + a.eventId + '/readiness']);
        assert.ok(app.hasText('Encerrando'));
      }
      assert.equal(writes.length, 1);
    } finally { app.dispose(); }
  });
}

for (const ambiguous of [true, false]) {
  test('F1-R06: ' + (ambiguous ? 'resultado incerto preserva a intenção' : 'recusa definitiva libera a ação'), async () => {
    const rig = pendingPanelClosure();
    const { app, a, write, writes } = rig;
    await app.mount();
    try {
      await rig.confirm();
      await app.press('Voltar ao painel');
      const before = [...rig.panelReads];
      await app.act(async () => {
        if (ambiguous) write.reject(new Error('Resposta indisponível'));
        else write.resolve({ statusCode: 409, body: { code: 'EVENT_ALREADY_CLOSED' } });
      });
      assert.deepEqual(rig.panelReads, before);
      assert.ok(app.hasText('Aberto'));
      await app.press('Operação do evento');
      assert.equal(app.hasButton('Reenviar a mesma solicitação'), ambiguous);
      assert.equal(app.hasText('Resultado ainda não confirmado'), ambiguous);
      assert.equal(app.hasText('Operação recusada'), !ambiguous);
      assert.ok(!app.hasText('Resposta confirmada'));
      assert.equal(writes.length, 1);
      assert.equal(rig.readsFor(a).length, 4);
    } finally { app.dispose(); }
  });
}

test('F1-R07/R08: conclusão fora de foco conserva uma única leitura no retorno', async () => {
  const rig = pendingPanelClosure();
  const { app, a, writes } = rig;
  await app.mount();
  try {
    await rig.confirm();
    assert.equal(rig.readsFor(a).length, 2);
    await rig.finish();
    assert.ok(app.hasText('Resposta confirmada'));
    assert.equal(rig.readsFor(a).length, 2);
    await app.press('Voltar ao painel');
    assert.ok(app.hasText('Encerrado'));
    assert.equal(rig.readsFor(a).length, 4);
    assert.equal(writes.length, 1);
  } finally { app.dispose(); }
});

test('ADMIN-07 navega para o evento selecionado, valida justificativa, cancela e reconsulta após alternar a fila', async () => {
  const a = operationView(1), b = operationView(2);
  const { app, writes, reads, enter } = operationHarness([a, b], (view, request) => {
    assert.equal(view, b);
    assert.equal(request.method, 'PATCH');
    const releasedCount = request.body.enabled ? 0 : view.externalWaitingParticipants;
    view.externalQueueEnabled = request.body.enabled;
    view.activeParticipants += releasedCount;
    view.externalWaitingParticipants -= releasedCount;
    return { eventId: view.eventId, externalQueueEnabled: view.externalQueueEnabled, releasedCount, changedAt: operationAt };
  });
  await app.mount();
  try {
    await enter(b);
    assert.deepEqual(reads, [b.eventId]);
    assert.ok(app.hasText('PAINEL DO EVENTO'));
    assert.ok(app.hasText(b.name));
    assert.deepEqual(app.textsInView('operation-phase'), ['Aberto']);
    assert.ok(app.hasText('Pronto para operar'));
    assert.deepEqual(app.textsInView('operation-active'), ['0', 'Participantes ativos']);
    assert.deepEqual(app.textsInView('operation-waiting'), ['3', 'Na fila externa']);
    assert.deepEqual(app.textsInView('operation-queue-state'), ['ATIVA']);
    for (const label of ['Home', 'Histórico', 'BI']) assert.equal(app.buttonProps(label).accessibilityRole, 'tab');
    assert.equal(app.hasButton('Sair da conta'), false);
    const operationScroll = app.scrollContainingButton('Desativar fila externa');
    assert.ok(operationScroll);
    assert.equal(app.scrollContainingButton('Encerrar imediatamente'), operationScroll);
    assert.equal(app.scrollContainingButton('Encerramento controlado'), operationScroll);
    assert.equal(app.hasText(a.name), false);
    await app.press('Desativar fila externa');
    await app.press('Revisar operação');
    assert.ok(app.hasText('Informe uma justificativa'));
    await app.input('Justificativa', 'Acesso direto para a Arena');
    await app.press('Revisar operação');
    assert.ok(app.hasText('Confirmar: Desativar fila externa?'));
    await app.press('Voltar à edição');
    await app.press('Cancelar operação');
    assert.equal(writes.length, 0);
    await app.press('Desativar fila externa');
    await app.input('Justificativa', 'Acesso direto para a Arena');
    await app.press('Revisar operação');
    const confirm = app.handler('Confirmar operação');
    await app.act(async () => { confirm(); confirm(); });
    assert.deepEqual(writes.map(w => w.body), [{ enabled: false, reason: 'Acesso direto para a Arena' }]);
    assert.ok(app.hasText('Pessoas liberadas: 3'));
    assert.deepEqual(app.textsInView('operation-active'), ['3', 'Participantes ativos']);
    assert.deepEqual(app.textsInView('operation-waiting'), ['0', 'Na fila externa']);
    assert.deepEqual(app.textsInView('operation-queue-state'), ['INATIVA']);
    await app.press('Ativar fila externa');
    await app.input('Justificativa', 'Organizar próximos ingressos');
    await app.press('Revisar operação');
    await app.press('Confirmar operação');
    assert.equal(writes.length, 2);
    assert.notEqual(writes[0].key, writes[1].key);
    assert.deepEqual(app.textsInView('operation-queue-state'), ['ATIVA']);
    assert.deepEqual(app.textsInView('operation-active'), ['3', 'Participantes ativos']);
    assert.deepEqual(reads, [b.eventId, b.eventId, b.eventId]);
  } finally { app.dispose(); }
});

test('ADMIN-07 perda de resposta exige reenvio explícito após reentrada, mesmo com fila já desativada', async () => {
  const view = operationView(1);
  let attempts = 0;
  const { app, writes, enter } = operationHarness([view], () => {
    if (++attempts === 1) {
      Object.assign(view, { externalQueueEnabled: false, activeParticipants: 3, externalWaitingParticipants: 0 });
      throw Object.assign(new Error('Resposta indisponível'), { name: 'AbortError' });
    }
    return { eventId: view.eventId, externalQueueEnabled: false, releasedCount: 3, changedAt: operationAt };
  });
  await app.mount();
  try {
    await enter(view);
    await app.press('Desativar fila externa');
    await app.input('Justificativa', 'Liberar entrada');
    await app.press('Revisar operação');
    await app.press('Confirmar operação');
    assert.ok(app.hasText('Resultado ainda não confirmado'));
    assert.deepEqual(app.textsInView('operation-queue-state'), ['INATIVA']);
    assert.equal(app.hasText('Resposta confirmada'), false);
    await app.press('Voltar ao painel');
    await app.press('Operação do evento');
    assert.equal(writes.length, 1);
    assert.equal(app.hasButton('Ativar fila externa'), false);
    await app.press('Reenviar a mesma solicitação');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    assert.ok(app.hasText('Resposta confirmada'));
  } finally { app.dispose(); }
});

test('ADMIN-07 recusa definitiva no reenvio libera nova revisão após expirar o prazo controlado', async () => {
  const view = operationView(1);
  let attempts = 0;
  const { app, writes, reads, enter } = operationHarness([view], () => {
    attempts++;
    if (attempts === 1) {
      view.observedAt = '2090-11-23T13:31:00.000000Z';
      throw Object.assign(new Error('Resposta indisponível'), { name: 'AbortError' });
    }
    assert.equal(attempts, 2);
    return { statusCode: 409, body: { code: 'CLOSURE_DEADLINE_INVALID' } };
  });
  await app.mount();
  try {
    await enter(view);
    async function reviewAt(time) {
      await app.press('Encerramento controlado');
      await app.input('Justificativa', 'Encerrar a operação');
      await app.input('Data de encerramento', '23/11/2090');
      await app.input('Hora de encerramento', time);
      await app.press('Revisar operação');
      assert.ok(app.hasButton('Confirmar operação'));
    }
    await reviewAt('10:30');
    assert.equal(writes.length, 0);
    await app.press('Confirmar operação');
    assert.equal(writes.length, 1);
    assert.deepEqual(reads, [view.eventId, view.eventId]);
    assert.ok(app.hasText('Resultado ainda não confirmado'));
    assert.equal(app.hasText('Resposta confirmada'), false);
    assert.equal(app.hasButton('Encerramento controlado'), false);
    await app.press('Reenviar a mesma solicitação');
    assert.deepEqual(writes, [writes[0], writes[0]]);
    assert.deepEqual(reads, [view.eventId, view.eventId, view.eventId]);
    assert.ok(app.hasText('Operação recusada'));
    assert.ok(app.hasText('O prazo solicitado não está dentro dos limites atuais.'));
    assert.equal(app.hasText('Resultado ainda não confirmado'), false);
    assert.equal(app.hasText('Resposta confirmada'), false);
    assert.equal(app.hasButton('Reenviar a mesma solicitação'), false);
    await reviewAt('10:35');
    assert.equal(writes.length, 2);
  } finally { app.dispose(); }
});

for (const mode of ['immediate', 'controlled']) {
  test('ADMIN-07 confirma o encerramento ' + mode + ' e lê do servidor o estado posterior', async () => {
    const view = operationView(1);
    const controlled = mode === 'controlled';
    const { app, writes, enter } = operationHarness([view], (_, request) => {
      assert.equal(request.method, 'POST');
      assert.ok(request.route.endsWith('/close'));
      const deadline = controlled ? '2090-11-23T13:30:00.000000Z' : operationAt;
      Object.assign(view, { closureMode: mode, closureRequestedAt: operationAt, adminDeadlineAt: deadline,
        effectivePhase: controlled ? 'closing' : 'closed', canClose: false, canSetExternalQueue: false, externalWaitingParticipants: 0 });
      return { eventId: view.eventId, closureMode: mode, status: view.effectivePhase, newEntriesClosedAt: operationAt,
        effectiveOperationalDeadlineAt: deadline, externalWaitingFinalized: 3 };
    });
    await app.mount();
    try {
      await enter(view);
      assert.ok(app.hasText('Ambas as opções de encerramento exigem justificativa e confirmação.'));
      await app.press(controlled ? 'Encerramento controlado' : 'Encerrar imediatamente');
      await app.input('Justificativa', 'Encerrar a operação');
      if (controlled) {
        await app.input('Data de encerramento', '23/11/2090');
        await app.input('Hora de encerramento', '11:05');
        await app.press('Revisar operação');
        assert.ok(app.hasText('dentro do limite operacional'));
        assert.equal(writes.length, 0);
        await app.input('Hora de encerramento', '10:30');
      }
      await app.press('Revisar operação');
      assert.equal(writes.length, 0);
      await app.press('Confirmar operação');
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].body, { mode, reason: 'Encerrar a operação',
        ...(controlled ? { controlledUntilAt: '2090-11-23T13:30:00.000Z' } : {}) });
      assert.deepEqual(app.textsInView('operation-phase'), [controlled ? 'Encerrando' : 'Encerrado']);
      assert.equal(app.hasText('Pronto para operar'), false);
      assert.ok(app.hasText('Pessoas finalizadas na espera externa: 3'));
      assert.equal(app.hasButton('Encerrar imediatamente'), false);
      assert.equal(app.hasButton('Encerramento controlado'), false);
      assert.equal(app.hasButton('Desativar fila externa'), false);
      if (controlled) {
        assert.ok(app.hasText('Prazo do encerramento controlado'));
        view.effectivePhase = 'closed';
        await app.press('Voltar ao painel');
        await app.press('Operação do evento');
        assert.deepEqual(app.textsInView('operation-phase'), ['Encerrado']);
        assert.equal(writes.length, 1);
      }
    } finally { app.dispose(); }
  });
}

test('ADMIN-07 mostra indisponibilidade, erro de rede e recusa sem apresentar controles', async () => {
  const view = operationView(1, { effectivePhase: 'scheduled', canSetExternalQueue: false, activeParticipants: undefined });
  let stage = 'offline';
  const { app, enter, writes } = operationHarness([view], () => assert.fail('Escrita inesperada'), snapshot => {
    if (stage === 'offline') throw new Error('Sem rede');
    if (stage === 'absent') return { statusCode: 404, body: { code: 'RESOURCE_NOT_FOUND' } };
    if (stage === 'denied') return { statusCode: 403, body: { code: 'ADMIN_REQUIRED' } };
    return snapshot;
  });
  await app.mount();
  try {
    await enter(view);
    assert.ok(app.hasText('Dados operacionais indisponíveis'));
    assert.equal(app.hasButton('Encerrar imediatamente'), false);
    stage = 'absent';
    await app.press('Tentar novamente');
    assert.ok(app.hasText('Evento não encontrado ou indisponível'));
    stage = 'available';
    await app.press('Tentar novamente');
    assert.deepEqual(app.textsInView('operation-phase'), ['Agendado']);
    assert.deepEqual(app.textsInView('operation-active'), ['Indisponível', 'Participantes ativos']);
    assert.deepEqual(app.textsInView('operation-waiting'), ['3', 'Na fila externa']);
    assert.equal(app.hasText('Pronto para operar'), false);
    assert.equal(app.hasButton('Desativar fila externa'), false);
    Object.assign(view, { effectivePhase: 'not_ready', externalQueueEnabled: false });
    await app.press('Atualizar operação');
    assert.deepEqual(app.textsInView('operation-phase'), ['Não pronto']);
    assert.ok(app.hasText('Configuração pendente'));
    assert.equal(app.hasText('Pronto para operar'), false);
    assert.equal(app.hasButton('Ativar fila externa'), false);
    stage = 'denied';
    await app.press('Atualizar operação');
    assert.ok(app.hasText('Sessão sem autorização'));
    assert.equal(app.hasText(view.name), false);
    assert.equal(app.hasButton('Encerrar imediatamente'), false);
    assert.equal(writes.length, 0);
  } finally { app.dispose(); }
});

test('ADMIN-07 separa recibo confirmado de falha posterior na consulta', async () => {
  const view = operationView(1);
  let offline = false;
  const { app, enter, writes } = operationHarness([view], () => {
    offline = true;
    Object.assign(view, { externalQueueEnabled: false, activeParticipants: 3, externalWaitingParticipants: 0 });
    return { eventId: view.eventId, externalQueueEnabled: false, releasedCount: 3, changedAt: operationAt };
  }, current => {
    if (offline) throw new Error('Consulta indisponível após gravação');
    return current;
  });
  await app.mount();
  try {
    await enter(view);
    await app.press('Desativar fila externa');
    await app.input('Justificativa', 'Entrada direta');
    await app.press('Revisar operação');
    await app.press('Confirmar operação');
    assert.ok(app.hasText('Resposta confirmada'));
    assert.ok(app.hasText('Dados operacionais indisponíveis'));
    assert.equal(app.hasButton('Ativar fila externa'), false);
    offline = false;
    await app.press('Tentar novamente');
    assert.deepEqual(app.textsInView('operation-queue-state'), ['INATIVA']);
    assert.equal(writes.length, 1);
  } finally { app.dispose(); }
});

test('ADMIN-07 resposta de escrita tardia não afeta outro evento ou provedor', async () => {
  const a = operationView(1), b = operationView(2), response = deferred();
  const { app, writes, enter } = operationHarness([a, b], () => response.promise);
  await app.mount();
  try {
    await enter(a);
    await app.press('Desativar fila externa');
    await app.input('Justificativa', 'Ação restrita ao evento A');
    await app.press('Revisar operação');
    const obsolete = app.handler('Confirmar operação');
    await app.press('Confirmar operação');
    assert.ok(app.hasText('Operação administrativa em andamento'));
    await app.press('Voltar ao painel');
    await app.press('Voltar aos eventos');
    await app.press('Acessar evento ' + b.name);
    await app.press('Operação do evento');
    assert.ok(app.hasText(b.name));
    assert.equal(app.hasText('Operação administrativa em andamento'), false);
    await app.replaceProvider({ ...adminUser, id: 'admin-replacement', sessionId: '10000000-0000-4000-8000-000000000002' });
    await enter(b);
    await app.act(async () => {
      obsolete();
      response.resolve({ eventId: a.eventId, externalQueueEnabled: false, releasedCount: 3, changedAt: operationAt });
    });
    assert.equal(writes.length, 1);
    assert.ok(app.hasText(b.name));
    assert.equal(app.hasText('Resposta confirmada'), false);
    assert.ok(app.hasButton('Desativar fila externa'));
  } finally { app.dispose(); }
});

test('ADMIN-05: Home e listagem abrem o fluxo, cinco etapas preservam UUID e retomada lê o evento salvo', async () => {
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

test('ADMIN-05: equipe confirma revogação, revisa os checks e conclui um evento pronto ainda agendado', async () => {
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
      if (route === path + '/staff') return { eventId, items: staff ? [staffMember(grant, email)] : [] };
      if (route === path + '/readiness') return { eventId, statusStored: 'scheduled', effectivePhase: 'scheduled',
        acceptingNewParticipations: false, ready: staff, missing: staff ? [] : ['VERIFIED_ACTIVE_STAFF'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: staff } };
      assert.equal(options.method, 'POST');
      if (route === '/admin/roles/grant') {
        assert.deepEqual(JSON.parse(options.body), { role: 'staff', eventId, email });
        assert.equal(staff, false);
        grant.id = 'abcdef00-0000-4000-8000-' + String(10 + revocations).padStart(12, '0');
        staff = true;
        return { statusCode: 201, body: { grant } };
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
    await app.press('Confirmar concessão');
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
    await app.press('Confirmar concessão');
    await app.press('Continuar');
    assert.ok(app.hasText('Experiências: 1 · Estações: 1'));
    assert.ok(app.hasText('Fase: Agendado'));
    await app.press('Concluir configuração');
    assert.ok(app.hasText('Evento criado com sucesso'));
    assert.ok(app.hasText('Pronto para operar'));
    await app.press('Voltar para a Home Admin');
    assert.equal(app.activeRoute(), 'Home');
    await app.press('Gerenciar eventos');
    await app.press('Acessar evento Encontro das oficinas');
    await app.press('Equipe Staff');
    assert.ok(app.hasButton('Revogar acesso de ' + email));
    await app.press('Revogar acesso de ' + email);
    await app.press('Revogar acesso');
    assert.equal(revocations, 2);
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    await app.press('Confirmar concessão');
    await app.press('Voltar ao painel');
    await app.press('Continuar configuração');
    await app.press('Continuar');
    assert.ok(app.hasButton('Revogar acesso de ' + email));
    assert.ok(app.hasText('O evento tem Staff elegível.'));
  } finally { app.dispose(); }
});

test('ADMIN-05: painel pronto oferece retomada de estação salva com resposta perdida na mesma sessão', async () => {
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
  test(`ADMIN-05: confirmação após POST pendente — ${scenario}`, async () => {
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

test('Admin: senha e desafio não abrem painel; TOTP e identidade confirmada abrem Heliom', async () => {
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

test('Admin: restauração válida reutiliza telas, retornos internos e logout real', async () => {
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

test('Admin: painel real retorna à mesma rota da lista e mantém informações no UUID selecionado', async () => {
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
      if (route === detailPath + '/staff') return { eventId, items: [] };
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
    assert.ok(app.hasText('Staff do evento'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    assert.ok(app.hasText('O evento tem Staff elegível.'));
    assert.equal(app.hasButton('Sair da conta'), false);
    assert.equal(readinessReads, 2);
    await app.press('Voltar ao painel');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.equal(readinessReads, 3);
    await app.press('Informações e horários');
    assert.equal(app.activeRoute(), 'AdminEventManagementInfo');
    assert.equal(app.hasButton('Sair da conta'), false);
    for (const text of ['Informações gerais', 'Datas e horários', 'Acesso ao evento', 'ARENA-TESTE']) assert.ok(app.hasText(text));
    assert.equal(readinessReads, 4);
    await app.press('Editar nome');
    await app.input('Nome do evento', 'Alteração não salva');
    await app.press('Voltar ao painel');
    assert.ok(app.hasText('Alterações não salvas'));
    await app.press('Permanecer editando');
    await app.press('Voltar ao painel');
    await app.press('Descartar alterações');
    assert.equal(app.activeRoute(), 'AdminRealEvent');
    assert.equal(readinessReads, 5);
    await app.press('Voltar aos eventos');
    assert.equal(app.activeRoute(), 'AdminEvents');
    await app.press('Acessar evento Evento Selecionado');
    await app.press('BI');
    assert.equal(app.activeRoute(), 'BI');
    assert.ok(app.hasText('Em implementação'));
  } finally { app.dispose(); }
});

test('ADMIN-04: painel abre estrutura por UUID, edita em contexto e reconsulta a prontidão no retorno', async () => {
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
function structureIntegration({ initialStation = false, write, read, me, platformOS = 'web' } = {}) {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const experienceId = 'abcdef00-0000-4000-8000-000000000002';
  const station = { id: 'abcdef00-0000-4000-8000-000000000003', experienceId, label: 'Mesa', availability: 'available',
    pendingServiceSessionId: null };
  const group = { id: experienceId, eventId, name: 'Oficina', stations: initialStation ? [station] : [] };
  const db = { phase: 'scheduled', name: 'Evento de estrutura', eligibleStaff: true, roster: [] };
  const path = '/admin/events/' + eventId;
  const stationPath = path + '/experiences/' + experienceId + '/stations';
  const availabilityPath = '/staff/events/' + eventId + '/stations/' + station.id + '/availability';
  const requests = [];
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    platformOS, me, http: async (route, options) => {
      requests.push({ route, method: options.method, key: options.headers['Idempotency-Key'], body: options.body });
      if (options.method === 'POST' && ['/admin/roles/grant', '/admin/roles/revoke'].includes(route)) return write({ db, route, options });
      if (options.method === 'POST' && route === stationPath) {
        return write ? write({ db, group, station, route, options }) : { statusCode: 201, body: { station } };
      }
      if (options.method === 'PATCH' && route === availabilityPath) return write({ db, group, station, route, options });
      if (options.method !== 'GET') return;
      const override = read?.({ route, path, group, eventId, db });
      if (override) return override;
      const available = group.stations.some(row => row.availability === 'available');
      const ready = available && db.eligibleStaff;
      const event = { id: eventId, name: db.name, accessCode: 'ESTRUTURA', timezone: 'UTC', effectivePhase: db.phase,
        startsAt: '2090-12-01T10:00:00Z', officialEndsAt: '2090-12-01T14:00:00Z', operationalDeadlineAt: '2090-12-01T14:30:00Z',
        externalQueueEnabled: false, readiness: { ready } };
      if (route === '/admin/events') return { items: [event], nextCursor: null };
      if (route === path) return { event };
      if (route === path + '/experiences') return { eventId, items: [group] };
      if (route === path + '/staff') return { eventId, items: db.roster };
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

test('ADMIN-06: equipe persistida reaparece, mostra erro de consulta separado de vazio e permite revogar conta inelegível', async () => {
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const email = 'staff-antigo@example.test';
  const at = '2090-11-01T00:00:00Z';
  const grant = { id: 'abcdef00-0000-4000-8000-000000000051', userId: 'abcdef00-0000-4000-8000-000000000052',
    eventId, role: 'staff', grantedAt: at, revokedAt: null };
  let failRead = false, revocations = 0, revoked = false;
  const finish = deferred(), rosterAfterRevoke = deferred();
  const rig = structureIntegration({
    platformOS: 'ios',
    read({ route, path }) {
      if (route !== path + '/staff') return;
      if (failRead) return { statusCode: 503, body: {} };
      if (revoked) return rosterAfterRevoke.promise;
    },
    async write({ db, route, options }) {
      assert.equal(route, '/admin/roles/revoke');
      assert.deepEqual(JSON.parse(options.body), { grantId: grant.id });
      revocations++;
      await finish.promise;
      db.roster = [];
      revoked = true;
      return { grant: { ...grant, revokedAt: at } };
    },
  });
  const { app } = rig;
  const revokeButton = 'Revogar acesso de ' + email;
  const rosterReads = () => rig.requests.filter(request => request.route === rig.path + '/staff').length;
  rig.db.roster = [staffMember(grant, email, false, 'Staff Antigo')];
  await app.mount();
  try {
    await rig.openPanel();
    assert.equal(rosterReads(), 0);
    await app.press('Equipe Staff');
    assert.equal(rosterReads(), 1);
    assert.ok(app.hasText('Staff Antigo'));
    assert.ok(app.hasText('Vínculo ativo · conta inelegível'));
    assert.ok(!app.hasText('Acesso ativo'));
    assert.ok(!app.hasText('Concessões conhecidas nesta sessão'));
    const scroll = app.scrollContainingButton('Conceder Staff');
    assert.ok(scroll);
    assert.equal(scroll, app.scrollContainingButton(revokeButton));
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
    assert.ok(!app.scrollContainingButton('Home'));
    await app.press('Voltar ao painel');
    assert.equal(rosterReads(), 1);
    failRead = true;
    await app.press('Equipe Staff');
    assert.equal(rosterReads(), 2);
    assert.ok(app.hasText('Não foi possível consultar a equipe Staff.'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    assert.ok(!app.hasText(email));
    failRead = false;
    await app.press('Tentar consultar a equipe novamente');
    assert.ok(app.hasText('Staff Antigo'));
    assert.equal(rosterReads(), 3);
    await app.press(revokeButton);
    assert.equal(revocations, 0);
    await app.press('Revogar acesso');
    assert.equal(app.buttonProps(revokeButton).accessibilityState.busy, true);
    await app.activateButton(revokeButton);
    assert.equal(revocations, 1);
    assert.equal(rosterReads(), 3);
    assert.ok(app.hasText('Staff Antigo'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    await app.act(async () => { finish.resolve(); });
    assert.equal(rosterReads(), 4);
    assert.ok(app.hasText('Atualizando a equipe Staff...'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    await app.act(async () => { rosterAfterRevoke.resolve({ eventId, items: [] }); });
    assert.ok(!app.hasText('Staff Antigo'));
    assert.ok(app.hasText('Revogação confirmada.'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    await app.press('Home');
    assert.equal(app.activeRoute(), 'Home');
    assert.equal(rosterReads(), 4);
  } finally {
    finish.resolve();
    rosterAfterRevoke.resolve({ eventId, items: [] });
    app.dispose();
  }
});

for (const outcome of ['ativo', 'ausente', 'substituído', 'falha recuperável', 'troca de sessão', 'cancelado durante leitura']) {
  test('ADMIN-06: confirmação de revogação durante atualização da equipe — ' + outcome, async () => {
    const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
    const eventId = id(1), at = '2090-11-01T00:00:00Z', email = 'vinculo-antigo@example.test';
    const grant = { id: id(51), userId: id(52), eventId, role: 'staff', grantedAt: at, revokedAt: null };
    const otherGrant = { ...grant, id: id(53), userId: id(54) };
    const replacement = { ...grant, id: id(55) };
    const initialMember = staffMember(grant, email);
    const writeFinished = deferred(), refreshing = deferred(), retry = deferred();
    let hold = null;
    let revocationAttempts = 0;
    const rig = structureIntegration({
      read({ route, path }) {
        if (route !== path + '/staff' || !hold) return;
        const reading = hold;
        hold = null;
        return reading.promise;
      },
      async write({ db, route }) {
        if (route === '/admin/roles/grant') {
          await writeFinished.promise;
          return { statusCode: 201, body: { grant: otherGrant } };
        }
        if (++revocationAttempts === 1) return { statusCode: 503, body: {} };
        db.roster = [];
        const revokedGrant = outcome === 'substituído' ? replacement : grant;
        return { statusCode: 200, body: { grant: { ...revokedGrant, revokedAt: at } } };
      },
    });
    const revokes = () => rig.requests.filter(({ method, route }) => method === 'POST' && route === '/admin/roles/revoke')
      .map(({ body, key }) => ({ body: JSON.parse(body), key }));
    const { app } = rig;
    rig.db.roster = [initialMember];
    await app.mount();
    try {
      await rig.openPanel();
      await app.press('Equipe Staff');
      await app.input('E-mail do usuário', 'outro@example.test');
      await app.press('Conceder Staff');
      await app.press('Confirmar concessão');
      const grants = rig.requests.filter(({ method, route }) => method === 'POST' && route === '/admin/roles/grant');
      assert.deepEqual(grants.map(({ body }) => JSON.parse(body)), [
        { role: 'staff', eventId, email: 'outro@example.test' },
      ]);
      await app.press('Revogar acesso de ' + email);
      const staleConfirm = app.handler('Revogar acesso');
      await app.act(async () => {
        hold = refreshing;
        writeFinished.resolve();
      });
      assert.equal(hold, null);
      assert.ok(app.hasText('Aguarde a verificação do vínculo.'));
      assert.equal(app.buttonProps('Revogar acesso').accessibilityState.disabled, true);
      await app.act(async () => { staleConfirm(); staleConfirm(); });
      assert.deepEqual(revokes(), []);
      assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));

      if (outcome === 'cancelado durante leitura') {
        await app.press('Cancelar');
        assert.ok(!app.hasText('Revogar acesso Staff?'));
        await app.act(async () => { refreshing.resolve({ eventId, items: [initialMember] }); });
        await app.act(async () => { staleConfirm(); });
        assert.ok(!app.hasText('Revogar acesso Staff?'));
        assert.ok(app.hasButton('Revogar acesso de ' + email));
        assert.deepEqual(revokes(), []);
        return;
      }

      if (outcome === 'troca de sessão') {
        rig.db.roster = [];
        await app.replaceProvider({ ...adminUser, id: 'admin-b', email: 'admin-b@example.test', sessionId: id(93) });
        await rig.openPanel();
        await app.press('Equipe Staff');
        await app.act(async () => {
          refreshing.resolve({ eventId, items: [initialMember] });
          staleConfirm();
        });
        assert.deepEqual(revokes(), []);
        assert.ok(!app.hasText(email));
        assert.ok(!app.hasText('Revogar acesso Staff?'));
        assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
        return;
      }

      if (outcome === 'falha recuperável') {
        await app.act(async () => { refreshing.resolve({ statusCode: 503, body: {} }); });
        assert.ok(app.hasText('Não foi possível verificar o vínculo.'));
        assert.ok(app.hasText(email));
        assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
        assert.deepEqual(revokes(), []);
        hold = retry;
        await app.press('Atualizar equipe Staff');
        assert.ok(app.hasText('Aguarde a verificação do vínculo.'));
        await app.act(async () => { retry.resolve({ eventId, items: [initialMember] }); });
      } else {
        const items = outcome === 'ausente' ? [] :
          outcome === 'substituído' ? [staffMember(replacement, email)] : [initialMember];
        await app.act(async () => { refreshing.resolve({ eventId, items }); });
      }
      assert.deepEqual(revokes(), []);
      if (outcome === 'ausente' || outcome === 'substituído') {
        assert.ok(app.hasText('O acesso selecionado já não consta na equipe Staff.'));
        assert.ok(!app.hasText('Revogação confirmada.'));
        await app.act(async () => { staleConfirm(); });
        await app.press('Voltar à equipe');
        assert.ok(!app.hasText('Revogar acesso Staff?'));
        assert.equal(app.hasButton('Revogar acesso de ' + email), outcome === 'substituído');
        assert.deepEqual(revokes(), []);
        if (outcome === 'ausente') return;
        await app.press('Revogar acesso de ' + email);
        assert.ok(app.hasText('Revogar acesso Staff?'));
        await app.act(async () => { staleConfirm(); });
        assert.deepEqual(revokes(), []);
      }
      const confirm = app.handler('Revogar acesso');
      await app.act(async () => { confirm(); confirm(); });
      const attempts = revokes();
      assert.equal(attempts.length, 1);
      const [firstAttempt] = attempts;
      assert.deepEqual(firstAttempt.body, { grantId: outcome === 'substituído' ? replacement.id : grant.id });
      assert.ok(firstAttempt.key);
      assert.ok(app.hasText('Resultado incerto'));
      assert.ok(app.hasButton('Revogar acesso de ' + email));
      await app.press('Repetir revogação para ' + email);
      assert.deepEqual(revokes(), [firstAttempt, firstAttempt]);
      assert.ok(app.hasText('Revogação confirmada.'));
      assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    } finally {
      writeFinished.resolve();
      refreshing.resolve({ eventId, items: [] });
      retry.resolve({ eventId, items: [] });
      app.dispose();
    }
  });
}

test('ADMIN-06: equipe maior mantém formulário e ações nominais na mesma rolagem', async t => {
  const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
  const at = '2090-11-01T00:00:00Z';
  const eventId = id(1);
  const rig = structureIntegration({ platformOS: 'ios', write({ db, route, options }) {
    if (route !== '/admin/roles/revoke') return { statusCode: 500, body: {} };
    const { grantId } = JSON.parse(options.body);
    const member = db.roster.find(item => item.grantId === grantId);
    if (!member) return { statusCode: 404, body: {} };
    db.roster = db.roster.filter(item => item.grantId !== grantId);
    return { statusCode: 200, body: { grant: { id: grantId, userId: member.userId, eventId,
      role: 'staff', grantedAt: member.grantedAt, revokedAt: at } } };
  } });
  const { app } = rig;
  const roster = Array.from({ length: 80 }, (_, i) => staffMember(
    { id: id(100 + i), userId: id(200 + i), grantedAt: at }, 'equipe-' + (i + 1) + '@example.test'));
  rig.db.roster = [...roster];
  const button = member => 'Revogar acesso de ' + member.email;
  const postTrace = requests => requests.filter(({ method }) => method === 'POST').map(({ method, route, body }) => {
    const payload = JSON.parse(body ?? '{}');
    return { method, pathname: '/api/v1' + route, bodyFields: Object.keys(payload),
      ...(route === '/admin/roles/revoke' && { grantId: payload.grantId }) };
  });
  const staffWrites = requests => requests.filter(({ method, route }) =>
    method === 'POST' && (route === '/admin/roles/revoke' || route === '/admin/roles/grant'));
  await app.mount();
  try {
    assert.deepEqual(postTrace(rig.requests), [
      { method: 'POST', pathname: '/api/v1/auth/refresh', bodyFields: ['refreshToken'] },
    ], 'POSTs durante a montagem com credencial persistida');
    await rig.openPanel();
    await app.press('Equipe Staff');
    const scroll = app.scrollContainingButton('Conceder Staff');
    assert.ok(scroll);
    assert.ok(!app.hasText('Acesso ativo'));
    assert.ok(!app.hasText('Vínculo ativo · conta inelegível'));
    for (const member of roster) {
      const label = button(member);
      assert.equal(app.scrollContainingButton(label), scroll);
      const props = app.buttonProps(label);
      assert.equal(props.accessibilityRole, 'button');
      assert.equal(props.accessibilityState.disabled, false);
      assert.ok(props.style({ pressed: false }).some(style => style?.minHeight >= 44));
    }
    const first = roster[0], last = roster.at(-1);
    await app.press(button(last));
    assert.ok(app.hasText(last.email + ' · ' + rig.db.name));
    const beforeCancel = rig.requests.length;
    const postsBeforeCancel = postTrace(rig.requests);
    assert.equal(staffWrites(rig.requests).length, 0,
      `POSTs antes de cancelar: ${JSON.stringify(postsBeforeCancel)}`);
    await app.press('Cancelar');
    const postsAfterCancel = postTrace(rig.requests.slice(beforeCancel));
    t.diagnostic(JSON.stringify({ beforeCancel: { count: postsBeforeCancel.length, posts: postsBeforeCancel },
      afterCancel: { count: postsAfterCancel.length, posts: postsAfterCancel } }));
    assert.equal(staffWrites(rig.requests.slice(beforeCancel)).length, 0,
      `POSTs ao cancelar: ${JSON.stringify(postsAfterCancel)}`);
    assert.ok(!app.hasText('Revogar acesso Staff?'));
    assert.deepEqual(rig.db.roster, roster);
    for (const member of roster) assert.ok(app.hasButton(button(member)));
    const rosterReads = () => rig.requests.filter(({ method, route }) => method === 'GET' && route === rig.path + '/staff');
    assert.equal(rosterReads().length, 1);

    for (const [index, member] of [first, last].entries()) {
      const beforeSelection = rig.requests.length;
      await app.press(button(member));
      assert.ok(app.hasText(member.email + ' · ' + rig.db.name));
      assert.equal(staffWrites(rig.requests.slice(beforeSelection)).length, 0);
      const beforeConfirm = rig.requests.length;
      await app.press('Revogar acesso');
      const writes = staffWrites(rig.requests.slice(beforeConfirm));
      assert.deepEqual(writes.map(({ method, route, body }) => ({ method, route, body: JSON.parse(body) })), [
        { method: 'POST', route: '/admin/roles/revoke', body: { grantId: member.grantId } },
      ]);
      assert.equal(rosterReads().length, 2 + index);
      assert.ok(!app.hasButton(button(member)));
      assert.ok(app.hasButton(button(roster[1])));
      if (member === first) assert.ok(app.hasButton(button(last)));
    }
  } finally { app.dispose(); }
});

test('ADMIN-06: concessão em evento encerrado e resposta tardia após troca de Admin no mesmo cliente', async () => {
  const response = deferred();
  const oldRoster = deferred(), currentRoster = deferred();
  const email = 'anterior@example.test';
  let oldSession = true;
  const h = structureIntegration({ write: () => response.promise,
    read: ({ route, path }) => route === path + '/staff' ? (oldSession ? oldRoster.promise : currentRoster.promise) : undefined });
  const { app, requests, db } = h;
  try {
    await app.mount();
    await h.openPanel();
    db.phase = 'closed';
    await app.press('Equipe Staff');
    assert.ok(app.hasText(db.name));
    assert.ok(!app.hasText('Encerrado'));
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    const oldConfirm = app.handler('Confirmar concessão');
    await app.act(async () => { oldConfirm(); });
    assert.ok(app.hasText('Em andamento'));
    const client = app.manager.client;
    await app.act(() => app.manager.logout());
    const other = { ...adminUser, id: 'admin-b', email: 'b@example.test', sessionId: '20000000-0000-4000-8000-000000000002' };
    app.setUser(other);
    await app.act(() => app.manager.login({ email: other.email, password: 'password' }));
    await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
    oldSession = false;
    db.phase = 'scheduled';
    await h.openPanel();
    await app.press('Equipe Staff');
    assert.ok(app.hasText('Consultando a equipe Staff...'));
    await app.act(async () => {
      response.resolve({ statusCode: 201, body: { grant: { id: 'abcdef00-0000-4000-8000-000000000009',
        eventId: h.path.split('/').at(-1), userId: 'abcdef00-0000-4000-8000-000000000008', role: 'staff',
        grantedAt: '2090-11-01T00:00:00Z', revokedAt: null } } });
      oldRoster.resolve({ eventId: h.path.split('/').at(-1), items: [{
        grantId: 'abcdef00-0000-4000-8000-000000000059', userId: 'abcdef00-0000-4000-8000-000000000058',
        name: 'Dados da sessão anterior', email, grantedAt: '2090-11-01T00:00:00Z', eligible: true,
      }] });
      oldConfirm();
    });
    assert.equal(app.manager.client, client);
    assert.equal(requests.filter(r => r.route === '/admin/roles/grant').length, 1);
    assert.equal(requests.filter(r => r.route === h.path + '/staff').length, 2);
    assert.ok(app.hasText('Consultando a equipe Staff...'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    assert.equal(app.hasText(email), false);
    assert.equal(app.hasText('Concessão confirmada.'), false);
    await app.act(async () => { currentRoster.resolve({ eventId: h.path.split('/').at(-1), items: [] }); });
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
  } finally {
    const empty = { eventId: h.path.split('/').at(-1), items: [] };
    response.resolve({ statusCode: 503, body: {} });
    oldRoster.resolve(empty);
    currentRoster.resolve(empty);
    app.dispose();
  }
});

test('ADMIN-04: recuperação do wizard no painel pronto em closing, recusa do replay e consulta em closed', async () => {
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

test('ADMIN-04: wizard reconhece operação da gestão e retoma com a chave e o corpo originais', async () => {
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

test('ADMIN-04: rascunho protege retorno visual, ação Android e remoção programática da rota', async () => {
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
  test(`ADMIN-04: PATCH tardio no mesmo cliente após ${switchAccount ? 'troca de conta' : 'logout'}`, async () => {
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

test('ADMIN-04: voltar é habilitado após PATCH concluído na mesma sessão', async () => {
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

test('Admin: refresh e troca de conta invalidam logout antigo', async () => {
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

test('Admin: revogação remota retira a área e invalida ações guardadas', async () => {
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

test('Admin: restauração recusada por falta de segundo fator não monta painel', async () => {
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

test('Admin: falha de revogação remota mantém logout local e painel inacessível', async () => {
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

test('integra sessão real, papéis, TOTP, provedores e isolamento da navegação', async () => {
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

test('restauração real mantém questionário obrigatório para participante', async () => {
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

test('401 real no cliente renova, revalida Staff e substitui a navegação', async () => {
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

test('provedores recuperam rotação com falha de gravação sem novo POST', async () => {
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

test('logout durante /me de login deixa navegação pública e descarta resposta', async () => {
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

test('modal protegido fica invisível e callback antigo não executa durante erro de identidade', async () => {
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

test('lista e painel exibem a fase efetiva em vez do status persistido', async () => {
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

test('tela real remove chamado somente após confirmação e atualiza estação sem reenvio', async () => {
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

test('painel real apresenta estações por experiência e abre atendimento diretamente', async () => {
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

test('estação real chama diretamente pelo backend com intenção persistida e sem duplo envio', async () => {
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

test('chamada direta da estação não reenvia após resposta incerta nem após atualizar', async () => {
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

test('chamada direta da estação capturada antes do logout não envia POST', async () => {
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

test('tela da estação recupera reconhecimento automático após exclusão ambígua', async () => {
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

test('painel Staff real exibe estação e fila e limpa os dados ao receber 403', async () => {
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
  assert.equal(app.hasText('Experiência real'), false, 'uma experiência não repete seu título no painel');
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

test('401 recuperável nas estações renova e revalida a sessão Staff', async () => {
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

test('401 terminal nas estações invalida sessão e remove o painel Staff', async () => {
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

test('trocar evento Staff descarta estações e preserva status scheduled e closed', async () => {
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

test('Staff real consulta eventos, seleciona, volta e não aceita rota com ID manual', async () => {
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

test('Staff real trata erro de rede, atualização manual e troca de conta sem reaproveitar seleção', async () => {
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

test('revalidação limpa evento selecionado e revogação Staff remove a pilha real', async () => {
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

test('401 terminal na lista Staff usa o gerenciador real e remove a área protegida', async () => {
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

test('401 recuperável na lista Staff renova sessão e obtém eventos com a identidade revalidada', async () => {
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

test('Controle de Entrada real confirma primeiro, desativa, reativa e volta preservando evento', async () => {
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

test('chamada direta capturada antes do logout não envia operação na sessão seguinte', async () => {
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

test('chamada direta externa mantém intenção incerta e não repete POST após atualização', async () => {
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

test('recusa definitiva da entrada é reconhecida sem toque e preserva feedback', async () => {
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

test('401 terminal no Controle de Entrada remove lista nominal e área Staff', async () => {
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

for (const scenario of ['timeout', 'token expirado', 'resposta tardia', 'logout com novo sessionId']) {
  test('ADMIN-06: continuidade pela autenticação real do app com ' + scenario, async () => {
    const checking = deferred(), identity = deferred(), response = deferred();
    const email = 'renovacao@example.test';
    const successful = { statusCode: 201, body: { grant: { id: 'abcdef00-0000-4000-8000-000000000019',
      userId: 'abcdef00-0000-4000-8000-000000000020', role: 'staff',
      eventId: 'abcdef00-0000-4000-8000-000000000001', grantedAt: '2090-11-01T00:00:00Z', revokedAt: null } } };
    const applied = new Map();
    const replays = [];
    let verifyLater = false, expireRead = false, posts = 0, freshLogin = false;
    const rig = structureIntegration({
      read({ route, path }) {
        if (!expireRead || route !== path + '/readiness') return;
        expireRead = false;
        return { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } };
      },
      me(user) {
        if (!verifyLater) return user;
        checking.resolve();
        return identity.promise;
      },
      async write({ db, options }) {
        const key = options.headers['Idempotency-Key'];
        const attempt = ++posts;
        if (attempt === 1) {
          if (scenario === 'token expirado') return { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } };
          applied.set(key, options.body);
          if (scenario === 'resposta tardia' || scenario === 'logout com novo sessionId') {
            const result = await response.promise;
            if (scenario === 'resposta tardia') db.roster = [staffMember(result.body.grant, email)];
            return result;
          }
          throw new Error('Timeout após aplicar mutação');
        }
        if (applied.has(key)) {
          assert.equal(options.body, applied.get(key));
          replays.push(key);
        } else {
          assert.ok(scenario === 'token expirado' || freshLogin);
          applied.set(key, options.body);
        }
        return successful;
      },
    });
    const { app } = rig;
    const writes = () => rig.requests.filter(item => item.route === '/admin/roles/grant');
    async function openStaff() {
      await rig.openPanel();
      await app.press('Equipe Staff');
    }
    try {
      await app.mount();
      const before = app.manager.getSnapshot().user;
      const epoch = app.manager.getSessionEpoch();
      await openStaff();
      await app.input('E-mail do usuário', email);
      await app.press('Conceder Staff');
      const confirm = app.handler('Confirmar concessão');
      if (scenario === 'token expirado') verifyLater = true;
      await app.act(async () => { confirm(); confirm(); });
      assert.equal(writes().length, 1);
      assert.ok(!app.hasText('Concessão confirmada.'));
      let refresh;
      if (scenario !== 'token expirado') {
        verifyLater = true;
        await app.act(async () => {
          expireRead = scenario === 'timeout';
          refresh = expireRead ? app.manager.client.get(rig.path + '/readiness', { auth: true }) : app.manager.refreshSession();
          await checking.promise;
        });
      } else {
        await checking.promise;
      }
      assert.equal(app.manager.getSnapshot().identityStatus, 'checking');
      assert.equal(app.hasButton('Conceder Staff'), false);
      assert.ok(!app.hasText(email));
      await app.act(async () => {
        confirm();
        if (scenario === 'resposta tardia') response.resolve(successful);
      });
      assert.equal(writes().length, 1);
      assert.ok(!app.hasText('Concessão confirmada.'));

      if (scenario === 'logout com novo sessionId') {
        await app.act(() => app.manager.logout());
        verifyLater = false;
        await app.act(async () => { identity.resolve(before); await refresh; });
        const next = { ...before, sessionId: '10000000-0000-4000-8000-000000000021' };
        app.setUser(next);
        await app.act(() => app.manager.login({ email: next.email, password: 'password' }));
        await app.act(() => app.manager.verifyAdminTwoFactor('123456'));
        await openStaff();
        await app.act(async () => { response.resolve(successful); });
        assert.equal(app.manager.getSnapshot().user.id, before.id);
        assert.notEqual(app.manager.getSnapshot().user.sessionId, before.sessionId);
        assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
        assert.equal(app.hasButton('Repetir concessão para ' + email), false);
        freshLogin = true;
        await app.input('E-mail do usuário', email);
        await app.press('Conceder Staff');
        await app.press('Confirmar concessão');
        assert.notEqual(writes()[1].key, writes()[0].key);
        return;
      }

      await app.act(async () => { identity.resolve(before); if (refresh) await refresh; });
      assert.equal(app.manager.getSessionEpoch(), epoch);
      assert.equal(app.manager.getSnapshot().user.sessionId, before.sessionId);
      await openStaff();
      assert.equal(writes().length, 1);
      if (scenario === 'resposta tardia') {
        assert.ok(app.hasButton('Revogar acesso de ' + email));
        assert.ok(app.hasText('Concessão confirmada.'));
      } else {
        assert.ok(app.hasText('Resultado incerto'));
        await app.press('Repetir concessão para ' + email);
        assert.deepEqual(writes()[1], writes()[0]);
        assert.equal(applied.size, 1);
        assert.deepEqual(replays, scenario === 'timeout' ? [writes()[0].key] : []);
        assert.ok(app.hasText('Concessão confirmada.'));
      }
    } finally { app.dispose(); }
  });
}

test('ADMIN-06: revogação e concessão concorrentes preservam lista e prontidão da leitura mais nova', async () => {
  const firstRead = deferred(), oldRead = deferred(), revocation = deferred(), nextGrant = deferred();
  const firstRosterRead = deferred(), oldRoster = deferred();
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const at = '2090-11-01T00:00:00Z', first = 'primeiro@example.test', second = 'segundo@example.test';
  const grant = { id: 'abcdef00-0000-4000-8000-000000000024', userId: 'abcdef00-0000-4000-8000-000000000025',
    eventId, role: 'staff', grantedAt: at, revokedAt: null };
  let race = false, reads = 0, rosterReads = 0;
  const rig = structureIntegration({
    async write({ db, route, options }) {
      if (route === '/admin/roles/revoke') {
        assert.deepEqual(JSON.parse(options.body), { grantId: grant.id });
        const result = await revocation.promise;
        db.roster = db.roster.filter(member => member.grantId !== grant.id);
        return result;
      }
      if (JSON.parse(options.body).email === first) {
        db.roster = [staffMember(grant, first)];
        return { statusCode: 201, body: { grant } };
      }
      const result = await nextGrant.promise;
      db.roster = [...db.roster, staffMember(result.body.grant, second)];
      return result;
    },
    read({ route, path }) {
      if (race && route === path + '/readiness' && ++reads === 1) {
        firstRead.resolve();
        return oldRead.promise;
      }
      if (race && route === path + '/staff' && ++rosterReads === 1) {
        firstRosterRead.resolve();
        return oldRoster.promise;
      }
    },
  });
  const { app } = rig;
  async function grantTo(email) {
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    await app.press('Confirmar concessão');
  }
  try {
    await app.mount();
    await rig.openPanel();
    await app.press('Equipe Staff');
    await grantTo(first);
    assert.ok(app.hasButton('Revogar acesso de ' + first));
    await app.input('E-mail do usuário', 'inválido');
    await app.press('Conceder Staff');
    assert.ok(app.hasText('Informe um e-mail válido.'));
    await app.press('Revogar acesso de ' + first);
    await app.press('Revogar acesso');
    assert.ok(!app.hasText('Informe um e-mail válido.'));
    assert.ok(!app.hasText('Revogação confirmada.'));
    await grantTo(second);
    race = true;
    await app.act(async () => {
      revocation.resolve({ statusCode: 200, body: { grant: { ...grant, revokedAt: at } } });
      await Promise.all([firstRead.promise, firstRosterRead.promise]);
    });
    await app.act(async () => {
      nextGrant.resolve({ statusCode: 201, body: { grant: { ...grant, id: 'abcdef00-0000-4000-8000-000000000026',
        userId: 'abcdef00-0000-4000-8000-000000000027' } } });
    });
    assert.ok(app.hasText('Revogação confirmada.'));
    assert.ok(app.hasText('Concessão confirmada.'));
    assert.ok(app.hasText('O evento tem Staff elegível.'));
    await app.act(async () => {
      oldRead.resolve({ eventId, statusStored: 'scheduled', effectivePhase: 'scheduled', ready: false,
        acceptingNewParticipations: false, missing: ['VERIFIED_ACTIVE_STAFF'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: false } });
      oldRoster.resolve({ eventId, items: [] });
    });
    assert.equal(reads, 2);
    assert.equal(rosterReads, 2);
    assert.ok(app.hasText('O evento tem Staff elegível.'));
    assert.equal(app.hasButton('Revogar acesso de ' + first), false);
    assert.ok(app.hasButton('Revogar acesso de ' + second));
  } finally { app.dispose(); }
});

test('ADMIN-06: concessão tardia de A não altera a gestão de B', async () => {
  const response = deferred();
  const oldRoster = deferred(), currentRoster = deferred();
  const event = n => ({ id: 'abcdef00-0000-4000-8000-00000000000' + n, name: 'Evento ' + n, timezone: 'UTC',
    startsAt: '2090-11-01T12:00:00Z', officialEndsAt: '2090-11-01T14:00:00Z', effectivePhase: 'scheduled',
    readiness: { ready: false } });
  const events = [event(1), event(2)], email = 'somente-a@example.test', writes = [];
  const rosterReads = [];
  let rosterA = [];
  const app = createIntegration({ initialToken: 'stored-admin', initialUser: adminUser, control: { realAdmin: true,
    async http(route, options) {
      if (route === '/admin/events') return { items: events, nextCursor: null };
      if (route === '/admin/roles/revoke') {
        writes.push(JSON.parse(options.body));
        return { statusCode: 500, body: {} };
      }
      if (route === '/admin/roles/grant') {
        writes.push(JSON.parse(options.body));
        const result = await response.promise;
        rosterA = [staffMember(result.body.grant, email)];
        return result;
      }
      const selected = events.find(item => route.startsWith('/admin/events/' + item.id));
      if (!selected) return undefined;
      if (route.endsWith('/staff')) {
        const firstRead = !rosterReads.includes(selected.id);
        rosterReads.push(selected.id);
        if (selected === events[1]) return currentRoster.promise;
        return firstRead ? oldRoster.promise : { eventId: selected.id, items: rosterA };
      }
      if (route.endsWith('/readiness')) return { eventId: selected.id, statusStored: 'scheduled', effectivePhase: 'scheduled',
        ready: false, acceptingNewParticipations: false, missing: ['VERIFIED_ACTIVE_STAFF'],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: false } };
      return { event: selected };
    },
  } });
  async function open(n) {
    await app.press('Acessar evento Evento ' + n);
    await app.press('Equipe Staff');
  }
  await app.mount();
  try {
    await app.press('Gerenciar eventos');
    await open(1);
    assert.deepEqual(rosterReads, [events[0].id]);
    assert.ok(app.hasText('Consultando a equipe Staff...'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    await app.press('Confirmar concessão');
    assert.ok(app.hasText('Em andamento'));
    await app.press('Voltar ao painel');
    await app.press('Descartar alterações');
    await app.press('Voltar aos eventos');
    await open(2);
    assert.deepEqual(rosterReads, [events[0].id, events[1].id]);
    assert.ok(app.hasText('Consultando a equipe Staff...'));
    await app.act(async () => {
      response.resolve({ statusCode: 201, body: { grant: { id: 'abcdef00-0000-4000-8000-000000000022',
        userId: 'abcdef00-0000-4000-8000-000000000023', eventId: events[0].id, role: 'staff',
        grantedAt: '2090-11-01T12:00:00Z', revokedAt: null } } });
    });
    assert.ok(app.hasText('Evento 2'));
    await app.act(async () => { oldRoster.resolve({ eventId: events[0].id, items: rosterA }); });
    assert.deepEqual(rosterReads, [events[0].id, events[1].id]);
    assert.ok(app.hasText('Consultando a equipe Staff...'));
    assert.ok(!app.hasText('Nenhum Staff vinculado a este evento'));
    assert.ok(!app.hasText('Concessão confirmada.'));
    assert.ok(!app.hasText(email));
    await app.act(async () => { currentRoster.resolve({ eventId: events[1].id, items: [] }); });
    assert.ok(!app.hasText('Consultando a equipe Staff...'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    assert.ok(!app.hasText(email));
    await app.press('Voltar ao painel');
    await app.press('Voltar aos eventos');
    await open(1);
    assert.deepEqual(rosterReads, [events[0].id, events[1].id, events[0].id]);
    assert.ok(app.hasButton('Revogar acesso de ' + email));
    await app.press('Revogar acesso de ' + email);
    const previousConfirm = app.handler('Revogar acesso');
    await app.press('Voltar ao painel');
    await app.press('Voltar aos eventos');
    await open(2);
    await app.act(async () => { previousConfirm(); });
    assert.ok(!app.hasText(email));
    assert.ok(!app.hasText('Revogar acesso Staff?'));
    assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
    assert.deepEqual(writes, [{ role: 'staff', eventId: events[0].id, email }]);
  } finally {
    response.resolve({ statusCode: 503, body: {} });
    oldRoster.resolve({ eventId: events[0].id, items: [] });
    currentRoster.resolve({ eventId: events[1].id, items: [] });
    app.dispose();
  }
});

for (const sameUser of [false, true]) {
  for (const outcome of ['401 recuperável', 'sucesso', 'timeout']) {
    test('ADMIN-06: POST tardio após substituir AuthProvider, ' + outcome + ', ' + (sameUser ? 'mesmo usuário' : 'outro usuário'), async () => {
      const latePost = deferred(), lateRead = deferred(), readArrived = deferred();
      const email = 'sessao-anterior@example.test';
      let holdRead = false;
      const rig = structureIntegration({
        read({ route, path }) {
          if (holdRead && route === path + '/readiness') {
            holdRead = false;
            readArrived.resolve();
            return lateRead.promise;
          }
        },
        async write() {
          const result = await latePost.promise;
          if (outcome === 'timeout') throw Object.assign(new Error('Tempo esgotado após o envio'), { name: 'AbortError' });
          return result;
        },
      });
      const { app } = rig;
      const prior = app.manager;
      const priorSubscriptions = new Set();
      const subscribe = prior.subscribe;
      prior.subscribe = listener => {
        priorSubscriptions.add(listener);
        const unsubscribe = subscribe(listener);
        return () => {
          priorSubscriptions.delete(listener);
          unsubscribe();
        };
      };
      await app.mount();
      try {
        await rig.openPanel();
        await app.press('Equipe Staff');
        await app.input('E-mail do usuário', email);
        await app.press('Conceder Staff');
        const oldConfirm = app.handler('Confirmar concessão');
        await app.act(() => { oldConfirm(); });
        assert.ok(app.hasText('Em andamento'));
        assert.equal(priorSubscriptions.size, 1);
        const priorSnapshot = prior.getSnapshot();
        const epoch = prior.getSessionEpoch();
        assert.ok(prior.getAccessToken());

        holdRead = true;
        const oldRead = prior.client.get(rig.path + '/readiness', { auth: true });
        const rejected = assert.rejects(oldRead, error => error.code === 'SESSION_REVOKED');
        await readArrived.promise;

        const replacementUser = { ...priorSnapshot.user, id: sameUser ? priorSnapshot.user.id : 'admin-b',
          email: sameUser ? priorSnapshot.user.email : 'admin-b@example.test',
          sessionId: '10000000-0000-4000-8000-000000000099' };
        const replacement = await app.replaceProvider(replacementUser);
        assert.equal(priorSubscriptions.size, 0);
        assert.equal(replacement.client, prior.client);
        assert.equal(replacement.getSnapshot().user.sessionId, replacementUser.sessionId);
        await rig.openPanel();
        await app.press('Equipe Staff');
        const requests = () => rig.requests.filter(item => item.route === '/admin/roles/grant').length;
        const refreshes = () => app.calls.filter(path => path === '/auth/refresh').length;
        const logouts = () => app.calls.filter(path => path === '/auth/logout').length;
        const requestCount = requests(), refreshCount = refreshes(), logoutCount = logouts();
        const replacementSnapshot = replacement.getSnapshot();
        const replacementStoredToken = app.storedToken();

        await app.act(async () => {
          latePost.resolve(outcome === '401 recuperável' ? { statusCode: 401, body: { code: 'ACCESS_TOKEN_EXPIRED' } } :
            { statusCode: 201, body: { grant: { id: 'abcdef00-0000-4000-8000-000000000028',
              userId: 'abcdef00-0000-4000-8000-000000000029', eventId: rig.path.split('/').at(-1),
              role: 'staff', grantedAt: '2090-11-01T00:00:00Z', revokedAt: null } } });
          lateRead.resolve({ statusCode: 401, body: { code: 'SESSION_REVOKED' } });
          await rejected;
          oldConfirm();
          const staleLogout = await prior.logout();
          assert.equal(staleLogout.localLoggedOut, false);
        });

        assert.equal(requestCount, 1);
        assert.equal(requests(), requestCount);
        assert.equal(refreshes(), refreshCount);
        assert.equal(logouts(), logoutCount);
        assert.equal(prior.getSnapshot(), priorSnapshot);
        assert.equal(prior.getSessionEpoch(), epoch);
        assert.equal(prior.getAccessToken(), null);
        assert.equal(prior.isIdentityVerified(), false);
        assert.equal(replacement.getSnapshot(), replacementSnapshot);
        assert.equal(app.storedToken(), replacementStoredToken);
        assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
        assert.ok(!app.hasText(email));
        assert.equal(app.hasButton('Repetir concessão para ' + email), false);
      } finally {
        latePost.resolve({ statusCode: 503, body: {} });
        lateRead.resolve({ statusCode: 401, body: { code: 'SESSION_REVOKED' } });
        app.dispose();
      }
    });
  }
}

test('ADMIN-06: o replay de X preserva a confirmação do vínculo Y entre gestão e wizard', async () => {
  const email = 'mesmo-destinatario@example.test';
  const eventId = 'abcdef00-0000-4000-8000-000000000001';
  const at = '2090-11-01T00:00:00Z';
  const original = { id: 'abcdef00-0000-4000-8000-000000000031',
    userId: 'abcdef00-0000-4000-8000-000000000032', eventId, role: 'staff', grantedAt: at, revokedAt: null };
  const replacement = { ...original, id: 'abcdef00-0000-4000-8000-000000000033' };
  const revocations = [];
  const applications = [];
  const rig = structureIntegration({
    write({ db, route, options }) {
      const key = options.headers['Idempotency-Key'];
      const body = JSON.parse(options.body);
      if (route.endsWith('/grant')) {
        assert.deepEqual(body, { role: 'staff', eventId, email });
        const grant = applications.includes(original.id) ? replacement : original;
        applications.push(grant.id);
        db.eligibleStaff = true;
        db.roster = [staffMember(grant, email)];
        return { statusCode: 201, body: { grant } };
      }
      assert.deepEqual(body, { grantId: original.id });
      revocations.push(key);
      if (revocations.length === 1) {
        applications.push('revogar:' + original.id);
        db.eligibleStaff = false;
        db.roster = [];
        throw new Error('Resposta perdida depois de revogar X');
      }
      assert.equal(key, revocations[0]);
      return { statusCode: 200, body: { grant: { ...original, revokedAt: at } } };
    },
  });
  const { app } = rig;
  async function grant() {
    await app.input('E-mail do usuário', email);
    await app.press('Conceder Staff');
    await app.press('Confirmar concessão');
  }
  await app.mount();
  try {
    await rig.openPanel();
    await app.press('Continuar configuração');
    await app.press('Continuar');
    await grant();
    assert.ok(app.hasText('Concessão confirmada.'));
    await app.act(async () => app.back());

    await app.press('Equipe Staff');
    await app.press('Revogar acesso de ' + email);
    await app.press('Revogar acesso');
    assert.ok(app.hasButton('Repetir revogação para ' + email));
    assert.ok(!app.hasText('Revogação confirmada.'));
    await grant();
    await app.press('Repetir revogação para ' + email);
    assert.deepEqual(applications, [original.id, 'revogar:' + original.id, replacement.id]);
    assert.equal(revocations.length, 2);
    assert.ok(app.hasText('Revogação confirmada.'));
    assert.ok(app.hasText('Concessão confirmada.'));
    assert.ok(app.hasText(replacement.id));

    await app.press('Voltar ao painel');
    await app.press('Continuar configuração');
    await app.press('Continuar');
    assert.ok(app.hasText('Revogação confirmada.'));
    assert.ok(app.hasText('Concessão confirmada.'));
    assert.ok(app.hasText(replacement.id));
  } finally { app.dispose(); }
});
