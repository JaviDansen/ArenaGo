const assert = require('node:assert/strict');
const test = require('node:test');
const { createStaffApp } = require('./helpers/staffHarness.cjs');

const ENTRY_ACTIVE = 'Controle de Entrada, fila ativa, 4 aguardando';
const PLAYSTATION = 'Abrir PlayStation, 1 chamado, 1 na fila';
const VIRTUAL_REALITY = 'Abrir Realidade Virtual, 1 chamado, 3 na fila';
const RACING = 'Abrir Simulador de Corrida, 1 chamado, 1 na fila';
const plain = (value) => JSON.parse(JSON.stringify(value));

async function enterEvent(code = 'STAFFDEMO') {
  const app = createStaffApp();
  app.typeCode(code);
  await app.pressAsync('ENTRAR NO EVENTO');
  assert.equal(app.route, 'StaffPanel');
  return app;
}

function confirmDialog(app, action, confirm) {
  app.press(action);
  assert.equal(app.modalOpen, true, `${action} abre confirmação`);
  app.press(confirm);
  assert.equal(app.modalOpen, false);
}

test('SV01 acesso: layout do print 01, faixa de demonstração e conta do AuthContext', () => {
  const app = createStaffApp({ auth: { isAuthenticated: true, user: { id: 'u-9', name: 'Heliom Teste' } } });
  for (const text of ['🔐 Área do Staff', 'Operação de um evento', 'Login', 'Código do evento',
    'MODO DEMONSTRAÇÃO', 'Heliom Teste', 'NÃO recebeu permissão Staff', 'API futura',
    'É o mesmo código usado pelo Participante']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasButton('ENTRAR NO EVENTO'));
});

test('SV01 acesso: código vazio não avança e mostra erro', async () => {
  const app = createStaffApp();
  for (const code of ['', '   ']) {
    app.typeCode(code);
    await app.pressAsync('ENTRAR NO EVENTO');
    assert.equal(app.route, 'StaffAccess');
    assert.ok(app.hasText('Informe o código do evento.'));
    assert.equal(app.session, null);
  }
  assert.deepEqual(app.navigationCalls, []);
});

test('SV01 acesso: mostra carregamento e depois erro para código desconhecido', async () => {
  let release;
  const app = createStaffApp({ latency: () => new Promise((resolve) => { release = resolve; }) });
  app.typeCode('NAOEXISTE');
  const pending = app.press('ENTRAR NO EVENTO');
  assert.ok(app.hasButton('VERIFICANDO...'));
  assert.equal(app.isDisabled('VERIFICANDO...'), true);
  assert.equal(app.input().props.editable, false);
  release();
  await pending;
  app.sync();
  assert.ok(app.hasText('Código não encontrado entre os eventos de demonstração.'));
  assert.ok(app.hasButton('ENTRAR NO EVENTO'));
  assert.equal(app.route, 'StaffAccess');

  app.typeCode('NAOEXISTE2');
  assert.ok(!app.hasText('Código não encontrado'), 'digitar limpa o erro');
});

test('SV01 acesso: erro simulado de comunicação não abre o painel', async () => {
  const app = createStaffApp();
  app.typeCode('stafferro');
  await app.pressAsync('ENTRAR NO EVENTO');
  assert.equal(app.route, 'StaffAccess');
  assert.ok(app.hasText('Falha simulada'));
});

test('SV01 acesso: "Voltar ao app" sai da Área Staff', () => {
  const app = createStaffApp();
  app.press('Voltar ao app');
  assert.deepEqual(plain(app.navigationCalls), [{ type: 'back' }]);
});

test('SV01 código conhecido abre o Painel Operacional do print 02', async () => {
  const app = await enterEvent(' staffdemo ');
  assert.deepEqual(app.routes, ['StaffPanel']);
  assert.equal(app.session.code, 'STAFFDEMO');
  for (const text of ['Painel Operacional', 'BEAST Arena - Shopping XYZ · STAFFDEMO',
    'Estações do evento', 'MODO DEMONSTRAÇÃO']) {
    assert.ok(app.hasText(text), text);
  }
  for (const text of ['🚪 Controle de Entrada', '🎮 PlayStation (1 chamado · 1 na fila)',
    '🥽 Realidade Virtual (1 chamado · 3 na fila)', '🏎️ Simulador de Corrida (1 chamado · 1 na fila)',
    '↩ Trocar de evento']) {
    assert.ok(app.texts().includes(text), text);
  }
});

test('SV01 painel sem evento selecionado oferece volta à Área do Staff', () => {
  const app = createStaffApp({ initialRoute: 'StaffPanel' });
  assert.ok(app.hasText('Nenhum evento selecionado'));
  app.press('IR PARA A ÁREA DO STAFF');
  assert.equal(app.route, 'StaffAccess');
});

test('SV01 painel navega para Controle de Entrada e volta preservando o evento', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  assert.equal(app.route, 'StaffEntryControl');
  app.press('↩ Painel');
  assert.equal(app.route, 'StaffPanel');
  assert.equal(app.session.code, 'STAFFDEMO');
});

test('SV01 painel abre a mesma tela de estação para as três experiências', async () => {
  const app = await enterEvent();
  const expected = [
    [PLAYSTATION, 'playstation', 'ps-1', '🎮 PlayStation'],
    [VIRTUAL_REALITY, 'virtual-reality', 'vr-1', '🥽 Realidade Virtual'],
    [RACING, 'racing-simulator', 'sim-1', '🏎️ Simulador de Corrida'],
  ];
  for (const [label, experienceId, stationId, title] of expected) {
    app.press(label);
    assert.equal(app.route, 'StaffStation');
    assert.deepEqual({ ...app.params }, { experienceId, stationId });
    assert.ok(app.hasText(title), title);
    app.press('↩ Painel');
  }
});

test('SV01 trocar de evento pede confirmação e limpa a seleção da demonstração', async () => {
  const app = await enterEvent();
  app.press('↩ Trocar de evento');
  assert.equal(app.modalOpen, true);
  app.press('CANCELAR');
  assert.equal(app.session.code, 'STAFFDEMO');
  confirmDialog(app, '↩ Trocar de evento', 'TROCAR DE EVENTO');
  assert.equal(app.session, null);
  assert.deepEqual(app.routes, ['StaffAccess']);

  app.typeCode('STAFFVAZIO');
  await app.pressAsync('ENTRAR NO EVENTO');
  assert.equal(app.session.code, 'STAFFVAZIO');
});

test('SV02 controle de entrada reproduz o print 03', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  for (const text of ['Controle de Entrada', 'Fila de acesso à Arena', 'Fila de acesso', 'ATIVA',
    'Não', 'Sim', 'Aguardando: 4 · Próximo: Rafael T.', '1. Rafael T.', '2. Júlia P.',
    '3. Marcos L.', '4. Beatriz N.', 'A entrada normal é individual']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasButton('CONFIRMAR ENTRADA'));
  assert.ok(app.hasButton('DESATIVAR FILA (LIBERA TODOS)'));
});

test('SV02 confirmar entrada: cancelar não muda, confirmar avança só localmente', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  app.press('CONFIRMAR ENTRADA');
  assert.ok(app.hasText('nada é enviado ao servidor'));
  app.press('CANCELAR');
  assert.equal(app.session.entryQueue.waiting.length, 4);

  confirmDialog(app, 'CONFIRMAR ENTRADA', 'CONFIRMAR');
  assert.equal(app.session.entryQueue.waiting[0].name, 'Júlia P.');
  assert.ok(app.hasText('confirmada na simulação local'));
  assert.ok(app.hasText('Aguardando: 3 · Próximo: Júlia P.'));
  assert.ok(!app.texts().some((text) => /servidor/.test(text) && /sucesso/i.test(text)));
});

test('SV02 desativar fila exige confirmação e avisa que é operação de Admin', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  app.press('DESATIVAR FILA (LIBERA TODOS)');
  assert.ok(app.hasText('Operação reservada a Admin na futura API'));
  app.press('CANCELAR');
  assert.equal(app.session.entryQueue.active, true);

  confirmDialog(app, 'Fila de acesso: Não', 'DESATIVAR NA DEMONSTRAÇÃO');
  assert.equal(app.session.entryQueue.active, false);
  assert.ok(app.hasText('INATIVA'));
  assert.ok(app.hasText('novos ingressos futuros'));
  assert.ok(app.hasText('não recoloca'));
  assert.ok(app.hasText('Fila vazia'));
  assert.ok(!app.hasButton('DESATIVAR FILA (LIBERA TODOS)'));

  app.press('Fila de acesso: Sim');
  assert.ok(app.hasText('ATIVA'));
  assert.ok(app.hasText('Fila vazia'));
  assert.equal(app.session.entryQueue.waiting.length, 0);
});

test('SV02 erro simulado não altera a fila e o evento é preservado ao voltar', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  app.press('Simular erro na próxima ação');
  confirmDialog(app, 'CONFIRMAR ENTRADA', 'CONFIRMAR');
  assert.ok(app.hasText('Erro simulado'));
  assert.equal(app.session.entryQueue.waiting.length, 4);

  confirmDialog(app, 'CONFIRMAR ENTRADA', 'CONFIRMAR');
  app.press('↩ Painel');
  app.press('Controle de Entrada, fila ativa, 3 aguardando');
  assert.ok(app.hasText('1. Júlia P.'));
});

test('SV02 evento com fila inativa e vazia mostra o estado correto', async () => {
  const app = await enterEvent('STAFFVAZIO');
  app.press('Controle de Entrada, fila inativa, 0 aguardando');
  assert.ok(app.hasText('INATIVA'));
  assert.ok(app.hasText('Fila de acesso desativada'));
  assert.ok(app.hasText('Fila vazia'));
  assert.ok(!app.hasButton('CONFIRMAR ENTRADA'));
});

test('SV03 PlayStation reproduz o print 04 e concluir libera a estação', async () => {
  const app = await enterEvent();
  app.press(PLAYSTATION);
  for (const text of ['🎮 PlayStation', '⚠️ Check pendente',
    'Ana C. foi chamado(a). Ao terminar a experiência, confirme a conclusão.',
    'Fila (1)', '1. Lucas R.', 'Chama-se apenas o próximo']) {
    assert.ok(app.hasText(text), text);
  }
  assert.ok(app.hasButton('AUSENTE → FINAL DA FILA'));
  assert.ok(app.hasButton('Remover Lucas R.'));

  confirmDialog(app, 'CONCLUIR EXPERIÊNCIA', 'CONCLUIR');
  assert.ok(app.hasText('Nenhum chamado nesta estação'));
  assert.ok(app.hasText('concluída na simulação local'));
  assert.equal(app.session.experiences[0].queue.length, 1);

  app.press('CHAMAR PRÓXIMO');
  assert.ok(app.hasText('Lucas R. foi chamado(a)'));
  assert.ok(app.hasText('Fila (0)'));
  assert.ok(app.hasText('Fila vazia'));
});

test('SV03 Realidade Virtual reproduz o print 05 e ausente vai para o final', async () => {
  const app = await enterEvent();
  app.press(VIRTUAL_REALITY);
  for (const text of ['🥽 Realidade Virtual', 'Carla M. foi chamado(a)', 'Fila (3)',
    '1. Maria A.', '2. Pedro M.', '3. Tiago V.']) {
    assert.ok(app.hasText(text), text);
  }
  app.press('AUSENTE → FINAL DA FILA');
  assert.ok(app.hasText('volta para o final da fila'));
  app.press('MARCAR AUSENTE');
  assert.deepEqual(plain(app.session.experiences[1].queue.map((item) => item.name)),
    ['Maria A.', 'Pedro M.', 'Tiago V.', 'Carla M.']);
  assert.equal(app.session.experiences[1].completedCount, 0);
  assert.ok(app.hasText('4. Carla M.'));
  assert.ok(app.hasText('final da fila (simulação)'));
});

test('SV03 ausente após o corte de inscrições não volta à fila', async () => {
  const app = await enterEvent('STAFFVAZIO');
  app.press('Abrir PlayStation, 1 chamado, 0 na fila');
  assert.ok(!app.hasButton('AUSENTE → FINAL DA FILA'), 'inscrições encerradas: sem promessa de retorno');
  assert.ok(app.hasText('Inscrições encerradas: “Ausente” libera a estação e o participante não volta à fila'));
  assert.ok(!app.hasText('“Ausente” volta ao fim da fila'));
  app.press('AUSENTE (NÃO VOLTA À FILA)');
  assert.ok(app.hasText('NÃO volta para a fila'));
  app.press('MARCAR AUSENTE');
  assert.equal(app.session.experiences[0].queue.length, 0);
  assert.ok(app.hasText('Fila vazia'));
  assert.equal(app.isDisabled('CHAMAR PRÓXIMO'), true);
  assert.ok(app.hasText('Fila vazia: não há ninguém para chamar.'));
});

test('SV03 remover pede confirmação e não apaga ninguém (pendente de contrato)', async () => {
  const app = await enterEvent();
  app.press(VIRTUAL_REALITY);
  app.press('Remover Pedro M.');
  assert.ok(app.hasText('Remover Pedro M.?'));
  assert.ok(app.hasText('Remover não é o mesmo que Ausente.'));
  assert.ok(app.hasText('pendente de contrato'));
  app.press('CONFIRMAR (SEM EFEITO)');
  assert.ok(app.hasText('Remoção não executada'));
  assert.equal(app.session.experiences[1].queue.length, 3);
});

test('SV03 estação indisponível não chama e é distinta do estado da fila', async () => {
  const app = await enterEvent();
  app.press(PLAYSTATION);
  app.press('Estação PlayStation 2, indisponível');
  assert.equal(app.params.stationId, 'ps-2');
  assert.ok(app.hasText('Estação indisponível'));
  assert.ok(app.hasText('Fila (1)'), 'a fila da experiência continua visível');
  assert.ok(!app.hasButton('CHAMAR PRÓXIMO'));
  assert.ok(!app.hasButton('CONCLUIR EXPERIÊNCIA'));
});

test('SV03 estações da mesma experiência compartilham a mesma fila', async () => {
  const app = await enterEvent();
  app.press(VIRTUAL_REALITY);
  app.press('Estação Realidade Virtual 2, livre');
  assert.ok(app.hasText('Nenhum chamado nesta estação'));
  app.press('CHAMAR PRÓXIMO');
  assert.ok(app.hasText('Maria A. foi chamado(a)'));
  assert.ok(app.hasText('Fila (2)'));

  app.press('Estação Realidade Virtual 1, ocupada');
  assert.ok(app.hasText('Carla M. foi chamado(a)'));
  assert.ok(app.hasText('Fila (2)'));
  assert.ok(!app.hasText('Maria A.'), 'quem foi chamado não aparece na fila');
  app.press('↩ Painel');
  assert.ok(app.texts().includes('🥽 Realidade Virtual (2 chamado · 2 na fila)'));
});

test('SV03 estação inexistente mostra estado seguro', () => {
  const app = createStaffApp({
    initialRoute: 'StaffStation',
    initialParams: { experienceId: 'playstation', stationId: 'x' },
  });
  assert.ok(app.hasText('Estação não encontrada'));
  app.press('↩ Painel');
  assert.equal(app.route, 'StaffAccess', 'sem sessão volta para a Área do Staff');
});

test('fluxo completo: acesso → painel → entrada → painel → estações → painel → trocar evento', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  confirmDialog(app, 'CONFIRMAR ENTRADA', 'CONFIRMAR');
  app.press('↩ Painel');
  app.press(PLAYSTATION);
  confirmDialog(app, 'CONCLUIR EXPERIÊNCIA', 'CONCLUIR');
  app.press('↩ Painel');
  app.press(VIRTUAL_REALITY);
  confirmDialog(app, 'AUSENTE → FINAL DA FILA', 'MARCAR AUSENTE');
  app.press('↩ Painel');
  assert.deepEqual(app.routes, ['StaffPanel']);
  assert.ok(app.texts().includes('🎮 PlayStation (0 chamado · 1 na fila)'));
  assert.ok(app.texts().includes('🥽 Realidade Virtual (0 chamado · 4 na fila)'));
  confirmDialog(app, '↩ Trocar de evento', 'TROCAR DE EVENTO');
  assert.deepEqual(app.routes, ['StaffAccess']);
  assert.equal(app.session, null);
  assert.ok(!app.requested.some((name) => /ParticipationContext|httpClient|services/.test(name)));
});

// ---- Correções pós-auditoria (C02–C05) ----

const ACCOUNT_A = { isAuthenticated: true, user: { id: 'conta-a', name: 'Conta A' }, getSessionEpoch: () => 1 };
const ACCOUNT_B = { isAuthenticated: true, user: { id: 'conta-b', name: 'Conta B' }, getSessionEpoch: () => 2 };

async function enterAs(auth, code = 'STAFFDEMO') {
  const app = createStaffApp({ auth });
  app.typeCode(code);
  await app.pressAsync('ENTRAR NO EVENTO');
  assert.equal(app.route, 'StaffPanel');
  return app;
}

test('C02 troca direta da conta A para B descarta a demonstração na mesma renderização', async () => {
  const app = await enterAs(ACCOUNT_A);
  app.press(ENTRY_ACTIVE);
  confirmDialog(app, 'CONFIRMAR ENTRADA', 'CONFIRMAR');
  app.press('↩ Painel');
  app.demo.toggleFailNextAction();
  app.sync();
  assert.equal(app.session.entryQueue.waiting.length, 3, 'A alterou a demonstração');

  app.setAuth(ACCOUNT_B); // sem logout prévio
  assert.equal(app.session, null, 'nada da conta A é exposto para B');
  assert.equal(app.demo.failNextAction, false, 'erro simulado de A também é descartado');
  assert.ok(app.hasText('Nenhum evento selecionado'));
  assert.ok(!app.hasText('BEAST Arena'));

  // B começa do zero: fixture original, sem as alterações de A.
  app.press('IR PARA A ÁREA DO STAFF');
  app.typeCode('STAFFDEMO');
  await app.pressAsync('ENTRAR NO EVENTO');
  assert.equal(app.session.entryQueue.waiting.length, 4);
});

test('C02 mesma conta com nova geração de sessão também descarta o estado', async () => {
  const app = await enterAs(ACCOUNT_A);
  app.setAuth({ ...ACCOUNT_A, getSessionEpoch: () => 9 });
  assert.equal(app.session, null);
});

test('C02 callback antigo disparado após a troca de conta e antes da renderização não altera nada', async () => {
  const app = await enterAs(ACCOUNT_A);
  app.press(ENTRY_ACTIVE);
  app.press('CONFIRMAR ENTRADA');
  const staleConfirm = app.handlerOf('CONFIRMAR');
  app.setAuthWithoutRender(ACCOUNT_B);
  staleConfirm();
  app.sync();
  assert.equal(app.session, null);
  assert.ok(!app.hasText('Entrada de Rafael T. confirmada'));
});

test('C03 painel oferece "Voltar ao aplicativo" e "Trocar de evento"; sair descarta a demonstração', async () => {
  const app = await enterEvent();
  assert.ok(app.hasButton('↩ Trocar de evento'), 'troca de evento preservada');
  assert.ok(app.hasButton('Voltar ao aplicativo'));
  app.press('Voltar ao aplicativo');
  assert.equal(app.exitedToApp, true, 'rota StaffDemo fechada na pilha do app');
  assert.equal(app.session, null, 'estado descartado');
  assert.deepEqual(plain(app.navigationCalls.at(-1)), { type: 'parentBack' });
});

test('C04 dois callbacks seguidos da mesma confirmação consomem só um participante', async () => {
  const app = await enterEvent();
  app.press(ENTRY_ACTIVE);
  app.press('CONFIRMAR ENTRADA');
  assert.ok(app.hasText('Rafael T. será marcado(a) como dentro da Arena.'));
  const confirm = app.handlerOf('CONFIRMAR');
  confirm();
  confirm(); // sem renderização intermediária
  app.sync();
  assert.deepEqual(plain(app.session.entryQueue.waiting.map((item) => item.name)),
    ['Júlia P.', 'Marcos L.', 'Beatriz N.']);
  assert.equal(app.session.entryQueue.insideCount, 74);
  assert.ok(app.hasText('Entrada de Rafael T. confirmada na simulação local.'));
  assert.ok(!app.hasText('já foi processada'));
  assert.ok(app.requested.every((name) => !/services\//.test(name)), 'sem backend');
});

test('C05 com inscrições abertas a ausência continua prometendo o final da fila', async () => {
  const app = await enterEvent();
  app.press(VIRTUAL_REALITY);
  assert.ok(app.hasButton('AUSENTE → FINAL DA FILA'));
  assert.ok(!app.hasButton('AUSENTE (NÃO VOLTA À FILA)'));
  assert.ok(app.hasText('“Ausente” volta ao fim da fila'));
});
