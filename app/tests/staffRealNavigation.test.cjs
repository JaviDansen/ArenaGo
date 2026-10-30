// Área Staff com React Navigation REAL (montagem de estado, ações, getComponent,
// pilha aninhada e desmontagem). O app não tem renderizador de testes e não
// ganha dependência nova: reaproveita, só para leitura, as dependências travadas
// do qa/regression (mesmas versões do lockfile do app). Sem elas, o teste é pulado.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const qaRequire = createRequire(path.resolve(__dirname, '../../qa/regression/package.json'));
let deps = null;
try {
  deps = {
    React: qaRequire('react'),
    jsx: qaRequire('react/jsx-runtime'),
    Renderer: qaRequire('react-test-renderer'),
    Navigation: qaRequire('@react-navigation/core'),
    StackRouter: qaRequire('@react-navigation/routers').StackRouter,
  };
} catch {
  deps = null;
}
const skip = deps ? false : 'dependências do qa/regression não instaladas (npm ci em qa/regression)';

function versionsMatchApp() {
  const locked = require('../package-lock.json').packages;
  for (const name of ['react', '@react-navigation/core', '@react-navigation/routers']) {
    assert.equal(qaRequire(`${name}/package.json`).version, locked[`node_modules/${name}`].version,
      `versão divergente do app: ${name}`);
  }
}

function createRealApp(initialAuth) {
  const { React, jsx, Renderer, Navigation, StackRouter } = deps;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const AuthCtx = React.createContext(null);
  const authModule = { AuthContext: AuthCtx, useAuth: () => React.useContext(AuthCtx) };

  // Pilha real do React Navigation, sem as views nativas do native-stack.
  function FocusedStack(props) {
    const { state, descriptors, NavigationContent } = Navigation.useNavigationBuilder(StackRouter, props);
    return React.createElement(NavigationContent, null, descriptors[state.routes[state.index].key].render());
  }
  const nativeStack = { createNativeStackNavigator: Navigation.createNavigatorFactory(FocusedStack) };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'ScrollView',
    'Text', 'TextInput', 'View'].map((name) => [name, name]));
  native.Modal = ({ visible, children }) => (visible ? React.createElement('Modal', null, children) : null);
  native.StyleSheet = { create: (styles) => styles };
  native.Platform = { OS: 'ios' };

  const navRef = Navigation.createNavigationContainerRef();
  const unhandled = [];
  const passthrough = ({ children }) => children;
  const Placeholder = ({ route }) => React.createElement('Text', null, `tela ${route.name}`);
  const cache = new Map();

  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const directory = path.posix.dirname(relativePath);
    const { exports } = loadModule(relativePath, (name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context') {
        return { SafeAreaView: 'SafeAreaView', SafeAreaProvider: passthrough };
      }
      if (name === '@react-navigation/native-stack') return nativeStack;
      if (name === '@react-navigation/native') {
        return {
          NavigationContainer: ({ children }) => React.createElement(Navigation.BaseNavigationContainer, {
            ref: navRef,
            onUnhandledAction: (action) => unhandled.push(action),
          }, children),
        };
      }
      assert.ok(name.startsWith('.'), `import inesperado: ${name}`);
      const target = path.posix.normalize(path.posix.join(directory, name));
      if (target === 'context/AuthContext') return authModule;
      if (target === 'context/ParticipationContext') return { ParticipationProvider: passthrough };
      if (target === 'screens/auth/AuthSessionGate') {
        return { __esModule: true, default: passthrough, resolveInitialRouteForAuthState: () => 'MainTabs' };
      }
      if (target === 'screens/staff/staffDemoLatency') return { waitStaffDemoLatency: () => Promise.resolve() };
      if (target.startsWith('screens/staff/') || target.startsWith('data/')) return load(`${target}.js`);
      return { __esModule: true, default: Placeholder };
    });
    cache.set(relativePath, exports);
    return exports;
  }

  const { AppNavigation } = load('App.js');
  assert.ok(!cache.has('screens/staff/StaffDemoNavigator.js'), 'Área Staff não carrega antes de abrir a rota');
  const element = (auth) => React.createElement(AuthCtx.Provider, { value: auth },
    React.createElement(AppNavigation));
  let tree;
  Renderer.act(() => { tree = Renderer.create(element(initialAuth)); });

  const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
  const pressables = (label) => tree.root.findAll((node) => node.type === 'Pressable'
    && (node.props.accessibilityLabel === label || textOf(node) === label));
  return {
    navRef,
    unhandled,
    loaded: (relativePath) => cache.has(relativePath),
    rootRoutes: () => navRef.getRootState().routes.map((route) => route.name),
    hasText: (fragment) => tree.root.findAllByType('Text').some((node) => textOf(node).includes(fragment)),
    navigate(name) { Renderer.act(() => navRef.navigate(name)); },
    async press(label) {
      const found = pressables(label);
      assert.equal(found.length, 1, `exatamente um botão: ${label}`);
      await Renderer.act(async () => { await found[0].props.onPress(); });
    },
    async enter(code) {
      const input = tree.root.findByType('TextInput');
      Renderer.act(() => input.props.onChangeText(code));
      await this.press('ENTRAR NO EVENTO');
    },
    setAuth(auth) { Renderer.act(() => tree.update(element(auth))); },
    dispose() { Renderer.act(() => tree.unmount()); },
  };
}

const accountA = { isAuthenticated: true, user: { id: 'a', name: 'Conta A', hasCompletedQuestionnaire: true },
  getSessionEpoch: () => 1 };
const accountB = { isAuthenticated: true, user: { id: 'b', name: 'Conta B', hasCompletedQuestionnaire: true },
  getSessionEpoch: () => 2 };

test('React Navigation real: StaffDemo via getComponent e "Voltar ao aplicativo" desmonta a demonstração',
  { skip }, async () => {
    versionsMatchApp();
    const app = createRealApp(accountA);
    assert.deepEqual(app.rootRoutes(), ['MainTabs']);

    app.navigate('StaffDemo');
    assert.ok(app.loaded('screens/staff/StaffDemoNavigator.js'));
    assert.ok(app.hasText('Conectado como: Conta A'));
    await app.enter('STAFFDEMO');
    assert.ok(app.hasText('Painel Operacional'));
    await app.press('Controle de Entrada, fila ativa, 4 aguardando');
    await app.press('CONFIRMAR ENTRADA');
    await app.press('CONFIRMAR');
    await app.press('↩ Painel');

    await app.press('Voltar ao aplicativo');
    assert.deepEqual(app.rootRoutes(), ['MainTabs'], 'rota StaffDemo removida da pilha do app');
    assert.ok(app.hasText('tela MainTabs'));
    assert.deepEqual(app.unhandled, []);

    // Reabrir começa do zero: o estado anterior foi descartado na desmontagem.
    app.navigate('StaffDemo');
    assert.ok(app.hasText('Código do evento'));
    await app.enter('STAFFDEMO');
    await app.press('Controle de Entrada, fila ativa, 4 aguardando');
    assert.ok(app.hasText('Rafael T.'), 'fixture original, sem a entrada confirmada antes');
    app.dispose();
  });

test('React Navigation real: troca direta A → B descarta o estado de A sem logout', { skip }, async () => {
  const app = createRealApp(accountA);
  app.navigate('StaffDemo');
  await app.enter('STAFFDEMO');
  assert.ok(app.hasText('Painel Operacional'));

  app.setAuth(accountB); // sem logout
  assert.deepEqual(app.rootRoutes(), ['MainTabs', 'StaffDemo']);
  assert.ok(!app.hasText('Painel Operacional'), 'painel de A não aparece para B');
  assert.ok(!app.hasText('BEAST Arena'));
  // A pilha aninhada mantém a rota, mas o provedor novo não tem evento: estado seguro.
  assert.ok(app.hasText('Nenhum evento selecionado'));
  await app.press('IR PARA A ÁREA DO STAFF');
  assert.ok(app.hasText('Conectado como: Conta B'));
  assert.ok(app.hasText('Código do evento'));
  app.dispose();
});
