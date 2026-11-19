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
        ['services/adminEventsService', 'services/adminEventSetupService'].includes(target))) {
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
