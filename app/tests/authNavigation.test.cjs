const assert = require('node:assert/strict');
const test = require('node:test');
const { StackRouter, CommonActions } = require('@react-navigation/routers');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

let authState;
function NavigationContainer() {}
function StackNavigator() {}
function StackScreen() {}
function ImportedScreen() {}

const gateExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
  if (name === 'react') return { ...require('react'), useState: (value) => [value, () => {}] };
  if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
  if (name === 'react-native') {
    return Object.fromEntries(
      ['ActivityIndicator', 'Pressable', 'SafeAreaView', 'StyleSheet', 'Text', 'View'].map(
        (key) => [key, key === 'StyleSheet' ? { create: (styles) => styles } : key]
      )
    );
  }
  if (name === '../../context/AuthContext') {
    return { AuthProvider: 'AuthProvider', useAuth: () => authState };
  }
  return require(name);
}).exports;

const appExports = loadModule('App.js', (name) => {
  if (name === 'react') return { ...require('react'), useAuth: () => authState };
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === '@react-navigation/native') return { NavigationContainer };
  if (name === '@react-navigation/native-stack') {
    return { createNativeStackNavigator: () => ({ Navigator: StackNavigator, Screen: StackScreen }) };
  }
  if (name === './context/AuthContext') return { useAuth: () => authState };
  if (name === './screens/auth/AuthSessionGate') {
    return {
      __esModule: true,
      default: function AuthSessionGate() {},
      resolveInitialRouteForAuthState: gateExports.resolveInitialRouteForAuthState,
    };
  }
  return { __esModule: true, default: ImportedScreen };
}).exports;

function findElement(root, type) {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!root || typeof root !== 'object' || !root.props) return null;
  if (root.type === type) return root;
  return findElement(root.props.children, type);
}

function renderStack(state) {
  authState = state;
  const tree = appExports.AppNavigation();
  const stack = findElement(tree, StackNavigator);
  assert.ok(stack, 'App renders the real root stack configuration');

  const names = [];
  function collect(node) {
    if (Array.isArray(node)) {
      node.forEach(collect);
    } else if (node && typeof node === 'object' && node.props) {
      if (node.type === StackScreen) names.push(node.props.name);
      collect(node.props.children);
    }
  }
  collect(stack.props.children);
  return { stack, names };
}

function routerOptions(routeNames) {
  return {
    routeNames,
    routeParamList: Object.fromEntries(routeNames.map((name) => [name, undefined])),
    routeGetIdList: {},
  };
}

function routeChange(router, state, routeNames) {
  return router.getStateForRouteNamesChange(state, {
    ...routerOptions(routeNames),
    routeNames,
    routeKeyChanges: [],
  });
}

function navigate(router, state, routeNames, name) {
  return router.getStateForAction(state, CommonActions.navigate(name), {
    ...routerOptions(routeNames, name),
  });
}

test('React Navigation replaces Login with MainTabs immediately when login authenticates', async () => {
  const publicTree = renderStack({ isAuthenticated: false, sessionStatus: 'unauthenticated' });
  assert.equal(publicTree.names[0], 'Welcome');
  assert.deepEqual(publicTree.names, [
    'Welcome', 'Login', 'Register', 'Cadastro', 'ForgotPassword', 'EsqueciSenha',
  ]);

  const publicRouter = StackRouter(routerOptions(publicTree.names));
  let state = publicRouter.getInitialState(routerOptions(publicTree.names));
  state = navigate(publicRouter, state, publicTree.names, 'Login');
  assert.equal(state.routes[state.index].name, 'Login');

  const loginScreen = createHarness('screens/auth/LoginScreen.js', {
    authContext: {
      clearNotices() {},
      async login() {
        authState = {
          isAuthenticated: true,
          sessionStatus: 'authenticated',
          postAuthRoute: 'MainTabs',
          user: { hasCompletedQuestionnaire: true },
        };
        return { status: 'authenticated', user: authState.user };
      },
    },
  });
  for (const [placeholder, value] of [
    ['seu.email@exemplo.com', 'player@example.com'],
    ['Digite sua senha', 'ValidPassword#2026'],
  ]) {
    loginScreen.act(() => {
      loginScreen.nodes.find(
        (node) => node.type === 'TextInput' && node.props.placeholder === placeholder
      ).props.onChangeText(value);
    });
  }
  await loginScreen.actAsync(() => loginScreen.press('Entrar na conta'));
  assert.deepEqual(loginScreen.navigationCalls, [], 'LoginScreen does not navigate imperatively');

  // Renderiza novamente AppNavigation com o estado publicado pelo contexto no mesmo fluxo de login.
  const signedInTree = renderStack(authState);
  assert.equal(signedInTree.names[0], 'MainTabs');
  assert.ok(!signedInTree.names.includes('Login'));
  assert.ok(!signedInTree.names.includes('Welcome'));
  for (const route of [
    'MainTabs', 'ProfileQuestionnaire', 'EventEntry', 'EventConfirmation',
    'ParticipationDetails', 'Evaluation',
  ]) assert.ok(signedInTree.names.includes(route), `${route} remains available in the app`);

  // O roteador existente do React Navigation mantém suas opções originais; a ordem das rotas
  // seleciona a tela de destino quando a rota anterior deixa de estar disponível.
  state = routeChange(publicRouter, state, signedInTree.names);
  assert.deepEqual(state.routes.map((route) => route.name), ['MainTabs']);
  assert.equal(state.routes[state.index].name, 'MainTabs');
  assert.equal(publicRouter.getStateForAction(state, CommonActions.navigate('Login'), {
    ...routerOptions(signedInTree.names),
  }), null, 'Login is an unavailable route while authenticated');
  for (const route of signedInTree.names) {
    assert.ok(publicRouter.getStateForAction(state, CommonActions.navigate(route), {
      ...routerOptions(signedInTree.names),
    }), `${route} remains navigable in the authenticated app`);
  }
});

test('React Navigation switches auth route sets for signup, logout, relogin and session restoration', () => {
  const publicTree = renderStack({ isAuthenticated: false, sessionStatus: 'unauthenticated' });
  const publicRouter = StackRouter(routerOptions(publicTree.names));
  let state = publicRouter.getInitialState(routerOptions(publicTree.names));
  state = navigate(publicRouter, state, publicTree.names, 'Login');

  const signupTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    postAuthRoute: 'ProfileQuestionnaire',
  });
  assert.equal(signupTree.names[0], 'ProfileQuestionnaire');
  state = routeChange(publicRouter, state, signupTree.names);
  assert.deepEqual(state.routes.map((route) => route.name), ['ProfileQuestionnaire']);

  const logoutTree = renderStack({ isAuthenticated: false, sessionStatus: 'unauthenticated' });
  assert.equal(logoutTree.names[0], 'Welcome');
  state = routeChange(publicRouter, state, logoutTree.names);
  assert.deepEqual(state.routes.map((route) => route.name), ['Welcome']);

  state = navigate(publicRouter, state, logoutTree.names, 'Login');
  const reloginTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    postAuthRoute: 'MainTabs',
  });
  assert.equal(reloginTree.names[0], 'MainTabs');
  state = routeChange(publicRouter, state, reloginTree.names);
  assert.deepEqual(state.routes.map((route) => route.name), ['MainTabs']);

  const restoredTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    postAuthRoute: 'MainTabs',
    user: { hasCompletedQuestionnaire: true },
  });
  const restoredRouter = StackRouter(routerOptions(restoredTree.names));
  state = restoredRouter.getInitialState(routerOptions(restoredTree.names));
  assert.equal(state.routes[state.index].name, 'MainTabs');

  // Uma inicialização pode criar o roteador já autenticado. Após o logout,
  // um novo cadastro ainda deve abrir o questionário, e não a rota antiga do aplicativo.
  const signedOutAfterRestore = renderStack({
    isAuthenticated: false,
    sessionStatus: 'unauthenticated',
  });
  state = routeChange(restoredRouter, state, signedOutAfterRestore.names);
  state = navigate(restoredRouter, state, signedOutAfterRestore.names, 'Register');
  const signupAfterRestore = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    postAuthRoute: 'ProfileQuestionnaire',
  });
  state = routeChange(restoredRouter, state, signupAfterRestore.names);
  assert.equal(state.routes[state.index].name, 'ProfileQuestionnaire');
});

test('failed authentication leaves the Login route set available and does not produce an authenticated route', () => {
  const loginErrorTree = renderStack({
    isAuthenticated: false,
    sessionStatus: 'unauthenticated',
    authNotice: 'Credenciais inválidas',
  });
  assert.ok(loginErrorTree.names.includes('Login'));
  assert.ok(!loginErrorTree.names.includes('MainTabs'));
  assert.equal(loginErrorTree.names[0], 'Login');
});

test('HomeScreen logout calls auth.logout once and leaves navigation to AuthSessionGate', async () => {
  let finishLogout;
  let logoutCalls = 0;
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: {
      user: { hasCompletedQuestionnaire: true },
      logout: () => {
        logoutCalls += 1;
        return new Promise((resolve) => {
          finishLogout = resolve;
        });
      },
    },
  });

  let logoutPromise;
  h.act(() => {
    const button = h.nodes.find(
      (node) => node.type === 'Pressable' && textOf(node) === 'Sair da conta'
    );
    assert.ok(button);
    logoutPromise = button.props.onPress();
  });
  assert.equal(logoutCalls, 1);
  const logoutButton = h.nodes.find(
    (node) => node.type === 'Pressable' && textOf(node) === 'Saindo...'
  );
  assert.ok(logoutButton, 'loading state is shown while logout is pending');
  assert.equal(logoutButton.props.disabled, true, 'repeat presses are blocked while logging out');

  finishLogout();
  await logoutPromise;
  assert.deepEqual(h.navigationCalls, []);
});

test('K05 Auditoria: Login com questionario pendente direciona para ProfileQuestionnaire', async () => {
  const publicTree = renderStack({ isAuthenticated: false, sessionStatus: 'unauthenticated' });
  const publicRouter = StackRouter(routerOptions(publicTree.names));
  let state = publicRouter.getInitialState(routerOptions(publicTree.names));
  state = navigate(publicRouter, state, publicTree.names, 'Login');

  const loginScreen = createHarness('screens/auth/LoginScreen.js', {
    authContext: {
      clearNotices() {},
      async login() {
        authState = {
          isAuthenticated: true,
          sessionStatus: 'authenticated',
          postAuthRoute: 'ProfileQuestionnaire',
          user: { id: 'u-1', name: 'Pendente', hasCompletedQuestionnaire: false },
        };
        return { status: 'authenticated', user: authState.user, nextRoute: 'ProfileQuestionnaire' };
      },
    },
  });

  for (const [placeholder, value] of [
    ['seu.email@exemplo.com', 'pendente@example.com'],
    ['Digite sua senha', 'ValidPassword#2026'],
  ]) {
    loginScreen.act(() => {
      loginScreen.nodes.find(
        (node) => node.type === 'TextInput' && node.props.placeholder === placeholder
      ).props.onChangeText(value);
    });
  }
  await loginScreen.actAsync(() => loginScreen.press('Entrar na conta'));
  assert.deepEqual(loginScreen.navigationCalls, []);

  const signedInTree = renderStack(authState);
  assert.equal(signedInTree.names[0], 'ProfileQuestionnaire', 'Primeira rota da stack deve ser ProfileQuestionnaire');
  state = routeChange(publicRouter, state, signedInTree.names);
  assert.deepEqual(state.routes.map((route) => route.name), ['ProfileQuestionnaire']);
  assert.equal(state.routes[state.index].name, 'ProfileQuestionnaire');
});

test('K05 Auditoria: Restauracao de sessao com questionario pendente direciona para ProfileQuestionnaire', () => {
  const pendingRestoreTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    user: { id: 'u-2', name: 'Restaurado Pendente', hasCompletedQuestionnaire: false },
  });
  assert.equal(pendingRestoreTree.names[0], 'ProfileQuestionnaire');
  const router = StackRouter(routerOptions(pendingRestoreTree.names));
  const state = router.getInitialState(routerOptions(pendingRestoreTree.names));
  assert.equal(state.routes[state.index].name, 'ProfileQuestionnaire');
});

test('Adversarial A.1: Usuario com questionario pendente tem acesso estritamente bloqueado a rotas operacionais', () => {
  const pendingTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    user: { id: 'u-pending', name: 'Participante Pendente', hasCompletedQuestionnaire: false },
  });

  // Apenas ProfileQuestionnaire e alias Questionario devem estar presentes na Stack
  assert.deepEqual(pendingTree.names, ['ProfileQuestionnaire', 'Questionario']);

  const router = StackRouter(routerOptions(pendingTree.names));
  const initialState = router.getInitialState(routerOptions(pendingTree.names));
  assert.equal(initialState.routes[initialState.index].name, 'ProfileQuestionnaire');

  // Tentativas de navegacao direta para qualquer rota operacional devem ser completamente rejeitadas
  for (const forbiddenRoute of ['MainTabs', 'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation']) {
    const attemptedState = navigate(router, initialState, pendingTree.names, forbiddenRoute);
    assert.equal(
      attemptedState,
      null,
      `Rota operacional "${forbiddenRoute}" nao deve ser acessivel para usuario com questionario pendente`
    );
  }
});

test('Adversarial A.2: Usuario com questionario concluido tem acesso completo as rotas operacionais', () => {
  const completedTree = renderStack({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    user: { id: 'u-completed', name: 'Participante Concluido', hasCompletedQuestionnaire: true },
  });

  assert.ok(completedTree.names.includes('MainTabs'));
  assert.ok(completedTree.names.includes('EventEntry'));
  assert.ok(completedTree.names.includes('EventConfirmation'));
  assert.ok(completedTree.names.includes('ParticipationDetails'));
  assert.ok(completedTree.names.includes('Evaluation'));

  const router = StackRouter(routerOptions(completedTree.names));
  const initialState = router.getInitialState(routerOptions(completedTree.names));
  assert.equal(initialState.routes[initialState.index].name, 'MainTabs');

  const navEventEntry = navigate(router, initialState, completedTree.names, 'EventEntry');
  assert.ok(navEventEntry);
  assert.equal(navEventEntry.routes[navEventEntry.index].name, 'EventEntry');
});

test('Adversarial A.3: Questionario de perfil preserva acoes para encerrar a sessao via logout', async () => {
  let logoutCalled = false;
  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: ['handleBack'],
    authContext: {
      isAuthenticated: true,
      user: { id: 'u-1', hasCompletedQuestionnaire: false },
      httpClient: {
        get: () => ({ then: (fn) => { fn({}); return { catch: () => {} }; } }),
      },
      logout: () => {
        logoutCalled = true;
      },
    },
  });

  // Verifica que o botao "Sair da conta" esta presente e acessivel no cabecalho
  h.act(() => h.press('Sair da conta'));
  assert.equal(logoutCalled, true, 'Botao de sair no cabecalho deve disparar auth.logout()');

  // Verifica que handleBack na etapa 0 tambem dispara logout quando nao ha tela anterior
  logoutCalled = false;
  h.act((c) => c.handleBack());
  assert.equal(logoutCalled, true, 'handleBack na etapa 0 deve disparar logout para nao reter usuario preso');
});
