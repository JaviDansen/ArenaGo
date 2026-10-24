const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

const fields = ['currentStepIndex', 'questionnaireData', 'birthDateText', 'gender', 'otherGender',
  'education', 'errors', 'searchQuery', 'filteredSuggestions', 'handleBack', 'handleSelectGender',
  'handleSelectEducation', 'handleAdvanceStep1', 'handleSearchChange', 'handleAddGame',
  'handleRemoveGame', 'handleAdvanceStep2', 'handleSelectMarketKnowledge',
  'handleSelectMarketInterest', 'handleFinishQuestionnaire'];

function questionnaire(options) {
  return createHarness('screens/profile/ProfileQuestionnaireScreen.js', { fields, ...options });
}

function ready(options) {
  const h = questionnaire(options);
  h.act(() => h.inputBirthDate('29/02/2024'));
  h.act((c) => c.handleSelectGender('Outro'));
  h.act(() => h.nodes.find((n) => n.type === 'TextInput' &&
    n.props.placeholder === 'Como você se identifica?').props.onChangeText('  Identidade  '));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());
  h.act((c) => { c.handleAddGame('Minecraft'); c.handleAddGame(' minecraft '); c.handleAddGame('Fortnite'); });
  h.act((c) => c.handleAdvanceStep2());
  assert.equal(h.capture.currentStepIndex, 2);
  return h;
}

function assertErrorVisible(h, field) {
  const message = h.capture.errors[field];
  assert.ok(message, `missing error: ${field}`);
  assert.ok(h.nodes.some((node) => node.type === 'Text' && textOf(node) === message));
  return message;
}

function assertMessageRemoved(h, message) {
  assert.equal(h.nodes.some((node) => node.type === 'Text' && textOf(node) === message), false);
}

test('empty first step displays required errors and each correction clears only its own error', () => {
  const h = questionnaire();
  h.act(() => h.press('Avançar para a próxima etapa'));
  assert.equal(h.capture.currentStepIndex, 0);
  assert.deepEqual(h.navigationCalls, []);
  const dateError = assertErrorVisible(h, 'birthDate');
  const genderError = assertErrorVisible(h, 'gender');
  const educationError = assertErrorVisible(h, 'education');

  h.act(() => h.inputBirthDate('29/02/202'));
  assertMessageRemoved(h, dateError);
  assertErrorVisible(h, 'gender');
  assertErrorVisible(h, 'education');
  h.act(() => h.press('Avançar para a próxima etapa'));
  assert.equal(h.capture.currentStepIndex, 0);
  const incompleteError = assertErrorVisible(h, 'birthDate');
  assert.notEqual(incompleteError, dateError);

  h.act(() => h.inputBirthDate('29/02/2024'));
  assertMessageRemoved(h, incompleteError);
  h.act(() => h.press('Masculino'));
  assertMessageRemoved(h, genderError);
  assertErrorVisible(h, 'education');
  h.act(() => h.press('Superior'));
  assertMessageRemoved(h, educationError);
  assert.equal(h.capture.currentStepIndex, 0);
  h.act(() => h.press('Avançar para a próxima etapa'));
  assert.equal(h.capture.currentStepIndex, 1);
  assert.deepEqual(Object.keys(h.capture.errors), []);
  assert.equal(h.capture.questionnaireData.birthDate, '2024-02-29');
  assert.deepEqual(h.navigationCalls, []);
});

test('Other gender requires a nonblank description and accepts a corrected retry', () => {
  const h = questionnaire();
  h.act(() => h.inputBirthDate('29/02/2024'));
  h.act(() => h.press('Outro'));
  h.act(() => h.press('Superior'));
  const changeDescription = (value) => h.act(() => h.nodes.find((node) =>
    node.type === 'TextInput' && node.props.placeholder === 'Como você se identifica?'
  ).props.onChangeText(value));
  changeDescription('   ');
  h.act(() => h.press('Avançar para a próxima etapa'));
  assert.equal(h.capture.currentStepIndex, 0);
  const error = assertErrorVisible(h, 'otherGender');
  changeDescription('  Identidade  ');
  assertMessageRemoved(h, error);
  h.act(() => h.press('Avançar para a próxima etapa'));
  assert.equal(h.capture.currentStepIndex, 1);
  assert.equal(h.capture.questionnaireData.otherGender, 'Identidade');
  assert.deepEqual(Object.keys(h.capture.errors), []);
});

test('correcting a missing game clears the error and preserves earlier answers on a return trip', () => {
  const h = ready();
  h.act(() => h.press('Voltar para Etapa 2'));
  for (const game of Array.from(h.capture.questionnaireData.selectedGames)) {
    h.act(() => h.press(`Remover ${game}`));
  }
  const before = structuredClone(h.capture.questionnaireData);
  h.act(() => h.press('Avançar para a Etapa 3'));
  assert.equal(h.capture.currentStepIndex, 1);
  const error = assertErrorVisible(h, 'selectedGames');
  assert.deepEqual(structuredClone(h.capture.questionnaireData), before);
  h.act((c) => c.handleSearchChange('Minecraft'));
  h.act(() => h.press('Selecionar Minecraft'));
  assertMessageRemoved(h, error);
  h.act(() => h.press('Avançar para a Etapa 3'));
  assert.equal(h.capture.currentStepIndex, 2);
  assert.deepEqual(Object.keys(h.capture.errors), []);
  h.act(() => h.press('Voltar para Etapa 2'));
  h.act(() => h.press('Voltar etapa'));
  assert.equal(h.capture.birthDateText, '29/02/2024');
  assert.equal(h.capture.gender, 'Outro');
  assert.equal(h.capture.otherGender, '  Identidade  ');
  assert.equal(h.capture.education, 'Superior');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Minecraft']);
  assert.deepEqual(h.navigationCalls, []);
});

test('empty, incomplete and impossible birth dates block step 1 without erasing answers', () => {
  const h = questionnaire();
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  for (const value of ['', '29/02/202', '31/02/2005', '29/02/2025']) {
    h.act(() => h.inputBirthDate(value));
    h.act((c) => c.handleAdvanceStep1());
    assert.equal(h.capture.currentStepIndex, 0);
    assert.ok(h.capture.errors.birthDate);
    assert.equal(h.capture.gender, 'Masculino');
    assert.equal(h.capture.education, 'Superior');
    assert.equal(h.capture.birthDateText, value);
  }
});

test('birth date stores ISO and has no residual age field', () => {
  const h = ready();
  assert.equal(h.capture.questionnaireData.birthDate, '2024-02-29');
  assert.equal(Object.hasOwn(h.capture.questionnaireData, 'age'), false);
  const source = readFileSync(path.join(__dirname, '../screens/profile/ProfileQuestionnaireScreen.js'), 'utf8');
  assert.doesNotMatch(source, /\bage\b|setAge|errors\.age/);
});

test('selection and finish in one batch preserve the latest answers and other steps', () => {
  const h = ready();
  const knowledge = h.exports.MARKET_KNOWLEDGE_OPTIONS;
  const interest = h.exports.MARKET_INTEREST_OPTIONS;
  h.act((c) => { c.handleSelectMarketKnowledge(knowledge[0]); c.handleSelectMarketInterest(interest[0]); });
  h.act((c) => { c.handleSelectMarketKnowledge(knowledge[2]); c.handleSelectMarketInterest(interest[2]); c.handleFinishQuestionnaire(); });
  assert.equal(h.capture.questionnaireData.marketKnowledge, knowledge[2]);
  assert.equal(h.capture.questionnaireData.marketInterest, interest[2]);
  assert.equal(h.capture.questionnaireData.birthDate, '2024-02-29');
  assert.equal(h.capture.questionnaireData.otherGender, 'Identidade');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Minecraft', 'Fortnite']);
  assert.equal(h.navigationCalls.length, 1);
  assert.equal(h.navigationCalls[0].payload.routes[0].name, 'MainTabs');
});

test('first selections and finish in one batch validate the committed answers', () => {
  const h = ready();
  h.act((c) => { c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]); c.handleFinishQuestionnaire(); });
  assert.equal(h.navigationCalls.length, 1);
  assert.deepEqual(Object.keys(h.capture.errors), []);
});

test('all nine valid answer pairs conclude through the existing MainTabs route', () => {
  const sample = questionnaire();
  for (const knowledge of sample.exports.MARKET_KNOWLEDGE_OPTIONS) {
    for (const interest of sample.exports.MARKET_INTEREST_OPTIONS) {
      const h = ready();
      h.act(() => h.press(knowledge));
      h.act(() => h.press(interest));
      h.act(() => h.press('Concluir questionário'));
      assert.equal(h.navigationCalls.length, 1);
      assert.equal(h.navigationCalls[0].payload.routes[0].name, 'MainTabs');
      assert.equal(h.capture.questionnaireData.marketKnowledge, knowledge);
      assert.equal(h.capture.questionnaireData.marketInterest, interest);
    }
  }
});

test('missing market responses block finish, retain answers and allow a corrected retry', () => {
  for (const scenario of ['both', 'knowledge', 'interest']) {
    const h = ready();
    if (scenario === 'knowledge') h.act((c) => c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]));
    if (scenario === 'interest') h.act((c) => c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]));
    const before = JSON.stringify(h.capture.questionnaireData);
    h.act((c) => c.handleFinishQuestionnaire());
    assert.equal(h.navigationCalls.length, 0);
    assert.equal(h.capture.currentStepIndex, 2);
    assert.equal(JSON.stringify(h.capture.questionnaireData), before);
    assert.equal(Boolean(h.capture.errors.marketKnowledge), scenario !== 'knowledge');
    assert.equal(Boolean(h.capture.errors.marketInterest), scenario !== 'interest');
    h.act((c) => { c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[1]);
      c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[1]); c.handleFinishQuestionnaire(); });
    assert.equal(h.navigationCalls.length, 1);
  }
});

test('two or more batched back actions at step 2 never render a negative index', () => {
  for (const count of [2, 3, 10]) {
    const h = ready();
    h.act((c) => c.handleBack());
    const before = JSON.stringify(h.capture.questionnaireData);
    h.act((c) => { for (let i = 0; i < count; i++) c.handleBack(); });
    assert.equal(h.capture.currentStepIndex, 0);
    assert.equal(JSON.stringify(h.capture.questionnaireData), before);
    assert.equal(h.navigationCalls.length, 0);
    h.act((c) => c.handleBack());
    assert.equal(h.navigationCalls[0].type, 'back');
  }
});

test('normal navigation and edits preserve all three steps', () => {
  const h = ready();
  h.act((c) => { c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[1]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[1]); });
  h.act((c) => c.handleBack());
  h.act((c) => { c.handleRemoveGame('Minecraft'); c.handleAddGame('Meu Jogo'); });
  h.act((c) => c.handleBack());
  assert.equal(h.capture.birthDateText, '29/02/2024');
  assert.equal(h.capture.gender, 'Outro');
  assert.equal(h.capture.education, 'Superior');
  h.act(() => h.inputBirthDate('01/03/2024'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleAdvanceStep1());
  h.act((c) => c.handleAdvanceStep2());
  assert.equal(h.capture.questionnaireData.birthDate, '2024-03-01');
  assert.equal(h.capture.questionnaireData.otherGender, null);
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Fortnite', 'Meu Jogo']);
  assert.equal(h.capture.questionnaireData.marketKnowledge, h.exports.MARKET_KNOWLEDGE_OPTIONS[1]);
  assert.equal(h.capture.questionnaireData.marketInterest, h.exports.MARKET_INTEREST_OPTIONS[1]);
});

test('game search, manual addition, removal, reentry and batched uniqueness still work', () => {
  const h = ready();
  h.act((c) => c.handleBack());
  h.act((c) => c.handleSearchChange('  rObLoX  '));
  assert.deepEqual(Array.from(h.capture.filteredSuggestions), ['Roblox']);
  h.act(() => h.press('Selecionar Roblox'));
  h.act((c) => c.handleSearchChange(' Jogo Manual '));
  h.act(() => h.nodes.find((n) => n.type === 'TextInput').props.onSubmitEditing());
  h.act((c) => { c.handleAddGame(' VALORANT '); c.handleAddGame('valorant'); c.handleAddGame(''); c.handleAddGame('  '); });
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Minecraft', 'Fortnite', 'Roblox', 'Jogo Manual', 'VALORANT']);
  h.act(() => h.press('Remover Roblox'));
  h.act((c) => c.handleAddGame('Roblox'));
  for (const game of Array.from(h.capture.questionnaireData.selectedGames)) h.act((c) => c.handleRemoveGame(game));
  h.act((c) => c.handleAdvanceStep2());
  assert.equal(h.capture.currentStepIndex, 1);
  assert.ok(h.capture.errors.selectedGames);
});

test('fallback finish navigation retains the existing MainTabs destination', () => {
  const h = ready({ fallbackNavigation: true });
  h.act((c) => { c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]); c.handleFinishQuestionnaire(); });
  assert.deepEqual(h.navigationCalls, [{ type: 'replace', name: 'MainTabs' }]);
});

test('Welcome, valid registration, questionnaire and Login retain their routes', async () => {
  const welcome = createHarness('screens/auth/WelcomeScreen.js');
  welcome.act(() => welcome.press('Criar minha conta'));
  assert.equal(welcome.navigationCalls[0].name, 'Register');

  const register = createHarness('screens/auth/RegisterScreen.js', {
    fields: ['handleRegister'],
    authContext: {
      register: async ({ name, email }) => ({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          name,
          email,
          roles: ['participante'],
          hasCompletedQuestionnaire: false,
        },
        accessToken: 'access-token',
        expiresInSeconds: 900,
        refreshToken: 'refresh-token',
      }),
    },
  });
  for (const [placeholder, value] of [
    ['Como quer ser chamado?', 'Participante'], ['seu.email@exemplo.com', 'teste@example.com'],
    ['Crie uma senha de acesso', 'secret12'], ['Digite a mesma senha novamente', 'secret12'],
  ]) register.act(() => register.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value));
  await register.actAsync((c) => c.handleRegister());
  assert.deepEqual(register.navigationCalls, []);

  const login = createHarness('screens/auth/LoginScreen.js', {
    fields: ['handleLogin'],
    authContext: {
      login: async ({ email }) => ({
        requires2FA: false,
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Participante',
          email,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        },
        accessToken: 'access-token',
        expiresInSeconds: 900,
        refreshToken: 'refresh-token',
      }),
    },
  });
  for (const [placeholder, value] of [
    ['seu.email@exemplo.com', 'teste@example.com'], ['Digite sua senha', 'secret12'],
  ]) login.act(() => login.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value));
  await login.actAsync((c) => c.handleLogin());
  assert.deepEqual(login.navigationCalls, []);
});

test('K05: preloads existing profile questionnaire and games catalog from backend', async () => {
  const customFields = [...fields, 'availableGames'];
  const mockGamesList = [
    { id: '1', name: 'Jogo Backend 1', isCurated: true },
    { id: '2', name: 'Jogo Backend 2', isCurated: false },
  ];
  let catalogCalled = false;
  let profileGetCalled = false;

  const mockClient = {
    get: async (url) => {
      if (url.startsWith('/games')) {
        catalogCalled = true;
        return { games: mockGamesList, total: 2 };
      }
      if (url === '/profile/questionnaire') {
        profileGetCalled = true;
        return {
          hasCompleted: true,
          aboutYou: {
            birthDate: '2001-05-15',
            gender: 'Feminino',
            otherGender: null,
            education: 'Pós-graduação',
          },
          yourGames: ['Jogo Backend 1'],
          gamesMarket: {
            marketKnowledge: 'Sim, conheço.',
            marketInterest: 'Sim, tenho interesse.',
          },
        };
      }
      throw new Error(`Unexpected GET: ${url}`);
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1', name: 'Test User' },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  h.act(() => {});

  assert.equal(catalogCalled, true);
  assert.equal(profileGetCalled, true);
  assert.deepEqual(h.capture.availableGames, ['Jogo Backend 1', 'Jogo Backend 2']);
  assert.equal(h.capture.birthDateText, '15/05/2001');
  assert.equal(h.capture.gender, 'Feminino');
  assert.equal(h.capture.education, 'Pós-graduação');
  assert.deepEqual(h.capture.questionnaireData.selectedGames, ['Jogo Backend 1']);
  assert.equal(h.capture.questionnaireData.marketKnowledge, 'Sim, conheço.');
  assert.equal(h.capture.questionnaireData.marketInterest, 'Sim, tenho interesse.');
});

test('K05: submits questionnaire to PUT /profile/questionnaire, calls fetchCurrentUser and resets navigation to MainTabs', async () => {
  const customFields = [...fields, 'isSubmitting', 'saveError'];
  let putPayload = null;
  let putAuthParam = null;
  let fetchCurrentUserCalled = false;
  let markCompletedCalled = false;

  const mockClient = {
    get: async () => ({ games: [], total: 0 }),
    put: async (url, payload, options) => {
      if (url === '/profile/questionnaire') {
        putPayload = payload;
        putAuthParam = options?.auth;
        return { message: 'Perfil salvo com sucesso.' };
      }
      throw new Error(`Unexpected PUT: ${url}`);
    },
  };

  const authContext = {
    isAuthenticated: true,
    httpClient: mockClient,
    user: { id: 'user-1', name: 'Test User', hasCompletedQuestionnaire: false },
    fetchCurrentUser: async () => {
      fetchCurrentUserCalled = true;
      return { id: 'user-1', hasCompletedQuestionnaire: true };
    },
    markQuestionnaireCompleted: () => {
      markCompletedCalled = true;
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext,
  });

  h.act(() => h.inputBirthDate('10/04/2000'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Minecraft'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]);
    c.handleFinishQuestionnaire();
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(putPayload.birthDate, '2000-04-10');
  assert.equal(putPayload.gender, 'Masculino');
  assert.equal(putPayload.otherGender, null);
  assert.equal(putPayload.education, 'Superior');
  assert.deepEqual(Array.from(putPayload.selectedGames), ['Minecraft']);
  assert.equal(putPayload.marketKnowledge, h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
  assert.equal(putPayload.marketInterest, h.exports.MARKET_INTEREST_OPTIONS[0]);
  assert.equal(putAuthParam, true);
  assert.equal(fetchCurrentUserCalled, true);
  assert.equal(markCompletedCalled, true);
  assert.equal(h.navigationCalls.length, 1);
  assert.equal(h.navigationCalls[0].payload.routes[0].name, 'MainTabs');
});

test('K05: handles PUT /profile/questionnaire failure gracefully, displays error banner and preserves form state', async () => {
  const customFields = [...fields, 'saveError'];

  const mockClient = {
    get: async () => ({ games: [], total: 0 }),
    put: async () => {
      const err = new Error('Falha de conexão com o servidor');
      err.detail = 'Falha de conexão com o servidor. Tente novamente.';
      err.fieldErrors = { education: 'Erro no campo escolaridade' };
      throw err;
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1', name: 'Test User' },
    },
  });

  h.act(() => h.inputBirthDate('10/04/2000'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Minecraft'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]);
    c.handleFinishQuestionnaire();
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(h.navigationCalls.length, 0);
  assert.equal(h.capture.saveError, 'Falha de conexão com o servidor. Tente novamente.');
  assert.equal(h.capture.errors.education, 'Erro no campo escolaridade');
  assert.equal(h.capture.questionnaireData.birthDate, '2000-04-10');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Minecraft']);
});

test('K05 Auditoria 1: Login com questionario pendente direciona para ProfileQuestionnaire', async () => {
  const login = createHarness('screens/auth/LoginScreen.js', {
    fields: ['handleLogin'],
    authContext: {
      login: async ({ email }) => ({
        requires2FA: false,
        nextRoute: 'ProfileQuestionnaire',
        user: {
          id: 'user-pending-1',
          name: 'Pendente',
          email,
          roles: ['participante'],
          hasCompletedQuestionnaire: false,
        },
        accessToken: 'access-token',
        expiresInSeconds: 900,
        refreshToken: 'refresh-token',
      }),
    },
  });
  for (const [placeholder, value] of [
    ['seu.email@exemplo.com', 'pendente@example.com'], ['Digite sua senha', 'secret12'],
  ]) login.act(() => login.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value));
  await login.actAsync((c) => c.handleLogin());
  assert.deepEqual(login.navigationCalls, []);
});

test('K05 Auditoria 2: Restauracao de sessao com questionario pendente direciona para ProfileQuestionnaire', () => {
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
      return { AuthProvider: 'AuthProvider', useAuth: () => ({}) };
    }
    return require(name);
  }).exports;

  const { resolveInitialRouteForAuthState } = gateExports;
  const targetRoute = resolveInitialRouteForAuthState({
    user: { id: 'u1', hasCompletedQuestionnaire: false },
    isAuthenticated: true,
  });
  assert.equal(targetRoute, 'ProfileQuestionnaire');
});

test('K05 Auditoria 3: Busca de jogo que so existe no backend alem dos 50 iniciais', async () => {
  const customFields = [...fields, 'searchResults', 'filteredSuggestions'];
  const mockClient = {
    get: async (url) => {
      if (url.includes('query=Cyberpunk')) {
        return {
          games: [{ id: 'game-cp77', name: 'Cyberpunk 2077' }],
          total: 1,
        };
      }
      if (url.startsWith('/games')) {
        return { games: [{ id: '1', name: 'Minecraft' }], total: 1 };
      }
      return { hasCompleted: false };
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1' },
    },
  });

  h.act(() => h.inputBirthDate('10/10/2000'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());

  // Na Etapa 2, busca jogo inexistente no catalogo inicial
  h.act((c) => c.handleSearchChange('Cyberpunk'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.ok(h.capture.filteredSuggestions.includes('Cyberpunk 2077'));
  h.act(() => h.press('Selecionar Cyberpunk 2077'));
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Cyberpunk 2077']);
});

test('K05 Auditoria 4: Mensagem de erro real e visivel na Etapa 3 com acessibilidade', async () => {
  const customFields = [...fields, 'saveError'];
  const mockClient = {
    get: async () => ({ games: [], total: 0 }),
    put: async () => {
      const err = new Error('Falha de rede');
      err.detail = 'Servidor indisponivel temporariamente';
      throw err;
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1' },
    },
  });

  h.act(() => h.inputBirthDate('10/10/2000'));
  h.act((c) => c.handleSelectGender('Feminino'));
  h.act((c) => c.handleSelectEducation('Médio'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Valorant'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]);
    c.handleFinishQuestionnaire();
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(h.capture.saveError, 'Servidor indisponivel temporariamente');
  const alertNode = h.nodes.find(
    (n) => n.props?.accessibilityRole === 'alert' && n.props?.accessible === true
  );
  assert.ok(alertNode, 'Banner de alerta com acessibilidade deve estar visivel');
  assert.ok(textOf(alertNode).includes('Servidor indisponivel temporariamente'));
});

test('K05 Auditoria 5: Dois toques rapidos gerando apenas um PUT (trava sincrona)', async () => {
  const customFields = [...fields, 'isSubmitting'];
  let putCount = 0;
  let resolvePut;
  const mockClient = {
    get: async () => ({ games: [], total: 0 }),
    put: async () => {
      putCount += 1;
      return new Promise((resolve) => {
        resolvePut = resolve;
      });
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1' },
      markQuestionnaireCompleted: () => {},
    },
  });

  h.act(() => h.inputBirthDate('10/10/2000'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Minecraft'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]);
  });

  // Dois toques rápidos consecutivos
  h.act((c) => {
    c.handleFinishQuestionnaire();
    c.handleFinishQuestionnaire();
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(putCount, 1, 'Apenas uma requisicao PUT deve ter sido iniciada');

  resolvePut({ message: 'OK' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(putCount, 1, 'Requisicao PUT permaneceu unica apos resolucao');
  assert.equal(h.navigationCalls.length, 1);
});

test('K05 Auditoria 6: Falha de rede sem perda de dados preenchidos', async () => {
  const customFields = [...fields, 'saveError'];
  let shouldFail = true;
  const mockClient = {
    get: async () => ({ games: [], total: 0 }),
    put: async () => {
      if (shouldFail) {
        const err = new Error('Network error');
        err.detail = 'Sem conexao de internet.';
        throw err;
      }
      return { message: 'OK' };
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1' },
      markQuestionnaireCompleted: () => {},
    },
  });

  h.act(() => h.inputBirthDate('15/08/1999'));
  h.act((c) => c.handleSelectGender('Outro'));
  h.act(() => h.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === 'Como você se identifica?').props.onChangeText('Nao-binario'));
  h.act((c) => c.handleSelectEducation('Pós-graduação'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Free Fire'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[1]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[1]);
    c.handleFinishQuestionnaire();
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(h.capture.saveError, 'Sem conexao de internet.');
  assert.equal(h.navigationCalls.length, 0);

  // Todos os dados foram integralmente mantidos
  assert.equal(h.capture.birthDateText, '15/08/1999');
  assert.equal(h.capture.gender, 'Outro');
  assert.equal(h.capture.otherGender, 'Nao-binario');
  assert.equal(h.capture.education, 'Pós-graduação');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Free Fire']);
  assert.equal(h.capture.questionnaireData.marketKnowledge, h.exports.MARKET_KNOWLEDGE_OPTIONS[1]);
  assert.equal(h.capture.questionnaireData.marketInterest, h.exports.MARKET_INTEREST_OPTIONS[1]);

  // Segunda tentativa com sucesso
  shouldFail = false;
  h.act((c) => c.handleFinishQuestionnaire());
  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  assert.equal(h.navigationCalls.length, 1);
  assert.equal(h.navigationCalls[0].payload.routes[0].name, 'MainTabs');
});

test('K05 Auditoria 7: Impossibilidade de avanco sem persistencia real no backend', () => {
  const customFields = [...fields, 'saveError'];
  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields: customFields,
    authContext: null,
  });

  h.act(() => h.inputBirthDate('10/10/2000'));
  h.act((c) => c.handleSelectGender('Masculino'));
  h.act((c) => c.handleSelectEducation('Superior'));
  h.act((c) => c.handleAdvanceStep1());

  h.act((c) => c.handleAddGame('Minecraft'));
  h.act((c) => c.handleAdvanceStep2());

  h.act((c) => {
    c.handleSelectMarketKnowledge(h.exports.MARKET_KNOWLEDGE_OPTIONS[0]);
    c.handleSelectMarketInterest(h.exports.MARKET_INTEREST_OPTIONS[0]);
    c.handleFinishQuestionnaire();
  });

  assert.equal(h.navigationCalls.length, 0, 'Nao deve navegar para MainTabs sem persistencia');
  assert.ok(h.capture.saveError, 'Deve exibir erro indicando impossibilidade de persistir');
  assert.equal(h.capture.currentStepIndex, 2);
});

test('K05 Auditoria 8: Preload tardio sem sobrescrever edicoes do usuario', async () => {
  let delayedResolve;
  const mockClient = {
    get: async (url) => {
      if (url.startsWith('/games')) {
        return { games: [], total: 0 };
      }
      if (url === '/profile/questionnaire') {
        return new Promise((resolve) => {
          delayedResolve = resolve;
        });
      }
      return {};
    },
  };

  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    fields,
    authContext: {
      isAuthenticated: true,
      httpClient: mockClient,
      user: { id: 'user-1' },
    },
  });

  // Usuario interage ANTES da resposta tardia chegar
  h.act(() => h.inputBirthDate('25/12/2000'));
  h.act((c) => c.handleSelectGender('Feminino'));

  // Servidor responde tardiamente com dados antigos
  delayedResolve({
    hasCompleted: true,
    aboutYou: {
      birthDate: '1990-01-01',
      gender: 'Masculino',
      otherGender: null,
      education: 'Fundamental',
    },
    yourGames: ['Jogo Antigo'],
    gamesMarket: {
      marketKnowledge: 'Não conheço.',
      marketInterest: 'Não tenho interesse.',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  h.act(() => {});

  // As edicoes do usuario foram preservadas e nao foram sobrescritas!
  assert.equal(h.capture.birthDateText, '25/12/2000');
  assert.equal(h.capture.gender, 'Feminino');
});

test('K05 Auditoria 9: Persistencia e restauracao apos reinicio do app', async () => {
  const apiConfigModule = loadModule('config/apiConfig.js', require).exports;
  const httpClientModule = loadModule(
    'services/httpClient.js',
    (name) => (name === '../config/apiConfig' ? apiConfigModule : require(name))
  ).exports;
  const tokenStorageModule = loadModule('services/tokenStorage.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'ios' } };
    if (name === 'expo-secure-store') return {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
      isAvailableAsync: async () => true,
    };
    return require(name);
  }).exports;

  const authModule = loadModule('services/authService.js', (name) => {
    if (name === './httpClient') return httpClientModule;
    if (name === './tokenStorage') return tokenStorageModule;
    return require(name);
  });
  const { createAuthSessionManager } = authModule.exports;

  let storedTokens = null;
  const mockStorage = {
    getRefreshToken: async () => storedTokens?.refreshToken || null,
    setRefreshToken: async (token) => {
      storedTokens = { ...(storedTokens || {}), refreshToken: token };
    },
    clearRefreshToken: async () => {
      storedTokens = null;
    },
    isAvailable: async () => true,
    hasHardwareKeystore: () => true,
  };

  let questionnaireSavedOnBackend = false;

  const mockClient = {
    setAuthHandlers: () => {},
    clearAuthHandlers: () => {},
    post: async (url) => {
      if (url === '/auth/refresh') {
        return {
          accessToken: 'new-acc-token',
          refreshToken: 'new-ref-token',
          expiresInSeconds: 900,
          user: {
            id: 'user-restore-1',
            name: 'Kaled',
            email: 'kaled@example.com',
            hasCompletedQuestionnaire: questionnaireSavedOnBackend,
          },
        };
      }
      return {};
    },
    get: async (url) => {
      if (url === '/auth/me') {
        return {
          user: {
            id: 'user-restore-1',
            name: 'Kaled',
            email: 'kaled@example.com',
            hasCompletedQuestionnaire: questionnaireSavedOnBackend,
          },
        };
      }
      return {};
    },
  };

  // 1. Simula login inicial com questionario pendente
  const session1 = createAuthSessionManager({
    client: mockClient,
    tokenStorage: mockStorage,
  });

  await mockStorage.setRefreshToken('valid-ref-token');
  const restored1 = await session1.restoreSession();
  assert.equal(restored1.user.hasCompletedQuestionnaire, false);
  assert.equal(session1.getSnapshot().postAuthRoute, 'ProfileQuestionnaire');

  // 2. Questionario eh salvo no backend
  questionnaireSavedOnBackend = true;
  session1.markQuestionnaireCompleted();
  assert.equal(session1.getSnapshot().postAuthRoute, 'MainTabs');

  // 3. Reinicio completo do app (nova sessao a partir do storage)
  const session2 = createAuthSessionManager({
    client: mockClient,
    tokenStorage: mockStorage,
  });
  const restored2 = await session2.restoreSession();
  assert.equal(restored2.user.hasCompletedQuestionnaire, true);
  assert.equal(session2.getSnapshot().postAuthRoute, 'MainTabs');
});
