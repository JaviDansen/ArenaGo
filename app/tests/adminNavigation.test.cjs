// Rota da Área Admin no app, botão do Início e pilha própria (ADM01).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');
const { createAdminApp } = require('./helpers/adminHarness.cjs');

let authState;
function StackNavigator() {}
function StackScreen() {}
function ImportedScreen() {}
function AdminDemoNavigator() {}

const gateExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
  if (name === '../../context/adminAccess') return loadModule('context/adminAccess.js', require).exports;
  if (name === 'react') return require('react');
  if (name === 'react-native') return { StyleSheet: { create: (styles) => styles } };
  if (name === 'expo-status-bar') return { StatusBar() {} };
  if (name === 'react-native-safe-area-context') return { SafeAreaView() {} };
  if (name === '../../context/AuthContext') return { AuthProvider() {}, useAuth() {} };
  return require(name);
}).exports;

const appExports = loadModule('App.js', (name) => {
  if (name === 'react') return require('react');
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === '@react-navigation/native') return { NavigationContainer() {} };
  if (name === '@react-navigation/native-stack') {
    return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
  }
  if (name === 'react-native-safe-area-context') return { SafeAreaProvider() {} };
  if (name === './context/AuthContext') return { useAuth: () => authState };
  if (name === './theme') return createParticipantThemeStub();
  if (name === './screens/auth/AuthSessionGate') {
    return {
      __esModule: true,
      default() {},
      resolveInitialRouteForAuthState: gateExports.resolveInitialRouteForAuthState,
    };
  }
  if (name === './screens/admin/AdminDemoNavigator') return { __esModule: true, default: AdminDemoNavigator };
  return { __esModule: true, default: ImportedScreen };
}).exports;

function routes(state) {
  authState = state;
  const found = [];
  (function collect(node) {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object' && node.props) {
      if (node.type === StackScreen) found.push(node.props);
      collect(node.props.children);
    }
  })(appExports.AppNavigation());
  return found;
}

test('AdminArea reutiliza a pilha Heliom e as rotas antigas não são registradas', () => {
  const signedIn = routes({ isAuthenticated: true, user: { id: 'u-1', roles: ['participante'], hasCompletedQuestionnaire: true } });
  const privileged = routes(verifiedAdminAuth());
  const admin = privileged.find((route) => route.name === 'AdminArea');
  assert.ok(admin, 'AdminArea disponível ao Admin confirmado');
  assert.equal(admin.component, undefined, 'sem import no topo do App.js');
  assert.equal(admin.getComponent(), AdminDemoNavigator);
  assert.deepEqual(privileged.map((route) => route.name), ['AdminArea']);
  for (const name of ['MainTabs', 'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation',
    'ProfileQuestionnaire', 'RealEvaluation']) {
    assert.ok(signedIn.some((route) => route.name === name), `${name} preservada`);
  }
  for (const name of ['AdminArea', 'AdminDemo', 'AdminPending', 'AdminPanel', 'StaffDemo']) {
    assert.ok(!signedIn.some((route) => route.name === name), `participante não recebe ${name}`);
  }
  assert.equal(signedIn[0].name, 'MainTabs', 'abas continuam como tela inicial');

  const pending = routes({ isAuthenticated: true, user: { id: 'u-2', roles: ['participante'], hasCompletedQuestionnaire: false } });
  assert.ok(!pending.some((route) => route.name === 'AdminDemo'), 'questionário pendente não abre Admin');
  const signedOut = routes({ isAuthenticated: false });
  assert.ok(!signedOut.some((route) => route.name === 'AdminDemo'), 'acesso público protegido');

  for (const roles of [['admin'], ['staff'], ['admin', 'staff']]) {
    const area = routes(verifiedAdminAuth({ user: { roles } }));
    assert.ok(!area.some((route) => route.name === 'AdminDemo'), 'rota antiga removida');
    assert.ok(!area.some((route) => route.name === 'MainTabs'), 'papéis reais não entram na pilha Participante');
    if (!roles.includes('admin')) assert.ok(!area.some((route) => route.name === 'AdminArea'));
  }
});

test('Início mantém entrada em evento sem atalhos administrativos ou StaffDemo', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
  });
  assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Admin/.test(textOf(node))));
  for (const testID of ['home-background', 'home-event-entry-card', 'home-empty-participation-card']) {
    assert.ok(h.nodes.some((node) => node.props.testID === testID), `${testID} preservado`);
  }
  assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Staff/.test(textOf(node))));
  h.press('Entrar em um evento');
  assert.deepEqual(h.navigationCalls.map((call) => call.name), ['EventEntry']);
});

test('Home não oferece Admin em nenhum estado', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
  });
  for (const mode of ['loading', 'error', 'ready']) {
    h.setProps({ mode, message: 'Falha simulada', onRetry() {} });
    assert.ok(!h.nodes.some((node) => node.type === 'Pressable'
      && node.props.accessibilityLabel === 'Área Admin (demonstração)'));
  }
  assert.deepEqual(h.navigationCalls, []);
});

test('pilha da Área Admin registra as telas com títulos em português e provedor por sessão', () => {
  const registered = [];
  const { ownerKeyFor } = createAdminApp();
  let currentAuth = verifiedAdminAuth({ getSessionEpoch: () => 7 });
  const navigator = loadModule('screens/admin/AdminDemoNavigator.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
    }
    if (name === '../../context/AuthContext') {
      return { useAuth: () => currentAuth };
    }
    if (name === './AdminDemoContext') {
      return {
        AdminDemoProvider: 'AdminDemoProvider',
        getAdminDemoOwnerKey: ownerKeyFor,
      };
    }
    return { __esModule: true, default: ImportedScreen };
  }).exports.default;
  const tree = navigator();
  assert.equal(tree.type, 'AdminDemoProvider', 'estado da demonstração fica dentro da área');
  assert.equal(tree.key, ownerKeyFor(currentAuth), 'provedor usa conta, sessão, geração e revisão reais');
  const originalKey = tree.key;
  for (const overrides of [{ user: { id: 'b' } }, { getSessionEpoch: () => 8 },
    { getIdentityRevision: () => 2 }, { user: { sessionId: '20000000-0000-4000-8000-000000000002' } }]) {
    currentAuth = verifiedAdminAuth({ getSessionEpoch: () => 7, ...overrides });
    assert.notEqual(navigator().key, originalKey);
  }
  for (const overrides of [{ user: { roles: ['participante'] } }, { user: { roles: ['staff'] } },
    { identityStatus: 'checking' }, { identityStatus: 'error' }, { isAuthenticated: false },
    { adminChallenge: { isTotpConfigured: true } }]) {
    currentAuth = verifiedAdminAuth(overrides);
    assert.equal(navigator(), null, 'montagem direta/rota antiga não contorna autorização');
  }
  const stack = tree.props.children;
  assert.equal(stack.props.initialRouteName, 'AdminPanel');
  for (const screen of [].concat(stack.props.children)) registered.push([screen.props.name, screen.props.options.title]);
  assert.deepEqual(JSON.parse(JSON.stringify(registered)), [
    ['AdminPanel', 'Painel Administrativo'],
    ['AdminEvents', 'Gerenciar Eventos'],
    ['AdminCreateEvent', 'Criar Evento'],
    ['AdminEventDetail', 'Detalhe do Evento'],
    ['AdminEventSchedule', 'Alterar Horários'],
    ['AdminEventQueue', 'Fila Externa'],
    ['AdminEventClose', 'Encerrar Evento'],
    ['AdminEventExperiences', 'Experiências do Evento'],
    ['AdminExperienceDetail', 'Experiência'],
    ['AdminStationDetail', 'Estação'],
    ['AdminEventStaff', 'Staff do Evento'],
    ['AdminHistory', 'Histórico'],
    ['AdminEventBi', 'BI do Evento'],
    ['AdminOverview', 'Visão Geral'],
  ]);
});
