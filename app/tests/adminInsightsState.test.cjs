// ADM03 — regras puras do Histórico, Visão Geral e BI individual (D08, D10,
// RA-01, métricas temporais). Numeração = critérios de aceite da ADM03.
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const data = loadModule('data/adminDemoData.js', require).exports;
const time = loadModule('screens/admin/adminTime.js', (name) => {
  if (name === '../../data/adminDemoData') return data;
  return require(name);
}).exports;
const state = loadModule('screens/admin/adminDemoState.js', (name) => {
  if (name === '../../data/adminDemoData') return data;
  if (name === './adminTime') return time;
  return require(name);
}).exports;
const insights = loadModule('screens/admin/adminInsights.js', (name) => {
  if (name === '../../data/adminDemoData') return data;
  if (name === './adminDemoState') return state;
  if (name === './adminTime') return time;
  return require(name);
}).exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const session = () => state.createAdminDemoSession();
const idOf = (current, code) => current.events.find((item) => item.accessCode === code).id;
const codes = (items) => plain(items.map((item) => (item.event ?? item).accessCode));
const XP = 'demo-admin-arena-xp';

function draft(overrides = {}) {
  return {
    name: 'Arena Nova',
    accessCode: 'NOVA-01',
    timezone: 'America/Sao_Paulo',
    startDate: '10/11/2026',
    startTime: '10:00',
    officialEndDate: '10/11/2026',
    officialEndTime: '18:00',
    operationalDeadlineDate: '10/11/2026',
    operationalDeadlineTime: '18:30',
    externalQueueEnabled: true,
    reason: 'Cadastro e preparação do evento',
    ...overrides,
  };
}

test('fixtures de BI entram na sessão como cópia e apontam só para IDs existentes', () => {
  const current = session();
  current.evaluations[0].revisions[0].score = 1;
  assert.equal(data.adminDemoEvaluations[0].revisions[0].score, 5);
  const stationIds = new Set(current.stations.map((item) => item.id));
  const eventIds = new Set(current.events.map((item) => item.id));
  assert.ok(current.stationCompletions.every((item) => stationIds.has(item.stationId)));
  assert.ok(current.evaluations.every((item) => eventIds.has(item.eventId)));
  assert.ok(current.timeMetrics.every((item) => eventIds.has(item.eventId)));
});

test('fixtures de BI coerentes com os contadores: avaliações e amostras não excedem as finalizadas elegíveis', () => {
  const current = session();
  current.events.forEach((event) => {
    const bi = insights.getEventBi(current, event.id);
    assert.ok(bi.evaluations.total <= bi.participations.finishedOutsideAdmin, event.accessCode);
    assert.ok(bi.time.lastCompletion.sampleSize <= bi.participations.finishedOutsideAdmin, event.accessCode);
  });
});

test('critério 1: histórico contém somente eventos efetivamente encerrados', () => {
  const current = session();
  const items = insights.listHistory(current);
  assert.deepEqual(codes(items), ['TESTE-01', 'SUMMER-24']);
  assert.ok(items.every((item) => item.info.phase === 'closed'));
  assert.equal(items[0].closureKind, 'immediate');
  assert.equal(items[1].closureKind, 'schedule');
  // Status armazenado "open" defasado (Copa Noturna) só entra quando o relógio encerra.
  const later = state.advanceClock(current, 15).state;
  assert.deepEqual(codes(insights.listHistory(later)), ['NOTURNA', 'TESTE-01', 'SUMMER-24']);
});

test('critério 2: encerramentos imediato e controlado feitos na sessão atualizam o histórico', () => {
  let current = session();
  current = state.closeEvent(current, XP, { mode: 'immediate', reason: 'Queda de energia no local' }).state;
  const item = insights.listHistory(current).find((entry) => entry.event.id === XP);
  assert.ok(item);
  assert.equal(item.closureKind, 'immediate');
  assert.equal(insights.getClosureReason(item.event), 'Queda de energia no local');

  let controlled = session();
  controlled = state.closeEvent(controlled, XP, { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte' }).state;
  assert.ok(!insights.listHistory(controlled).some((entry) => entry.event.id === XP), 'encerrando não é encerrado');
  controlled = state.advanceClock(controlled, 30).state;
  const closed = insights.listHistory(controlled).find((entry) => entry.event.id === XP);
  assert.equal(closed.closureKind, 'controlled');
});

test('ADM02: perda de capacidade não transforma o evento em encerrado', () => {
  let current = session();
  current = state.revokeStaff(current, XP, { grantId: 'demo-admin-grant-xp-ana', reason: 'Troca de equipe' }).state;
  current = state.revokeStaff(current, XP, { grantId: 'demo-admin-grant-xp-bruno', reason: 'Troca de equipe' }).state;
  const bi = insights.getEventBi(current, XP);
  assert.equal(bi.info.phase, 'open');
  assert.equal(bi.info.capacitySuspended, true);
  assert.ok(!insights.listHistory(current).some((entry) => entry.event.id === XP));
});

test('critério 3: busca (trim e caixa) e período retornam subconjuntos corretos', () => {
  const current = session();
  assert.deepEqual(codes(insights.listHistory(current, { query: '  summer ' })), ['SUMMER-24']);
  assert.deepEqual(codes(insights.listHistory(current, { query: 'teste-01' })), ['TESTE-01']);
  assert.deepEqual(codes(insights.listHistory(current, { query: 'ARENA-XP' })), [], 'aberto não entra');
  assert.deepEqual(codes(insights.listHistory(current, { period: '7d' })), ['TESTE-01']);
  assert.deepEqual(codes(insights.listHistory(current, { period: '30d' })), ['TESTE-01']);
  assert.deepEqual(codes(insights.listHistory(current, { period: '90d' })), ['TESTE-01', 'SUMMER-24']);
  assert.deepEqual(codes(insights.listHistory(current, { period: '7d', query: 'summer' })), []);
  assert.deepEqual(codes(insights.listPeriodEvents(current, '7d')), ['TESTE-01', 'NOTURNA', 'ARENA-XP', 'KIDS-01'],
    'futuros (início depois do relógio) ficam fora das janelas');
  assert.equal(insights.listPeriodEvents(current, 'all').length, 7);
  assert.equal(insights.findPeriod('inexistente').id, 'all');
});

test('critério 4: Visão Geral é a soma exata dos BIs individuais dos mesmos eventos', () => {
  const current = session();
  for (const period of ['all', '7d', '90d']) {
    const overview = insights.getOverview(current, { period });
    const bis = overview.events.map((event) => insights.getEventBi(current, event.id));
    const sum = (pick) => bis.reduce((total, bi) => total + pick(bi), 0);
    assert.equal(overview.participations.registered, sum((bi) => bi.participations.registered), period);
    assert.equal(overview.participations.finished, sum((bi) => bi.participations.finished), period);
    assert.equal(overview.participations.adminFinalized, sum((bi) => bi.participations.adminFinalized), period);
    assert.equal(overview.completions.completed, sum((bi) => bi.completions.completed), period);
    assert.equal(overview.completions.stations, sum((bi) => bi.completions.stations), period);
    assert.equal(overview.evaluations.total, sum((bi) => bi.evaluations.total), period);
  }
});

test('critério 4: números consolidados de todos os eventos (fonte: sessão atual)', () => {
  const overview = insights.getOverview(session());
  assert.deepEqual(plain(overview.phases), { total: 7, scheduled: 3, open: 1, closing: 1, closed: 2, notReady: 2 });
  assert.deepEqual(plain(overview.participations), {
    registered: 421, active: 22, externalWaiting: 6, finished: 393, adminFinalized: 14, finishedOutsideAdmin: 379,
  });
  assert.deepEqual(plain(overview.completions), { completed: 381, absences: 26, stations: 19, stationsWithCompletions: 13 });
  assert.deepEqual(plain(overview.topExperiences.map((item) => [item.name, item.eventName, item.completed])), [
    ['Just Dance', 'Summer Arena', 142],
    ['Simulador', 'Summer Arena', 96],
    ['Teste de Fila', 'Teste Interno', 38],
    ['Just Dance', 'Arena Experience — Shopping', 38],
    ['Futebol de Mesa', 'Copa Noturna', 22],
  ]);
  assert.equal(overview.evaluations.total, 18);
  assert.equal(insights.formatAverage(overview.evaluations.average), '4,1');
  assert.deepEqual(plain(overview.time.lastCompletion), { sampleSize: 202, insufficient: false, averageMinutes: 45 });
  assert.deepEqual(plain(overview.time.voluntaryExit), { sampleSize: 9, insufficient: false, averageMinutes: 27 });
});

test('critério 5: período e seleção alteram os indicadores de forma determinística', () => {
  const current = session();
  const week = insights.getOverview(current, { period: '7d' });
  assert.deepEqual(plain(week), plain(insights.getOverview(current, { period: '7d' })), 'mesma entrada, mesmo resultado');
  assert.equal(week.phases.total, 4);
  assert.equal(week.completions.completed, 65 + 36 + 38);
  assert.equal(week.evaluations.total, 8);

  const summer = insights.getOverview(current, { period: 'all', eventIds: [idOf(current, 'SUMMER-24')] });
  assert.equal(summer.events.length, 1);
  assert.equal(summer.completions.completed, 242);
  assert.equal(summer.evaluations.total, 10);

  const two = insights.getOverview(current, { eventIds: [idOf(current, 'SUMMER-24'), XP] });
  assert.equal(two.completions.completed, 242 + 65);
  // Selecionado fora do período é ignorado: o recorte fica vazio, não inventado.
  const outside = insights.getOverview(current, { period: '7d', eventIds: [idOf(current, 'SUMMER-24')] });
  assert.equal(outside.empty, true);
  assert.equal(outside.completions.completed, 0);
  // Ordem e duplicidade da seleção não mudam o resultado.
  const reversed = insights.getOverview(current, { eventIds: [XP, idOf(current, 'SUMMER-24'), XP] });
  assert.deepEqual(plain(reversed.completions), plain(two.completions));
});

test('critério 6: evento novo entra na contagem sem participações, avaliações ou métricas inventadas', () => {
  const before = session();
  const { state: current, result } = state.createEvent(before, draft());
  assert.equal(result.ok, true);
  const created = current.events.find((event) => event.accessCode === 'NOVA-01');
  const bi = insights.getEventBi(current, created.id);
  assert.equal(bi.stage, 'future');
  assert.equal(bi.insufficient, true);
  assert.equal(bi.participations.registered, 0);
  assert.equal(bi.completions.completed, 0);
  assert.equal(bi.evaluations.total, 0);
  assert.equal(bi.time.lastCompletion.insufficient, true);
  assert.equal(bi.time.lastCompletion.averageMinutes, null);

  const a = insights.getOverview(before);
  const b = insights.getOverview(current);
  assert.equal(b.phases.total, a.phases.total + 1);
  assert.deepEqual(plain(b.participations), plain(a.participations));
  assert.deepEqual(plain(b.evaluations), plain(a.evaluations));
  assert.equal(b.completions.completed, a.completions.completed);
});

test('critério 7: atendimentos não são deduzidos da fila nem do número de estações', () => {
  let current = session();
  const before = insights.getEventBi(current, XP);
  const added3 = state.addStation(current, XP, 'demo-admin-exp-xp-dance', { label: 'Estação 3' });
  assert.equal(added3.result.ok, true, added3.result.message);
  current = added3.state;
  current = {
    ...current,
    experiences: current.experiences.map((item) => (item.eventId === XP ? { ...item, queue: { waiting: 99 } } : item)),
  };
  const after = insights.getEventBi(current, XP);
  assert.equal(after.completions.completed, before.completions.completed);
  assert.equal(after.completions.stations, before.completions.stations + 1);
  assert.equal(after.completions.stationsWithCompletions, before.completions.stationsWithCompletions);
  const dance = after.usage.find((item) => item.experience.id === 'demo-admin-exp-xp-dance');
  const added = dance.stations.find((item) => item.station.label === 'Estação 3');
  assert.equal(added.completed, 0);
  assert.equal(added.share, 0);
  assert.equal(dance.completed, 38);
});

test('critério 7: estação indisponível mantém atendimentos anteriores; experiência sem estação fica zerada', () => {
  let current = session();
  const bi = insights.getEventBi(current, XP);
  const corrida = bi.usage.find((item) => item.experience.id === 'demo-admin-exp-xp-corrida');
  assert.equal(corrida.completed, 18);
  assert.deepEqual(plain(corrida.stations.map((item) => item.share)), [83, 17]);
  const D2 = idOf(current, 'BEAST-D2');
  current = state.createExperience(current, D2, { name: 'Fliperama' }).state;
  const created = insights.getEventBi(current, D2).usage.find((item) => item.experience.name === 'Fliperama');
  assert.equal(created.completed, 0);
  assert.deepEqual(plain(created.stations), []);
});

test('critério 8: encerramento administrativo não cria conclusões Staff nem avaliações', () => {
  const before = insights.getEventBi(session(), XP);
  const immediate = state.closeEvent(session(), XP, { mode: 'immediate', reason: 'Queda de energia' }).state;
  const after = insights.getEventBi(immediate, XP);
  assert.equal(after.participations.finished, 41 + 18 + 6);
  assert.equal(after.participations.adminFinalized, 24);
  assert.equal(after.participations.finishedOutsideAdmin, 41);
  assert.equal(after.completions.completed, before.completions.completed);
  assert.deepEqual(plain(after.evaluations), plain(before.evaluations));
  assert.deepEqual(plain(after.time), plain(before.time), 'tempo não usa a finalização administrativa');

  let controlled = state.closeEvent(session(), XP, { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte' }).state;
  assert.equal(insights.getEventBi(controlled, XP).participations.adminFinalized, 6, 'espera externa finalizada');
  controlled = state.advanceClock(controlled, 30).state;
  const end = insights.getEventBi(controlled, XP);
  assert.equal(end.participations.adminFinalized, 6 + 18);
  assert.equal(end.completions.completed, before.completions.completed);
  assert.equal(end.evaluations.total, before.evaluations.total);
  // Idempotente: avançar mais não soma de novo.
  assert.equal(insights.getEventBi(state.advanceClock(controlled, 60).state, XP).participations.adminFinalized, 24);
});

test('critério 9: métricas temporais sem fonte suficiente aparecem como indisponíveis (nunca zero)', () => {
  const current = session();
  const teste = insights.getEventBi(current, idOf(current, 'TESTE-01'));
  assert.deepEqual(plain(teste.time.lastCompletion), { sampleSize: 0, insufficient: true, averageMinutes: null });
  const summer = insights.getEventBi(current, idOf(current, 'SUMMER-24'));
  assert.equal(summer.time.lastCompletion.averageMinutes, 46);
  assert.equal(summer.time.voluntaryExit.insufficient, true, 'só 3 saídas voluntárias');
  assert.equal(summer.time.voluntaryExit.averageMinutes, null);
  const xp = insights.getEventBi(current, XP);
  assert.equal(xp.time.voluntaryExit.averageMinutes, 25);
  for (const bad of [[{ sampleSize: 10, averageMinutes: 0 }], [{ sampleSize: 10, averageMinutes: -5 }], [{ sampleSize: 10 }], null]) {
    assert.equal(insights.summarizeDuration(bad).insufficient, true);
  }
});

test('critério 10: avaliação editada conta uma vez, com a nota mais recente', () => {
  const current = session();
  const summer = insights.getEventBi(current, idOf(current, 'SUMMER-24')).evaluations;
  assert.equal(summer.total, 10);
  assert.equal(insights.formatAverage(summer.average), '4,1');
  assert.deepEqual(plain(summer.distribution.map((item) => item.count)), [0, 1, 1, 4, 4]);
  assert.equal(insights.currentScore(current.evaluations.find((item) => item.id === 'demo-admin-eval-summer-04')), 2);
  assert.equal(insights.currentScore(current.evaluations.find((item) => item.id === 'demo-admin-eval-summer-07')), 4,
    'revisões fora de ordem: vale o instante mais recente');
  const xp = insights.getEventBi(current, XP).evaluations;
  assert.equal(insights.formatAverage(xp.average), '4,2');
  // Mesmo id repetido não duplica.
  const twice = insights.summarizeEvaluations([...current.evaluations, ...current.evaluations]);
  assert.equal(twice.total, current.evaluations.length);
  // Nota inválida é ignorada.
  assert.equal(insights.currentScore({ id: 'x', revisions: [{ score: 9, at: '2026-01-01T00:00:00.000Z' }] }), null);
});

test('D10: grupo abaixo do mínimo mostra "dados insuficientes" sem média nem distribuição', () => {
  const current = session();
  const teste = insights.getEventBi(current, idOf(current, 'TESTE-01')).evaluations;
  assert.deepEqual(plain(teste), { total: 3, insufficient: true, average: null, distribution: null });
});

test('critério 11: nenhum dado pessoal ou nominal no histórico, Visão Geral ou BI', () => {
  const current = session();
  const serialized = JSON.stringify([
    insights.getOverview(current),
    insights.listHistory(current).map((item) => item.participations),
    current.events.map((event) => {
      const bi = insights.getEventBi(current, event.id);
      return { ...bi, event: undefined, info: undefined };
    }),
  ]);
  assert.ok(!/@|accountId|email|comment/i.test(serialized));
});

test('leituras são puras e propriedades herdadas não viram dado', () => {
  const current = session();
  const before = plain(current);
  insights.getOverview(current, { period: '7d' });
  insights.listHistory(current, { query: 'x' });
  current.events.forEach((event) => insights.getEventBi(current, event.id));
  assert.deepEqual(plain(current), before);

  const inherited = Object.create({ stationId: 'demo-admin-station-d1-ringue-1', completed: 50 });
  const tampered = { ...current, stationCompletions: [...current.stationCompletions, inherited] };
  assert.equal(insights.getEventBi(tampered, idOf(current, 'BEAST-D1')).completions.completed, 0);
  assert.equal(insights.getEventBi(current, 'nao-existe'), null);
});

test('BI distingue futuro, aguardando prontidão, em andamento, encerrando e encerrado', () => {
  const current = session();
  const stage = (code) => insights.getEventBi(current, idOf(current, code)).stage;
  assert.equal(stage('BEAST-D2'), 'future');
  assert.equal(stage('KIDS-01'), 'waiting');
  assert.equal(stage('ARENA-XP'), 'open');
  assert.equal(stage('NOTURNA'), 'closing');
  assert.equal(stage('SUMMER-24'), 'closed');
  assert.equal(insights.getEventBi(current, idOf(current, 'KIDS-01')).insufficient, true);
});
