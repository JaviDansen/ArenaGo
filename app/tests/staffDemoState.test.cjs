const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const data = loadModule('data/staffDemoData.js', require).exports;
const state = loadModule('screens/staff/staffDemoState.js', (name) => {
  if (name === '../../data/staffDemoData') return data;
  return require(name);
}).exports;

const session = (code = 'STAFFDEMO') => state.createStaffDemoSession(code);
const station = (current, id) => state.findStation(current, id).station;
const experience = (current, id) => state.findExperience(current, id);
// Os módulos rodam em outro contexto vm; normaliza para comparar estruturas.
const plain = (value) => JSON.parse(JSON.stringify(value));
const names = (list) => plain(list.map((item) => item.name));

test('acesso Staff: código vazio ou só com espaços não avança', () => {
  for (const code of ['', '   ', '\t\r\n', undefined, null, 42]) {
    assert.equal(state.resolveStaffDemoAccess(code).code, 'EMPTY');
  }
});

test('acesso Staff: código conhecido ignora maiúsculas e espaços externos', () => {
  for (const code of ['STAFFDEMO', 'staffdemo', ' StaffDemo \n']) {
    const access = state.resolveStaffDemoAccess(code);
    assert.equal(access.ok, true);
    assert.equal(access.eventCode, 'STAFFDEMO');
  }
  assert.equal(state.resolveStaffDemoAccess('staffvazio').eventCode, 'STAFFVAZIO');
});

test('acesso Staff: código desconhecido ou herdado do protótipo é recusado', () => {
  for (const code of ['FILA', 'XYZ', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const access = state.resolveStaffDemoAccess(code);
    assert.equal(access.ok, false, code);
    assert.equal(access.code, 'NOT_FOUND', code);
  }
  assert.equal(state.createStaffDemoSession('TOSTRING'), null);
  assert.equal(state.createStaffDemoSession('toString'), null);
});

test('acesso Staff: código de erro simulado devolve falha sem sessão', () => {
  const access = state.resolveStaffDemoAccess('stafferro');
  assert.equal(access.ok, false);
  assert.equal(access.code, 'SIMULATED_ERROR');
  assert.match(access.message, /simulada/);
});

test('fixtures são congeladas e cada sessão é uma cópia isolada', () => {
  assert.ok(Object.isFrozen(data.staffDemoEvents.STAFFDEMO.entryQueue.waiting));
  const first = session();
  first.entryQueue.waiting.pop();
  first.experiences[1].queue.length = 0;
  const second = session();
  assert.equal(second.entryQueue.waiting.length, 4);
  assert.equal(second.experiences[1].queue.length, 3);
  assert.equal(data.staffDemoEvents.STAFFDEMO.entryQueue.waiting.length, 4);
});

test('fixture espelha os prints de referência', () => {
  const current = session();
  assert.deepEqual(names(current.entryQueue.waiting), ['Rafael T.', 'Júlia P.', 'Marcos L.', 'Beatriz N.']);
  assert.equal(station(current, 'ps-1').call.name, 'Ana C.');
  assert.deepEqual(names(experience(current, 'playstation').queue), ['Lucas R.']);
  assert.equal(station(current, 'vr-1').call.name, 'Carla M.');
  assert.deepEqual(names(experience(current, 'virtual-reality').queue), ['Maria A.', 'Pedro M.', 'Tiago V.']);
  const counters = current.experiences.map((item) => {
    const summary = state.getExperienceSummary(item);
    return [item.name, summary.pendingCalls, summary.queueSize];
  });
  assert.deepEqual(plain(counters), [
    ['PlayStation', 1, 1], ['Realidade Virtual', 1, 3], ['Simulador de Corrida', 1, 1],
  ]);
});

test('confirmar entrada atende o primeiro da fila sem alterar o estado anterior', () => {
  const before = session();
  const snapshot = JSON.stringify(before);
  const { state: after, result } = state.confirmEntry(before, before.entryQueue.waiting[0].entryId);
  assert.equal(result.ok, true);
  assert.equal(result.participant.name, 'Rafael T.');
  assert.match(result.message, /simulação/);
  assert.deepEqual(names(after.entryQueue.waiting), ['Júlia P.', 'Marcos L.', 'Beatriz N.']);
  assert.equal(after.entryQueue.insideCount, before.entryQueue.insideCount + 1);
  assert.equal(JSON.stringify(before), snapshot);
});

test('confirmar entrada falha com fila vazia ou inativa', () => {
  let current = session();
  for (let i = 0; i < 4; i++) current = state.confirmEntry(current, current.entryQueue.waiting[0].entryId).state;
  assert.equal(state.confirmEntry(current, 'qualquer').result.code, 'QUEUE_EMPTY');
  assert.equal(state.confirmEntry(session('STAFFVAZIO'), 'qualquer').result.code, 'QUEUE_INACTIVE');
});

test('confirmar entrada vale só para o participante exibido e repetir não consome o seguinte', () => {
  const before = session();
  const shown = before.entryQueue.waiting[0].entryId;
  const first = state.confirmEntry(before, shown);
  assert.equal(first.result.ok, true);
  const repeated = state.confirmEntry(first.state, shown);
  assert.equal(repeated.result.ok, false);
  assert.equal(repeated.result.code, 'ENTRY_NOT_NEXT');
  assert.equal(repeated.state, first.state, 'estado intacto');
  assert.deepEqual(names(first.state.entryQueue.waiting), ['Júlia P.', 'Marcos L.', 'Beatriz N.']);
  for (const id of [undefined, null, '', before.entryQueue.waiting[1].entryId]) {
    assert.equal(state.confirmEntry(before, id).result.code, 'ENTRY_NOT_NEXT', String(id));
  }
});

test('desativar fila libera todos e reativar não recoloca ninguém', () => {
  const { state: disabled, result } = state.disableEntryQueue(session());
  assert.equal(result.released, 4);
  assert.equal(disabled.entryQueue.active, false);
  assert.deepEqual(plain(disabled.entryQueue.waiting), []);
  assert.equal(disabled.entryQueue.insideCount, 77);
  assert.equal(state.disableEntryQueue(disabled).result.code, 'QUEUE_INACTIVE');

  const { state: reactivated } = state.reactivateEntryQueue(disabled);
  assert.equal(reactivated.entryQueue.active, true);
  assert.deepEqual(plain(reactivated.entryQueue.waiting), []);
  assert.equal(state.reactivateEntryQueue(reactivated).result.code, 'QUEUE_ACTIVE');
});

test('chamada segue a fila FIFO única da experiência entre estações', () => {
  let current = session();
  const vr2 = state.callNext(current, 'vr-2');
  assert.equal(vr2.result.ok, true);
  current = vr2.state;
  assert.equal(station(current, 'vr-2').call.name, 'Maria A.');
  assert.deepEqual(names(experience(current, 'virtual-reality').queue), ['Pedro M.', 'Tiago V.']);

  // vr-1 tem chamado pendente e precisa resolvê-lo antes de chamar.
  assert.equal(state.callNext(current, 'vr-1').result.code, 'CALL_PENDING');
  current = state.completeCall(current, 'vr-1').state;
  current = state.callNext(current, 'vr-1').state;
  assert.equal(station(current, 'vr-1').call.name, 'Pedro M.');
  assert.notEqual(station(current, 'vr-1').call.participantId, station(current, 'vr-2').call.participantId);
});

test('estação indisponível, fila vazia e estação inexistente não chamam', () => {
  const current = session();
  assert.equal(state.callNext(current, 'ps-2').result.code, 'STATION_UNAVAILABLE');
  assert.equal(state.callNext(current, 'nao-existe').result.code, 'STATION_NOT_FOUND');
  assert.equal(state.getCallBlocker(current, 'vr-2'), null);
  assert.equal(state.callNext(session('STAFFVAZIO'), 'sim-1').result.code, 'QUEUE_EMPTY');
});

test('concluir libera a estação, conta conclusão e não mexe na fila', () => {
  const before = session();
  const { state: after, result } = state.completeCall(before, 'ps-1');
  assert.equal(result.participant.name, 'Ana C.');
  assert.equal(station(after, 'ps-1').call, null);
  assert.equal(experience(after, 'playstation').completedCount, 1);
  assert.deepEqual(plain(experience(after, 'playstation').queue), plain(experience(before, 'playstation').queue));
  assert.equal(state.completeCall(after, 'ps-1').result.code, 'NO_CALL');
});

test('ausência volta ao final da fila enquanto inscrições estão abertas e não conta conclusão', () => {
  const { state: after, result } = state.markAbsent(session(), 'vr-1');
  assert.equal(result.requeued, true);
  assert.equal(station(after, 'vr-1').call, null);
  const queue = experience(after, 'virtual-reality').queue;
  assert.deepEqual(names(queue), ['Maria A.', 'Pedro M.', 'Tiago V.', 'Carla M.']);
  assert.equal(queue[3].participantId, 'demo-p-20');
  assert.notEqual(queue[3].entryId, 'demo-q-vr-0', 'ausência cria nova entrada');
  assert.equal(experience(after, 'virtual-reality').completedCount, 0);
});

test('ausência após o corte de inscrições não devolve à fila', () => {
  const { state: after, result } = state.markAbsent(session('STAFFVAZIO'), 'ps-1');
  assert.equal(result.ok, true);
  assert.equal(result.requeued, false);
  assert.deepEqual(plain(experience(after, 'playstation').queue), []);
  assert.match(result.message, /não volta/);
});

test('ausência sem chamado pendente é recusada', () => {
  assert.equal(state.markAbsent(session(), 'vr-2').result.code, 'NO_CALL');
});

test('resumo da experiência conta fila, chamados e estações disponíveis', () => {
  const summary = state.getExperienceSummary(experience(session(), 'playstation'));
  assert.deepEqual(plain(summary), { queueSize: 1, pendingCalls: 1, availableStations: 1, totalStations: 2 });
});

test('código Staff não usa ParticipationContext nem clientes HTTP', () => {
  const appDirectory = path.resolve(__dirname, '..');
  const files = [];
  (function walk(directory) {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) files.push(full);
    }
  })(path.join(appDirectory, 'screens', 'staff'));
  files.push(path.join(appDirectory, 'data', 'staffDemoData.js'));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const forbidden of [/from '[^']*ParticipationContext'/, /from '[^']*services\//,
      /httpClient/, /\bfetch\(/, /tokenStorage/]) {
      assert.doesNotMatch(source, forbidden, `${path.basename(file)} contém ${forbidden}`);
    }
  }
});
