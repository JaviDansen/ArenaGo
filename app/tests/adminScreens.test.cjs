// Telas da Área Admin (ADM01) com o provedor real e navegação simulada.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminApp } = require('./helpers/adminHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const byCode = (app, code) => app.session.events.find((event) => event.accessCode === code);

async function openEvents(app) {
  app.press('Gerenciar Eventos, 7 eventos na demonstração');
  assert.equal(app.route, 'AdminEvents');
  await app.flush();
}

function fillCreateForm(app, overrides = {}) {
  const values = {
    'Nome do evento *': 'Arena Teste',
    'Código de ingresso *': ' novo-01 ',
    'Data de início *': '10112026',
    'Hora de início *': '1000',
    'Data do encerramento oficial *': '10112026',
    'Hora do encerramento oficial *': '1800',
    'Data do limite operacional *': '10112026',
    'Hora do limite operacional *': '1830',
    'Justificativa do cadastro *': 'Cadastro e preparação do evento',
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) app.type(label, value);
}

test('painel: autenticação real, operações demonstrativas e contadores coerentes', () => {
  const app = createAdminApp({ auth: verifiedAdminAuth({ user: { id: 'u-9', name: 'Heliom Teste' } }) });
  for (const text of ['ÁREA ADMIN (DEMONSTRAÇÃO)', 'MODO DEMONSTRAÇÃO', 'Heliom Teste',
    'Sessão Admin autenticada com segundo fator', 'Resumo da demonstração', 'Contadores fictícios']) {
    assert.ok(app.hasText(text), text);
  }
  for (const counter of ['Eventos: 7', 'Agendados: 3', 'Abertos: 1', 'Encerrando: 1',
    'Encerrados: 2', 'Não prontos: 2']) {
    assert.ok(app.hasLabel(counter), counter);
  }
});

test('painel: Histórico e Visão Geral abrem as telas da ADM03 (sem aviso de pendência)', async () => {
  const app = createAdminApp();
  assert.ok(!app.hasText('pendente (ADM03)'));
  app.press('Histórico, 2 eventos encerrados na demonstração');
  assert.equal(app.route, 'AdminHistory');
  await app.flush();
  app.press('← Painel');
  app.press('Visão Geral, indicadores consolidados da demonstração');
  assert.equal(app.route, 'AdminOverview');
  assert.ok(app.hasText('Nenhum resultado real é exibido'));
});

test('gerenciar eventos: carregamento simulado, busca, filtros de fase e status defasado', async () => {
  let release;
  const app = createAdminApp({ latency: () => new Promise((resolve) => { release = resolve; }) });
  app.press('Gerenciar Eventos, 7 eventos na demonstração');
  assert.ok(app.hasText('Carregando eventos...'));
  release();
  await app.flush();
  assert.ok(!app.hasText('Carregando eventos...'));
  for (const name of ['Arena Experience — Shopping', 'Copa Noturna', 'Summer Arena', 'Teste Interno']) {
    assert.ok(app.hasText(name), name);
  }
  assert.ok(app.hasText('Status armazenado: Aberto (open) · fase efetiva pelo relógio: Encerrando (closing)'));
  assert.ok(app.hasText('aguardando prontidão'), 'Arena Kids iniciou sem prontidão');

  app.press('Filtrar por Encerrado (closed)');
  assert.ok(app.hasText('Summer Arena') && app.hasText('Teste Interno'));
  assert.ok(!app.hasText('Copa Noturna'));
  assert.ok(!app.hasButton('Arquivados'), 'não existe filtro/estado archived');

  app.press('Todos');
  app.type('Buscar evento', 'beast');
  assert.ok(app.hasText('BEAST MARAGAMES — Dia 1') && app.hasText('BEAST MARAGAMES — Dia 2'));
  assert.ok(!app.hasText('Copa Noturna'));
  app.type('Buscar evento', 'zzz');
  assert.ok(app.hasText('Nenhum evento encontrado'));
});

test('gerenciar eventos: erro simulado de carregamento e nova tentativa', async () => {
  const app = createAdminApp();
  app.press('Simular erro na próxima ação');
  await openEvents(app);
  assert.ok(app.hasText('Não foi possível carregar'));
  assert.ok(app.hasText('Falha simulada ao carregar os eventos'));
  app.press('Tentar novamente');
  await app.flush();
  assert.ok(app.hasText('Copa Noturna'));
});

test('criar evento: formulário vazio mostra os erros e não abre confirmação', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  assert.equal(app.route, 'AdminCreateEvent');
  for (const forbidden of ['Local do evento', 'Tipo de evento', 'Descrição', 'Estação(ões) do evento']) {
    assert.ok(!app.hasText(forbidden), `campo fora do DTO: ${forbidden}`);
  }
  app.press('CRIAR EVENTO');
  assert.equal(app.modalOpen, false);
  for (const text of ['Informe o nome do evento.', 'Informe o código de ingresso.',
    'Escolha o fuso horário do evento.', 'Defina se a fila externa', 'Informe uma justificativa',
    'Revise os campos destacados.']) {
    assert.ok(app.hasText(text), text);
  }
  assert.equal(app.session.events.length, 7);
});

test('criar evento: código duplicado (inclusive de evento encerrado) é recusado', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  fillCreateForm(app, { 'Código de ingresso *': ' summer-24 ' });
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
  app.press('CRIAR EVENTO');
  assert.equal(app.modalOpen, false);
  assert.ok(app.hasText('já está reservado por outro evento'));
});

test('criar evento: margem acima de 60 min e encerramento antes do início são recusados', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  fillCreateForm(app, { 'Hora do limite operacional *': '1901' });
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
  app.press('CRIAR EVENTO');
  assert.ok(app.hasText('no máximo 60 minutos'));
  app.press('Limite operacional 0 minutos após o encerramento oficial');
  assert.equal(app.input('Hora do limite operacional *').props.value, '18:00');
  app.type('Hora do encerramento oficial *', '0900');
  app.press('CRIAR EVENTO');
  assert.ok(app.hasText('O encerramento oficial precisa ser depois do início.'));
});

test('criar evento: prévia informa o fuso; criado nasce Agendado, não pronto e aparece no painel e na lista', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  fillCreateForm(app);
  app.press('America/Manaus, Manaus, UTC−4');
  app.press('Fila externa desabilitada');
  assert.ok(app.hasText('Início: 10/11/2026 10:00 (America/Manaus, UTC−4)'));
  assert.ok(app.hasText('2026-11-10T14:00:00.000Z'), 'UTC sem usar o fuso do aparelho');

  app.press('CRIAR EVENTO');
  assert.equal(app.modalOpen, true);
  app.press('CANCELAR');
  assert.equal(app.session.events.length, 7, 'cancelar não cria');

  app.press('CRIAR EVENTO');
  await app.pressAsync('CRIAR EVENTO');
  assert.equal(app.route, 'AdminEventDetail');
  assert.deepEqual(plain(app.routes), ['AdminPanel', 'AdminEvents', 'AdminEventDetail']);
  const created = byCode(app, 'NOVO-01');
  assert.equal(created.statusStored, 'scheduled');
  assert.equal(created.startsAt, '2026-11-10T14:00:00.000Z');
  assert.equal(created.externalQueueEnabled, false);
  for (const text of ['Evento criado na demonstração', 'Código de ingresso: NOVO-01 · imutável',
    'Prontidão: não pronto ✗', 'Estrutura do evento', 'Experiências: 0 · com estação disponível: 0',
    'Staff vigente: 0', 'Não existe botão “Abrir Evento”']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(!app.hasButton('Abrir Evento'));
  assert.ok(!app.hasButton('Excluir evento'));
  assert.ok(!app.hasText('Configuração indisponível nesta etapa'), 'aviso antigo da ADM01 removido');
  assert.ok(app.hasButton('Experiências e estações') && app.hasButton('Staff do evento'));

  app.press('← Eventos');
  assert.equal(app.route, 'AdminEvents');
  assert.ok(app.hasText('Arena Teste'));
  app.press('← Painel');
  assert.ok(app.hasButton('Gerenciar Eventos, 8 eventos na demonstração'));
});

test('criar evento: erro simulado não cria nada e mantém o formulário', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  fillCreateForm(app);
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
  app.press('Simular erro na próxima ação');
  app.press('CRIAR EVENTO');
  await app.pressAsync('CRIAR EVENTO');
  assert.equal(app.route, 'AdminCreateEvent');
  assert.ok(app.hasText('Erro simulado: nenhuma alteração foi feita'));
  assert.equal(app.session.events.length, 7);
  assert.equal(app.input('Nome do evento *').props.value, 'Arena Teste');
});

test('criar evento: mostra carregamento e bloqueia os campos enquanto salva', async () => {
  let release;
  const app = createAdminApp({ initialRoute: 'AdminCreateEvent', latency: () => new Promise((resolve) => { release = resolve; }) });
  fillCreateForm(app);
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
  app.press('CRIAR EVENTO');
  const pending = app.press('CRIAR EVENTO');
  assert.ok(app.hasButton('CRIANDO...'));
  assert.equal(app.isDisabled('CRIANDO...'), true);
  assert.equal(app.input('Nome do evento *').props.editable, false);
  release();
  await pending;
  await app.flush();
  assert.equal(app.route, 'AdminEventDetail');
});

test('detalhe: evento aberto mostra configuração, cortes, prontidão e ações permitidas', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  for (const text of ['Código de ingresso: ARENA-XP · imutável', 'Fuso: America/Fortaleza',
    'Início: 05/11/2026 08:00 (America/Fortaleza, UTC−3)', 'margem de 60 min',
    'Novas entradas até: 05/11/2026 17:00', 'Aceitando novas participações (simulado).',
    'Prontidão: pronto ✓', 'Não há exclusão de eventos']) {
    assert.ok(app.hasText(text), text);
  }
  for (const action of ['Alterar horários', 'Desabilitar fila externa', 'Encerrar antecipadamente']) {
    assert.equal(app.isDisabled(action), false, action);
  }
});

test('detalhe: depois do horário oficial, prazos e fila não reabrem e o encerramento segue possível', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-noturna' } });
  assert.ok(app.hasText('Status armazenado: Aberto (open) · fase efetiva: Encerrando (closing)'));
  assert.ok(app.hasText('O status armazenado está defasado'));
  assert.equal(app.isDisabled('Alterar horários'), true);
  assert.ok(app.hasText('O horário oficial já foi alcançado'));
  assert.equal(app.isDisabled('Desabilitar fila externa'), true);
  assert.ok(app.hasText('alternar a fila externa não reabre ingressos'));
  assert.equal(app.isDisabled('Encerrar antecipadamente'), false);
});

test('detalhe: evento inexistente ou parâmetro herdado mostra estado seguro', () => {
  const missing = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'nao-existe' } });
  assert.ok(missing.hasText('Evento não encontrado'));
  const inherited = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: Object.create({ eventId: 'demo-admin-arena-xp' }) });
  assert.ok(inherited.hasText('Evento não encontrado'));
});

test('relógio de teste: avançar abre automaticamente um evento pronto, sem botão "Abrir"', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-beast-d1' } });
  assert.ok(app.hasText('fase efetiva: Agendado (scheduled)'));
  assert.ok(app.hasText('Não aceita novas participações agora.'));
  app.press('Avançar relógio 1 hora');
  assert.ok(app.hasText('Status armazenado: Agendado (scheduled) · fase efetiva: Aberto (open)'));
  assert.ok(app.hasText('Aceitando novas participações (simulado).'));
  app.press('Reiniciar relógio');
  assert.ok(app.hasText('fase efetiva: Agendado (scheduled)'));
});

test('alterar horários: ação própria com confirmação, justificativa e feedback', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Alterar horários');
  assert.equal(app.route, 'AdminEventSchedule');
  assert.equal(app.input('Nova data do encerramento oficial *').props.value, '05/11/2026');
  assert.equal(app.input('Nova hora do encerramento oficial *').props.value, '17:00');
  assert.ok(app.hasText('Início (não muda nesta ação)'));
  assert.ok(!app.input('Código de ingresso *'), 'código não é editável');

  app.type('Nova hora do encerramento oficial *', '1800');
  assert.equal(app.input('Nova hora do limite operacional *').props.value, '18:00');
  app.press('Limite operacional 0 minutos após o encerramento oficial');
  app.press('SALVAR HORÁRIOS');
  assert.equal(app.modalOpen, true);
  await app.pressAsync('ALTERAR HORÁRIOS');
  assert.ok(app.hasText('Informe uma justificativa'));
  assert.equal(byCode(app, 'ARENA-XP').officialEndsAt, '2026-11-05T20:00:00.000Z', 'nada mudou');

  app.type('Justificativa *', 'Ajuste solicitado pela organização');
  app.press('SALVAR HORÁRIOS');
  await app.pressAsync('ALTERAR HORÁRIOS');
  assert.ok(app.hasText('Horários atualizados'));
  assert.equal(byCode(app, 'ARENA-XP').officialEndsAt, '2026-11-05T21:00:00.000Z');
  assert.equal(byCode(app, 'ARENA-XP').operationalDeadlineAt, '2026-11-05T21:00:00.000Z');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Encerramento oficial: 05/11/2026 18:00'));
  assert.ok(app.hasText('Alteração de horários em'));
});

test('alterar horários: novo encerramento no passado é recusado (sem reabertura)', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventSchedule', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.type('Nova hora do encerramento oficial *', '0830');
  app.type('Justificativa *', 'Tentativa inválida');
  app.press('SALVAR HORÁRIOS');
  await app.pressAsync('ALTERAR HORÁRIOS');
  assert.ok(app.hasText('precisa ser depois do horário atual'));
  assert.ok(app.hasText('Não foi possível alterar'));
});

test('fila externa: confirmação explica o efeito sobre quem espera e o painel reflete', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Desabilitar fila externa');
  assert.equal(app.route, 'AdminEventQueue');
  assert.ok(app.hasText('libera agora os 6 participante(s)'));
  assert.ok(app.hasText('diferente de encerrar inscrições'));
  app.type('Justificativa *', 'Fluxo de público reduzido');
  app.press('DESABILITAR FILA EXTERNA');
  assert.equal(app.modalOpen, true);
  app.press('CANCELAR');
  assert.equal(byCode(app, 'ARENA-XP').externalQueueEnabled, true, 'cancelar não muda');
  app.press('DESABILITAR FILA EXTERNA');
  await app.pressAsync('DESABILITAR FILA EXTERNA');
  assert.ok(app.hasText('Fila externa atualizada'));
  assert.ok(app.hasText('6 participante(s) em espera foram liberados'));
  assert.deepEqual(plain(byCode(app, 'ARENA-XP').participants), { externalWaiting: 0, active: 24, finished: 41 });
  assert.ok(!app.hasButton('DESABILITAR FILA EXTERNA'), 'não alterna de novo sem querer');
  app.press('Voltar ao evento');
  assert.ok(app.hasButton('Habilitar fila externa'));
});

test('encerrar: exige modo e justificativa; controlado respeita a janela; imediato encerra sem reabrir', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-noturna' } });
  app.press('Encerrar antecipadamente');
  app.press('REVISAR ENCERRAMENTO');
  assert.ok(app.hasText('Escolha o modo de encerramento.'));
  assert.equal(app.modalOpen, false);

  app.press('Modo controlado');
  assert.ok(app.hasText('De 1 a 15 min'), 'limite operacional às 12:15 UTC');
  app.type('Prazo controlado (minutos a partir de agora) *', '30');
  app.type('Justificativa *', 'Fim antecipado');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  assert.ok(app.hasText('Informe de 1 a 15 minuto(s)'));
  assert.equal(byCode(app, 'NOTURNA').closureMode, null);

  app.press('Modo imediato');
  assert.ok(app.hasText('finaliza todas as participações abertas'));
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  assert.ok(app.hasText('Encerramento registrado'));
  const closed = byCode(app, 'NOTURNA');
  assert.equal(closed.statusStored, 'closed');
  assert.equal(closed.closureMode, 'immediate');
  app.press('Voltar ao evento');
  assert.equal(app.isDisabled('Encerrar antecipadamente'), true);
  assert.ok(app.hasText('Este evento já está encerrado.'));
});

test('encerrar controlado: espera externa finalizada e fila externa bloqueada depois', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Encerrar antecipadamente');
  app.press('Modo controlado');
  assert.ok(app.hasText('finalizado agora, sem avaliação'));
  app.type('Prazo controlado (minutos a partir de agora) *', '45');
  app.type('Justificativa *', 'Chuva forte no local');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  assert.ok(app.hasText('Encerramento controlado iniciado'));
  assert.equal(byCode(app, 'ARENA-XP').adminDeadlineAt, '2026-11-05T12:45:00.000Z');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Encerramento administrativo controlado'));
  assert.equal(app.isDisabled('Alterar horários'), true);
  assert.equal(app.isDisabled('Desabilitar fila externa'), true);
});

test('isolamento: troca direta de conta ou nova geração da sessão descarta a demonstração', async () => {
  const app = createAdminApp();
  app.press('Avançar relógio 1 hora');
  assert.equal(app.session.clockNow, '2026-11-05T13:00:00.000Z');
  app.setAuth(verifiedAdminAuth({ user: { id: 'u-2', name: 'Outra Conta' } }));
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z', 'conta B começa do zero');
  app.press('Avançar relógio 1 hora');
  app.setAuth(verifiedAdminAuth({ user: { id: 'u-2', name: 'Outra Conta' }, getSessionEpoch: () => 2 }));
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z', 'nova sessão da mesma conta também');
  app.setAuth({ isAuthenticated: false, user: null });
  assert.equal(app.session, null, 'logout limpa');
  assert.ok(app.hasText('Sessão indisponível'));
});

test('isolamento: callback antigo disparado após trocar de conta não altera a nova demonstração', () => {
  const app = createAdminApp();
  const advance = app.handlerOf('Avançar relógio 1 hora');
  app.setAuthWithoutRender(verifiedAdminAuth({ user: { id: 'u-3' } }));
  advance();
  app.setAuth(verifiedAdminAuth({ user: { id: 'u-3' } }));
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z', 'a conta nova começa limpa');
  assert.equal(app.session.events.length, 7);
  app.press('Avançar relógio 1 hora');
  assert.equal(app.session.clockNow, '2026-11-05T13:00:00.000Z', 'ações novas funcionam normalmente');
});

test('saída: logout descarta a demonstração sem retornar ao participante', async () => {
  const app = createAdminApp();
  await app.pressAsync('← Sair da conta');
  assert.equal(app.logoutCount, 1);
  assert.equal(app.session, null);
  assert.deepEqual(plain(app.navigationCalls), []);
});

test('provedor recusa Participante, Staff, desafio pendente e identidade não confirmada', () => {
  for (const overrides of [
    { user: { roles: ['participante'] } }, { user: { roles: ['staff'] } },
    { user: { roles: ['admin', 'invalid'] } }, { user: { sessionId: null } },
    { identityStatus: 'checking' }, { identityStatus: 'error' },
    { isAuthenticated: false }, { adminChallenge: { isTotpConfigured: true } },
  ]) {
    const app = createAdminApp({ auth: verifiedAdminAuth(overrides) });
    assert.equal(app.session, null);
    assert.ok(!app.hasButton('Gerenciar Eventos, 7 eventos na demonstração'));
    assert.ok(app.hasText('Sessão indisponível'));
  }
});

test('callbacks antigos não alteram outra conta após renderização nem encerram sua sessão', async () => {
  const app = createAdminApp();
  const stale = app.demo;
  const exit = app.handlerOf('← Sair da conta');
  app.setAuth(verifiedAdminAuth({ user: { id: 'admin-b' } }));
  const before = plain(app.session);
  stale.advanceClock(60);
  stale.toggleFailNextAction();
  assert.equal(stale.run(() => { throw new Error('transição antiga executada'); }).code, 'NO_SESSION');
  assert.equal(stale.discard(), false);
  await exit();
  app.sync();
  assert.equal(app.logoutCount, 0);
  assert.deepEqual(plain(app.session), before);
  assert.equal(app.demo.failNextAction, false);
});

test('perda de papel limpa mocks e ações anteriores não retornam após nova autorização', () => {
  const app = createAdminApp();
  const stale = app.demo;
  app.press('Avançar relógio 1 hora');
  app.setAuth(verifiedAdminAuth({ user: { roles: ['staff'] } }));
  assert.equal(app.session, null);
  assert.equal(stale.simulateLoad().code, 'NO_SESSION');
  app.setAuth(verifiedAdminAuth());
  stale.advanceClock(60);
  app.sync();
  assert.equal(app.session.clockNow, '2026-11-05T12:00:00.000Z');
});

test('fluxo completo: Painel → Eventos → Criar → Detalhe → Gerenciar → Painel → logout', async () => {
  const app = createAdminApp();
  await openEvents(app);
  app.press('+ Criar novo evento');
  fillCreateForm(app);
  app.press('America/Fortaleza, Fortaleza / São Luís, UTC−3');
  app.press('Fila externa habilitada');
  app.press('CRIAR EVENTO');
  await app.pressAsync('CRIAR EVENTO');
  assert.equal(app.route, 'AdminEventDetail');
  app.press('Desabilitar fila externa');
  app.type('Justificativa *', 'Evento pequeno, sem fila');
  app.press('DESABILITAR FILA EXTERNA');
  await app.pressAsync('DESABILITAR FILA EXTERNA');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Fila externa: desabilitada'));
  app.press('Voltar ao painel');
  assert.equal(app.route, 'AdminPanel');
  assert.ok(app.hasButton('Gerenciar Eventos, 8 eventos na demonstração'));
  await app.pressAsync('← Sair da conta');
  assert.equal(app.logoutCount, 1);
  assert.equal(app.session, null);
});

test('isolamento de módulos: Admin não importa participação, serviços HTTP nem Área Staff', () => {
  const app = createAdminApp();
  assert.ok(!app.requested.some((name) => /ParticipationContext|httpClient|services\/|staff\//.test(name)));
});

test('ações de gestão: erro simulado ligado no detalhe falha sem alterar o evento', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Simular erro na próxima ação');
  app.press('Desabilitar fila externa');
  app.type('Justificativa *', 'Fluxo de público reduzido');
  app.press('DESABILITAR FILA EXTERNA');
  await app.pressAsync('DESABILITAR FILA EXTERNA');
  assert.ok(app.hasText('Não foi possível alterar'));
  assert.ok(app.hasText('Erro simulado: nenhuma alteração foi feita'));
  assert.equal(byCode(app, 'ARENA-XP').externalQueueEnabled, true);
  assert.equal(byCode(app, 'ARENA-XP').participants.externalWaiting, 6);
  app.press('DESABILITAR FILA EXTERNA');
  await app.pressAsync('DESABILITAR FILA EXTERNA');
  assert.ok(app.hasText('Fila externa atualizada'), 'nova tentativa funciona');
});

test('condições não modeladas aparecem como indisponíveis, nunca como sucesso', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-noturna' } });
  assert.ok(app.hasText('O processamento de filas internas e chamadas não é simulado'));
  app.press('Avançar relógio 1 hora');
  assert.ok(app.hasText('fase efetiva: Encerrado (closed)'));
  assert.ok(app.hasText('Não simulado nesta demonstração'), 'finalização automática D07 não simulada');
  app.press('Reiniciar relógio');
  app.press('Encerrar antecipadamente');
  app.press('Modo imediato');
  app.type('Justificativa *', 'Encerramento de teste');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  assert.ok(app.hasText('o cancelamento delas não foi simulado'));
  assert.ok(!app.hasText('chamadas pendentes canceladas'));
});
