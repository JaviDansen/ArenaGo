// ADM02 — telas de experiências, estações e Staff com o provedor real,
// navegação simulada, callbacks guardados e latência controlada.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminApp } = require('./helpers/adminHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');

const XP = 'demo-admin-arena-xp';
const D1 = 'demo-admin-beast-d1';
const D2 = 'demo-admin-beast-d2';
const KIDS = 'demo-admin-kids';
const SUMMER = 'demo-admin-summer';
const XP_DANCE = 'demo-admin-exp-xp-dance';
const XP_VR = 'demo-admin-exp-xp-vr';
const D1_LUTA = 'demo-admin-exp-d1-luta';
const XP_DANCE_1 = 'demo-admin-station-xp-dance-1';
const XP_DANCE_2 = 'demo-admin-station-xp-dance-2';

const eventOf = (app, id) => app.session.events.find((item) => item.id === id);
const auditCount = (app, id, action) => eventOf(app, id).audit.filter((entry) => entry.action === action).length;
const experiencesOf = (app, id) => app.session.experiences.filter((item) => item.eventId === id);
const stationsOf = (app, experienceId) => app.session.stations.filter((item) => item.experienceId === experienceId);
const grantsOf = (app, id) => app.session.staffGrants.filter((item) => item.eventId === id && item.revokedAt === null);

function controlledLatency() {
  const waiting = [];
  return {
    latency: () => new Promise((resolve) => { waiting.push(resolve); }),
    release() { waiting.splice(0).forEach((resolve) => resolve()); },
    get pending() { return waiting.length; },
  };
}

function fillCreateForm(app) {
  const values = {
    'Nome do evento *': 'Arena Teste',
    'Código de ingresso *': 'NOVO-01',
    'Data de início *': '10112026',
    'Hora de início *': '1000',
    'Data do encerramento oficial *': '10112026',
    'Hora do encerramento oficial *': '1800',
    'Data do limite operacional *': '10112026',
    'Hora do limite operacional *': '1830',
    'Justificativa do cadastro *': 'Cadastro e preparação do evento',
  };
  for (const [label, value] of Object.entries(values)) app.type(label, value);
  app.press('America/Sao_Paulo, São Paulo / Brasília, UTC−3');
  app.press('Fila externa habilitada');
}

// As sete ações da ADM02: abrem a confirmação e devolvem o rótulo do confirmar.
const FLOWS = {
  'criar experiência': {
    route: 'AdminEventExperiences',
    params: { eventId: D1 },
    event: D1,
    action: 'EXPERIENCE_CREATE',
    open(app) {
      app.type('Nome da nova experiência *', 'Fliperama');
      app.press('CRIAR EXPERIÊNCIA');
      return 'CRIAR EXPERIÊNCIA';
    },
    success: 'Experiência criada',
    applied: (app) => experiencesOf(app, D1).length === 3,
  },
  'renomear experiência': {
    route: 'AdminExperienceDetail',
    params: { eventId: D1, experienceId: D1_LUTA },
    event: D1,
    action: 'EXPERIENCE_RENAME',
    open(app) {
      app.type('Nome da experiência *', 'Luta Livre');
      app.press('SALVAR NOME');
      return 'SALVAR NOME';
    },
    success: 'Nome atualizado',
    applied: (app) => experiencesOf(app, D1).some((item) => item.name === 'Luta Livre'),
  },
  'adicionar estação': {
    route: 'AdminExperienceDetail',
    params: { eventId: D1, experienceId: D1_LUTA },
    event: D1,
    action: 'STATION_CREATE',
    open(app) {
      app.type('Identificação da nova estação *', 'Ringue 2');
      app.press('ADICIONAR ESTAÇÃO');
      return 'ADICIONAR ESTAÇÃO';
    },
    success: 'Estação adicionada',
    applied: (app) => stationsOf(app, D1_LUTA).length === 2,
  },
  'alterar identificação da estação': {
    route: 'AdminStationDetail',
    params: { eventId: D1, experienceId: D1_LUTA, stationId: 'demo-admin-station-d1-ringue-1' },
    event: D1,
    action: 'STATION_RENAME',
    open(app) {
      app.type('Identificação da estação *', 'Ringue A');
      app.press('SALVAR IDENTIFICAÇÃO');
      return 'SALVAR IDENTIFICAÇÃO';
    },
    success: 'Identificação atualizada',
    applied: (app) => stationsOf(app, D1_LUTA)[0].label === 'Ringue A',
  },
  'disponibilidade da estação': {
    route: 'AdminStationDetail',
    params: { eventId: XP, experienceId: XP_DANCE, stationId: XP_DANCE_2 },
    event: XP,
    action: 'STATION_AVAILABILITY',
    open(app) {
      app.press('TORNAR INDISPONÍVEL');
      return 'CONFIRMAR';
    },
    success: 'Disponibilidade atualizada',
    applied: (app) => stationsOf(app, XP_DANCE).find((item) => item.id === XP_DANCE_2).availability === 'unavailable',
  },
  'conceder Staff': {
    route: 'AdminEventStaff',
    params: { eventId: D2 },
    event: D2,
    action: 'STAFF_GRANT',
    open(app) {
      app.type('Buscar conta por e-mail', 'diego');
      app.press('Selecionar diego.rocha@arenago.example');
      app.press('CONCEDER STAFF NESTE EVENTO');
      return 'CONCEDER STAFF';
    },
    success: 'Staff concedido',
    applied: (app) => grantsOf(app, D2).length === 1,
  },
  'revogar Staff': {
    route: 'AdminEventStaff',
    params: { eventId: XP },
    event: XP,
    action: 'STAFF_REVOKE',
    open(app) {
      app.press('Revogar Staff de ana.lima@arenago.example');
      return 'REVOGAR STAFF';
    },
    success: 'Staff revogado',
    applied: (app) => grantsOf(app, XP).length === 1,
  },
};

// ─── Critério 12: navegação ──────────────────────────────────────────────

test('critério 12: navegação evento → experiências → experiência → estação → volta; evento → Staff → volta', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: XP } });
  assert.ok(!app.hasText('Configuração indisponível nesta etapa'));
  assert.ok(app.hasText('Experiências: 3 · com estação disponível: 3'));
  assert.ok(app.hasText('Staff vigente: 2 · apto (conta ativa e e-mail verificado): 2'));
  app.press('Experiências e estações');
  assert.equal(app.route, 'AdminEventExperiences');
  for (const name of ['Just Dance  →', 'Simulador de Corrida  →', 'Realidade Virtual  →']) assert.ok(app.hasText(name), name);
  assert.ok(!app.hasText('Arena de Luta'), 'só as experiências deste evento');
  assert.ok(app.hasText('Fila única: 5 aguardando (fictício)'));

  app.press('Abrir experiência Just Dance');
  assert.equal(app.route, 'AdminExperienceDetail');
  assert.ok(app.hasText('Atendida por 2 estação(ões): todas chamam desta mesma fila'));
  assert.ok(app.hasText('Ocupação: chamada pendente desde 05/11/2026 08:58 (fictícia)'));
  assert.ok(app.hasText('Ocupação: livre (sem chamada pendente)'));

  app.press('Abrir estação Estação 1');
  assert.equal(app.route, 'AdminStationDetail');
  assert.deepEqual(JSON.parse(JSON.stringify(app.params)), { eventId: XP, experienceId: XP_DANCE, stationId: XP_DANCE_1 });
  assert.ok(app.hasText('Disponibilidade: disponível'));
  assert.ok(app.hasText('Disponível não quer dizer livre'));

  app.press('← Experiência');
  assert.equal(app.route, 'AdminExperienceDetail');
  app.press('← Experiências');
  assert.equal(app.route, 'AdminEventExperiences');
  app.press('Voltar ao evento');
  assert.equal(app.route, 'AdminEventDetail');

  app.press('Staff do evento');
  assert.equal(app.route, 'AdminEventStaff');
  assert.ok(app.hasText('ana.lima@arenago.example') && app.hasText('bruno.costa@arenago.example'));
  assert.ok(app.hasText('Staff é autorizado por evento'));
  app.press('← Evento');
  assert.deepEqual(JSON.parse(JSON.stringify(app.routes)), ['AdminEventDetail']);
});

test('critério 12: troca de conta ou logout descarta experiências, estações e Staff criados', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventExperiences', initialParams: { eventId: D1 } });
  app.type('Nome da nova experiência *', 'Fliperama');
  app.press('CRIAR EXPERIÊNCIA');
  await app.pressAsync('CRIAR EXPERIÊNCIA');
  assert.equal(experiencesOf(app, D1).length, 3);
  app.setAuth(verifiedAdminAuth({ user: { id: 'u-2', name: 'Outra Conta', sessionId: '20000000-0000-4000-8000-000000000002' } }));
  assert.equal(experiencesOf(app, D1).length, 2, 'conta B começa do zero');
  assert.ok(!app.hasText('Fliperama  →'));
  app.setAuth({ isAuthenticated: false, user: null });
  assert.equal(app.session, null);
  assert.ok(app.hasText('Evento não encontrado'));
});

test('rotas com IDs cruzados, inexistentes ou herdados mostram estado seguro', () => {
  const cases = [
    ['AdminExperienceDetail', { eventId: D1, experienceId: XP_DANCE }, 'Experiência não encontrada'],
    ['AdminExperienceDetail', Object.create({ eventId: XP, experienceId: XP_DANCE }), 'Experiência não encontrada'],
    ['AdminStationDetail', { eventId: XP, experienceId: XP_VR, stationId: XP_DANCE_1 }, 'Estação não encontrada'],
    ['AdminStationDetail', { eventId: D1, experienceId: XP_DANCE, stationId: XP_DANCE_1 }, 'Estação não encontrada'],
    ['AdminEventExperiences', { eventId: 'nao-existe' }, 'Evento não encontrado'],
    ['AdminEventStaff', Object.create({ eventId: XP }), 'Evento não encontrado'],
  ];
  for (const [route, params, text] of cases) {
    const app = createAdminApp({ initialRoute: route, initialParams: params });
    assert.ok(app.hasText(text), `${route} → ${text}`);
    assert.ok(!app.hasButton('TORNAR INDISPONÍVEL') && !app.hasButton('ADICIONAR ESTAÇÃO'));
  }
});

// ─── Critério 1: configuração completa pela interface ────────────────────

test('critério 1 (tela): evento novo → experiência → estação → ainda não pronto → Staff apto → pronto', async () => {
  const app = createAdminApp({ initialRoute: 'AdminCreateEvent' });
  fillCreateForm(app);
  app.press('CRIAR EVENTO');
  await app.pressAsync('CRIAR EVENTO');
  assert.equal(app.route, 'AdminEventDetail');
  assert.ok(app.hasText('Prontidão: não pronto ✗'));

  app.press('Experiências e estações');
  assert.ok(app.hasText('Nenhuma experiência cadastrada'));
  app.press('Preencher com Just Dance');
  assert.equal(app.input('Nome da nova experiência *').props.value, 'Just Dance', 'atalho só preenche o campo');
  assert.equal(app.session.experiences.length, 13, 'atalho não cria nada');
  app.press('CRIAR EXPERIÊNCIA');
  assert.equal(app.modalOpen, true);
  assert.ok(app.hasText('Evento: Arena Teste'));
  await app.pressAsync('CRIAR EXPERIÊNCIA');
  assert.ok(app.hasText('Experiência criada'));
  assert.equal(app.input('Nome da nova experiência *').props.value, '', 'campo limpo após sucesso');

  app.press('Abrir experiência Just Dance');
  assert.ok(app.hasText('Nenhuma estação nesta experiência'));
  app.press('Preencher com Estação 1');
  app.press('ADICIONAR ESTAÇÃO');
  await app.pressAsync('ADICIONAR ESTAÇÃO');
  assert.ok(app.hasText('Estação adicionada'));
  assert.ok(app.hasButton('Abrir estação Estação 1'));
  app.press('← Experiências');
  assert.ok(app.hasText('1 estação(ões) · 1 disponível(is) · 0 com chamada pendente'));
  app.press('Voltar ao evento');

  assert.ok(app.hasText('Prontidão: não pronto ✗'), 'ainda falta Staff');
  assert.ok(app.hasLabel('Pelo menos uma experiência com estação disponível: atendido'));
  assert.ok(app.hasLabel('Pelo menos um Staff autorizado, ativo e verificado: faltando'));

  app.press('Staff do evento');
  assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));
  app.type('Buscar conta por e-mail', 'DIEGO');
  assert.ok(!app.hasText('ana.lima@arenago.example'), 'busca filtra por e-mail');
  app.press('Selecionar diego.rocha@arenago.example');
  app.press('CONCEDER STAFF NESTE EVENTO');
  assert.ok(app.hasText('Vale somente para este evento'));
  await app.pressAsync('CONCEDER STAFF');
  assert.ok(app.hasText('Staff concedido'));
  assert.ok(app.hasText('Apto ✓ (conta ativa e e-mail verificado)'));
  assert.equal(app.isDisabled('CONCEDER STAFF NESTE EVENTO'), true, 'não concede de novo');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Prontidão: pronto ✓'));
  assert.ok(app.hasText('fase efetiva: Agendado (scheduled)'), 'pronto, aguardando o início');
});

// ─── Critérios 2, 4, 5, 8, 9, 10 nas telas ───────────────────────────────

test('critério 2 (tela): conta inativa ou sem e-mail verificado não recebe Staff; busca não cria conta', () => {
  const app = createAdminApp({ initialRoute: 'AdminEventStaff', initialParams: { eventId: D2 } });
  for (const email of ['ana.lima@arenago.example', 'elisa.martins@arenago.example', 'gabriela.alves@arenago.example']) {
    assert.ok(app.hasText(email), 'contas existentes listadas por e-mail');
  }
  app.press('Selecionar elisa.martins@arenago.example');
  assert.ok(app.hasText('E-mail não verificado: a concessão de Staff exige conta ativa e e-mail verificado.'));
  assert.equal(app.isDisabled('CONCEDER STAFF NESTE EVENTO'), true);
  app.press('Selecionar fabio.nunes@arenago.example');
  assert.ok(app.hasText('Conta inativa: a concessão de Staff exige conta ativa e e-mail verificado.'));
  assert.equal(app.isDisabled('CONCEDER STAFF NESTE EVENTO'), true);
  app.type('Buscar conta por e-mail', 'nova.pessoa@arenago.example');
  assert.ok(app.hasText('Nenhuma conta encontrada'));
  assert.equal(app.session.accounts.length, 8);
  assert.equal(grantsOf(app, D2).length, 0);

  const kids = createAdminApp({ initialRoute: 'AdminEventStaff', initialParams: { eventId: KIDS } });
  assert.ok(kids.hasText('Conta inativa: não conta para a prontidão'));
  assert.ok(kids.hasText('Staff apto (conta ativa e e-mail verificado): 1'));
});

test('critérios 4 e 5 (tela): com participação, criar e renomear ficam bloqueados; adicionar estação continua', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventExperiences', initialParams: { eventId: XP } });
  assert.ok(app.hasText('Criação de experiência indisponível'));
  assert.ok(app.hasText('já teve participação'));
  assert.ok(!app.hasButton('CRIAR EXPERIÊNCIA'));
  assert.ok(!app.input('Nome da nova experiência *'));

  app.press('Abrir experiência Just Dance');
  assert.ok(app.hasText('Renomear indisponível'));
  assert.ok(!app.input('Nome da experiência *'));
  assert.ok(app.hasText('adicionar estação a uma experiência existente continua permitido'));
  app.press('Preencher com Estação 3');
  app.press('ADICIONAR ESTAÇÃO');
  await app.pressAsync('ADICIONAR ESTAÇÃO');
  assert.ok(app.hasText('Estação adicionada'));
  assert.ok(app.hasText('Atendida por 3 estação(ões): todas chamam desta mesma fila'));
  assert.ok(app.hasText('Aguardando: 5 (fictício)'), 'a mesma fila, sem reinício');

  app.press('Abrir estação Estação 3');
  assert.ok(app.hasText('Alterar identificação indisponível'));
  assert.ok(!app.input('Identificação da estação *'));
  assert.ok(app.hasButton('TORNAR INDISPONÍVEL'), 'disponibilidade continua operacional');
});

test('critério 8 (tela): estação com chamada pendente não pode ser desativada; a livre pode', async () => {
  const busy = createAdminApp({
    initialRoute: 'AdminStationDetail',
    initialParams: { eventId: XP, experienceId: XP_DANCE, stationId: XP_DANCE_1 },
  });
  assert.ok(busy.hasText('Desativação bloqueada'));
  assert.ok(busy.hasText('chamada pendente: ela só pode ficar indisponível depois que a chamada for resolvida'));
  assert.equal(busy.isDisabled('TORNAR INDISPONÍVEL'), true);

  const free = createAdminApp({
    initialRoute: 'AdminStationDetail',
    initialParams: { eventId: XP, experienceId: XP_DANCE, stationId: XP_DANCE_2 },
  });
  free.press('TORNAR INDISPONÍVEL');
  assert.ok(free.hasText('A fila da experiência não fecha'));
  await free.pressAsync('CONFIRMAR');
  assert.ok(free.hasText('Disponibilidade atualizada'));
  assert.ok(free.hasText('Disponibilidade: indisponível'));
  assert.ok(free.hasButton('TORNAR DISPONÍVEL'));
});

test('critérios 9 e 10 (tela): revogar o último Staff mantém o evento aberto; reconceder recupera antes do corte', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: XP } });
  app.press('Staff do evento');
  app.press('Revogar Staff de ana.lima@arenago.example');
  assert.ok(app.hasText('A revogação vale somente para este evento.'));
  await app.pressAsync('REVOGAR STAFF');
  app.press('Revogar Staff de bruno.costa@arenago.example');
  assert.ok(app.hasText('É o último Staff apto: novas participações ficarão suspensas, mas o evento NÃO será encerrado'));
  await app.pressAsync('REVOGAR STAFF');
  assert.ok(app.hasText('Staff revogado'));
  assert.ok(app.hasText('continua aberto'));
  assert.ok(app.hasText('Nenhum Staff vinculado a este evento'));

  app.press('Voltar ao evento');
  for (const text of ['fase efetiva: Aberto (open)', 'Não aceita novas participações agora.',
    'Novas participações suspensas — o evento continua aberto', 'Motivo: sem Staff apto no evento',
    'Aguardando na fila externa: 6', 'Ativas na Arena: 18', 'Finalizadas: 41']) {
    assert.ok(app.hasText(text), text);
  }
  assert.equal(app.isDisabled('Encerrar antecipadamente'), false, 'nada foi encerrado');

  app.press('Staff do evento');
  app.type('Buscar conta por e-mail', 'ana');
  app.press('Selecionar ana.lima@arenago.example');
  app.press('CONCEDER STAFF NESTE EVENTO');
  await app.pressAsync('CONCEDER STAFF');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Aceitando novas participações (simulado).'), 'capacidade volta sem botão de abrir');
  assert.ok(!app.hasText('Novas participações suspensas'));
});

test('critério 10 (tela): evento encerrado fica somente leitura e nenhuma operação o reabre', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventExperiences', initialParams: { eventId: SUMMER } });
  assert.ok(app.hasText('Criação de experiência indisponível'));
  assert.ok(app.hasText('Evento encerrado definitivamente'));
  app.press('Abrir experiência Just Dance');
  assert.ok(app.hasText('Renomear indisponível') && app.hasText('Adicionar estação indisponível'));
  app.press('Abrir estação Estação 1');
  assert.ok(app.hasText('Disponibilidade indisponível'));
  assert.ok(app.hasText('Ocupação: sem chamadas vigentes (evento encerrado)'));
  assert.ok(!app.hasButton('TORNAR INDISPONÍVEL'));

  const staff = createAdminApp({ initialRoute: 'AdminEventStaff', initialParams: { eventId: SUMMER } });
  assert.ok(staff.hasText('Concessão indisponível'));
  assert.ok(!staff.input('Buscar conta por e-mail'));
  staff.press('Revogar Staff de ana.lima@arenago.example');
  await staff.pressAsync('REVOGAR STAFF');
  assert.ok(staff.hasText('Staff revogado'), 'revogar por segurança continua possível');
  assert.equal(eventOf(staff, SUMMER).statusStored, 'closed');
});

test('C-14 por experiência (tela): a fila sem estação disponível suspende; as outras e o evento seguem', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: XP } });
  app.press('Experiências e estações');
  app.press('Abrir experiência Simulador de Corrida');
  app.press('Abrir estação Cockpit A');
  app.press('TORNAR INDISPONÍVEL');
  await app.pressAsync('CONFIRMAR');
  app.press('← Experiência');
  assert.ok(app.hasText('Novas entradas nesta fila: suspensas — nenhuma estação desta experiência está disponível'));
  app.press('← Experiências');
  assert.ok(app.hasText('Novas entradas nesta fila: suspensas — nenhuma estação desta experiência está disponível'));
  assert.ok(app.hasText('Novas entradas nesta fila: aceitas (simulado)'), 'Just Dance e Realidade Virtual seguem');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('Aceitando novas participações (simulado).'));
});

test('C-05 (tela): estação ativada depois do início abre o evento sozinha e o painel acompanha', async () => {
  const app = createAdminApp();
  app.press('Gerenciar Eventos, 7 eventos na demonstração');
  await app.flush();
  app.press('Abrir Arena Kids, código KIDS-01, Agendado');
  assert.ok(app.hasText('fase efetiva: Agendado (scheduled)'));
  app.press('Experiências e estações');
  app.press('Abrir experiência Pintura Digital');
  app.press('Abrir estação Mesa 1');
  app.press('TORNAR DISPONÍVEL');
  assert.ok(app.hasText('não reabre um evento encerrado'));
  await app.pressAsync('CONFIRMAR');
  app.press('← Experiência');
  app.press('← Experiências');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('fase efetiva: Aberto (open)'));
  assert.ok(app.hasText('Abertura automática registrada em: 05/11/2026 09:00 (America/Belem, UTC−3)'));
  app.press('Voltar ao painel');
  assert.ok(app.hasLabel('Abertos: 2'));
  assert.ok(app.hasLabel('Não prontos: 1'));
  assert.ok(app.hasLabel('Agendados: 2'));
});

// ─── Critério 11: confirmação duplicada, cancelada, carregamento, erro ────

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`critério 11 — ${name}: dois disparos do confirmar aplicam uma vez e mantêm o sucesso`, async () => {
    const app = createAdminApp({ initialRoute: flow.route, initialParams: flow.params });
    const confirm = app.handlerOf(flow.open(app));
    await Promise.all([confirm(), confirm()]);
    await app.flush();
    assert.ok(flow.applied(app), 'aplicado');
    assert.equal(auditCount(app, flow.event, flow.action), 1, 'um único registro');
    assert.ok(app.hasText(flow.success));
    assert.ok(!app.hasText('Não foi possível'));
  });

  test(`critério 11 — ${name}: confirmação cancelada ou guardada não altera nada`, async () => {
    const app = createAdminApp({ initialRoute: flow.route, initialParams: flow.params });
    const before = JSON.stringify(app.session);
    const stale = app.handlerOf(flow.open(app));
    app.press('CANCELAR');
    assert.equal(app.modalOpen, false);
    await stale();
    await app.flush();
    assert.equal(JSON.stringify(app.session), before, 'estado intacto');
    assert.ok(!app.hasText(flow.success));
    assert.ok(!app.hasText('Não foi possível'));
  });

  test(`critério 11 — ${name}: nova confirmação durante o carregamento é recusada`, async () => {
    const clock = controlledLatency();
    const app = createAdminApp({ initialRoute: flow.route, initialParams: flow.params, latency: clock.latency });
    const confirm = app.handlerOf(flow.open(app));
    const first = confirm();
    app.sync();
    assert.ok(!app.hasButton('Simular erro na próxima ação') || app.isDisabled('Simular erro na próxima ação'),
      'ferramentas bloqueadas durante o envio');
    const again = confirm();
    app.sync();
    assert.equal(clock.pending, 1, 'só uma operação em andamento');
    clock.release();
    await Promise.all([first, again]);
    await app.flush();
    await confirm();
    await app.flush();
    assert.equal(clock.pending, 0);
    assert.equal(auditCount(app, flow.event, flow.action), 1);
    assert.ok(app.hasText(flow.success));
  });

  test(`critério 11 — ${name}: erro simulado não altera nada e a nova tentativa funciona`, async () => {
    const app = createAdminApp({ initialRoute: flow.route, initialParams: flow.params });
    const before = JSON.stringify(app.session);
    app.press('Simular erro na próxima ação');
    await app.pressAsync(flow.open(app));
    assert.ok(app.hasText('Erro simulado: nenhuma alteração foi feita'));
    assert.ok(app.hasText('Não foi possível'));
    assert.equal(JSON.stringify(app.session), before, 'estado intacto');
    await app.pressAsync(flow.open(app));
    assert.ok(flow.applied(app), 'nova tentativa aplicada');
    assert.equal(auditCount(app, flow.event, flow.action), 1);
  });
}
