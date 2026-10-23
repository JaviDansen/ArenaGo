const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

function element(type, props = {}) {
  return { type, props };
}

const react = {
  isValidElement(value) {
    return Boolean(value && typeof value === 'object' && value.props);
  },
  cloneElement(value, props, ...children) {
    const nextProps = { ...value.props, ...props };
    if (children.length) nextProps.children = children.length === 1 ? children[0] : children;
    return { ...value, props: nextProps };
  },
};

const { adaptNavigationTree, resolveInitialRouteForAuthState } = loadModule(
  'screens/auth/AuthSessionGate.js',
  (name) => {
    if (name === 'react') return react;
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'react-native') {
      return Object.fromEntries(
        ['ActivityIndicator', 'Pressable', 'SafeAreaView', 'StyleSheet', 'Text', 'View'].map(
          (key) => [key, key === 'StyleSheet' ? { create: (styles) => styles } : key]
        )
      );
    }
    if (name === '../../context/AuthContext') return { AuthProvider: 'AuthProvider', useAuth: () => null };
    return require(name);
  }
).exports;

function navigationTree() {
  const names = [
    'Welcome', 'Login', 'Register', 'ProfileQuestionnaire', 'MainTabs',
    'EventEntry', 'EventConfirmation', 'ParticipationDetails', 'Evaluation',
  ];
  const screens = names.map((name) => element('Screen', { name }));
  return element('NavigationContainer', {
    children: element('StackNavigator', { initialRouteName: 'Welcome', children: screens }),
  });
}

function navigatorOf(tree) {
  return tree.props.children;
}

test('AuthSessionGate changes the navigator initial route and protected routes with session state', () => {
  const publicTree = adaptNavigationTree(navigationTree(), {
    isAuthenticated: false,
    sessionStatus: 'unauthenticated',
  });
  const publicNavigator = navigatorOf(publicTree);
  assert.equal(publicNavigator.props.initialRouteName, 'Welcome');
  assert.equal(publicNavigator.props.key, 'unauth-Welcome');
  assert.deepEqual(publicNavigator.props.children.map((screen) => screen.props.name), [
    'Welcome', 'Login', 'Register',
  ]);

  const registrationSession = {
    isAuthenticated: true,
    postAuthRoute: 'ProfileQuestionnaire',
  };
  assert.equal(resolveInitialRouteForAuthState(registrationSession), 'ProfileQuestionnaire');
  const registrationTree = adaptNavigationTree(navigationTree(), registrationSession);
  const registrationNavigator = navigatorOf(registrationTree);
  assert.equal(registrationNavigator.props.initialRouteName, 'ProfileQuestionnaire');
  assert.equal(registrationNavigator.props.key, 'auth-ProfileQuestionnaire');
  assert.equal(registrationTree.props.key, undefined, 'the NavigationContainer stays mounted');
  assert.ok(registrationNavigator.props.children.some((screen) => screen.props.name === 'ProfileQuestionnaire'));

  const loginSession = { isAuthenticated: true, postAuthRoute: 'MainTabs' };
  assert.equal(resolveInitialRouteForAuthState(loginSession), 'MainTabs');
  const loginTree = adaptNavigationTree(registrationTree, loginSession);
  assert.equal(navigatorOf(loginTree).props.initialRouteName, 'MainTabs');
  assert.equal(navigatorOf(loginTree).props.key, 'auth-MainTabs');
});

test('AuthSessionGate returns to a public route after logout and routes restored sessions from auth state', () => {
  const authenticatedTree = adaptNavigationTree(navigationTree(), {
    isAuthenticated: true,
    postAuthRoute: 'MainTabs',
  });
  const loggedOutTree = adaptNavigationTree(authenticatedTree, {
    isAuthenticated: false,
    sessionStatus: 'unauthenticated',
  });
  assert.equal(navigatorOf(loggedOutTree).props.initialRouteName, 'Welcome');
  assert.equal(navigatorOf(loggedOutTree).props.key, 'unauth-Welcome');
  assert.deepEqual(navigatorOf(loggedOutTree).props.children.map((screen) => screen.props.name), [
    'Welcome', 'Login', 'Register',
  ]);

  const newLoginTree = adaptNavigationTree(navigationTree(), {
    isAuthenticated: true,
    postAuthRoute: 'MainTabs',
  });
  assert.equal(navigatorOf(newLoginTree).props.initialRouteName, 'MainTabs');
  assert.equal(navigatorOf(newLoginTree).props.key, 'auth-MainTabs');

  assert.equal(resolveInitialRouteForAuthState({
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    postAuthRoute: 'MainTabs',
    user: { hasCompletedQuestionnaire: false },
  }), 'MainTabs');
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
