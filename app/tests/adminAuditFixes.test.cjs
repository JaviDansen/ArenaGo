// Correções da auditoria da ADM01 (F01–F05): testes adversariais com o
// provedor real, callbacks guardados e latência controlada.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminApp } = require('./helpers/adminHarness.cjs');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const byCode = (app, code) => app.session.events.find((event) => event.accessCode === code);
const auditCount = (app, code, action) => byCode(app, code).audit.filter((entry) => entry.action === action).length;
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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

// Latência controlada: cada espera fica pendente até release().
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

// Os quatro fluxos de gestão: abre a confirmação e devolve o rótulo do confirmar.
const FLOWS = {
  'alteração de horários': {
    route: 'AdminEventSchedule',
    action: 'SCHEDULE',
    open(app) {
      app.type('Nova hora do encerramento oficial *', '1800');
      app.press('Limite operacional 0 minutos após o encerramento oficial');
      app.type('Justificativa *', 'Ajuste solicitado pela organização');
      app.press('SALVAR HORÁRIOS');
      return 'ALTERAR HORÁRIOS';
    },
    success: 'Horários atualizados',
    applied: (app) => byCode(app, 'ARENA-XP').officialEndsAt === '2026-11-05T21:00:00.000Z',
  },
  'fila externa': {
    route: 'AdminEventQueue',
    action: 'EXTERNAL_QUEUE',
    open(app) {
      app.type('Justificativa *', 'Fluxo de público reduzido');
      app.press('DESABILITAR FILA EXTERNA');
      return 'DESABILITAR FILA EXTERNA';
    },
    success: 'Fila externa atualizada',
    applied: (app) => byCode(app, 'ARENA-XP').externalQueueEnabled === false,
  },
  'encerramento imediato': {
    route: 'AdminEventClose',
    action: 'CLOSE',
    open(app) {
      app.press('Modo imediato');
      app.type('Justificativa *', 'Interrupção operacional');
      app.press('REVISAR ENCERRAMENTO');
      return 'ENCERRAR EVENTO';
    },
    success: 'Encerramento registrado',
    applied: (app) => byCode(app, 'ARENA-XP').closureMode === 'immediate',
  },
  'encerramento controlado': {
    route: 'AdminEventClose',
    action: 'CLOSE',
    open(app) {
      app.press('Modo controlado');
      app.type('Prazo controlado (minutos a partir de agora) *', '30');
      app.type('Justificativa *', 'Chuva forte no local');
      app.press('REVISAR ENCERRAMENTO');
      return 'ENCERRAR EVENTO';
    },
    success: 'Encerramento registrado',
    applied: (app) => byCode(app, 'ARENA-XP').closureMode === 'controlled',
  },
};

// ─── F01 — confirmações duplicadas ───────────────────────────────────────

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`F01 ${name}: dois disparos do confirmar sem renderização aplicam uma vez e mantêm o sucesso`, async () => {
    const app = createAdminApp({ initialRoute: flow.route, initialParams: { eventId: 'demo-admin-arena-xp' } });
    const confirmLabel = flow.open(app);
    assert.equal(app.modalOpen, true);
    const confirm = app.handlerOf(confirmLabel);
    const first = confirm();
    const second = confirm();
    await Promise.all([first, second]);
    await app.flush();
    assert.ok(flow.applied(app), 'a ação válida foi aplicada');
    assert.ok(app.hasText(flow.success), 'o sucesso legítimo continua na tela');
    assert.ok(!app.hasText('Não foi possível'), 'nenhum erro substituiu o sucesso');
    assert.equal(auditCount(app, 'ARENA-XP', flow.action), 1, 'um único registro de auditoria');
  });

  test(`F01 ${name}: confirmar de novo durante o processamento (latência pendente) é recusado`, async () => {
    const clock = controlledLatency();
    const app = createAdminApp({
      initialRoute: flow.route,
      initialParams: { eventId: 'demo-admin-arena-xp' },
      latency: clock.latency,
    });
    const confirmLabel = flow.open(app);
    const confirm = app.handlerOf(confirmLabel);
    const first = confirm();
    app.sync();
    const again = confirm();
    app.sync();
    assert.equal(clock.pending, 1, 'só uma operação entrou em processamento');
    clock.release();
    await Promise.all([first, again]);
    await app.flush();
    // Depois de concluída, o callback antigo também não faz nada.
    await confirm();
    await app.flush();
    assert.equal(clock.pending, 0);
    assert.ok(app.hasText(flow.success));
    assert.ok(!app.hasText('Não foi possível'));
    assert.equal(auditCount(app, 'ARENA-XP', flow.action), 1);
  });
}

test('F01 criar evento: dois disparos do confirmar criam um único evento', async () => {
  const app = createAdminApp({ initialRoute: 'AdminCreateEvent' });
  fillCreateForm(app);
  app.press('CRIAR EVENTO');
  const confirm = app.handlerOf('CRIAR EVENTO');
  await Promise.all([confirm(), confirm()]);
  await app.flush();
  assert.equal(app.session.events.filter((event) => event.accessCode === 'NOVO-01').length, 1);
  assert.equal(app.route, 'AdminEventDetail');
  assert.ok(app.hasText('Evento criado na demonstração'));
});

// ─── F02 — confirmação cancelada ou antiga ───────────────────────────────

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`F02 ${name}: callback guardado e executado depois de CANCELAR não altera nada`, async () => {
    const app = createAdminApp({ initialRoute: flow.route, initialParams: { eventId: 'demo-admin-arena-xp' } });
    const before = plain(byCode(app, 'ARENA-XP'));
    const confirmLabel = flow.open(app);
    const stale = app.handlerOf(confirmLabel);
    app.press('CANCELAR');
    assert.equal(app.modalOpen, false);
    await stale();
    await app.flush();
    assert.deepEqual(plain(byCode(app, 'ARENA-XP')), before, 'estado intacto');
    assert.ok(!app.hasText(flow.success));
    assert.ok(!app.hasText('Não foi possível'), 'nem sucesso nem erro: nada foi processado');
  });
}

test('F02 fila externa: callback de um diálogo anterior não vale para o diálogo reaberto', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventQueue', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.type('Justificativa *', 'Fluxo de público reduzido');
  app.press('DESABILITAR FILA EXTERNA');
  const stale = app.handlerOf('DESABILITAR FILA EXTERNA');
  app.press('CANCELAR');
  app.press('DESABILITAR FILA EXTERNA');
  assert.equal(app.modalOpen, true);
  await stale();
  await app.flush();
  assert.equal(byCode(app, 'ARENA-XP').externalQueueEnabled, true, 'callback antigo recusado');
  assert.equal(app.modalOpen, true, 'o diálogo atual continua aguardando decisão');
  await app.pressAsync('DESABILITAR FILA EXTERNA');
  assert.equal(byCode(app, 'ARENA-XP').externalQueueEnabled, false);
  assert.equal(auditCount(app, 'ARENA-XP', 'EXTERNAL_QUEUE'), 1);
});

test('F02 criar evento: callback guardado e executado depois de CANCELAR não cria nada', async () => {
  const app = createAdminApp({ initialRoute: 'AdminCreateEvent' });
  fillCreateForm(app);
  app.press('CRIAR EVENTO');
  const stale = app.handlerOf('CRIAR EVENTO');
  app.press('CANCELAR');
  await stale();
  await app.flush();
  assert.equal(app.session.events.length, 7);
  assert.equal(app.route, 'AdminCreateEvent');
});

test('R01 confirmação grava exatamente a justificativa revisada no diálogo', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventQueue', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.type('Justificativa *', 'Justificativa revisada');
  app.press('DESABILITAR FILA EXTERNA');
  const confirm = app.handlerOf('DESABILITAR FILA EXTERNA');
  await confirm();
  await app.flush();
  const entry = byCode(app, 'ARENA-XP').audit.find((item) => item.action === 'EXTERNAL_QUEUE');
  assert.equal(entry.reason, 'Justificativa revisada');
});

// ─── F03 — prazo do encerramento controlado ──────────────────────────────

test('F03 tela: prazo controlado alcançado finaliza as participações ativas (simulado) e avisa', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Encerrar antecipadamente');
  app.press('Modo controlado');
  app.type('Prazo controlado (minutos a partir de agora) *', '30');
  app.type('Justificativa *', 'Chuva forte no local');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  app.press('Voltar ao evento');
  assert.deepEqual(plain(byCode(app, 'ARENA-XP').participants), { externalWaiting: 0, active: 18, finished: 47 });

  app.press('Avançar relógio 1 hora');
  assert.ok(app.hasText('fase efetiva: Encerrado (closed)'));
  assert.deepEqual(plain(byCode(app, 'ARENA-XP').participants), { externalWaiting: 0, active: 0, finished: 65 });
  assert.ok(app.hasText('Ativas na Arena: 0'));
  assert.ok(app.hasText('Finalizadas: 65'));
  assert.ok(app.hasText('Prazo do encerramento controlado alcançado'));
  assert.ok(app.hasText('18 participação(ões) ainda aberta(s) foram finalizadas no prazo (simulado)'));
  assert.ok(app.hasText('filas internas e chamadas não é simulado'));
  assert.equal(byCode(app, 'ARENA-XP').statusStored, 'closed');

  // Idempotente: avançar de novo ou reiniciar não refaz nem desfaz.
  app.press('Avançar relógio 1 hora');
  app.press('Reiniciar relógio');
  assert.deepEqual(plain(byCode(app, 'ARENA-XP').participants), { externalWaiting: 0, active: 0, finished: 65 });
  assert.equal(auditCount(app, 'ARENA-XP', 'CONTROLLED_DEADLINE'), 1);
  assert.ok(app.hasText('fase efetiva: Encerrado (closed)'));
});

test('F03 estado: só finaliza ao atingir o prazo, preserva finalizadas e não mexe em outros eventos', () => {
  let current = state.createAdminDemoSession();
  ({ state: current } = state.closeEvent(current, 'demo-admin-arena-xp',
    { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte no local' }));
  const others = plain(current.events.filter((event) => event.accessCode !== 'ARENA-XP'));
  ({ state: current } = state.advanceClock(current, 15));
  let event = current.events.find((item) => item.accessCode === 'ARENA-XP');
  assert.equal(event.participants.active, 18, 'antes do prazo nada é finalizado');
  assert.equal(state.getEffectivePhase(event, current.clockNow), 'closing');
  ({ state: current } = state.advanceClock(current, 15));
  event = current.events.find((item) => item.accessCode === 'ARENA-XP');
  assert.deepEqual(plain(event.participants), { externalWaiting: 0, active: 0, finished: 65 });
  assert.equal(event.statusStored, 'closed');
  assert.equal(event.controlledDeadlineFinalized, 18);
  assert.equal(event.audit.at(-1).at, '2026-11-05T12:30:00.000Z');
  const othersAfter = plain(current.events.filter((item) => item.accessCode !== 'ARENA-XP'));
  assert.equal(othersAfter.length, others.length);
  othersAfter.forEach((item, index) => assert.deepEqual(item.participants, others[index].participants));
});

// ─── F04 — opções bloqueadas durante a criação ───────────────────────────

test('F04 criar evento: durante CRIANDO... fuso, fila externa e ferramentas ficam bloqueados', async () => {
  const clock = controlledLatency();
  const app = createAdminApp({ initialRoute: 'AdminCreateEvent', latency: clock.latency });
  fillCreateForm(app);
  app.press('CRIAR EVENTO');
  const pending = app.press('CRIAR EVENTO');
  assert.ok(app.hasButton('CRIANDO...'));
  for (const option of ['America/Sao_Paulo, São Paulo / Brasília, UTC−3',
    'America/Fortaleza, Fortaleza / São Luís, UTC−3', 'Fila externa habilitada', 'Fila externa desabilitada',
    'Limite operacional 0 minutos após o encerramento oficial', 'Avançar relógio 1 hora',
    'Simular erro na próxima ação', 'Cancelar']) {
    assert.equal(app.isDisabled(option), true, option);
  }
  // Mesmo um toque que escapasse da interface não muda o que será gravado.
  app.button('Fila externa desabilitada').props.onPress?.();
  app.sync();
  clock.release();
  await pending;
  await app.flush();
  const created = app.session.events.find((event) => event.accessCode === 'NOVO-01');
  assert.equal(created.timezone, 'America/Sao_Paulo');
  assert.equal(created.externalQueueEnabled, true);
  assert.equal(app.route, 'AdminEventDetail');
  assert.ok(app.hasText('Fila externa: habilitada'));
  assert.ok(app.hasText('Fuso: America/Sao_Paulo'));
});

test('F04 encerrar: modo de encerramento fica bloqueado durante o processamento', async () => {
  const clock = controlledLatency();
  const app = createAdminApp({
    initialRoute: 'AdminEventClose',
    initialParams: { eventId: 'demo-admin-arena-xp' },
    latency: clock.latency,
  });
  app.press('Modo imediato');
  app.type('Justificativa *', 'Interrupção operacional');
  app.press('REVISAR ENCERRAMENTO');
  const pending = app.press('ENCERRAR EVENTO');
  assert.equal(app.isDisabled('Modo controlado'), true);
  assert.equal(app.isDisabled('Modo imediato'), true);
  clock.release();
  await pending;
  await app.flush();
  assert.equal(byCode(app, 'ARENA-XP').closureMode, 'immediate');
});

// ─── F05 — reiniciar relógio não reabre ──────────────────────────────────

test('F05 tela: reiniciar o relógio após encerramento controlado não volta para open', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-arena-xp' } });
  app.press('Avançar relógio 15 minutos');
  app.press('Encerrar antecipadamente');
  app.press('Modo controlado');
  app.type('Prazo controlado (minutos a partir de agora) *', '30');
  app.type('Justificativa *', 'Chuva forte no local');
  app.press('REVISAR ENCERRAMENTO');
  await app.pressAsync('ENCERRAR EVENTO');
  app.press('Voltar ao evento');
  assert.ok(app.hasText('fase efetiva: Encerrando (closing)'));

  app.press('Reiniciar relógio');
  assert.ok(app.hasText('fase efetiva: Encerrando (closing)'), 'continua encerrando');
  assert.ok(!app.hasText('Aceitando novas participações'));
  assert.ok(app.hasText('Não aceita novas participações agora.'));
  assert.equal(app.isDisabled('Alterar horários'), true);
  assert.equal(app.isDisabled('Desabilitar fila externa'), true);

  // Do início de novo até o prazo (12:45 UTC): finaliza normalmente.
  app.press('Avançar relógio 1 hora');
  assert.ok(app.hasText('fase efetiva: Encerrado (closed)'));
  assert.equal(byCode(app, 'ARENA-XP').participants.active, 0);
});

test('F05 estado: com encerramento administrativo a fase nunca volta a open/scheduled', () => {
  let current = state.createAdminDemoSession();
  ({ state: current } = state.advanceClock(current, 15));
  ({ state: current } = state.closeEvent(current, 'demo-admin-arena-xp',
    { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte no local' }));
  ({ state: current } = state.resetClock(current));
  const event = current.events.find((item) => item.accessCode === 'ARENA-XP');
  assert.equal(state.getEffectivePhase(event, current.clockNow), 'closing');
  assert.equal(state.getEffectivePhase(event, '2026-11-05T00:00:00.000Z'), 'closing');
  assert.equal(state.describeEvent(event, current.clockNow).acceptingNewParticipations, false);
  assert.equal(state.getExternalQueueAvailability(event, current.clockNow).allowed, false);
  assert.equal(state.getScheduleChangeAvailability(event, current.clockNow).allowed, false);
});

test('fluxos aprovados: abertura automática por relógio continua funcionando sem encerramento', async () => {
  const app = createAdminApp({ initialRoute: 'AdminEventDetail', initialParams: { eventId: 'demo-admin-beast-d1' } });
  app.press('Avançar relógio 1 hora');
  assert.ok(app.hasText('fase efetiva: Aberto (open)'));
  app.press('Reiniciar relógio');
  assert.ok(app.hasText('fase efetiva: Agendado (scheduled)'));
  await flushPromises();
});
