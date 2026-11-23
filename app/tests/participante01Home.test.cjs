// PARTICIPANTE-01 — Home do Participante e formatação de horários do ingresso.
const assert = require('node:assert/strict');
const test = require('node:test');

// Os módulos rodam em outro contexto vm; comparar pelo conteúdo.
const same = (actual, expected, message) => assert.deepEqual(structuredClone(actual), expected, message);
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

const eventTime = loadModule('utils/eventTime.js', require).exports;
const overviewUtils = loadModule('utils/homeOverview.js', name =>
  name === './eventTime.js' ? eventTime : require(name)).exports;
const entryPresentation = loadModule('utils/eventEntryPresentation.js', require).exports;

const ids = {
  recent: '11111111-1111-4111-8111-111111111111',
  older: '22222222-2222-4222-8222-222222222222',
  event: '33333333-3333-4333-8333-333333333333',
  userA: '44444444-4444-4444-8444-444444444444',
  userB: '55555555-5555-4555-8555-555555555555',
};

function historyItem(overrides = {}) {
  return {
    participationId: ids.recent,
    event: { id: ids.event, name: 'Arena Games Festival' },
    status: 'finished',
    joinedAt: '2026-11-08T13:00:00.000000Z',
    arenaEnteredAt: '2026-11-08T13:05:00.000000Z',
    finishedAt: '2026-11-08T15:00:00.000000Z',
    completedServicesCount: 2,
    evaluation: { eligible: true, submitted: false, pending: true },
    ...overrides,
  };
}

function renderHome(overview, user = { id: ids.userA, name: 'Maria Souza', hasCompletedQuestionnaire: true }) {
  const h = createHarness('screens/home/HomeScreen.js', {
    authContext: { isAuthenticated: true, user },
    props: { overview },
  });
  const text = () => h.nodes.map(node => (node.type === 'Text' ? textOf(node) : '')).join(' | ');
  const byTestId = testID => h.nodes.find(node => node.props?.testID === testID);
  return { h, text, byTestId };
}

// ---------------------------------------------------------------- horários

test('P01-22: horários do evento usam o fuso IANA informado, não o do aparelho', () => {
  const iso = '2026-11-08T13:00:00.000Z';
  same(eventTime.formatInstantParts(iso, 'America/Sao_Paulo'),
    { date: '08/11/2026', time: '10:00', zone: 'America/Sao_Paulo' });
  assert.equal(eventTime.formatInstantParts(iso, 'America/Manaus').time, '09:00');
  assert.equal(eventTime.formatInstantParts(iso, 'America/Noronha').time, '11:00');
});

test('P01-22: fuso desconhecido cai para UTC explícito e instante inválido não é exibido', () => {
  same(eventTime.formatInstantParts('2026-11-08T13:00:00.000Z', 'Mars/Base'),
    { date: '08/11/2026', time: '13:00', zone: 'UTC' });
  assert.equal(eventTime.describeTimeZone('Mars/Base'), 'UTC');
  assert.equal(eventTime.formatInstantParts('não é data', 'America/Sao_Paulo'), null);
  assert.equal(eventTime.describeTimeZone('America/Sao_Paulo'), 'Horário de Brasília (America/Sao_Paulo)');
});

test('P01-22: evento que atravessa a meia-noite mostra a data completa do encerramento', () => {
  const schedule = eventTime.describeEventSchedule({
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-11-08T22:00:00.000Z', // 19:00 de 08/11
    officialEndsAt: '2026-11-09T04:00:00.000Z', // 01:00 de 09/11
    operationalDeadlineAt: '2026-11-09T05:00:00.000Z', // 02:00 de 09/11
  });
  same(schedule, {
    date: '08/11/2026', start: '19:00', entriesUntil: '09/11/2026 às 01:00',
    finalDeadline: '02:00', zoneLabel: 'Horário de Brasília (America/Sao_Paulo)',
  });
  const sameDay = eventTime.describeEventSchedule({
    timezone: 'America/Sao_Paulo', startsAt: '2026-11-08T13:00:00.000Z',
    officialEndsAt: '2026-11-08T20:00:00.000Z', operationalDeadlineAt: '2026-11-08T21:00:00.000Z',
  });
  assert.equal(sameDay.entriesUntil, '17:00');
  assert.equal(sameDay.finalDeadline, '18:00');
});

// ---------------------------------------------------------------- textos do ingresso

test('P01-15/16/17/18: motivos de bloqueio aparecem em português, sem códigos técnicos', () => {
  const messages = entryPresentation.describeBlockingReasons(['EVENT_NOT_READY', 'PROFILE_INCOMPLETE']);
  same(messages, [
    'Complete o questionário de perfil antes de entrar no evento.',
    'O evento ainda não está pronto para receber participantes.',
  ]);
  for (const code of ['EVENT_NOT_FOUND', 'USER_NOT_FOUND', 'USER_INACTIVE', 'PARTICIPATION_ALREADY_CURRENT',
    'PROFILE_INCOMPLETE', 'EVENT_NOT_STARTED', 'EVENT_REGISTRATION_CLOSED', 'EVENT_NOT_READY', 'CODIGO_NOVO']) {
    const [message] = entryPresentation.describeBlockingReasons([code]);
    assert.doesNotMatch(message, /[A-Z]{3,}_[A-Z_]+/, `${code} não vaza código`);
  }
  same(entryPresentation.describeBlockingReasons([]), ['O evento não está disponível para entrada agora.']);
});

test('situação do evento deriva só da elegibilidade do servidor', () => {
  const label = eligibility => entryPresentation.describeEventAvailability(eligibility).label;
  assert.equal(label({ eligible: true, blockingReasons: [] }), 'ENTRADAS ABERTAS');
  assert.equal(label({ eligible: false, blockingReasons: ['EVENT_NOT_STARTED'] }), 'AINDA NÃO INICIADO');
  assert.equal(label({ eligible: false, blockingReasons: ['EVENT_REGISTRATION_CLOSED'] }), 'ENTRADAS ENCERRADAS');
  assert.equal(label({ eligible: false, blockingReasons: ['EVENT_NOT_READY'] }), 'EM PREPARAÇÃO');
  assert.equal(label({ eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] }), 'ENTRADA INDISPONÍVEL');
  assert.equal(entryPresentation.blockingAction(['PARTICIPATION_ALREADY_CURRENT', 'PROFILE_INCOMPLETE']), 'home');
  assert.equal(entryPresentation.blockingAction(['PROFILE_INCOMPLETE']), 'questionnaire');
  assert.equal(entryPresentation.blockingAction(['EVENT_NOT_STARTED']), null);
});

// ---------------------------------------------------------------- regras da Home

test('P01-01/02: visão geral distingue conta sem histórico e com histórico', async () => {
  const fetchPendingItem = async () => assert.fail('sem pendência não consulta elegibilidade');
  const empty = await overviewUtils.loadHomeOverview({}, {
    fetchHistory: async (_, options) => { same(options, { limit: 1 }); return { items: [], nextCursor: null }; },
    fetchPendingItem,
  });
  same(empty, { recent: null, pending: null });
  const item = historyItem();
  const filled = await overviewUtils.loadHomeOverview({}, {
    fetchHistory: async () => ({ items: [item], nextCursor: 'x' }), fetchPendingItem,
  });
  assert.equal(filled.recent, item);
});

test('P01-04/05: pendência única só é oferecida após confirmação do servidor', async () => {
  const older = historyItem({ participationId: ids.older, event: { id: ids.event, name: 'Copa Indie' } });
  const confirmed = await overviewUtils.loadHomeOverview({}, {
    pendingIds: [ids.older],
    fetchHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingItem: async (_, id) => { assert.equal(id, ids.older); return older; },
  });
  same(confirmed.pending, { kind: 'single', item: older });
  const card = overviewUtils.describePendingEvaluation(confirmed.pending, confirmed.recent);
  assert.equal(card.text, 'Você ainda pode avaliar sua participação em Copa Indie.');

  // Já enviada, expirada ou inelegível: o serviço devolve null e nada é oferecido.
  const submitted = await overviewUtils.loadHomeOverview({}, {
    pendingIds: [ids.recent],
    fetchHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingItem: async () => null,
  });
  assert.equal(submitted.pending, null);

  // Falha na confirmação esconde só o card, nunca o histórico.
  const failed = await overviewUtils.loadHomeOverview({}, {
    pendingIds: [ids.recent],
    fetchHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingItem: async () => { throw Object.assign(new Error('offline'), { isNetworkError: true }); },
  });
  assert.equal(failed.pending, null);
  assert.ok(failed.recent);
});

test('várias pendências seguem a política existente: lista na aba Eventos', async () => {
  const result = await overviewUtils.loadHomeOverview({}, {
    pendingIds: [ids.recent, ids.older],
    fetchHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingItem: async () => assert.fail('várias pendências não escolhem uma por conta própria'),
  });
  same(result.pending, { kind: 'multiple', count: 2 });
  same(overviewUtils.pendingEvaluationIds({ pendingEvaluationParticipationIds: [ids.recent, ids.recent, 'x'] }),
    [ids.recent]);
});

test('P01-11: leitura que deixou de ser atual é descartada', async () => {
  let current = true;
  const result = await overviewUtils.loadHomeOverview({}, {
    isCurrent: () => current,
    fetchHistory: async () => { current = false; return { items: [historyItem()], nextCursor: null }; },
    fetchPendingItem: async () => assert.fail('não continua após troca de sessão'),
    pendingIds: [ids.recent],
  });
  assert.equal(result, null);
});

test('evento recente apresenta a semântica real do status, sem inventar local', () => {
  const finished = overviewUtils.describeRecentParticipation(historyItem());
  assert.equal(finished.eventName, 'Arena Games Festival');
  assert.match(finished.date, /^\d{2}\/\d{2}\/2026$/);
  assert.match(finished.time, /^\d{2}:\d{2}$/);
  assert.equal(finished.statusLabel, 'Encerrada');
  assert.ok(!('location' in finished));
  const canceled = overviewUtils.describeRecentParticipation(historyItem({
    status: 'canceled', arenaEnteredAt: null, completedServicesCount: 0,
  }));
  assert.equal(canceled.statusLabel, 'Cancelada');
  assert.equal(canceled.statusVariant, 'danger');
});

// ---------------------------------------------------------------- tela da Home

test('P01-01: conta sem histórico mostra tutorial e estado vazio; botão abre o ingresso real', () => {
  const { h, text, byTestId } = renderHome({ status: 'empty', recent: null, pending: null, retry() {} });
  assert.match(text(), /Olá, Maria!/);
  assert.match(text(), /Como funciona\?/);
  for (const step of ['Acesse o evento', 'Participe das experiências', 'Avalie a sua experiência']) {
    assert.match(text(), new RegExp(step));
  }
  assert.match(text(), /Você ainda não participou de nenhum evento\./);
  assert.ok(!byTestId('home-recent-section'));
  assert.ok(!byTestId('home-pending-evaluation-card'));
  const entry = h.nodes.find(node => node.type === 'Pressable' && textOf(node) === 'Entrar em um evento');
  entry.props.onPress();
  same(h.navigationCalls.map(call => call.name), ['EventEntry']);
});

test('P01-09: carregando ou com falha não mostra estado vazio nem tutorial', () => {
  const loading = renderHome({ status: 'loading', recent: null, pending: null, retry() {} });
  assert.ok(loading.byTestId('home-overview-loading'));
  assert.doesNotMatch(loading.text(), /ainda não participou|Como funciona/);

  let retries = 0;
  const failed = renderHome({ status: 'error', error: 'network', recent: null, pending: null, retry() { retries += 1; } });
  assert.ok(failed.byTestId('home-overview-error'));
  assert.doesNotMatch(failed.text(), /ainda não participou|Como funciona|Evento recente/);
  assert.match(failed.text(), /Não foi possível conectar ao servidor/);
  failed.h.nodes.find(node => node.type === 'Pressable' && textOf(node) === 'Tentar novamente').props.onPress();
  assert.equal(retries, 1);
});

test('P01-02/03/07/08: com histórico mostra o evento recente, abre a participação certa e Ver todos leva a Eventos', () => {
  const recent = historyItem({ evaluation: { eligible: true, submitted: true, pending: false } });
  const { h, text, byTestId } = renderHome({ status: 'history', recent, pending: null, retry() {} });
  assert.match(text(), /Evento recente/);
  assert.match(text(), /Arena Games Festival/);
  assert.doesNotMatch(text(), /Como funciona|ainda não participou/);
  assert.ok(!byTestId('home-pending-evaluation-card'), 'sem pendência, sem card');

  byTestId('home-recent-event-card').props.onPress();
  byTestId('home-see-all-events').props.onPress();
  same(h.navigationCalls.map(({ name, params }) => ({ name, params })), [
    { name: 'ParticipationDetails', params: { participationId: ids.recent, historyItem: recent } },
    { name: 'Eventos', params: undefined },
  ]);
});

test('P01-04: avaliação pendente abre a avaliação da participação pendente, não a mais recente', () => {
  const recent = historyItem();
  const pendingItem = historyItem({ participationId: ids.older, event: { id: ids.event, name: 'Copa Indie' } });
  const { h, text, byTestId } = renderHome({
    status: 'history', recent, pending: { kind: 'single', item: pendingItem }, retry() {},
  });
  assert.match(text(), /Avaliação pendente/);
  assert.match(text(), /Copa Indie/);
  byTestId('home-pending-evaluation-card').props.onPress();
  same(h.navigationCalls.map(({ name, params }) => ({ name, params })), [
    { name: 'RealEvaluation', params: { participationId: ids.older, historyItem: pendingItem } },
  ]);

  const sameRecent = renderHome({ status: 'history', recent, pending: { kind: 'single', item: recent }, retry() {} });
  assert.match(sameRecent.text(), /no último evento/);
  const many = renderHome({ status: 'history', recent, pending: { kind: 'multiple', count: 3 }, retry() {} });
  many.byTestId('home-pending-evaluation-card').props.onPress();
  same(many.h.navigationCalls.map(call => call.name), ['Eventos']);
});

test('P01-23: saudação usa só o primeiro nome, limita linhas e tem fallback', () => {
  const long = renderHome({ status: 'empty', retry() {} },
    { id: ids.userA, name: '  Bartolomeuzinhoextremamentecomprido de Souza  ', hasCompletedQuestionnaire: true });
  const greeting = long.h.nodes.find(node => node.type === 'Text' && /^Olá/.test(textOf(node)));
  assert.equal(textOf(greeting), 'Olá, Bartolomeuzinhoextremamentecomprido!');
  assert.equal(greeting.props.numberOfLines, 2);
  const noName = renderHome({ status: 'empty', retry() {} }, { id: ids.userA, hasCompletedQuestionnaire: true });
  assert.match(noName.text(), /Olá!/);
  const longEvent = renderHome({ status: 'history', recent: historyItem({
    event: { id: ids.event, name: 'Evento com um nome muito longo '.repeat(6) } }), pending: null, retry() {} });
  const name = longEvent.h.nodes.find(node => node.type === 'Text' && /Evento com um nome/.test(textOf(node)));
  assert.equal(name.props.numberOfLines, 2);
});

test('questionário pendente continua visível na Home reformulada', () => {
  const { byTestId } = renderHome({ status: 'empty', retry() {} },
    { id: ids.userA, name: 'Ana', hasCompletedQuestionnaire: false });
  assert.ok(byTestId('home-pending-questionnaire-banner'));
});

// ---------------------------------------------------------------- hook (isolamento por sessão)

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function hookRig(services) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const cleanups = [];
  const react = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(callback, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((value, k) => !Object.is(value, previous[k]))) {
        slots[i] = deps;
        effects.push({ i, callback });
      }
    },
  };
  const module = loadModule('screens/home/useHomeOverview.js', name => {
    if (name === 'react') return react;
    if (name === '../../services/participationHistoryService.js') return services;
    if (name === '../../utils/homeOverview.js') return overviewUtils;
    return require(name);
  }).exports;
  let last;
  function render(params) {
    cursor = 0;
    last = module.useHomeOverview(params);
    for (const { i, callback } of effects.splice(0)) {
      if (typeof cleanups[i] === 'function') cleanups[i]();
      const cleanup = callback();
      cleanups[i] = typeof cleanup === 'function' ? cleanup : null;
    }
    cursor = 0;
    last = module.useHomeOverview(params);
    effects = [];
    return last;
  }
  return { render, get last() { return last; } };
}

function authFor(userId, epoch = 1, verified = true) {
  return {
    isAuthenticated: true, user: { id: userId }, httpClient: { id: `client-${userId}` },
    getSessionEpoch: () => epoch, isIdentityVerified: () => verified,
  };
}

test('P01-12: sem identidade verificada a Home fica carregando e não consulta o histórico', () => {
  let reads = 0;
  const rig = hookRig({ fetchParticipationHistory: async () => { reads += 1; return { items: [], nextCursor: null }; },
    fetchPendingEvaluationHistoryItem: async () => null });
  const result = rig.render({ auth: authFor(ids.userA, 1, false), enabled: true, focused: true, returnState: null, returnStateVersion: 1 });
  assert.equal(result.status, 'loading');
  assert.equal(reads, 0);
});

test('P01-10/11: troca de conta descarta a resposta atrasada da conta anterior', async () => {
  const pending = { [ids.userA]: deferred(), [ids.userB]: deferred() };
  const rig = hookRig({
    fetchParticipationHistory: client => pending[client.id.replace('client-', '')].promise,
    fetchPendingEvaluationHistoryItem: async () => null,
  });
  const base = { enabled: true, focused: true, returnState: { pendingEvaluationParticipationIds: [] }, returnStateVersion: 1 };
  assert.equal(rig.render({ ...base, auth: authFor(ids.userA) }).status, 'loading');
  assert.equal(rig.render({ ...base, auth: authFor(ids.userB) }).status, 'loading');

  pending[ids.userA].resolve({ items: [historyItem()], nextCursor: null });
  await new Promise(resolve => setImmediate(resolve));
  const afterStale = rig.render({ ...base, auth: authFor(ids.userB) });
  assert.equal(afterStale.status, 'loading', 'histórico da conta A não aparece para B');
  assert.equal(afterStale.recent, null);

  pending[ids.userB].resolve({ items: [], nextCursor: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rig.render({ ...base, auth: authFor(ids.userB) }).status, 'empty');
  // Voltar para A (novo login) começa do zero, sem reaproveitar dados de B.
  assert.equal(rig.render({ ...base, auth: authFor(ids.userA, 2) }).status, 'loading');
});

test('P01-09: falha de rede vira estado de erro com nova tentativa, nunca histórico vazio', async () => {
  let attempt = 0;
  const rig = hookRig({
    fetchParticipationHistory: async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('offline'), { isNetworkError: true });
      return { items: [historyItem()], nextCursor: null };
    },
    fetchPendingEvaluationHistoryItem: async () => null,
  });
  const params = { auth: authFor(ids.userA), enabled: true, focused: true, returnState: null, returnStateVersion: 1 };
  rig.render(params);
  await new Promise(resolve => setImmediate(resolve));
  const failed = rig.render(params);
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'network');
  failed.retry();
  rig.render(params);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rig.render(params).status, 'history');
  assert.equal(attempt, 2);
});

test('participação corrente desabilita a leitura da Home', () => {
  let reads = 0;
  const rig = hookRig({ fetchParticipationHistory: async () => { reads += 1; return { items: [], nextCursor: null }; },
    fetchPendingEvaluationHistoryItem: async () => null });
  rig.render({ auth: authFor(ids.userA), enabled: false, focused: true, returnState: null, returnStateVersion: 1 });
  assert.equal(reads, 0);
});
