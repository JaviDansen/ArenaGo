const assert = require('node:assert/strict');
const React = require('react');
const Renderer = require('react-test-renderer');
const Navigation = require('@react-navigation/core');
const { StackRouter } = require('@react-navigation/routers');
const { read, loadJs } = require('./source.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = Renderer;
const jsx = require('react/jsx-runtime');

// Fail as infrastructure, rather than silently test a different React/router.
const locked = JSON.parse(read('app/package-lock.json')).packages;
for (const name of ['react', '@react-navigation/core', '@react-navigation/routers']) {
  assert.equal(require(name + '/package.json').version, locked['node_modules/' + name].version,
    'QA dependency must match the application lockfile: ' + name);
}

const native = Object.fromEntries([
  'ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'ScrollView',
  'Text', 'TextInput', 'View', 'SafeAreaView',
].map(name => [name, name]));
native.Platform = { OS: 'ios' };
native.StyleSheet = { create: value => value };

class ApiError extends Error {
  constructor(details) { super(details?.detail); Object.assign(this, details); }
}
const unavailable = () => { throw new Error('Unexpected use of real transport/storage'); };
const httpImports = { ApiError, createHttpClient: unavailable, httpClient: {} };
const tokenImports = { defaultTokenStorage: {} };
const authService = loadJs('app/services/authService.js', {
  './httpClient': httpImports, './tokenStorage': tokenImports,
});
const authContext = loadJs('app/context/AuthContext.js', {
  react: React, 'react/jsx-runtime': jsx,
  '../services/authService': authService,
  '../services/httpClient': httpImports,
  '../services/tokenStorage': tokenImports,
});
const birthDate = loadJs('app/utils/birthDate.js', {});
const validation = loadJs('app/utils/validation.js', { './birthDate': birthDate });
const questionnaire = loadJs('app/screens/profile/ProfileQuestionnaireScreen.js', {
  react: React, 'react/jsx-runtime': jsx, 'react-native': native,
  'expo-status-bar': { StatusBar: 'StatusBar' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '../../context/AuthContext': authContext,
  '../../components/BirthDateInput': { __esModule: true, default: 'BirthDateInput' },
  '../../utils/birthDate': birthDate, '../../utils/validation': validation,
});
const gate = loadJs('app/screens/auth/AuthSessionGate.js', {
  react: React, 'react/jsx-runtime': jsx, 'react-native': native,
  'expo-status-bar': { StatusBar: 'StatusBar' },
  '../../context/AuthContext': authContext,
});

function FocusedStack(props) {
  // Real React Navigation state building, action dispatch, route reconciliation
  // and descriptor rendering. Native-stack animations/native views are excluded.
  const { state, descriptors, NavigationContent } =
    Navigation.useNavigationBuilder(StackRouter, props);
  return React.createElement(NavigationContent, null,
    descriptors[state.routes[state.index].key].render());
}
const makeNavigator = Navigation.createNavigatorFactory(FocusedStack);

async function mount({ routed = false, catalog = [], deferCatalog = false } = {}) {
  const trace = [];
  const requests = { profile: [], search: [], put: [], catalog: [] };
  const users = new Map(['A', 'B'].map(id => [id, {
    id, name: 'User ' + id, email: id.toLowerCase() + '@example.test',
    hasCompletedQuestionnaire: false,
  }]));
  let serverUser = null;
  let refreshToken = null;
  function pending(kind, data = {}) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const request = { owner: serverUser?.id, ...data, resolve, reject };
    requests[kind].push(request);
    return promise;
  }
  const client = {
    setAuthHandlers() {},
    get(path) {
      if (path === '/auth/me') return Promise.resolve({ ...serverUser });
      if (path === '/profile/questionnaire') return pending('profile');
      if (path.startsWith('/games?query=')) {
        return pending('search', { query: new URL(path, 'http://fixture').searchParams.get('query') });
      }
      if (path === '/games?limit=50') {
        return deferCatalog ? pending('catalog') : Promise.resolve({ games: catalog });
      }
      throw new Error('Unexpected GET ' + path);
    },
    async post(path, payload) {
      if (path === '/auth/login') {
        serverUser = users.get(payload.email.split('@')[0].toUpperCase());
        assert.ok(serverUser, 'fixture login account');
        return { user: { ...serverUser }, accessToken: 'access-' + serverUser.id,
          refreshToken: 'refresh-' + serverUser.id };
      }
      if (path === '/auth/logout') { serverUser = null; return {}; }
      throw new Error('Unexpected POST ' + path);
    },
    put(path, payload) {
      assert.equal(path, '/profile/questionnaire');
      return pending('put', { payload });
    },
  };
  const manager = authService.createAuthSessionManager({
    client,
    tokenStorage: {
      isPersistent: false,
      async getRefreshToken() { return refreshToken; },
      async setRefreshToken(value) { refreshToken = value; },
      async clearRefreshToken() { refreshToken = null; },
    },
  });
  await manager.login({ email: 'a@example.test', password: 'fixture-password' });
  manager.subscribe(snapshot => trace.push({
    type: 'auth', user: snapshot.user?.id,
    authenticated: snapshot.isAuthenticated,
    completed: snapshot.user?.hasCompletedQuestionnaire,
  }));

  const navRef = Navigation.createNavigationContainerRef();
  const unhandled = [];
  const calls = [];
  let recordedRoutes = [];
  const stack = makeNavigator();
  function RecordingNavigator(props) {
    recordedRoutes = React.Children.toArray(props.children).map(element => element.props.name);
    trace.push({ type: 'routes-rendered', names: [...recordedRoutes] });
    return React.createElement(stack.Navigator, props);
  }
  function Container({ children }) {
    return React.createElement(Navigation.BaseNavigationContainer, {
      ref: navRef,
      onUnhandledAction(action) { unhandled.push(action); trace.push({ type: 'unhandled', action }); },
      onStateChange(state) { trace.push({ type: 'focus', name: state.routes[state.index].name }); },
    }, children);
  }
  const passthrough = ({ children }) => children;
  const Placeholder = ({ route }) => React.createElement('Text', null, route?.name);
  const imports = {
    'react/jsx-runtime': jsx,
    '@react-navigation/native': { NavigationContainer: Container },
    '@react-navigation/native-stack': {
      createNativeStackNavigator: () => ({ ...stack, Navigator: RecordingNavigator }),
    },
    './context/AuthContext': authContext,
    './context/ParticipationContext': { ParticipationProvider: passthrough },
    './screens/auth/AuthSessionGate': gate,
    './screens/profile/ProfileQuestionnaireScreen': questionnaire,
  };
  for (const path of [
    './navigation/MainTabs', './screens/participation/EvaluationScreen',
    './screens/event-entry/EventConfirmationScreen', './screens/event-entry/EventEntryScreen',
    './screens/auth/ForgotPasswordScreen', './screens/auth/LoginScreen',
    './screens/participation/ParticipationDetailsScreen',
    './screens/auth/RegisterScreen', './screens/auth/WelcomeScreen',
  ]) imports[path] = { __esModule: true, default: Placeholder };
  const app = loadJs('app/App.js', imports);
  const navigation = {
    reset(payload) { calls.push({ type: 'reset', payload }); },
    navigate(name) { calls.push({ type: 'navigate', name }); },
    replace(name) { calls.push({ type: 'replace', name }); },
    goBack() { calls.push({ type: 'back' }); },
    canGoBack() { return false; },
  };
  let tree;
  await act(async () => {
    tree = Renderer.create(React.createElement(authContext.AuthProvider, {
      sessionManager: manager, autoRestore: false,
    }, routed
      ? React.createElement(app.AppNavigation)
      : React.createElement(questionnaire.default, { navigation, route: {} })));
  });

  function textOf(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node.children || []).map(textOf).join('');
  }
  const findButtons = label => tree.root.findAll(n =>
    n.type === 'Pressable' &&
    (n.props.accessibilityLabel === label || textOf(n) === label));
  async function press(label) {
    const matches = findButtons(label);
    assert.equal(matches.length, 1, 'exactly one rendered button: ' + label);
    assert.notEqual(matches[0].props.disabled, true, 'button must be enabled: ' + label);
    await act(async () => { matches[0].props.onPress(); });
  }
  async function search(query) {
    const inputs = tree.root.findAll(n => n.type === 'TextInput' &&
      typeof n.props.onChangeText === 'function');
    assert.equal(inputs.length, 1, 'one game-search input on step 2');
    await act(async () => { inputs[0].props.onChangeText(query); });
  }
  async function toGames() {
    const input = tree.root.findByType('BirthDateInput');
    await act(async () => { input.props.onChangeText('01/01/2000'); });
    await press('Masculino');
    await press('Superior');
    await press('Avançar para a próxima etapa');
  }
  async function addGame(name) {
    await search(name);
    const request = requests.search.at(-1);
    await act(async () => { request.resolve({ games: [{ name }] }); });
    await press('Selecionar ' + name);
  }
  async function toFinish() {
    await toGames();
    await addGame('Minecraft');
    await press('Avançar para a Etapa 3');
    await press(questionnaire.MARKET_KNOWLEDGE_OPTIONS[0]);
    await press(questionnaire.MARKET_INTEREST_OPTIONS[0]);
  }
  return {
    tree, requests, manager, navRef, unhandled, calls, trace, press, search, toGames, toFinish,
    addGame, findButtons, textOf,
    get routeNames() { return recordedRoutes; },
    texts() { return tree.root.findAllByType('Text').map(textOf); },
    hasText(text) { return tree.root.findAllByType('Text').some(n => textOf(n).includes(text)); },
    async resolve(request, value) { await act(async () => { request.resolve(value); }); },
    async reject(request, error) { await act(async () => { request.reject(error); }); },
    async complete(request) {
      users.get(request.owner).hasCompletedQuestionnaire = true;
      await act(async () => { request.resolve({ message: 'OK' }); });
    },
    async logout() { await act(async () => { await manager.logout(); }); },
    async loginB() {
      await act(async () => { await manager.login({
        email: 'b@example.test', password: 'fixture-password',
      }); });
    },
    async dispose() { await act(async () => { tree.unmount(); }); },
  };
}

module.exports = { mount, act };
