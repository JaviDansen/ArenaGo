const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createHarness, createParticipantThemeStub, createParticipantUiStubs, loadModule, nodes, textOf,
} = require('./helpers/questionnaireHarness.cjs');

test('auth and questionnaire screens use the intended shared and welcome backgrounds', () => {
  const screens = [
    ['screens/auth/WelcomeScreen.js', 'welcome-background', 'welcome-background.png'],
    ['screens/auth/LoginScreen.js', 'login-background', 'shared-background.png'],
    ['screens/auth/RegisterScreen.js', 'register-background', 'shared-background.png'],
    ['screens/auth/ForgotPasswordScreen.js', 'forgot-password-background', 'shared-background.png'],
    ['screens/profile/ProfileQuestionnaireScreen.js', 'questionnaire-background', 'shared-background.png'],
  ];
  for (const [screen, testID, asset] of screens) {
    const h = createHarness(screen);
    const background = h.nodes.find((node) => node.type === 'Image' && node.props?.testID === `${testID}-image`);
    assert.ok(background, `${screen}: background image`);
    assert.ok(background.props.source?.uri?.endsWith(`/${asset}`), `${screen}: ${asset}`);
  }

  const edit = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    props: { route: { params: { mode: 'edit' } } },
    authContext: { isAuthenticated: false },
  });
  assert.ok(edit.nodes.some((node) => node.props?.testID === 'questionnaire-background'));
  assert.ok(edit.nodes.some((node) => node.props?.accessibilityRole === 'alert'));
});

test('login and registration password controls preserve the entered values', () => {
  for (const [screen, inputId] of [
    ['screens/auth/LoginScreen.js', 'login-password-input'],
    ['screens/auth/RegisterScreen.js', 'register-password-input'],
  ]) {
    const h = createHarness(screen);
    const input = () => h.nodes.find((node) => node.type === 'TextInput' && node.props?.testID === inputId);
    assert.ok(input(), `${screen}: password input`);
    h.act(() => input().props.onChangeText('SenhaSegura123'));
    assert.equal(input().props.secureTextEntry, true);
    h.act(() => h.press('Mostrar senha'));
    assert.equal(input().props.secureTextEntry, false);
    assert.equal(input().props.value, 'SenhaSegura123');
    h.act(() => h.press('Ocultar senha'));
    assert.equal(input().props.secureTextEntry, true);
    h.act(() => h.press('Mostrar senha'));
    h.setFocused(false);
    assert.equal(input().props.secureTextEntry, true, `${screen}: password is hidden on blur`);
  }
});

test('unavailable real evaluation keeps its message on the participant background', () => {
  let submissions = 0;
  const screen = loadModule('screens/participation/RealEvaluationScreen.js', (name) => {
    if (name === 'react') return {
      useCallback: (fn) => fn,
      useContext: () => ({ refreshParticipation: async () => {} }),
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    };
    if (name === 'react-native') return {
      StyleSheet: { create: (styles) => styles }, Text: 'Text', View: 'View',
    };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'expo-crypto') return { randomUUID: () => 'test-key' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') return { useAuth: () => ({ isAuthenticated: false }) };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../../services/participationHistoryService') return { validateHistoryItem: () => false };
    if (name === '../../services/participationActionService') return {
      createParticipationActionCoordinator: () => ({ submit: () => { submissions += 1; } }),
      describeParticipationActionError: () => 'Erro',
    };
    if (name === './EvaluationScreen') return { __esModule: true, default: 'EvaluationScreen' };
    return require(name);
  }).exports.default;

  const rendered = nodes(screen({ navigation: {}, route: { params: {} } }));
  assert.ok(rendered.some((node) => node.props?.testID === 'evaluation-unavailable-background'));
  assert.ok(rendered.some((node) => node.type === 'Text'
    && textOf(node).includes('A avaliação não está disponível para esta participação.')));
  assert.equal(submissions, 0);
});
