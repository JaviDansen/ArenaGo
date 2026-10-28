const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mount } = require('../helpers/react-app.cjs');

test('D01 incompatible old suggestions are not selectable while the next search is pending', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('Roblox');
  await h.resolve(h.requests.search.at(-1), { games: [{ name: 'Roblox' }] });
  assert.equal(h.findButtons('Selecionar Roblox').length, 1, 'first response is rendered');
  await h.search('Tetris');
  assert.equal(h.requests.search.at(-1).query, 'Tetris');
  // Examine the rendered tree BEFORE resolving Tetris; no internal hook state.
  const stale = h.findButtons('Selecionar Roblox').filter(button => !button.props.disabled);
  t.diagnostic('Old selectable suggestions while Tetris is pending: ' + stale.length);
  assert.equal(stale.length, 0,
    'a result incompatible with the current query must not remain actionable');
});

test('D02 out-of-order search responses keep the latest rendered suggestions', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('Roblox');
  const old = h.requests.search.at(-1);
  await h.search('Tetris');
  await h.resolve(h.requests.search.at(-1), { games: [{ name: 'Tetris' }] });
  await h.resolve(old, { games: [{ name: 'Roblox' }] });
  assert.equal(h.findButtons('Selecionar Tetris').length, 1);
  assert.equal(h.findButtons('Selecionar Roblox').length, 0);
});

test('D03 clearing the field prevents an outstanding response from returning to the UI', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('Roblox');
  const request = h.requests.search.at(-1);
  await h.search('');
  await h.resolve(request, { games: [{ name: 'Roblox' }] });
  assert.equal(h.tree.root.findByType('TextInput').props.value, '');
  assert.equal(h.findButtons('Selecionar Roblox').length, 0);
  assert.equal(h.hasText('Buscando no catálogo'), false);
});

test('D04 selecting a local match during search prevents its late response from reopening suggestions', async (t) => {
  const h = await mount({ catalog: [{ name: 'Minecraft' }] });
  t.after(() => h.dispose());
  await h.toGames();
  await h.search('Mine');
  const request = h.requests.search.at(-1);
  await h.press('Selecionar Minecraft');
  await h.resolve(request, { games: [{ name: 'Minecraft Dungeons' }] });
  assert.equal(h.tree.root.findByType('TextInput').props.value, '');
  assert.equal(h.findButtons('Remover Minecraft').length, 1);
  assert.equal(h.findButtons('Selecionar Minecraft Dungeons').length, 0);
  assert.equal(h.hasText('Buscando no catálogo'), false);
});

test('E01 add then remove Minecraft before preload does not resurrect it', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  const profile = h.requests.profile[0];
  await h.toGames();
  await h.addGame('Minecraft');
  await h.press('Remover Minecraft');
  assert.equal(h.findButtons('Remover Minecraft').length, 0, 'removal is visible before GET');
  await h.resolve(profile, { hasCompleted: true, yourGames: ['Minecraft'] });
  t.diagnostic('Minecraft removal controls after delayed GET: ' +
    h.findButtons('Remover Minecraft').length);
  assert.equal(h.findButtons('Remover Minecraft').length, 0,
    'late preload must honor the local removal');
});

test('E02 preload merges legitimate local games and untouched remote games', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.addGame('Terraria');
  await h.resolve(h.requests.profile[0], {
    hasCompleted: true, yourGames: ['Minecraft', 'Stardew Valley'],
  });
  for (const game of ['Terraria', 'Minecraft', 'Stardew Valley']) {
    assert.equal(h.findButtons('Remover ' + game).length, 1, 'selected game preserved: ' + game);
  }
});

test('E03 preload merges local and remote duplicates without duplicate selected controls', async (t) => {
  const h = await mount();
  t.after(() => h.dispose());
  await h.toGames();
  await h.addGame('MINECRAFT');
  await h.resolve(h.requests.profile[0], { hasCompleted: true, yourGames: ['Minecraft'] });
  const selected = h.tree.root.findAll(n => n.type === 'Pressable' &&
    String(n.props.accessibilityLabel).toLowerCase() === 'remover minecraft');
  assert.equal(selected.length, 1, 'case-insensitive merge must retain one selected game');
});
