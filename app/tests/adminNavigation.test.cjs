// Rota da Área Admin no app, botão do Início e pilha própria (ADM01).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

let authState;
function StackNavigator() {}
function StackScreen() {}
function ImportedScreen() {}
function StaffDemoNavigator() {}
function AdminDemoNavigator() {}

const appExports = loadModule('App.js', (name) => {
  if (name === 'react') return require('react');
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === '@react-navigation/native') return { NavigationContainer() {} };
  if (name === '@react-navigation/native-stack') {
    return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
  }
  if (name === 'react-native-safe-area-context') return { SafeAreaProvider() {} };
  if (name === './context/AuthContext') return { useAuth: () => authState };
  if (name === './screens/auth/AuthSessionGate') {
    return {
      __esModule: true,
      default() {},
      resolveInitialRouteForAuthState: (state) => (state?.isAuthenticated ? 'MainTabs' : 'Welcome'),
    };
  }
  if (name === './screens/staff/StaffDemoNavigator') return { __esModule: true, default: StaffDemoNavigator };
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
  const signedIn = routes({ isAuthenticated: true, user: { id: 'u-1', hasCompletedQuestionnaire: true } });
  const admin = signedIn.find((route) => route.name === 'AdminDemo');
  assert.ok(admin, 'AdminDemo disponível');
  assert.equal(admin.component, undefined, 'sem import no topo do App.js');
  assert.equal(admin.getComponent(), AdminDemoNavigator);
  for (const name of ['MainTabs', 'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation',
    'StaffDemo', 'ProfileQuestionnaire']) {
    assert.ok(signedIn.some((route) => route.name === name), `${name} preservada`);
  }
  assert.equal(signedIn[0].name, 'MainTabs', 'abas continuam como tela inicial');

  const pending = routes({ isAuthenticated: true, user: { id: 'u-2', hasCompletedQuestionnaire: false } });
  assert.ok(!pending.some((route) => route.name === 'AdminDemo'), 'questionário pendente não abre Admin');
  const signedOut = routes({ isAuthenticated: false });
  assert.ok(!signedOut.some((route) => route.name === 'AdminDemo'), 'acesso público protegido');
});

test('Início abre a Área Admin (demonstração) sem afetar Staff e entrada em evento', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
  });
  const label = h.nodes.find((node) => node.type === 'Pressable' && /Admin/.test(textOf(node)));
  assert.equal(textOf(label), 'Área Admin (demonstração)');
  h.press('Área Admin (demonstração)');
  h.press('Área do Staff (demonstração)');
  h.press('Entrar em um evento');
  assert.deepEqual(h.navigationCalls.map((call) => call.name), ['AdminDemo', 'StaffDemo', 'EventEntry']);
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
  ]);
});
