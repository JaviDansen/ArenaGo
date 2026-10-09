const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHarness } = require('./helpers/questionnaireHarness.cjs');

const fields = ['currentStepIndex', 'questionnaireData', 'birthDateText', 'gender', 'otherGender',
  'education', 'errors', 'searchQuery', 'filteredSuggestions', 'handleBack', 'handleSelectGender',
  'handleSelectEducation', 'handleAdvanceStep1', 'handleSearchChange', 'handleAddGame',
  'handleRemoveGame', 'handleAdvanceStep2', 'handleSelectMarketKnowledge',
  'handleSelectMarketInterest', 'handleFinishQuestionnaire'];

function questionnaire(options) {
  return createHarness('screens/ProfileQuestionnaireScreen.js', { fields, ...options });
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
  const source = readFileSync(path.join(__dirname, '../screens/ProfileQuestionnaireScreen.js'), 'utf8');
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

test('Welcome, valid registration, questionnaire and provisional Login retain their routes', () => {
  const welcome = createHarness('screens/auth/WelcomeScreen.js');
  welcome.act(() => welcome.press('Criar minha conta'));
  assert.equal(welcome.navigationCalls[0].name, 'Register');

  const register = createHarness('screens/auth/RegisterScreen.js', { fields: ['handleRegister'] });
  for (const [placeholder, value] of [
    ['Como quer ser chamado?', 'Participante'], ['seu.email@exemplo.com', 'teste@example.com'],
    ['Crie uma senha de acesso', 'secret1'], ['Digite a mesma senha novamente', 'secret1'],
  ]) register.act(() => register.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value));
  register.act((c) => c.handleRegister());
  assert.equal(register.navigationCalls[0].name, 'ProfileQuestionnaire');

  const login = createHarness('screens/auth/LoginScreen.js', { fields: ['handleLogin'] });
  for (const [placeholder, value] of [
    ['seu.email@exemplo.com', 'teste@example.com'], ['Digite sua senha', 'secret1'],
  ]) login.act(() => login.nodes.find((n) => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value));
  login.act((c) => c.handleLogin());
  assert.equal(login.navigationCalls[0].name, 'MainTabs');
});
