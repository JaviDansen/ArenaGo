const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

const birthDate = loadModule('utils/birthDate.js', require).exports;
const { getProfileViewData } = loadModule('utils/profile.js', name =>
  name === './birthDate' ? birthDate : require(name)).exports;

test('Profile displays session identity and clearly marked demo data without fetching or editing', () => {
  const h = createHarness('screens/profile/ProfileScreen.js', {
    authContext: {
      user: { name: 'Ana Souza', email: 'ana@example.test' },
      httpClient: {
        get() { assert.fail('Profile must not fetch questionnaire data'); },
        put() { assert.fail('Profile must not save questionnaire data'); },
      },
    },
  });
  const texts = h.nodes.filter(node => node.type === 'Text').map(textOf);
  for (const text of [
    'Meu Perfil', 'Ana Souza', 'ana@example.test', '3', 'Participações', '8h', 'Tempo total',
    'Indicadores demonstrativos', 'Dados do questionário',
    'Dados demonstrativos · não são respostas da sua conta',
    '22 anos', 'Masculino', 'Ensino Superior', 'Valorant, Minecraft',
    'Conheço um pouco.', 'Sim, tenho interesse.', 'Em breve',
  ]) assert.ok(texts.includes(text), text);

  const edit = h.nodes.find(node => node.type === 'Pressable'
    && textOf(node).includes('EDITAR DADOS DO QUESTIONÁRIO'));
  assert.equal(edit.props.disabled, true);
  assert.equal(edit.props.onPress, undefined);
  assert.ok(h.nodes.some(node => node.type === 'ScrollView'));
  assert.ok(h.nodes.some(node => node.type === 'SafeAreaView'));
  assert.deepEqual(h.navigationCalls, []);
});

test('Profile handles missing account data and updates identity when the account changes', () => {
  const h = createHarness('screens/profile/ProfileScreen.js', { authContext: null });
  const texts = () => h.nodes.filter(node => node.type === 'Text').map(textOf);
  assert.ok(texts().includes('Participante'));
  assert.ok(texts().includes('E-mail não disponível'));
  const logout = h.nodes.find(node => node.props.accessibilityLabel === 'Sair da conta');
  assert.equal(logout.props.disabled, true);
  h.setAuthContext({ user: { name: 'Bruno', email: 'bruno@example.test' } });
  assert.ok(texts().includes('Bruno'));
  assert.ok(texts().includes('bruno@example.test'));
  h.setAuthContext({ user: { name: '  ', email: '  ' } });
  assert.ok(texts().includes('Participante'));
  assert.ok(texts().includes('E-mail não disponível'));
});

test('Profile data transformation accepts questionnaire response shape and preserves its inputs', () => {
  const source = {
    user: { name: '  Ana  ', email: ' ana@example.test ' },
    referenceDate: '2026-10-28',
    statistics: { participationCount: 0, totalHours: 0 },
    questionnaire: {
      aboutYou: { birthDate: '2004-10-29', gender: 'Outro', otherGender: 'Não binário', education: 'Médio' },
      yourGames: [{ id: 'valorant', name: 'Valorant' }, 'Minecraft', null, {}],
      gamesMarket: { marketKnowledge: 'Conheço um pouco.', marketInterest: 'Sim, tenho interesse.' },
    },
  };
  const original = JSON.stringify(source);
  const profile = getProfileViewData(source);
  const value = label => profile.questionnaireRows.find(row => row.label === label).value;
  assert.equal(profile.name, 'Ana');
  assert.equal(profile.email, 'ana@example.test');
  assert.equal(profile.participationCount, '0');
  assert.equal(profile.totalTime, '0h');
  assert.equal(value('Idade'), '21 anos');
  assert.equal(value('Gênero'), 'Não binário');
  assert.equal(value('Escolaridade'), 'Médio');
  assert.equal(value('Jogos'), 'Valorant, Minecraft');
  assert.equal(JSON.stringify(source), original);
  source.referenceDate = '2026-10-29';
  assert.equal(getProfileViewData(source).questionnaireRows[0].value, '22 anos');
  for (const invalidDate of ['2004-02-30', '2027-01-01', '', null]) {
    source.questionnaire.aboutYou.birthDate = invalidDate;
    assert.equal(getProfileViewData(source).questionnaireRows[0].value, 'Não informada');
  }
  const empty = getProfileViewData();
  assert.equal(empty.participationCount, '—');
  assert.equal(empty.totalTime, '—');
  assert.equal(empty.questionnaireRows.length, 6);
  assert.ok(empty.questionnaireRows.every(row => /^Não informad/.test(row.value)));
});

test('Profile allows logout retry after failure and never navigates manually', async () => {
  let calls = 0;
  const h = createHarness('screens/profile/ProfileScreen.js', {
    authContext: { logout: async () => { calls += 1; throw new Error('logout failed'); } },
  });
  await h.actAsync(() => h.press('Sair da conta'));
  assert.equal(calls, 1);
  assert.ok(h.nodes.some(node => node.props.accessibilityRole === 'alert'
    && textOf(node).includes('Não foi possível sair da conta')));
  assert.equal(h.nodes.find(node => node.props.accessibilityLabel === 'Sair da conta').props.disabled, false);
  await h.actAsync(() => h.press('Sair da conta'));
  assert.equal(calls, 2);
  assert.deepEqual(h.navigationCalls, []);
});

test('Home has no logout and preserves event entry and pending questionnaire navigation', () => {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: {
      user: { id: 'user-1', hasCompletedQuestionnaire: false },
      logout() { assert.fail('Home must not log out'); },
    },
  });
  assert.ok(!h.nodes.some(node => node.type === 'Pressable' && /sair da conta/i.test(textOf(node))));
  h.press('Entrar em um evento');
  assert.equal(h.navigationCalls[0].name, 'EventEntry');
  h.press('Completar questionário de perfil');
  assert.equal(h.navigationCalls[1].name, 'ProfileQuestionnaire');
  assert.equal(h.navigationCalls[1].params.user.id, 'user-1');
});
