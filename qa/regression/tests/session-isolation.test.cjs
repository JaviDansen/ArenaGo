const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mount } = require('../helpers/react-app.cjs');

async function switchMountedScreen(h) {
  // Intentionally keeps this questionnaire instance mounted. This tests the
  // component's own account-reset contract, not the normal navigator unmount.
  await h.logout();
  await h.loginB();
  assert.equal(h.manager.getSnapshot().user.id, 'B');
}

test('C01 a mounted questionnaire returns to step 1 when session A becomes B', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toFinish();
  await switchMountedScreen(h);
  t.diagnostic('Rendered step after switch: ' + h.texts().filter(s => /^Etapa \d/.test(s)).join());
  assert.ok(h.hasText('Sobre você'), 'B must start on the first questionnaire step');
  assert.equal(h.hasText('Etapa 3 de 3'), false);
});

test('C02 mounted account switch clears already rendered A search results and query', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('A private');
  await h.resolve(h.requests.search.at(-1), { games: [{ name: 'A private result' }] });
  await switchMountedScreen(h);
  const searchInputs = h.tree.root.findAllByType('TextInput');
  const leaked = {
    queries: searchInputs.map(n => n.props.value).filter(Boolean),
    selectableA: h.findButtons('Selecionar A private result').length,
  };
  t.diagnostic(JSON.stringify(leaked));
  assert.deepEqual(leaked, { queries: [], selectableA: 0 },
    'B must not inherit A search text or actionable suggestions');
});

test('C03 profile GET from A cannot replace the profile already loaded for B', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  const a = h.requests.profile[0];
  await switchMountedScreen(h);
  const b = h.requests.profile.at(-1);
  assert.equal(b.owner, 'B');
  await h.resolve(b, { hasCompleted: true,
    aboutYou: { birthDate: '2001-02-03', gender: 'Feminino', education: 'Superior' },
    yourGames: ['B Game'],
  });
  assert.equal(h.tree.root.findByType('BirthDateInput').props.value, '03/02/2001');
  await h.resolve(a, { hasCompleted: true,
    aboutYou: { birthDate: '1980-04-05', gender: 'Masculino', education: 'Fundamental' },
    yourGames: ['A Game'],
  });
  assert.equal(h.tree.root.findByType('BirthDateInput').props.value, '03/02/2001');
  await h.press('Avançar para a próxima etapa');
  assert.equal(h.findButtons('Remover B Game').length, 1);
  assert.equal(h.findButtons('Remover A Game').length, 0);
});

test('C04 late PUT rejection from A cannot display its message in B mounted screen', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toFinish();
  await h.press('Concluir questionário');
  const a = h.requests.put[0];
  await switchMountedScreen(h);
  await h.reject(a, { detail: 'PRIVATE ERROR FROM A',
    fieldErrors: { marketKnowledge: 'PRIVATE FIELD ERROR FROM A' } });
  // If a future fix resets the step, still visit step 3 before checking banners.
  // Merely hiding a leaked saveError on step 1 must not make this test pass.
  if (h.hasText('Sobre você')) await h.toFinish();
  t.diagnostic('A errors visible to B: ' + h.texts().filter(s => s.includes('FROM A')).join(' | '));
  assert.equal(h.hasText('PRIVATE ERROR FROM A'), false,
    'catch handler must not publish previous-session error banners');
  assert.equal(h.hasText('PRIVATE FIELD ERROR FROM A'), false);
});

test('C05 A pending PUT must not keep B submission disabled', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toFinish();
  await h.press('Concluir questionário');
  await switchMountedScreen(h);
  // Navigate back only to fill B data if the known step-reset defect persists.
  // This does not clear isSubmitting or modify source/component state.
  if (h.hasText('Etapa 3 de 3')) {
    await h.press('Voltar etapa');
    await h.press('Voltar etapa');
  }
  await h.toFinish();
  const busy = h.findButtons('Salvando questionário...');
  t.diagnostic('Busy submission controls inherited from A: ' + busy.length);
  assert.equal(busy.length, 0, 'B must not inherit A submission lock/loading state');
  await h.press('Concluir questionário');
  assert.deepEqual(h.requests.put.map(r => r.owner), ['A', 'B']);
});

test('C06 successful PUT from A must not complete B or navigate B', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toFinish();
  await h.press('Concluir questionário');
  const a = h.requests.put[0];
  await switchMountedScreen(h);
  await h.complete(a);
  assert.equal(h.manager.getSnapshot().user.id, 'B');
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.deepEqual(h.calls, []);
});

test('C07 late search response from A must not introduce suggestions in B mounted screen', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('A');
  const a = h.requests.search.at(-1);
  await switchMountedScreen(h);
  assert.equal(h.findButtons('Selecionar A LATE RESULT').length, 0, 'not present before response');
  await h.resolve(a, { games: [{ name: 'A LATE RESULT' }] });
  t.diagnostic('A suggestion buttons after late response: ' +
    h.findButtons('Selecionar A LATE RESULT').length);
  assert.equal(h.findButtons('Selecionar A LATE RESULT').length, 0,
    'search callback must be invalidated by session changes');
});

test('C08 mounted account switch clears A validation errors', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.press('Avançar para a próxima etapa');
  const errors = h.texts().filter(s => /obrigat|informe|selecione/i.test(s));
  assert.ok(errors.length, 'A must have visible validation errors before switching');
  await switchMountedScreen(h);
  const residual = h.texts().filter(s => errors.includes(s));
  t.diagnostic('Residual validation messages: ' + JSON.stringify(residual));
  assert.deepEqual(residual, [], 'B must not start with A validation errors');
});

test('C09 mounted account switch clears A game feedback messages', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.addGame('A Only Game');
  assert.ok(h.hasText('"A Only Game" adicionado'));
  await switchMountedScreen(h);
  assert.equal(h.hasText('"A Only Game" adicionado'), false,
    'B must not see the success feedback from an action by A');
});

test('C10 real navigator logout/remount isolates B while A GET search and PUT finish late', async (t) => {
  const h = await mount({ routed: true });
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('A Only');
  await h.resolve(h.requests.search.at(-1), { games: [{ name: 'A Only' }] });
  assert.equal(h.findButtons('Selecionar A Only').length, 1);
  await h.addGame('Minecraft');
  await h.search('A PRIVATE');
  const aSearch = h.requests.search.at(-1);
  const aGet = h.requests.profile[0];
  await h.press('Avançar para a Etapa 3');
  await h.press('Sim, conheço.');
  await h.press('Sim, tenho interesse.');
  await h.press('Concluir questionário');
  const aPut = h.requests.put[0];
  await h.logout();
  assert.equal(h.navRef.getCurrentRoute().name, 'Welcome', 'logout must unmount questionnaire');
  await h.loginB();
  assert.ok(h.hasText('Sobre você'), 'fresh B instance starts on step 1');
  await h.toFinish();
  await h.press('Concluir questionário');
  const bPut = h.requests.put.at(-1);
  assert.equal(bPut.owner, 'B');
  await h.resolve(aGet, { hasCompleted: true,
    aboutYou: { birthDate: '1980-01-01' }, yourGames: ['A PRIVATE GAME'] });
  await h.resolve(aSearch, { games: [{ name: 'A PRIVATE RESULT' }] });
  await h.reject(aPut, { detail: 'A PRIVATE SAVE ERROR' });
  assert.equal(h.manager.getSnapshot().user.id, 'B');
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.equal(h.navRef.getCurrentRoute().name, 'ProfileQuestionnaire');
  assert.equal(h.hasText('A PRIVATE'), false);
  const busy = h.findButtons('Salvando questionário...');
  assert.equal(busy.length, 1);
  assert.equal(busy[0].props.disabled, true, 'A finalizer must not unlock B in-flight submission');
  // Invoke the exposed event callback, bypassing Pressable disabled, to stress
  // the component guard as well as the actual visible disabled state.
  const { act } = require('../helpers/react-app.cjs');
  await act(async () => { busy[0].props.onPress(); });
  assert.equal(h.requests.put.length, 2, 'exactly one PUT per account');
  assert.equal(h.unhandled.length, 0);
  await h.press('Voltar etapa');
  assert.equal(h.tree.root.findByType('TextInput').props.value, '');
  assert.equal(h.findButtons('Remover A PRIVATE GAME').length, 0);
  assert.equal(h.findButtons('Selecionar A PRIVATE RESULT').length, 0);
  assert.equal(h.hasText('Buscando no catálogo'), false);
  await h.press('Voltar etapa');
  assert.equal(h.tree.root.findByType('BirthDateInput').props.value, '01/01/2000');
});

test('C11 real navigator unmount prevents A successful PUT from completing B', async (t) => {
  const h = await mount({ routed: true });
  t.after(() => h.dispose());
  await h.toFinish();
  await h.press('Concluir questionário');
  const a = h.requests.put[0];
  await h.logout();
  assert.equal(h.navRef.getCurrentRoute().name, 'Welcome');
  await h.loginB();
  await h.complete(a);
  assert.equal(h.manager.getSnapshot().user.id, 'B');
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.equal(h.navRef.getCurrentRoute().name, 'ProfileQuestionnaire');
  assert.ok(h.hasText('Sobre você'));
  assert.equal(h.unhandled.length, 0);
});

test('C12 a pending search by A must not leave B showing a search spinner', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('A pending');
  assert.ok(h.hasText('Buscando no catálogo'));
  await switchMountedScreen(h);
  if (h.hasText('Sobre você')) await h.toGames();
  assert.equal(h.hasText('Buscando no catálogo'), false,
    'B must not inherit the loading indicator for A pending search');
});

test('C13 old catalog request cannot replace the newer catalog loaded for B', async (t) => {
  const h = await mount({ deferCatalog: true });
  t.after(() => h.dispose());
  const aCatalog = h.requests.catalog[0];
  await switchMountedScreen(h);
  const bCatalog = h.requests.catalog.at(-1);
  assert.equal(bCatalog.owner, 'B');
  await h.resolve(bCatalog, { games: [{ name: 'B NEWER CATALOG' }] });
  await h.toGames();
  assert.equal(h.findButtons('Selecionar B NEWER CATALOG').length, 1);
  await h.resolve(aCatalog, { games: [{ name: 'A OLDER CATALOG' }] });
  t.diagnostic('Old catalog buttons: ' + h.findButtons('Selecionar A OLDER CATALOG').length);
  assert.equal(h.findButtons('Selecionar A OLDER CATALOG').length, 0,
    'callback from the earlier effect must not replace B newer catalog');
  assert.equal(h.findButtons('Selecionar B NEWER CATALOG').length, 1);
});
