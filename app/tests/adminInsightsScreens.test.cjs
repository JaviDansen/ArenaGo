// ADM03 — telas de Histórico, Visão Geral e BI individual com o provedor real
// da demonstração e navegação simulada.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminApp } = require('./helpers/adminHarness.cjs');

const HISTORY = 'Histórico, 2 eventos encerrados na demonstração';
const OVERVIEW = 'Visão Geral, indicadores consolidados da demonstração';
const noPersonalData = (app) => !app.texts().some((text) => /@|arenago\.example/.test(text));

async function openHistory(app) {
  app.press(HISTORY);
  assert.equal(app.route, 'AdminHistory');
  await app.flush();
}

async function openOverview(app) {
  app.press(OVERVIEW);
  assert.equal(app.route, 'AdminOverview');
  await app.flush();
}

test('painel: Histórico e Visão Geral navegam (sem aviso de pendência da ADM03)', async () => {
  const app = createAdminApp();
  assert.ok(!app.hasText('pendente (ADM03)'));
  assert.ok(!app.hasText('em construção'));
  await openHistory(app);
  app.press('← Painel');
  await openOverview(app);
});

test('histórico: carregamento simulado, aviso de dados fictícios e só eventos encerrados', async () => {
  let release;
  const app = createAdminApp({ latency: () => new Promise((resolve) => { release = resolve; }) });
  app.press(HISTORY);
  assert.ok(app.hasText('Carregando histórico...'));
  release();
  await app.flush();
  assert.ok(!app.hasText('Carregando histórico...'));
  assert.ok(app.hasText('Não são resultados reais'));
  for (const text of ['Summer Arena', 'Teste Interno', 'Encerrado no horário',
    'Encerrado antecipadamente (imediato)', '275 participação(ões) finalizada(s) (simulado)',
    '14 delas finalizada(s) pelo encerramento administrativo.']) {
    assert.ok(app.hasText(text), text);
  }
  for (const other of ['Arena Experience — Shopping', 'Copa Noturna', 'BEAST MARAGAMES — Dia 1']) {
    assert.ok(!app.hasText(other), `${other} não está encerrado`);
  }
});

test('histórico: erro simulado de carregamento e nova tentativa', async () => {
  const app = createAdminApp();
  app.press('Simular erro na próxima ação');
  await openHistory(app);
  assert.ok(app.hasText('Não foi possível carregar'));
  assert.ok(!app.hasText('Summer Arena'));
  app.press('Tentar novamente');
  await app.flush();
  assert.ok(app.hasText('Summer Arena'));
});

test('critério 3 (tela): busca, período e estados vazios', async () => {
  const app = createAdminApp();
  await openHistory(app);
  app.press('Período: Últimos 7 dias');
  assert.ok(app.hasText('Teste Interno'));
  assert.ok(!app.hasText('Summer Arena'));
  app.press('Período: Últimos 90 dias');
  assert.ok(app.hasText('Summer Arena'));
  app.type('Buscar no histórico', 'summer');
  assert.ok(!app.hasText('Teste Interno'));
  app.type('Buscar no histórico', 'zzz');
  assert.ok(app.hasText('Nenhum evento encontrado'));
  assert.ok(app.hasText('Ajuste a busca ou o período.'));
});

test('critério 2 (tela): encerramento imediato pela tela da ADM01 aparece no histórico e no BI', async () => {
  const app = createAdminApp();
  app.press('Gerenciar Eventos, 7 eventos na demonstração');
  await app.flush();
  app.press('Abrir Arena Experience — Shopping, código ARENA-XP, Aberto');
  app.press('Encerrar antecipadamente');
  app.press('Modo imediato');
  app.type('Justificativa *', 'Queda de energia no local');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  assert.ok(app.hasText('Encerramento registrado'));
  app.press('Voltar ao evento');
  app.press('Voltar ao painel');
  app.press('Histórico, 3 eventos encerrados na demonstração');
  await app.flush();
  assert.ok(app.hasText('Arena Experience — Shopping'));
  assert.ok(app.hasText('24 delas finalizada(s) pelo encerramento administrativo.'));
  app.press('Abrir BI de Arena Experience — Shopping, código ARENA-XP');
  assert.ok(app.hasText('Justificativa: Queda de energia no local'));
  assert.ok(app.hasLabel('Atendimentos concluídos (Staff): 65'), 'encerramento não cria atendimentos');
  assert.ok(app.hasText('Avaliações: média 4,2 / 5 · 5 enviada(s)'), 'nem avaliações');
});

test('critério 13: Painel → Histórico → BI → configuração → retorno', async () => {
  const app = createAdminApp();
  await openHistory(app);
  app.press('Abrir BI de Summer Arena, código SUMMER-24');
  assert.equal(app.route, 'AdminEventBi');
  for (const text of ['Evento encerrado: números finais da demonstração.', 'Encerrado no horário',
    'Experiências e estações', 'Just Dance', '142 atendimento(s) concluído(s) · 9 ausência(s)',
    'Estação 1: 80 (56% da experiência)', 'Avaliações: média 4,1 / 5 · 10 enviada(s)',
    '46 min em média · 180 participação(ões) com experiência concluída',
    'Dados insuficientes (3 registro(s); mínimo de 5)', 'Segmentação do público sem política aprovada']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasLabel('Nota 5: 4 (40%)'));
  assert.ok(noPersonalData(app));
  app.press('Ver configuração do evento');
  assert.equal(app.route, 'AdminEventDetail');
  app.press('← Eventos');
  assert.equal(app.route, 'AdminEventBi');
  app.press('← Voltar');
  assert.equal(app.route, 'AdminHistory');
  app.press('← Painel');
  assert.deepEqual(app.routes, ['AdminPanel']);
});

test('BI: encerramento imediato separa as finalizadas pelo Admin e esconde média de grupo pequeno', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-teste' } });
  for (const text of ['Encerrado antecipadamente (imediato)', 'Justificativa: não registrada nesta demonstração.',
    'Avaliações: Dados insuficientes (3 enviada(s); mínimo de 5 para exibir a média).']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasLabel('Finalizadas pelo encerramento administrativo: 14'));
  assert.ok(app.hasLabel('Participações finalizadas fora do encerramento administrativo: 36'));
  assert.ok(!app.hasText('Avaliações: média'));
});

test('BI: evento futuro e evento aguardando prontidão mostram dados insuficientes', () => {
  const future = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-beast-d2' } });
  assert.ok(future.hasText('Evento futuro: ainda não começou'));
  assert.ok(future.hasText('Nenhum número é inventado'));
  assert.ok(future.hasText('Avaliações: nenhuma avaliação enviada.'));
  assert.ok(future.hasText('Sem atendimentos registrados.'));
  const waiting = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-kids' } });
  assert.ok(waiting.hasText('prontidão pendente'));
  assert.ok(waiting.hasText('Dados insuficientes'));
});

test('BI: em andamento e em encerramento avisam que os números são parciais', () => {
  const open = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-arena-xp' } });
  assert.ok(open.hasText('os números são parciais'));
  assert.ok(open.hasText('Cockpit B: 3 (17% da experiência)'), 'estação indisponível mantém histórico');
  assert.ok(open.hasText('25 min em média · 6 saída(s) voluntária(s)'));
  const closing = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-noturna' } });
  assert.ok(closing.hasText('Evento em encerramento'));
  assert.ok(closing.hasText('Entrada até a última experiência concluída'));
  assert.ok(closing.hasText('Dados insuficientes (0 registro(s); mínimo de 5)'));
});

test('BI: evento encerrado pelo relógio avisa que a finalização automática não é simulada', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: { eventId: 'demo-admin-noturna' } });
  app.press('Avançar relógio 15 minutos');
  assert.ok(app.hasText('Evento encerrado: números finais'));
  assert.ok(app.hasText('A finalização automática no limite operacional (D07) não é simulada'));
});

test('BI: evento inexistente ou parâmetro herdado mostra estado seguro', () => {
  for (const params of [{ eventId: 'nao-existe' }, Object.create({ eventId: 'demo-admin-summer' }), undefined]) {
    const app = createAdminApp({ initialRoute: 'AdminEventBi', initialParams: params });
    assert.ok(app.hasText('Evento não encontrado'));
    assert.ok(!app.hasText('Participações'));
  }
});

test('detalhe do evento leva ao BI individual', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Ver BI do evento');
  assert.equal(app.route, 'AdminEventBi');
  assert.equal(app.params.eventId, 'demo-admin-arena-xp');
  app.press('← Voltar');
  assert.equal(app.route, 'AdminEventDetail');
});

test('visão geral: carregamento, erro simulado e nova tentativa', async () => {
  let release;
  const app = createAdminApp({ latency: () => new Promise((resolve) => { release = resolve; }) });
  app.press(OVERVIEW);
  assert.ok(app.hasText('Carregando indicadores...'));
  assert.ok(!app.hasLabel('Eventos: 7'));
  release();
  await app.flush();
  assert.ok(app.hasLabel('Eventos: 7'));

  const failing = createAdminApp();
  failing.press('Simular erro na próxima ação');
  await openOverview(failing);
  assert.ok(failing.hasText('Não foi possível carregar'));
  assert.ok(!failing.hasLabel('Eventos: 7'));
  failing.press('Tentar novamente');
  await failing.flush();
  assert.ok(failing.hasLabel('Eventos: 7'));
});

test('visão geral: indicadores consolidados, exportação desabilitada e privacidade', async () => {
  const app = createAdminApp();
  await openOverview(app);
  for (const label of ['Eventos: 7', 'Encerrados: 2', 'Não prontos: 2', 'Registradas: 421', 'Ativas: 22',
    'Na fila externa: 6', 'Finalizadas: 393', 'Atendimentos concluídos: 381', 'Ausências marcadas: 26',
    'Estações com atendimento: 13/19', 'Avaliações: média 4,1 de 5, 18 avaliações enviadas']) {
    assert.ok(app.hasLabel(label), label);
  }
  for (const text of ['Todo o período · 7 evento(s) no período', '1. Just Dance (Summer Arena): 142 atendimento(s)',
    '14 das finalizadas foram finalizadas pelo encerramento administrativo', '45 min em média · 202',
    '27 min em média · 9 saída(s) voluntária(s)', 'Nenhum arquivo é gerado nesta demonstração']) {
    assert.ok(app.hasText(text), text);
  }
  assert.equal(app.isDisabled('Exportar CSV/XLSX (indisponível)'), true);
  assert.ok(noPersonalData(app));
});

test('critério 14: Painel → Visão Geral → filtros → BI → retorno', async () => {
  const app = createAdminApp();
  await openOverview(app);
  app.press('Período: Últimos 7 dias');
  assert.ok(app.hasText('Últimos 7 dias · 4 evento(s) no período'));
  assert.ok(app.hasLabel('Atendimentos concluídos: 139'));
  assert.ok(!app.hasButton('Selecionar Summer Arena'), 'fora do período não aparece no seletor');
  app.press('Selecionar Arena Experience — Shopping');
  assert.ok(app.hasText('Últimos 7 dias · 1 evento(s) selecionado(s)'));
  assert.ok(app.hasLabel('Atendimentos concluídos: 65'));
  app.press('Selecionar Teste Interno');
  assert.ok(app.hasLabel('Atendimentos concluídos: 103'));
  assert.ok(!app.hasButton('Abrir BI do evento selecionado'), 'BI só com um evento');
  app.press('Selecionar Teste Interno');
  app.press('Abrir BI do evento selecionado');
  assert.equal(app.route, 'AdminEventBi');
  assert.equal(app.params.eventId, 'demo-admin-arena-xp');
  app.press('← Voltar');
  assert.equal(app.route, 'AdminOverview');
  app.press('Limpar seleção (todos)');
  assert.ok(app.hasText('· 4 evento(s) no período'));
  app.press('← Painel');
  assert.deepEqual(app.routes, ['AdminPanel']);
});

test('visão geral: seleção fora do novo período é ignorada; evento novo não ganha números', async () => {
  const app = createAdminApp();
  await openOverview(app);
  app.press('Selecionar Summer Arena');
  assert.ok(app.hasLabel('Atendimentos concluídos: 242'));
  app.press('Período: Últimos 7 dias');
  assert.ok(app.hasText('· 4 evento(s) no período'), 'seleção fora do período não vira recorte vazio');
  app.press('Período: Todo o período');
  assert.ok(app.hasText('· 1 evento(s) selecionado(s)'));
});

test('critério 6 (tela): evento criado entra na contagem sem participações, avaliações nem métricas', async () => {
  const app = createAdminApp();
  app.press('Gerenciar Eventos, 7 eventos na demonstração');
  await app.flush();
  app.press('+ Criar novo evento');
  const values = {
    'Nome do evento *': 'Arena Nova', 'Código de ingresso *': 'NOVA-01',
    'Data de início *': '10112026', 'Hora de início *': '1000',
    'Data do encerramento oficial *': '10112026', 'Hora do encerramento oficial *': '1800',
    'Data do limite operacional *': '10112026', 'Hora do limite operacional *': '1830',
    'Justificativa do cadastro *': 'Cadastro e preparação do evento',
  };
  for (const [label, value] of Object.entries(values)) app.type(label, value);
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
  app.press('CRIAR EVENTO');
  await app.pressAsync('CRIAR EVENTO');
  assert.equal(app.route, 'AdminEventDetail');
  app.press('Ver BI do evento');
  for (const text of ['Evento futuro', 'Dados insuficientes', 'Avaliações: nenhuma avaliação enviada.',
    'Nenhuma experiência cadastrada neste evento.']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasLabel('Registradas (estado atual): 0'));
  app.press('← Voltar');
  app.press('Voltar ao painel');
  app.press(OVERVIEW);
  await app.flush();
  assert.ok(app.hasLabel('Eventos: 8'));
  assert.ok(app.hasLabel('Registradas: 421'), 'nenhuma participação criada');
  assert.ok(app.hasLabel('Avaliações: média 4,1 de 5, 18 avaliações enviadas'));
});

test('critério 12: troca de conta descarta filtros e eventos criados na Visão Geral', async () => {
  const app = createAdminApp();
  app.press('Avançar relógio 15 minutos');
  app.setAuth({ isAuthenticated: true, user: { id: 'u-2', name: 'Outra Conta' }, getSessionEpoch: () => 1 });
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z');
  assert.ok(app.hasButton(HISTORY));
  app.setAuth({ isAuthenticated: true, user: { id: 'u-2', name: 'Outra Conta' }, getSessionEpoch: () => 2 });
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z');
});

test('isolamento de módulos: telas da ADM03 não importam participação, HTTP nem Staff', () => {
  const app = createAdminApp();
  assert.ok(!app.requested.some((name) => /ParticipationContext|httpClient|services\/|staff\//.test(name)));
});
