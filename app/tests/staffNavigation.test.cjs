const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');

let authState;
function StackNavigator() {}
function StackScreen() {}
function ImportedScreen() {}

const appExports = loadModule('App.js', (name) => {
  if (name === 'react') return require('react');
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === '@react-navigation/native') return { NavigationContainer() {} };
  if (name === '@react-navigation/native-stack') {
    return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
  }
  if (name === 'react-native-safe-area-context') return { SafeAreaProvider() {} };
  if (name === './theme') return createParticipantThemeStub();
  if (name === './context/AuthContext') return { useAuth: () => authState };
  if (name === './screens/auth/AuthSessionGate') {
    return {
      __esModule: true,
      default() {},
      resolveInitialRouteForAuthState: (state) => (state?.isAuthenticated ? 'MainTabs' : 'Welcome'),
    };
  }
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

test('rota StaffDemo não é registrada para participantes, questionário pendente ou sessão pública', () => {
  const signedIn = routes({
    isAuthenticated: true,
    user: { id: 'u-1', hasCompletedQuestionnaire: true },
  });
  assert.ok(!signedIn.some((route) => route.name === 'StaffDemo'));
  for (const name of ['MainTabs', 'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation', 'RealEvaluation']) {
    assert.ok(signedIn.some((route) => route.name === name), `${name} preservada`);
  }
  assert.equal(signedIn[0].name, 'MainTabs', 'abas continuam como tela inicial');

  const pending = routes({ isAuthenticated: true, user: { id: 'u-2', hasCompletedQuestionnaire: false } });
  assert.ok(!pending.some((route) => route.name === 'StaffDemo'));
  const signedOut = routes({ isAuthenticated: false });
  assert.ok(!signedOut.some((route) => route.name === 'StaffDemo'));
});

test('Início não oferece a demonstração Staff e preserva a entrada em evento', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
  });
  assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Staff/.test(textOf(node))));
  h.press('Entrar em um evento');
  assert.deepEqual(h.navigationCalls.map((call) => call.name), ['EventEntry']);
});

test('pilha da Área Staff registra as quatro telas com títulos em português', () => {
  const registered = [];
  const navigator = loadModule('screens/staff/StaffDemoNavigator.js', (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
    }
    if (name === '../../context/AuthContext') {
      return { useAuth: () => ({ isAuthenticated: true, user: { id: 'u-1' }, getSessionEpoch: () => 7 }) };
    }
    if (name === './StaffDemoContext') {
      return {
        StaffDemoProvider: 'StaffDemoProvider',
        getStaffDemoOwnerKey: (auth) => `${auth.user.id}#${auth.getSessionEpoch()}`,
      };
    }
    return { __esModule: true, default: ImportedScreen };
  }).exports.default;
  const tree = navigator();
  assert.equal(tree.type, 'StaffDemoProvider', 'estado da demonstração fica dentro da área');
  assert.equal(tree.key, 'u-1#7', 'provedor remonta quando conta ou geração da sessão mudam');
  const stack = tree.props.children;
  assert.equal(stack.props.initialRouteName, 'StaffAccess');
  for (const screen of [].concat(stack.props.children)) registered.push([screen.props.name, screen.props.options.title]);
  assert.deepEqual(JSON.parse(JSON.stringify(registered)), [
    ['StaffAccess', 'Área do Staff'],
    ['StaffPanel', 'Painel Operacional'],
    ['StaffEntryControl', 'Controle de Entrada'],
    ['StaffStation', 'Estação'],
  ]);
});
