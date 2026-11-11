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
      if (entryMatch) return { eventId: entryMatch[1], externalQueueEnabled: true, canManage: false,
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
  const native = Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
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
      if (name === '@react-navigation/native') return { NavigationContainer: ({ children }) =>
        React.createElement(Navigation.BaseNavigationContainer, { ref: navRef, onUnhandledAction: (action) => unhandled.push(action) }, children) };
      const target = path.posix.normalize(path.posix.join(directory, name));
      if (target === 'theme') return createParticipantThemeStub();
      if (target === 'services/httpClient') return { ...http, httpClient: client };
      if (target === 'services/tokenStorage') return { defaultTokenStorage: storage };
      if (control.realStaff && ['screens/staff/StaffEventsNavigator', 'services/staffEventsService',
        'screens/staff/StaffEntryControlRealScreen', 'services/staffEntryService', 'services/staffEntryIntentStorage',
        'screens/staff/StaffStationOperationalScreen', 'services/staffIntentStorage',
        'services/staffDashboardService', 'services/staffOperationsService'].includes(target)) {
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
    modal() { return tree.root.findByType('Modal'); },
    handler(label) { return tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label).props.onPress; },
    confirmHandler() { return tree.root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'CONFIRMAR').props.onPress; },
    dispose() { Renderer.act(() => tree.unmount()); },
  };
}

const participant = { id: 'a', name: 'A', email: 'a@example.test', emailVerified: true,
  sessionId: '10000000-0000-4000-8000-000000000001',
  roles: ['participante'], hasCompletedQuestionnaire: true };

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
  assert.deepEqual(app.routes(), ['AdminPending']);
  app.navigate('StaffPending');
  assert.deepEqual(app.routes(), ['AdminPending']);
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

const staffEvent = { id: '11111111-1111-4111-8111-111111111111', name: 'Evento autorizado', status: 'open' };
const realExperienceId = '33333333-3333-4333-8333-333333333333';
const realStation = { id: '44444444-4444-4444-8444-444444444444', experienceId: realExperienceId,
  label: 'Estação real', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null };

test('painel real separa entrada, estações e fila compartilhada por experiência', { skip }, async () => {
  const otherStation = { ...realStation, id: '55555555-5555-4555-8555-555555555555', label: 'Console 2' };
  const control = { realStaff: true, events: [staffEvent], stations: [realStation, otherStation], experiences: [
    { id: realExperienceId, name: 'Just Dance' },
    { id: '66666666-6666-4666-8666-666666666666', name: 'Sem estação' },
  ] };
  const app = createIntegration({ initialUser: { ...participant, roles: ['staff'] }, control });
  await app.mount();
  await app.act(() => app.manager.login({ email: participant.email, password: 'password' }));
  await app.press('Selecionar evento Evento autorizado');
  await app.press('Controle de Entrada');
  assert.ok(app.hasText('Fila de acesso ao evento'));
  await app.press('Voltar ao painel'); await app.press('Estações');
  assert.ok(app.hasText('Just Dance')); assert.ok(app.hasText('Sem estação: nenhuma estação associada'));
  await app.press('Selecionar estação Estação real');
  assert.ok(app.hasText('Fila compartilhada da experiência'));
  await app.press('Voltar às estações'); await app.press('Selecionar estação Console 2');
  assert.ok(app.hasText('Fila de Just Dance'));
  assert.equal(app.calls.filter((url) => url === `/staff/events/${staffEvent.id}/experiences/${realExperienceId}/queue`).length, 2);
  await app.press('Voltar às estações'); await app.press('Voltar ao painel');
  await app.press('Controle de Entrada'); assert.ok(app.hasText('Fila de acesso ao evento'));
  app.dispose();
});

test('estação real chama pelo backend com intenção persistida e bloqueia reenvio incerto', { skip }, async () => {
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
  await app.press('Selecionar evento Evento autorizado'); await app.press('Estações');
  await app.press('Selecionar estação Estação real');
  assert.ok(app.hasText('Ana'));
  await app.press('Chamar próximo'); await app.press('CONFIRMAR OPERAÇÃO');
  assert.equal(posts, 1); assert.ok(app.hasText('Operação confirmada pelo servidor'));
  assert.ok(!app.hasText('Rafael T.'));
  app.dispose();
});

test('tela da estação recupera reconhecimento após exclusão ambígua e não reconhece recibo posterior', { skip }, async () => {
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const keyA = '50000000-0000-4000-8000-000000000001', keyB = '50000000-0000-4000-8000-000000000002';
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
    await app.press('Selecionar evento Evento autorizado'); await app.press('Estações');
    await app.press('Selecionar estação Estação real'); return app;
  }
  const first = await open();
  assert.ok(first.hasText('Operação confirmada pelo servidor.'));
  await first.press('Entendi o resultado');
  assert.equal(values.has(`${slot}.receipt`), false);
  assert.equal(JSON.parse(values.get(`${slot}.ack`)).status, 'pending');
  first.dispose();
  const restarted = await open(true);
  const staleA = restarted.handler('Entendi o resultado');
  await restarted.press('Entendi o resultado');
  assert.equal(JSON.parse(values.get(`${slot}.ack`)).status, 'completed');
  values.set(`${slot}.receipt`, JSON.stringify(record(keyB)));
  await restarted.press('Atualizar atendimento');
  await restarted.act(async () => staleA());
  assert.equal(JSON.parse(values.get(`${slot}.receipt`)).key, keyB);
  assert.ok(restarted.hasText('Operação confirmada pelo servidor.'));
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
  await app.press('Estações');
  assert.ok(app.hasText('Estação real'));
  assert.ok(app.hasText('Experiência real'));
  await app.press('Selecionar estação Estação real');
  assert.ok(app.hasText('Pessoas em espera: 0'));
  assert.ok(!app.hasText('Rafael T.'));
  denied = true;
  await app.press('Atualizar fila');
  assert.ok(app.hasText('Acesso ao evento ou à experiência indisponível'));
  assert.ok(!app.hasText('Estação real'));
  await app.press('Voltar às estações');
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
  const closedEvent = { id: '22222222-2222-4222-8222-222222222222', name: 'Evento encerrado', status: 'closed' };
  const control = { realStaff: true, events: [{ ...staffEvent, status: 'scheduled' }, closedEvent],
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
  await app.press('Estações');
  assert.ok(app.hasText('Estação real'));
  await app.press('Voltar ao painel');
  await app.press('Voltar aos eventos');
  await app.press('Selecionar evento Evento encerrado');
  assert.ok(app.hasText('Status: Encerrado'));
  await app.press('Estações');
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
  await app.press('Estações');
  assert.ok(app.hasText('Nenhuma estação encontrada'));
  await app.press('Voltar ao painel');
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
  let enabled = true, waiting = [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 },
    { participationId: 'abcdef00-0000-4000-8000-000000000005', displayName: 'Bia', position: 2 }];
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      requests.push({ route, method: options.method });
      if (options.method === 'GET') return { eventId: staffEvent.id, externalQueueEnabled: enabled, canManage: true,
        observedAt: at, waitingCount: waiting.length, waiting };
      if (options.method === 'POST') { const first = waiting.shift(); waiting.forEach((p, index) => { p.position = index + 1; });
        return { eventId: staffEvent.id, participation: { id: first.participationId, status: 'active', arenaEnteredAt: at } }; }
      const payload = JSON.parse(options.body), releasedCount = payload.enabled ? 0 : waiting.length;
      enabled = payload.enabled; if (!enabled) waiting = [];
      return { eventId: staffEvent.id, externalQueueEnabled: enabled, releasedCount, changedAt: at };
    } };
  const app = createIntegration({ initialUser: staffUser, control }); await app.mount();
  await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada');
  assert.ok(app.hasText('1. Ana')); await app.press('Confirmar entrada de Ana'); await app.press('CONFIRMAR ALTERAÇÃO');
  assert.ok(app.hasText('Entrada confirmada pelo servidor')); assert.ok(app.hasText('1. Bia'));
  await app.press('Entendi'); await app.press('Desativar fila externa'); await app.press('CONFIRMAR ALTERAÇÃO');
  assert.ok(app.hasText('Participantes liberados: 1')); await app.press('Entendi');
  await app.press('Reativar fila externa'); await app.press('CONFIRMAR ALTERAÇÃO'); await app.press('Entendi');
  assert.ok(app.hasText('Ninguém está aguardando')); await app.press('Voltar ao painel'); assert.ok(app.hasText('Painel operacional'));
  assert.equal(requests.filter(r => r.method === 'POST').length, 1); assert.equal(requests.filter(r => r.method === 'PATCH').length, 2);
  app.dispose();
});

test('confirmação de entrada aberta antes do logout não envia operação na sessão seguinte', { skip }, async () => {
  const values = new Map(), at = '2026-11-10T15:00:00.000Z'; let mutations = 0;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const control = { realStaff: true, platformOS: 'android', events: [staffEvent],
    secureStore: { getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); } },
    http: async (route, options) => {
      if (!route.includes('/entry-control')) return;
      if (options.method !== 'GET') { mutations++; throw new Error('não deve enviar'); }
      return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true, observedAt: at, waitingCount: 1,
        waiting: [{ participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } };
  const app = createIntegration({ initialUser: staffUser, control }); await app.mount();
  await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada'); await app.press('Confirmar entrada de Ana');
  const old = app.handler('CONFIRMAR ALTERAÇÃO'); await app.act(() => app.manager.logout()); await app.act(async () => old());
  assert.equal(mutations, 0); assert.ok(!app.hasText('1. Ana')); app.dispose();
});

test('401 terminal no Controle de Entrada remove lista nominal e área Staff', { skip }, async () => {
  let revoked = false;
  const staffUser = { ...participant, id: 'abcdef00-0000-4000-8000-000000000001', roles: ['staff'] };
  const app = createIntegration({ initialUser: staffUser, control: { realStaff: true, events: [staffEvent],
    http: async route => {
      if (revoked && route.endsWith('/entry-control')) return { statusCode: 401, body: { code: 'SESSION_REVOKED' } };
      if (route.endsWith('/entry-control')) return { eventId: staffEvent.id, externalQueueEnabled: true, canManage: true,
        observedAt: '2026-11-10T15:00:00.000Z', waitingCount: 1, waiting: [
          { participationId: 'abcdef00-0000-4000-8000-000000000004', displayName: 'Ana', position: 1 }] };
    } } });
  await app.mount(); await app.act(() => app.manager.login({ email: staffUser.email, password: 'ficticia' }));
  await app.press('Selecionar evento Evento autorizado'); await app.press('Controle de Entrada'); assert.ok(app.hasText('1. Ana'));
  revoked = true; await app.press('Atualizar fila de entrada');
  assert.equal(app.route(), 'Login'); assert.ok(!app.hasText('1. Ana')); app.dispose();
});
