const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, textOf } = require('./helpers/questionnaireHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');

const id = n => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const closedAt = '2026-11-26T12:00:00.000000Z';
const card = (n, name) => ({ id: id(n), name, timezone: 'America/Sao_Paulo', effectivePhase: 'closed',
  startsAt: '2026-11-26T10:00:00.000000Z', officialEndsAt: closedAt, closedAt,
  participations: 0, evaluationCount: 0, evaluationMean: null });
const page = (items, nextCursor = null) => ({ items, nextCursor });
const summary = (n, name) => ({ event: { ...card(n, name), scheduledDurationSeconds: 7200, closedEarly: false },
  overview: { participations: 0, completed: 0 }, observedAt: closedAt, ranking: [],
  ratings: { count: 0, mean: null, distribution: [1,2,3,4,5].map(stars => ({ stars, count: 0, percent: 0 })) },
  durationA: { population: 0, meanSeconds: null } });
const visible = (h, label) => h.nodes.some(node => textOf(node).includes(label));
const flush = h => h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('ADMIN-10 lista real tem datas no fuso do evento, paginação sem duplicatas e retorno por foco', async () => {
  const more = deferred(), calls = [];
  const h = createHarness('screens/admin/AdminRealHistoryScreen.js', { authContext: verifiedAdminAuth({
    httpClient: { get: (path, options) => {
      const url = new URL(path, 'http://localhost');
      assert.equal(url.pathname, '/admin/events/history');
      assert.equal(options.auth, true);
      calls.push(url.searchParams.get('cursor'));
      if (!url.searchParams.has('cursor')) return Promise.resolve(page([card(1, 'Arena Norte')], 'next'));
      assert.equal(url.searchParams.get('cursor'), 'next');
      return more.promise;
    } },
  }) });
  try {
    await flush(h);
    assert.ok(h.nodes.some(node => /26\/11\/(20)?26/.test(textOf(node))) && visible(h, '09:00'));
    assert.ok(!visible(h, closedAt));
    assert.ok(h.nodes.some(node => /0\s+Participações/.test(textOf(node))) && visible(h, 'Nota média'));
    assert.ok(!visible(h, 'Sem nota média'));
    assert.ok(h.nodes.some(node => node.props.accessibilityLabel === 'Nota média indisponível: sem avaliações'));
    const loadMore = h.nodes.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Carregar mais');
    assert.ok(loadMore);
    h.act(() => { loadMore.props.onPress(); loadMore.props.onPress(); });
    assert.deepEqual(calls, [null, 'next']);
    more.resolve(page([card(1, 'Arena Norte'), card(2, 'Arena Sul')]));
    await flush(h);
    assert.equal(h.nodes.filter(node => node.type === 'Text' && textOf(node) === 'Arena Norte').length, 1);
    h.press('Ver resumo');
    assert.equal(h.navigationCalls.at(-1).name, 'AdminHistorySummary');
    assert.equal(h.navigationCalls.at(-1).params.eventId, id(1));
    h.setFocused(false); h.setFocused(true);
    assert.ok(visible(h, 'Arena Sul'));
    await flush(h);
    assert.deepEqual(calls, [null, 'next', null, 'next']);
    assert.ok(visible(h, 'Arena Sul'));
  } finally {
    try { h.unmount(); } finally { more.resolve(page([])); }
  }
});

test('ADMIN-10 debounce, filtro e busca invalidam respostas antigas e reiniciam o cursor', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const olderPage = deferred(), filteredPage = deferred(), calls = [];
  const responses = new Map([
    [JSON.stringify(['all', null, null]), page([card(1, 'Todos os períodos')], 'all-page')],
    [JSON.stringify(['all', null, 'all-page']), olderPage.promise],
    [JSON.stringify(['7', null, null]), page([card(2, 'Período selecionado')], 'seven-page')],
    [JSON.stringify(['7', null, 'seven-page']), filteredPage.promise],
    [JSON.stringify(['7', 'arena %_', null]), page([])],
  ]);
  let h;
  try {
    h = createHarness('screens/admin/AdminRealHistoryScreen.js', { authContext: verifiedAdminAuth({
      httpClient: { get: path => {
        const params = new URL(path, 'http://localhost').searchParams;
        const query = [params.get('period'), params.get('search'), params.get('cursor')];
        calls.push(query);
        const key = JSON.stringify(query);
        assert.ok(responses.has(key), `Consulta inesperada: ${key}`);
        return Promise.resolve(responses.get(key));
      } },
    }) });
    await flush(h);
    assert.ok(visible(h, 'Todos os períodos'));
    h.act(() => h.press('Carregar mais'));
    h.act(() => h.press('Últimos 7 dias'));
    await flush(h);
    assert.ok(visible(h, 'Período selecionado') && !visible(h, 'Todos os períodos'));
    olderPage.resolve(page([card(3, 'Resposta antiga')], 'old'));
    await flush(h);
    assert.ok(!visible(h, 'Resposta antiga'));
    h.act(() => h.press('Carregar mais'));
    const input = h.nodes.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Pesquisar por nome ou código');
    assert.ok(input);
    h.act(() => input.props.onChangeText(' arena %_ '));
    // press() só invoca o handler. Cada act() aplica o estado antes da próxima interação.
    const beforeSearch = [['all', null, null], ['all', null, 'all-page'], ['7', null, null], ['7', null, 'seven-page']];
    h.act(() => t.mock.timers.tick(299));
    await flush(h);
    assert.deepEqual(calls, beforeSearch);
    assert.ok(visible(h, 'Carregando histórico...'));
    h.act(() => t.mock.timers.tick(1));
    await flush(h);
    assert.deepEqual(calls, [...beforeSearch, ['7', 'arena %_', null]]);
    assert.ok(visible(h, 'Nenhum resultado para a pesquisa'));
    filteredPage.resolve(page([card(4, 'Filtro antigo')], 'old'));
    await flush(h);
    assert.ok(!visible(h, 'Filtro antigo') && !visible(h, 'Carregar mais'));
    assert.ok(visible(h, 'Nenhum resultado para a pesquisa'));
  } finally {
    try { h?.unmount(); } finally {
      olderPage.resolve(page([]));
      filteredPage.resolve(page([]));
      t.mock.timers.reset();
    }
  }
});

test('ADMIN-10 resumo usa somente o evento real, mostra ausência de dados e preserva privacidade', async () => {
  const h = createHarness('screens/admin/AdminHistorySummaryScreen.js', { props: { route: { params: { eventId: id(1) } } },
    authContext: verifiedAdminAuth({ httpClient: { get: async (path, options) => {
      assert.equal(path, `/admin/events/${id(1)}/summary`);
      assert.equal(options.auth, true);
      return { ...summary(1, 'Evento encerrado real'), comments: ['Texto privado'], audience: { gender: 'Dado privado' } };
    } } }),
  });
  try {
    await flush(h);
    for (const label of ['Evento encerrado real', 'Duração programada', '2 h 0 min', 'Evento sem participações',
      'Sem atendimentos concluídos.', 'Sem avaliações', 'Sem dados', 'Visualização pendente de aprovação da política de privacidade.', 'Faixa etária', 'Gênero',
      '1 estrela', '2 estrelas', '3 estrelas', '4 estrelas', '5 estrelas']) assert.ok(visible(h, label), label);
    for (const label of ['Texto privado', 'Dado privado', 'Exportar', 'Abrir BI completo', closedAt]) assert.ok(!visible(h, label), label);
    assert.ok(visible(h, 'Tempo até a última experiência concluída'));
    assert.ok(visible(h, 'Indicador A · 0 participações elegíveis'));
    assert.equal(h.exports.scheduledDuration(14 * 86400), '14 dias');
    assert.equal(h.exports.scheduledDuration(86400 + 2 * 3600 + 3 * 60 + 4), '1 dia 2 h 3 min 4 s');
    assert.equal(h.exports.scheduledDuration(7200), '2 h 0 min');
    const tab = h.nodes.find(node => node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === 'Histórico');
    assert.equal(tab.props.accessibilityState.selected, true);
    h.press('Voltar ao Histórico');
    assert.equal(h.navigationCalls.at(-1).type, 'back');
  } finally { h.unmount(); }
});

test('ADMIN-10 atualização mantém dados na falha de rede e limpa após 403 ou evento indisponível', async () => {
  let outcome = null;
  const h = createHarness('screens/admin/AdminHistorySummaryScreen.js', { props: { route: { params: { eventId: id(1) } } },
    authContext: verifiedAdminAuth({ httpClient: { get: async () => {
      if (outcome) throw outcome;
      return summary(1, 'Arena presente');
    } } }),
  });
  try {
    await flush(h);
    outcome = new Error('rede');
    h.press('Atualizar resumo'); await flush(h);
    assert.ok(visible(h, 'Dados desatualizados') && visible(h, 'Arena presente'));
    outcome = { status: 403 };
    h.press('Tentar novamente'); await flush(h);
    assert.ok(visible(h, 'Sua sessão não permite') && !visible(h, 'Arena presente'));
    outcome = { status: 404 };
    h.setFocused(false); h.setFocused(true); await flush(h);
    assert.ok(visible(h, 'Evento não encontrado ou indisponível'));
  } finally { h.unmount(); }
});

for (const change of ['conta', 'evento', 'desmontagem']) test(`ADMIN-10 resumo ignora resposta após troca de ${change}`, async () => {
  const old = deferred();
  let accountChanged = false;
  const client = { get: (path) => {
    if (path === `/admin/events/${id(2)}/summary`) return Promise.resolve(summary(2, 'Novo resumo'));
    assert.equal(path, `/admin/events/${id(1)}/summary`);
    return accountChanged ? Promise.resolve(summary(1, 'Novo resumo')) : old.promise;
  } };
  const h = createHarness('screens/admin/AdminHistorySummaryScreen.js', { props: { route: { params: { eventId: id(1) } } },
    authContext: verifiedAdminAuth({ httpClient: client }) });
  try {
    if (change === 'conta') {
      accountChanged = true;
      h.setAuthContext(verifiedAdminAuth({ httpClient: client, user: { id: id(99), sessionId: 'nova' } }));
    }
    if (change === 'evento') h.setProps({ route: { params: { eventId: id(2) } } });
    if (change === 'desmontagem') h.unmount();
    old.resolve(summary(1, 'Resumo antigo'));
    await flush(h);
    assert.ok(!visible(h, 'Resumo antigo'));
    if (change !== 'desmontagem') assert.ok(visible(h, 'Novo resumo'));
    else assert.equal(h.nodes.length, 0);
  } finally {
    try { h.unmount(); } finally { old.resolve(summary(1, 'Resumo antigo')); }
  }
});
