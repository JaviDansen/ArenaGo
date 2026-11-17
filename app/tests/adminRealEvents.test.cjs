const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, createHarness, textOf } = require('./helpers/questionnaireHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');
const service = loadModule('services/adminEventsService.js', require).exports;
const id = n => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n = 1, phase = 'open') => ({ id: id(n), name: 'Arena Norte', effectivePhase: phase,
  startsAt: '2026-11-05T15:00:00Z', officialEndsAt: '2026-11-05T20:00:00Z', timezone: 'America/Sao_Paulo', readiness: { ready: phase !== 'not_ready' } });
const readiness = (n = 1, overrides = {}) => ({ eventId: id(n), statusStored: 'scheduled', effectivePhase: 'scheduled',
  ready: true, missing: [], checks: { nameAndAccessCode: true, validScheduleAndTimezone: true,
    externalQueueConfigured: true, hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: true },
  acceptingNewParticipations: false, observedAt: '2026-11-05T12:00:00.000000Z', ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));
const hasText = (h, expected) => h.nodes.some(node => textOf(node).includes(expected));
const eventPath = n => `/admin/events/${id(n)}`;
const panel = (get, n = 1) => createHarness('screens/admin/AdminRealEventScreen.js', {
  props: { route: { params: { eventId: id(n) } } }, authContext: verifiedAdminAuth({ httpClient: { get } }),
});
// Let pending promises and harness state updates settle until the expected UI
// appears. A finite number of event-loop turns prevents hanging tests.
async function waitForText(h, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
    if (h.nodes.some(node => textOf(node).includes(expected))) return;
  }
  assert.fail(`Texto não apareceu após 20 ciclos: ${expected}`);
}

test('lista envia busca global, fase e cursor autenticados, sem filtrar páginas no cliente', async () => {
  const calls = [];
  const result = await service.listAdminEvents({ get: async (...args) => { calls.push(args); return { items: [event(1, 'not_ready')], nextCursor: 'next' }; } },
    { search: '  Arena   Norte%_ ', phase: 'scheduled', cursor: 'before', limit: 2 });
  const url = new URL(calls[0][0], 'http://localhost');
  assert.equal(url.searchParams.get('search'), 'Arena Norte%_');
  assert.equal(url.searchParams.get('excludeClosed'), 'true');
  assert.equal(url.searchParams.get('phase'), 'scheduled');
  assert.equal(url.searchParams.get('cursor'), 'before');
  assert.equal(calls[0][1].auth, true);
  assert.equal(result.items[0].effectivePhase, 'not_ready');
});
test('paginação não duplica chamadas ou cards e termina no cursor nulo', async () => {
  const pending = deferred(); let count = 0;
  const loader = service.createAdminEventsLoader({ get: async () => ++count === 1 ? { items: [event()], nextCursor: 'next' } : pending.promise });
  await loader.setFilters({ search: '', phase: 'all' });
  const more = loader.more(); await loader.more(); assert.equal(count, 2);
  pending.resolve({ items: [event(), event(2)], nextCursor: null }); await more;
  assert.equal(loader.getSnapshot().items.length, 2);
  await loader.more(); assert.equal(count, 2);
});
test('busca sobreposta descarta resultado atrasado e reinicia cursor', async () => {
  const old = deferred(), fresh = deferred(); let count = 0;
  const loader = service.createAdminEventsLoader({ get: () => ++count === 1 ? old.promise : fresh.promise });
  const a = loader.setFilters({ search: 'antigo', phase: 'all' });
  const b = loader.setFilters({ search: 'novo', phase: 'open' });
  fresh.resolve({ items: [event(2)], nextCursor: null }); await b;
  old.resolve({ items: [event()], nextCursor: 'stale' }); await a;
  assert.deepEqual(plain(loader.getSnapshot().items.map(item => item.id)), [id(2)]);
  assert.equal(loader.getSnapshot().nextCursor, null);
});
test('erro inicial e de próxima página permitem retry sem perder contexto', async () => {
  let count = 0;
  const loader = service.createAdminEventsLoader({ get: async () => {
    count++; if ([1, 3].includes(count)) throw new Error('network');
    return { items: [event(count)], nextCursor: count === 2 ? 'next' : null };
  } });
  await loader.setFilters({}); assert.equal(loader.getSnapshot().status, 'error');
  await loader.retry(); assert.equal(loader.getSnapshot().items.length, 1);
  await loader.more(); assert.equal(loader.getSnapshot().items.length, 1);
  await loader.retry(); assert.equal(loader.getSnapshot().items.length, 2);
});
test('troca de sessão e dispose impedem publicação de conta anterior', async () => {
  const response = deferred(); let current = true, published = 0;
  const loader = service.createAdminEventsLoader({ get: () => response.promise }, { isCurrent: () => current });
  loader.subscribe(() => published++);
  const request = loader.setFilters({}); const before = published;
  current = false; loader.dispose(); response.resolve({ items: [event()], nextCursor: null }); await request;
  assert.equal(published, before); assert.equal(loader.getSnapshot().items.length, 0);
});
test('401/403 removem dados anteriores e detalhe valida UUID e identidade retornada', async () => {
  for (const status of [401, 403]) {
    let count = 0;
    const loader = service.createAdminEventsLoader({ get: async () => { if (++count > 1) throw { status }; return { items: [event()], nextCursor: 'next' }; } });
    await loader.setFilters({}); await loader.more(); assert.equal(loader.getSnapshot().items.length, 0);
  }
  let calls = 0;
  const client = { get: async () => { calls++; return { event: event() }; } };
  await assert.rejects(service.getAdminEvent(client, 'demo-id')); assert.equal(calls, 0);
  assert.equal((await service.getAdminEvent(client, id(1))).id, id(1));
  await assert.rejects(service.getAdminEvent(client, id(2)));
  await assert.rejects(service.listAdminEvents({ get: async () => ({ items: [event(1, 'closed')], nextCursor: null }) }));
});
test('datas pt-BR respeitam fuso e não exibem ISO ou valores ausentes', () => {
  assert.match(service.formatAdminDate('2026-11-05T15:00:00Z', 'America/Sao_Paulo'), /05\/11\/2026.*12:00/);
  assert.equal(service.formatAdminDate(null, 'UTC'), 'Data indisponível');
});
test('Home oferece navegação explícita, sem contadores ou formulários demo', () => {
  let exits = 0;
  const h = createHarness('screens/admin/AdminHomeScreen.js', { authContext: verifiedAdminAuth({ logout: () => exits++ }) });
  assert.ok(h.nodes.some(node => textOf(node).includes('Painel Administrativo')));
  for (const name of ['Criar evento', 'Catálogo de experiências']) {
    const button = h.nodes.find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith(name));
    assert.equal(button.props.disabled, true);
  }
  const users = h.nodes.find(node => node.type === 'View' && node.props.accessibilityLabel === 'Usuários e permissões · Em implementação');
  assert.ok(users, 'gestão global permanece informativa');
  assert.equal(users.props.onPress, undefined);
  assert.ok(textOf(users).includes('Em breve'));
  assert.ok(!h.nodes.some(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Usuários e permissões')));
  h.press('Gerenciar eventos'); h.act(() => {});
  assert.equal(h.navigationCalls.at(-1).name, 'AdminEvents');
  h.press('Histórico de eventos'); h.press('Visão geral'); h.press('Sair da conta');
  assert.equal(exits, 1); assert.equal(h.navigationCalls.at(-1).name, 'BI');
});
test('lista monta HTTP real, estado vazio, not_ready e seleção por UUID', async () => {
  const calls = []; let body = { items: [], nextCursor: null };
  const auth = verifiedAdminAuth({ httpClient: { get: async url => { calls.push(url); return body; } } });
  const h = createHarness('screens/admin/AdminRealEventsScreen.js', { authContext: auth });
  await waitForText(h, 'Nenhum evento encontrado');
  assert.ok(h.nodes.some(node => textOf(node).includes('Nenhum evento encontrado')));
  assert.deepEqual(h.nodes.filter(node => node.type === 'Pressable' && node.props.accessibilityRole === 'tab').map(node => node.props.accessibilityLabel), ['Home', 'Histórico', 'BI']);
  body = { items: [event(1, 'not_ready')], nextCursor: null };
  h.act(() => h.nodes.find(node => node.type === 'TextInput').props.onChangeText('Arena'));
  await waitForText(h, 'Não pronto');
  assert.ok(calls.at(-1).includes('search=Arena'));
  assert.ok(h.nodes.some(node => textOf(node).includes('Não pronto')));
  h.press('Acessar evento Arena Norte');
  assert.equal(h.navigationCalls.at(-1).params.eventId, id(1));
  assert.equal(h.navigationCalls.at(-1).name, 'AdminRealEvent');
  h.unmount();
});
test('lista exibe falha de rede e recupera pelo botão de retry', async () => {
  let count = 0;
  const h = createHarness('screens/admin/AdminRealEventsScreen.js', { authContext: verifiedAdminAuth({ httpClient: { get: async () => {
    if (++count === 1) throw new Error('network'); return { items: [], nextCursor: null };
  } } }) });
  await waitForText(h, 'Não foi possível carregar');
  assert.ok(h.nodes.some(node => textOf(node).includes('Não foi possível carregar')));
  h.press('Tentar novamente');
  await waitForText(h, 'Nenhum evento encontrado');
  assert.equal(count, 2); h.unmount();
});
test('painel consulta detalhe e prontidão pelo UUID, exibe dados oficiais e trata recurso inacessível', async () => {
  const urls = [];
  const h = panel(async (url, options) => {
    urls.push(url);
    assert.equal(options.auth, true);
    return url.endsWith('/readiness') ? readiness() : { event: { ...event(), officialEndsAt: '2026-11-06T05:00:00Z' } };
  });
  await waitForText(h, 'Arena Norte');
  assert.deepEqual(urls, [eventPath(1), `${eventPath(1)}/readiness`]);
  assert.ok(hasText(h, 'Painel do evento'));
  assert.ok(hasText(h, 'Pronto para operar'));
  assert.ok(hasText(h, 'Agendado'));
  assert.ok(!hasText(h, 'Aberto'));
  assert.ok(!hasText(h, 'Local:'));
  assert.match(textOf(h.nodes.find(node => node.type === 'Text' && textOf(node).startsWith('Início:'))), /05\/11\/2026.*12:00/);
  assert.match(textOf(h.nodes.find(node => node.type === 'Text' && textOf(node).startsWith('Término oficial:'))), /06\/11\/2026.*02:00/);
  assert.ok(!h.nodes.some(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Configuração pendente'));
  const cards = h.nodes.filter(node => node.type === 'Pressable' && node.props.testID?.startsWith('admin-event-area-'));
  const titles = ['Informações e horários', 'Experiências e estações', 'Equipe Staff', 'Operação do evento', 'BI do evento'];
  assert.deepEqual(cards.map(node => node.props.accessibilityLabel), titles);
  for (const [index, area] of ['schedule', 'experiences', 'staff', 'operation', 'analytics'].entries()) {
    h.press(titles[index]);
    assert.deepEqual(plain(h.navigationCalls.at(-1)), { type: 'navigate', name: 'AdminEventManagementInfo', params: { eventId: id(1), area } });
  }
  assert.deepEqual(h.nodes.filter(node => node.type === 'Pressable' && node.props.accessibilityRole === 'tab').map(node => node.props.accessibilityLabel), ['Home', 'Histórico', 'BI']);
  h.press('Voltar aos eventos');
  assert.equal(h.navigationCalls.at(-1).name, 'AdminEvents');
  h.setAuthContext(verifiedAdminAuth({ user: { id: 'other' }, httpClient: { get: async () => { throw { status: 404 }; } } }));
  assert.ok(!hasText(h, 'Arena Norte'));
  await waitForText(h, 'Evento indisponível');
  assert.ok(!hasText(h, 'GERENCIAMENTO'));
  h.unmount();
});

test('serviço valida prontidão, identidade, formato e preserva erros HTTP do cliente', async () => {
  let captured;
  const get = async (url, options) => { captured = [url, options.auth]; return readiness(); };
  await assert.rejects(service.getAdminEventReadiness({ get }, 'demo-id'), /inválido/);
  assert.equal(captured, undefined);
  assert.equal((await service.getAdminEventReadiness({ get }, id(1))).acceptingNewParticipations, false);
  assert.deepEqual(captured, [`${eventPath(1)}/readiness`, true]);
  for (const body of [readiness(2), null, readiness(1, { missing: [1] }), readiness(1, { checks: {} }),
    readiness(1, { observedAt: 'ontem' }), readiness(1, { ready: 'true' }), readiness(1, { effectivePhase: ['open'] })]) {
    await assert.rejects(service.getAdminEventReadiness({ get: async () => body }, id(1)), /prontidão inválida/);
  }
  await assert.rejects(service.getAdminEvent({ get: async () => ({ event: { ...event(), startsAt: null } }) }, id(1)), /evento inválida/);
  for (const error of [{ status: 401 }, { status: 403 }, { status: 404 }, new Error('network')]) {
    for (const read of [service.getAdminEvent, service.getAdminEventReadiness]) {
      await assert.rejects(read({ get: async () => { throw error; } }, id(1)), actual => actual === error);
    }
  }
});

test('prontidão dedicada substitui snapshot antigo e orienta pendências conhecidas e desconhecidas', async () => {
  const missing = ['EVENT_NAME_OR_ACCESS_CODE_INVALID', 'EVENT_SCHEDULE_INVALID', 'EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED',
    'EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF', 'FUTURE_CODE'];
  const h = panel(async url => url.endsWith('/readiness') ? readiness(1, { ready: false, effectivePhase: 'not_ready', missing,
    checks: Object.fromEntries(Object.keys(readiness().checks).map(key => [key, false])) }) : { event: event() });
  await waitForText(h, 'Configuração pendente');
  assert.ok(hasText(h, 'Não pronto'));
  assert.ok(!hasText(h, 'Pronto para operar'));
  h.act(() => h.press('Configuração pendente'));
  for (const message of ['nome e o código', 'horários e o fuso', 'configuração da fila externa', 'estação disponível',
    'ativo e com e-mail verificado', 'não puderam ser detalhados']) assert.ok(hasText(h, message), message);
  assert.ok(!hasText(h, 'FUTURE_CODE'));
  assert.ok(!hasText(h, 'online'));
  h.press('Consultar Equipe Staff');
  assert.deepEqual(plain(h.navigationCalls.at(-1).params), { eventId: id(1), area: 'staff' });
  h.act(() => h.press('Configuração pendente'));
  assert.ok(!hasText(h, 'ativo e com e-mail verificado'));
  h.unmount();
});

test('falha parcial não inventa prontidão e retry agrupa toques repetidos', async () => {
  let reads = 0;
  const next = deferred();
  const h = panel(async url => {
    if (!url.endsWith('/readiness')) return { event: event() };
    if (++reads === 1) throw new Error('network');
    return next.promise;
  });
  await waitForText(h, 'Prontidão indisponível');
  assert.ok(hasText(h, 'Arena Norte'));
  assert.ok(!hasText(h, 'Configuração pendente') && !hasText(h, 'Pronto para operar'));
  h.act(() => { h.press('Tentar novamente'); h.press('Tentar novamente'); });
  assert.equal(reads, 2);
  next.resolve(readiness(1, { effectivePhase: 'closed' }));
  await waitForText(h, 'Encerrado');
  assert.ok(hasText(h, 'Pronto para operar'));
  h.unmount();
});

test('readiness válido fica disponível quando o detalhe falha sem negar acesso', async () => {
  const h = panel(async url => {
    if (url.endsWith('/readiness')) return readiness();
    return { event: event(2) };
  });
  await waitForText(h, 'Pronto para operar');
  assert.ok(hasText(h, 'A resposta da API não pôde ser confirmada'));
  assert.ok(!hasText(h, 'Arena Norte') && !hasText(h, 'GERENCIAMENTO'));
  h.unmount();
});

test('403 ou 404 na prontidão removem inclusive detalhe válido após atualizar', async () => {
  for (const status of [401, 403, 404]) {
    let allowed = true;
    const h = panel(async url => {
      if (!url.endsWith('/readiness')) return { event: event() };
      if (!allowed) throw { status };
      return readiness();
    });
    await waitForText(h, 'Arena Norte');
    allowed = false;
    h.act(() => h.nodes.find(node => node.type === 'ScrollView').props.refreshControl.props.onRefresh());
    assert.ok(!hasText(h, 'Arena Norte'));
    await waitForText(h, 'Evento indisponível');
    assert.ok(!hasText(h, 'GERENCIAMENTO') && !hasText(h, 'Pronto para operar'));
    h.unmount();
  }
});

test('troca de UUID, sessão e logout descartam requisições em andamento', async () => {
  const previous = deferred(), other = deferred(), outgoing = deferred();
  const h = panel(url => url.startsWith(eventPath(1)) ? previous.promise : other.promise);
  h.setProps({ route: { params: { eventId: id(2) } } });
  previous.resolve({ event: event() });
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  assert.ok(!hasText(h, 'Arena Norte') && hasText(h, 'Carregando evento'));
  h.setAuthContext(verifiedAdminAuth({ user: { id: 'other' }, httpClient: { get: () => outgoing.promise } }));
  other.resolve({ event: { ...event(2), name: 'Sessão anterior' } });
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  assert.ok(!hasText(h, 'Sessão anterior') && hasText(h, 'Carregando evento'));
  h.setAuthContext(verifiedAdminAuth({ isAuthenticated: false }));
  outgoing.resolve({ event: { ...event(2), name: 'Saiu da conta' } });
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  assert.ok(!hasText(h, 'Saiu da conta') && !hasText(h, 'GERENCIAMENTO'));
  h.unmount();
});

test('recuperar foco consulta novamente e uma resposta anterior não sobrescreve a fase', async () => {
  const older = deferred();
  let reads = 0;
  const h = panel(async url => url.endsWith('/readiness') ? (++reads === 1 ? older.promise : readiness(1, { effectivePhase: 'closed' })) : { event: event() });
  h.setFocused(false);
  h.setFocused(true);
  await waitForText(h, 'Encerrado');
  assert.equal(reads, 2);
  older.resolve(readiness(1, { effectivePhase: 'open', acceptingNewParticipations: true }));
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  assert.ok(hasText(h, 'Encerrado') && !hasText(h, 'Aberto'));
  h.unmount();
});

test('destino informativo valida área e confirma evento com leitura autenticada', async () => {
  const calls = [];
  const h = createHarness('screens/admin/AdminEventManagementInfoScreen.js', {
    props: { route: { params: { eventId: id(2), area: 'staff', name: 'Nome não confiável' } } },
    authContext: verifiedAdminAuth({ httpClient: { get: async (url, options) => {
      calls.push([url, options.auth]);
      return { event: event(2) };
    } } }),
  });
  await waitForText(h, 'Arena Norte');
  assert.deepEqual(calls, [[eventPath(2), true]]);
  assert.ok(hasText(h, 'Equipe Staff'));
  assert.ok(!hasText(h, 'Nome não confiável'));
  h.press('Voltar ao painel');
  assert.deepEqual(plain(h.navigationCalls.at(-1)), { type: 'popTo', name: 'AdminRealEvent', params: { eventId: id(2) } });
  h.setProps({ route: { params: { eventId: id(2), area: 'AdminDemo' } } });
  await waitForText(h, 'Área indisponível');
  assert.equal(calls.length, 1);
  assert.ok(!hasText(h, 'Arena Norte'));
  h.unmount();
});
