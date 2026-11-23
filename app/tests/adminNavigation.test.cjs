// Rota da Área Admin no app, ausência do atalho no Início e pilha própria (ADM01).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');
const { createAdminApp } = require('./helpers/adminHarness.cjs');

test('BRAND-01: Admin usa logo exclusiva e splash e autenticação mantêm assets originais', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const admin = read('screens/admin/components/AdminLiveScreen.js');
  assert.match(admin, /require\(['"]\.\.\/\.\.\/\.\.\/assets\/images\/logo-arenago-admin\.png['"]\)/);
  assert.match(admin, /resizeMode="contain"/);
  assert.match(read('screens/splash/AnimatedSplashScreen.js'), /assets\/images\/logo-arenago\.png/);
  assert.match(read('screens/auth/AuthSessionGate.js'), /assets\/images\/logo-arenago\.png/);
  const config = JSON.parse(read('app.json')).expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(config.image, './assets/splash-icon.png');
  assert.equal(config.dark.image, './assets/splash-icon.png');
  const asset = fs.readFileSync(path.join(root, 'assets/images/logo-arenago-admin.png'));
  assert.equal(asset.readUInt32BE(16), 2048);
  assert.equal(asset.readUInt32BE(20), 682);
  assert.equal(asset[25], 6);
  assert.ok(fs.existsSync(path.join(root, 'assets/images/logo-arenago.png')));
  assert.ok(fs.existsSync(path.join(root, 'assets/splash-icon.png')));
});

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

test('Início permite entrada em evento sem oferecer atalhos Admin ou Staff demonstrativos', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { user: { id: 'u-1', hasCompletedQuestionnaire: true } },
    // PARTICIPANTE-01: o card fixo "sem participação" virou o estado de conta sem histórico.
    props: { overview: { status: 'empty', recent: null, pending: null, retry() {} } },
  });
  assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Admin/.test(textOf(node))));
  for (const testID of ['home-background', 'home-event-entry-card', 'home-first-access', 'home-empty-history']) {
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
  for (const mode of ['loading', 'error', 'ready']) {
    h.setProps({ mode, message: 'Falha simulada', onRetry() {} });
    assert.ok(!h.nodes.some((node) => node.type === 'Pressable'
      && node.props.accessibilityLabel === 'Área Admin (demonstração)'));
    assert.ok(!h.nodes.some((node) => node.type === 'Pressable' && /Admin/.test(textOf(node))));
  }
  assert.deepEqual(h.navigationCalls, []);
});

test('navegador Admin registra apenas destinos reais e respeita identidade', () => {
  let owner = 'admin:session:1';
  const navigator = loadModule('screens/admin/AdminDemoNavigator.js', name => {
    if (name === 'react') return { useMemo: factory => factory() };
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@react-navigation/native-stack') return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
    if (name === '@react-navigation/bottom-tabs') return { createBottomTabNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
    if (name === 'react-native') return { Text: 'Text' };
    if (name === '../../context/AuthContext') return { useAuth: () => ({}) };
    if (name === './useAdminEvents') return { adminReadOwner: () => owner };
    if (name === './adminSetupIntents') return { AdminSetupIntents: { Provider: 'SetupIntentsProvider' } };
    if (name === './components/adminTheme') return { adminColors: {} };
    return { __esModule: true, default: ImportedScreen };
  }).exports.default;
  const tree = navigator().props.children;
  assert.equal(tree.key, owner);
  assert.deepEqual(Array.from(tree.props.children, node => node.props.name), ['AdminTabs', 'AdminEvents', 'AdminRealEvent', 'AdminEventManagementInfo', 'AdminEventSetup']);
  const tabs = tree.props.children[0].props.component();
  assert.deepEqual(Array.from(tabs.props.children, node => node.props.name), ['Home', 'Histórico', 'BI']);
  owner = 'other:session:2'; assert.notEqual(navigator().props.children.key, tree.key);
  owner = null; assert.equal(navigator(), null);
});
