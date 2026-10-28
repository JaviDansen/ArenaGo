const assert = require('node:assert/strict');
const test = require('node:test');
const { StackRouter, CommonActions, StackActions } = require('@react-navigation/routers');
const { createHarness, textOf } = require('./helpers/questionnaireHarness.cjs');

const settle = h => h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
const texts = h => h.nodes.filter(node => node.type === 'Text').map(textOf);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function answers(game = 'Minecraft') {
  return {
    hasCompleted: true,
    aboutYou: { birthDate: '1998-12-31', gender: 'Outro', otherGender: 'Identidade anterior', education: 'Superior' },
    yourGames: [game, 'Valorant'],
    gamesMarket: { marketKnowledge: 'Conheço um pouco.', marketInterest: 'Sim, tenho interesse.' },
    completedAt: '2026-01-01T12:00:00Z',
  };
}
function context(id, client, extra = {}) {
  return {
    isAuthenticated: true,
    user: { id, name: 'Context ' + id, hasCompletedQuestionnaire: true },
    httpClient: client,
    ...extra,
  };
}
const fields = ['birthDateText', 'gender', 'otherGender', 'education', 'questionnaireData',
  'currentStepIndex', 'saveError', 'isSubmitting', 'handleAddGame', 'handleRemoveGame',
  'handleSelectMarketKnowledge', 'handleSelectMarketInterest', 'handleFinishQuestionnaire'];
function edit(authContext, extra = {}) {
  return createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    authContext, fields, props: { route: { params: { mode: 'edit' } } }, ...extra,
  });
}
function toFinalStep(h) {
  h.act(() => h.press('Avançar para a próxima etapa'));
  h.act(() => h.press('Avançar para a Etapa 3'));
  assert.equal(h.capture.currentStepIndex, 2);
}

test('editing loads every field, saves the complete authenticated payload once and refreshes Profile', async () => {
  let stored = answers();
  const requests = [], writes = [];
  const save = deferred();
  let marked = 0, refreshed = 0;
  const client = {
    async get(path, options) {
      requests.push({ path, options });
      if (path === '/profile') return { id: 'A', name: 'Conta real', email: 'real@example.test', hasCompletedQuestionnaire: true };
      if (path === '/profile/questionnaire') return stored;
      if (path.startsWith('/games')) return { games: [{ name: 'Roblox' }] };
      assert.fail(path);
    },
    put(path, payload, options) { writes.push({ path, payload, options }); return save.promise; },
  };
  const auth = context('A', client, {
    markQuestionnaireCompleted() { marked += 1; },
    async fetchCurrentUser() { refreshed += 1; },
    logout() { assert.fail('Editing must not log out'); },
  });
  const profile = createHarness('screens/profile/ProfileScreen.js', { authContext: auth });
  await settle(profile);
  profile.act(() => profile.press('Editar dados do questionário'));
  assert.equal(profile.navigationCalls[0].params.mode, 'edit');
  profile.setFocused(false);

  const h = edit(auth);
  assert.ok(texts(h).includes('Carregando suas respostas...'));
  assert.ok(!h.nodes.some(node => node.type === 'BirthDateInput'));
  await settle(h);
  assert.equal(h.capture.birthDateText, '31/12/1998');
  assert.equal(h.capture.gender, 'Outro');
  assert.equal(h.capture.otherGender, 'Identidade anterior');
  assert.equal(h.capture.education, 'Superior');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Minecraft', 'Valorant']);
  assert.equal(h.capture.questionnaireData.marketKnowledge, 'Conheço um pouco.');
  assert.equal(h.capture.questionnaireData.marketInterest, 'Sim, tenho interesse.');
  h.act(() => h.inputBirthDate('02/02/2001'));
  h.act(() => h.press('Feminino'));
  h.act(() => h.press('Médio'));
  h.act(() => h.press('Avançar para a próxima etapa'));
  h.act(c => { c.handleRemoveGame('Minecraft'); c.handleAddGame('Roblox'); });
  h.act(() => h.press('Voltar etapa'));
  assert.equal(h.capture.birthDateText, '02/02/2001');
  assert.equal(h.capture.education, 'Médio');
  toFinalStep(h);
  h.act(c => {
    c.handleSelectMarketKnowledge('Não conheço.');
    c.handleSelectMarketInterest('Não tenho interesse.');
    c.handleFinishQuestionnaire();
    c.handleFinishQuestionnaire();
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/profile/questionnaire');
  assert.equal(writes[0].options.auth, true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    birthDate: '2001-02-02', gender: 'Feminino', otherGender: null, education: 'Médio',
    selectedGames: ['Valorant', 'Roblox'], marketKnowledge: 'Não conheço.', marketInterest: 'Não tenho interesse.',
  });
  assert.equal(h.capture.isSubmitting, true);
  assert.equal(h.nodes.find(node => node.props.accessibilityLabel === 'Cancelar edição').props.disabled, true);
  assert.deepEqual(h.navigationCalls, []);
  const payload = writes[0].payload;
  stored = {
    hasCompleted: true,
    aboutYou: { birthDate: payload.birthDate, gender: payload.gender, otherGender: null, education: payload.education },
    yourGames: Array.from(payload.selectedGames),
    gamesMarket: { marketKnowledge: payload.marketKnowledge, marketInterest: payload.marketInterest },
  };
  save.resolve({ message: 'Atualizado' });
  await settle(h);
  assert.equal(marked, 1);
  assert.equal(refreshed, 1);
  const back = h.navigationCalls[0];
  assert.equal(back.type, 'popTo');
  assert.equal(back.name, 'MainTabs');
  assert.equal(back.params.screen, 'Perfil');
  assert.equal(back.params.params.questionnaireSaved, true);
  assert.equal(h.navigationCalls.length, 1);

  profile.setProps({ route: { params: back.params.params } });
  profile.setFocused(true);
  await settle(profile);
  assert.ok(texts(profile).includes('Questionário atualizado com sucesso.'));
  assert.ok(texts(profile).includes('Feminino'));
  assert.ok(texts(profile).includes('Valorant, Roblox'));
  assert.ok(texts(profile).includes('Não tenho interesse.'));
  assert.ok(texts(profile).includes('3') && texts(profile).includes('8h'));
  assert.equal(requests.filter(request => request.path === '/profile').length, 2);
  assert.ok(requests.filter(request => request.path.startsWith('/profile')).every(request => request.options.auth));
});

test('root stack popTo preserves MainTabs and selects the nested Perfil tab', () => {
  const options = { routeNames: ['MainTabs', 'ProfileQuestionnaire'], routeParamList: {}, routeGetIdList: {} };
  const router = StackRouter({ initialRouteName: 'MainTabs' });
  let state = router.getInitialState(options);
  const tabsKey = state.routes[0].key;
  state = router.getStateForAction(state, CommonActions.navigate('ProfileQuestionnaire', { mode: 'edit' }), options);
  assert.equal(state.routes.length, 2);
  state = router.getStateForAction(state, StackActions.popTo('MainTabs', {
    screen: 'Perfil', params: { questionnaireSaved: true },
  }), options);
  assert.equal(state.routes.length, 1);
  assert.equal(state.routes[0].key, tabsKey);
  assert.equal(state.routes[0].params.screen, 'Perfil');
  assert.equal(state.routes[0].params.params.questionnaireSaved, true);
});

test('editing GET failure blocks incomplete forms and saving until a successful retry', async () => {
  let attempts = 0, writes = 0;
  const client = {
    async get(path) {
      if (path.startsWith('/games')) return { games: [] };
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return answers();
    },
    put() { writes += 1; assert.fail('Loading/retrying must not save'); },
  };
  const h = edit(context('A', client));
  await settle(h);
  assert.ok(texts(h).some(text => text.includes('Não foi possível carregar o questionário')));
  assert.ok(!h.nodes.some(node => node.type === 'BirthDateInput'));
  assert.ok(!h.nodes.some(node => node.props.accessibilityLabel === 'Salvar alterações do questionário'));
  h.act(() => h.press('Tentar carregar questionário novamente'));
  await settle(h);
  assert.equal(attempts, 2);
  assert.equal(h.capture.birthDateText, '31/12/1998');
  assert.equal(writes, 0);
});

test('incomplete questionnaire response never enables the edit form', async () => {
  for (const response of [{ hasCompleted: false }, { hasCompleted: true }, {
    ...answers(), aboutYou: { ...answers().aboutYou, birthDate: '1998-02-30' },
  }]) {
    const h = edit(context('A', {
      async get(path) { return path.startsWith('/games') ? { games: [] } : response; },
    }));
    await settle(h);
    assert.ok(!h.nodes.some(node => node.type === 'BirthDateInput'));
    assert.ok(texts(h).some(text => text.includes('Não foi possível carregar o questionário')));
    h.unmount();
  }
});

test('cancel or back at the first edit step returns to Profile without PUT or logout', async () => {
  for (const label of ['Cancelar edição', 'Voltar etapa']) {
    let writes = 0, logouts = 0;
    const original = answers();
    const before = JSON.stringify(original);
    const h = edit(context('A', {
      async get(path) { return path.startsWith('/games') ? { games: [] } : original; },
      put() { writes += 1; },
    }, { logout() { logouts += 1; } }));
    await settle(h);
    h.act(() => h.inputBirthDate('01/01/2000'));
    h.act(() => h.press(label));
    assert.equal(writes, 0);
    assert.equal(logouts, 0);
    assert.equal(JSON.stringify(original), before);
    assert.equal(h.navigationCalls[0].name, 'MainTabs');
    assert.equal(h.navigationCalls[0].params.screen, 'Perfil');
    assert.equal(h.navigationCalls[0].params.params.questionnaireSaved, false);
    h.unmount();
  }
});

test('PUT error preserves edited fields and games and allows retry with the same full payload', async () => {
  const writes = [];
  const h = edit(context('A', {
    async get(path) { return path.startsWith('/games') ? { games: [] } : answers(); },
    async put(path, payload) {
      writes.push(JSON.stringify(payload));
      if (writes.length === 1) throw { detail: 'Conexão interrompida' };
      return { message: 'Atualizado' };
    },
  }));
  await settle(h);
  h.act(() => h.inputBirthDate('01/06/2000'));
  h.act(() => h.press('Avançar para a próxima etapa'));
  h.act(c => { c.handleRemoveGame('Minecraft'); c.handleAddGame('Roblox'); });
  h.act(() => h.press('Avançar para a Etapa 3'));
  h.act(c => c.handleSelectMarketInterest('Não tenho interesse.'));
  h.act(() => h.press('Salvar alterações do questionário'));
  await settle(h);
  assert.equal(h.capture.birthDateText, '01/06/2000');
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Valorant', 'Roblox']);
  assert.ok(texts(h).includes('Conexão interrompida'));
  assert.equal(h.capture.isSubmitting, false);
  assert.deepEqual(h.navigationCalls, []);
  h.act(() => h.press('Salvar alterações do questionário'));
  await settle(h);
  assert.equal(writes.length, 2);
  assert.equal(writes[0], writes[1]);
  assert.equal(h.navigationCalls[0].params.screen, 'Perfil');
});

test('Profile retries partial loading errors without falling back to demo answers', async () => {
  let fail = true;
  const client = {
    async get(path) {
      if (path === '/profile') return { id: 'A', name: 'Nome real', email: 'real@example.test', hasCompletedQuestionnaire: true };
      if (fail) throw new Error('offline');
      return answers('Roblox');
    },
  };
  const h = createHarness('screens/profile/ProfileScreen.js', { authContext: context('A', client) });
  await settle(h);
  assert.ok(texts(h).includes('Nome real'));
  assert.ok(texts(h).some(text => text.includes('Não foi possível carregar todos os dados')));
  assert.ok(!texts(h).includes('22 anos'));
  assert.ok(texts(h).includes('3') && texts(h).includes('8h'));
  fail = false;
  h.act(() => h.press('Tentar carregar perfil novamente'));
  await settle(h);
  assert.ok(texts(h).includes('Roblox, Valorant'));
  assert.ok(!h.nodes.some(node => node.props.accessibilityRole === 'alert'));
});

test('Profile loads only on focus and deduplicates repeated focus events while loading', async () => {
  const requests = [];
  const client = { get(path) { const request = { path, ...deferred() }; requests.push(request); return request.promise; } };
  const h = createHarness('screens/profile/ProfileScreen.js', { authContext: context('A', client), focused: false });
  await settle(h);
  assert.equal(requests.length, 0);
  h.setFocused(true);
  h.setFocused(true);
  await settle(h);
  assert.equal(requests.length, 2);
  requests[0].resolve({ id: 'A', name: 'Ana' });
  requests[1].resolve(answers());
  await settle(h);
  assert.ok(texts(h).includes('Ana'));
});

test('Profile discards old account and old focus responses, and clears personal data on logout', async () => {
  const requests = [];
  const client = { get(path) { const request = { path, ...deferred() }; requests.push(request); return request.promise; } };
  const h = createHarness('screens/profile/ProfileScreen.js', { authContext: context('A', client) });
  await settle(h);
  h.setAuthContext(context('B', client));
  await settle(h);
  requests[2].resolve({ id: 'B', name: 'Bruno', email: 'b@example.test' });
  requests[3].resolve(answers('Roblox'));
  await settle(h);
  requests[0].resolve({ id: 'A', name: 'Ana', email: 'a@example.test' });
  requests[1].reject(new Error('Old account error'));
  await settle(h);
  assert.ok(texts(h).includes('Bruno'));
  assert.ok(!texts(h).includes('Ana'));
  assert.ok(!h.nodes.some(node => node.props.accessibilityRole === 'alert'));
  h.setFocused(false);
  h.setFocused(true);
  await settle(h);
  h.setFocused(false);
  h.setFocused(true);
  await settle(h);
  requests[6].resolve({ id: 'B', name: 'Bruno atualizado' });
  requests[7].resolve(answers('Roblox'));
  await settle(h);
  requests[4].resolve({ id: 'B', name: 'Nome antigo' });
  requests[5].resolve(answers());
  await settle(h);
  assert.ok(texts(h).includes('Bruno atualizado'));
  assert.ok(!texts(h).includes('Nome antigo'));
  h.setAuthContext({ isAuthenticated: false, user: null, httpClient: client });
  assert.ok(!texts(h).includes('Bruno atualizado'));
  assert.ok(!texts(h).includes('Roblox, Valorant'));
});

test('edit rejects old GET and PUT results after a new session for the same user', async () => {
  let epoch = 1;
  const gets = [], puts = [];
  let marked = 0, refreshed = 0;
  const client = {
    get(path) {
      if (path.startsWith('/games')) return Promise.resolve({ games: [] });
      const request = deferred(); gets.push(request); return request.promise;
    },
    put() { const request = deferred(); puts.push(request); return request.promise; },
  };
  const auth = context('A', client, {
    getSessionEpoch: () => epoch,
    markQuestionnaireCompleted() { marked += 1; },
    async fetchCurrentUser() { refreshed += 1; },
  });
  const h = edit(auth);
  epoch = 2;
  h.setAuthContext({ ...auth });
  gets[1].resolve(answers('Roblox'));
  await settle(h);
  gets[0].resolve(answers('Minecraft'));
  await settle(h);
  assert.deepEqual(Array.from(h.capture.questionnaireData.selectedGames), ['Roblox', 'Valorant']);
  toFinalStep(h);
  h.act(() => h.press('Salvar alterações do questionário'));
  epoch = 3;
  // O getter descarta o PUT mesmo antes de React publicar a nova sessão.
  puts[0].resolve({ message: 'Old session save' });
  await settle(h);
  assert.equal(marked, 0);
  assert.equal(refreshed, 0);
  assert.deepEqual(h.navigationCalls, []);
  h.setAuthContext({ ...auth });
  gets[2].resolve(answers());
  await settle(h);
  assert.equal(h.capture.currentStepIndex, 0);
  assert.equal(h.capture.isSubmitting, false);
});

test('Profile rejects stale results before the new same-user session has rendered', async () => {
  let epoch = 1;
  const requests = [];
  const client = { get(path) { const request = { path, ...deferred() }; requests.push(request); return request.promise; } };
  const auth = context('A', client, { getSessionEpoch: () => epoch });
  const h = createHarness('screens/profile/ProfileScreen.js', { authContext: auth });
  await settle(h);
  epoch = 2;
  requests[0].resolve({ id: 'A', name: 'Sessão antiga' });
  requests[1].resolve(answers());
  await settle(h);
  assert.ok(!texts(h).includes('Sessão antiga'));
  h.setAuthContext({ ...auth });
  await settle(h);
  requests[2].resolve({ id: 'A', name: 'Sessão atual' });
  requests[3].resolve(answers());
  await settle(h);
  assert.ok(texts(h).includes('Sessão atual'));
});

test('unmounted edit never applies a late save or changes authentication', async () => {
  const save = deferred();
  const h = edit(context('A', {
    async get(path) { return path.startsWith('/games') ? { games: [] } : answers(); },
    put() { return save.promise; },
  }, {
    markQuestionnaireCompleted() { assert.fail('Unmounted edit must not update auth'); },
    fetchCurrentUser() { assert.fail('Unmounted edit must not refresh auth'); },
  }));
  await settle(h);
  toFinalStep(h);
  h.act(() => h.press('Salvar alterações do questionário'));
  h.unmount();
  save.resolve({ message: 'Updated' });
  await settle(h);
  assert.deepEqual(h.navigationCalls, []);
});

test('late PUT failure from A cannot display errors or unlock a pending edit submission by B', async () => {
  const saves = [];
  const client = {
    async get(path) { return path.startsWith('/games') ? { games: [] } : answers(); },
    put() { const request = deferred(); saves.push(request); return request.promise; },
  };
  const h = edit(context('A', client));
  await settle(h);
  toFinalStep(h);
  h.act(() => h.press('Salvar alterações do questionário'));
  h.setAuthContext(context('B', client));
  await settle(h);
  assert.equal(h.capture.currentStepIndex, 0);
  toFinalStep(h);
  h.act(() => h.press('Salvar alterações do questionário'));
  saves[0].reject({ detail: 'Erro privado de A' });
  await settle(h);
  assert.equal(h.capture.isSubmitting, true);
  assert.ok(!texts(h).includes('Erro privado de A'));
  h.act(c => c.handleFinishQuestionnaire());
  assert.equal(saves.length, 2);
  assert.deepEqual(h.navigationCalls, []);
  saves[1].resolve({ message: 'Saved B' });
  await settle(h);
  assert.equal(h.navigationCalls.length, 1);
  assert.equal(h.navigationCalls[0].params.screen, 'Perfil');
});

test('edit mode cannot bypass the mandatory questionnaire for a pending account', async () => {
  const paths = [];
  const h = edit(context('A', {
    async get(path) { paths.push(path); return { games: [] }; },
    put() { assert.fail('A pending account must use registration mode'); },
  }, {
    user: { id: 'A', hasCompletedQuestionnaire: false },
    logout() { assert.fail('Canceling edit must not log out'); },
  }));
  await settle(h);
  assert.ok(!h.nodes.some(node => node.type === 'BirthDateInput'));
  assert.ok(!paths.includes('/profile/questionnaire'));
  assert.ok(texts(h).some(text => text.includes('questionário concluído')));
  h.act(() => h.press('Cancelar edição'));
  assert.equal(h.navigationCalls[0].name, 'ProfileQuestionnaire');
  assert.equal(h.navigationCalls[0].params.mode, undefined);
});
