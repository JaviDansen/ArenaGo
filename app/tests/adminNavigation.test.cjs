// Rota da Área Admin no app, ausência do atalho no Início e pilha própria (ADM01).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');

let authState;
function StackNavigator() {}
function StackScreen() {}
function ImportedScreen() {}
function AdminDemoNavigator() {}

const gateExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
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

test('rota AdminDemo existe só no app autenticado e é carregada sob demanda', () => {
  const signedIn = routes({ isAuthenticated: true, user: { id: 'u-1', roles: ['participante'], hasCompletedQuestionnaire: true } });
  const admin = signedIn.find((route) => route.name === 'AdminDemo');
  assert.ok(admin, 'AdminDemo disponível');
  assert.equal(admin.component, undefined, 'sem import no topo do App.js');
  assert.equal(admin.getComponent(), AdminDemoNavigator);
  for (const name of ['MainTabs', 'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation',
    'ProfileQuestionnaire', 'RealEvaluation']) {
    assert.ok(signedIn.some((route) => route.name === name), `${name} preservada`);
  }
  assert.ok(!signedIn.some((route) => route.name === 'StaffDemo'), 'participante não recebe StaffDemo');
  assert.equal(signedIn[0].name, 'MainTabs', 'abas continuam como tela inicial');

  const pending = routes({ isAuthenticated: true, user: { id: 'u-2', roles: ['participante'], hasCompletedQuestionnaire: false } });
  assert.ok(!pending.some((route) => route.name === 'AdminDemo'), 'questionário pendente não abre Admin');
  const signedOut = routes({ isAuthenticated: false });
  assert.ok(!signedOut.some((route) => route.name === 'AdminDemo'), 'acesso público protegido');

  for (const roles of [['admin'], ['staff'], ['admin', 'staff']]) {
    const privileged = routes({ isAuthenticated: true,
      user: { id: 'u-3', roles, hasCompletedQuestionnaire: true } });
    assert.ok(!privileged.some((route) => route.name === 'AdminDemo'), 'papéis reais não entram na demonstração');
    assert.ok(!privileged.some((route) => route.name === 'MainTabs'), 'papéis reais não entram na pilha Participante');
  }
});

test('Início permite entrada em evento sem oferecer atalhos Admin ou Staff demonstrativos', () => {
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

test('Home não oferece atalho Admin nos estados de carregamento, erro ou pronto', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
  });
  for (const mode of ['loading', 'error']) {
    h.setProps({ mode, message: 'Falha simulada', onRetry() {} });
    assert.ok(!h.nodes.some((node) => node.type === 'Pressable'
      && node.props.accessibilityLabel === 'Área Admin (demonstração)'));
  }
  h.setProps({ mode: 'ready' });
  assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Admin/.test(textOf(node))));
});

test('pilha da Área Admin registra as telas com títulos em português e provedor por sessão', () => {
  const registered = [];
  const navigator = loadModule('screens/admin/AdminDemoNavigator.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
    }
    if (name === '../../context/AuthContext') {
      return { useAuth: () => ({ isAuthenticated: true, user: { id: 'u-1' }, getSessionEpoch: () => 7 }) };
    }
    if (name === './AdminDemoContext') {
      return {
        AdminDemoProvider: 'AdminDemoProvider',
        getAdminDemoOwnerKey: (auth) => `${auth.user.id}#${auth.getSessionEpoch()}`,
      };
    }
    return { __esModule: true, default: ImportedScreen };
  }).exports.default;
  const tree = navigator();
  assert.equal(tree.type, 'AdminDemoProvider', 'estado da demonstração fica dentro da área');
  assert.equal(tree.key, 'u-1#7', 'provedor remonta quando conta ou geração da sessão mudam');
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
