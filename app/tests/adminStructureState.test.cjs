// ADM02 — regras locais de experiências, estações, Staff e prontidão (C-05,
// C-13, C-14, §16.7, §18, §20). Funções puras, sem servidor.
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

const plain = (value) => JSON.parse(JSON.stringify(value));
const session = () => state.createAdminDemoSession();
const event = (current, code) => current.events.find((item) => item.accessCode === code);
const idOf = (current, code) => event(current, code).id;
const describe = (current, code) => state.describeEvent(event(current, code), current.clockNow, current);
const readiness = (current, code) => state.getReadiness(event(current, code), current);
const expId = (current, code, name) =>
  state.listExperiences(current, idOf(current, code)).find((item) => item.name === name).id;

const XP = 'demo-admin-arena-xp';
const D1 = 'demo-admin-beast-d1';
const D2 = 'demo-admin-beast-d2';
const KIDS = 'demo-admin-kids';
const NOTURNA = 'demo-admin-noturna';
const SUMMER = 'demo-admin-summer';
const XP_DANCE = 'demo-admin-exp-xp-dance';
const XP_CORRIDA = 'demo-admin-exp-xp-corrida';
const XP_VR = 'demo-admin-exp-xp-vr';
const D1_LUTA = 'demo-admin-exp-d1-luta';
const XP_DANCE_1 = 'demo-admin-station-xp-dance-1';
const XP_DANCE_2 = 'demo-admin-station-xp-dance-2';
const XP_CORRIDA_A = 'demo-admin-station-xp-corrida-a';

function apply(current, transition, ...args) {
  const outcome = state[transition](current, ...args);
  assert.equal(outcome.result.ok, true, `${transition}: ${outcome.result.code} ${outcome.result.message}`);
  return outcome.state;
}

function rejected(current, transition, args, code) {
  const outcome = state[transition](current, ...args);
  assert.equal(outcome.result.ok, false, `${transition} deveria falhar`);
  assert.equal(outcome.result.code, code, outcome.result.message);
  assert.equal(outcome.state, current, 'estado intacto (mesmo objeto)');
  return outcome.result;
}

// Evento cujo marco C-13 foi alcançado de outra forma (fixture construída).
function withHistory(current, eventId, patch) {
  return { ...current, events: current.events.map((item) => (item.id === eventId ? { ...item, ...patch } : item)) };
}

function newEventDraft() {
  return {
    name: 'Arena Teste',
    accessCode: 'NOVO-01',
    timezone: 'America/Sao_Paulo',
    startDate: '10/11/2026',
    startTime: '10:00',
    officialEndDate: '10/11/2026',
    officialEndTime: '18:00',
    operationalDeadlineDate: '10/11/2026',
    operationalDeadlineTime: '18:30',
    externalQueueEnabled: true,
    reason: 'Cadastro e preparação do evento',
  };
}

// ─── C-05: prontidão derivada das entidades ──────────────────────────────

test('C-05: prontidão é calculada das estruturas cadastradas, sem resumo gravado no evento', () => {
  const current = session();
  for (const item of current.events) {
    assert.ok(!('readiness' in item), `${item.accessCode}: sem campo de prontidão gravado`);
    assert.ok(!('isReady' in item), `${item.accessCode}: sem isReady`);
  }
  assert.equal(readiness(current, 'ARENA-XP').ready, true);
  assert.equal(readiness(current, 'BEAST-D1').ready, true);
  assert.deepEqual(plain(readiness(current, 'KIDS-01').missing), ['EXPERIENCE_WITH_AVAILABLE_STATION']);
  assert.deepEqual(plain(readiness(current, 'BEAST-D2').missing), ['VERIFIED_ACTIVE_STAFF']);
  assert.deepEqual(plain(readiness(current, 'ARENA-XP').structure), {
    experiences: 3, stations: 5, availableStations: 4, experiencesWithAvailableStation: 3, currentGrants: 2, validStaff: 2,
  });

  // Um resumo forjado no evento é ignorado: só as entidades contam.
  const forged = withHistory(current, D2, {
    readiness: { experiencesWithAvailableStation: 9, verifiedActiveStaff: 9 },
    isReady: true,
  });
  assert.equal(readiness(forged, 'BEAST-D2').ready, false);
  // Sem a sessão não há estrutura: os critérios estruturais ficam pendentes.
  assert.deepEqual(plain(state.getReadiness(event(current, 'ARENA-XP')).missing),
    ['EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF']);
});

test('critério 1: evento novo → experiência → estação disponível → só fica pronto com Staff apto', () => {
  let current = apply(session(), 'createEvent', newEventDraft());
  const id = idOf(current, 'NOVO-01');
  assert.deepEqual(plain(state.listExperiences(current, id)), [], 'nasce sem experiências');
  assert.deepEqual(plain(state.listCurrentStaffGrants(current, id)), [], 'nasce sem Staff');
  assert.deepEqual(plain(readiness(current, 'NOVO-01').missing), ['EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF']);

  current = apply(current, 'createExperience', id, { name: '  Just Dance  ' });
  const [experience] = state.listExperiences(current, id);
  assert.equal(experience.name, 'Just Dance', 'nome aparado');
  assert.deepEqual(plain(experience.queue), { waiting: 0 }, 'fila única começa vazia');
  assert.deepEqual(plain(readiness(current, 'NOVO-01').missing), ['EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF'],
    'experiência sem estação não conta');

  current = apply(current, 'addStation', id, experience.id, { label: 'Estação 1' });
  const [station] = state.listStations(current, experience.id);
  assert.equal(station.availability, 'available', 'estação nasce disponível');
  assert.deepEqual(plain(readiness(current, 'NOVO-01').missing), ['VERIFIED_ACTIVE_STAFF'], 'ainda falta Staff apto');
  assert.equal(describe(current, 'NOVO-01').phase, 'scheduled');

  current = apply(current, 'grantStaff', id, { email: 'diego.rocha@arenago.example' });
  assert.equal(readiness(current, 'NOVO-01').ready, true);
  assert.equal(describe(current, 'NOVO-01').phase, 'scheduled', 'pronto, mas antes do início');

  // No início (10/11 13:00 UTC = 05/11 12:00 + 5 dias e 1 h) abre sozinho.
  const opened = apply(current, 'advanceClock', 5 * 24 * 60 + 60);
  const info = describe(opened, 'NOVO-01');
  assert.equal(info.phase, 'open');
  assert.equal(info.acceptingNewParticipations, true);
  assert.equal(info.openedAt, '2026-11-10T13:00:00.000Z');
  assert.equal(event(opened, 'NOVO-01').statusStored, 'scheduled', 'sem botão "Abrir"; status armazenado intacto');
});

test('critério 2: conta inativa ou sem e-mail verificado não satisfaz a prontidão', () => {
  const current = session();
  rejected(current, 'grantStaff', [D2, { email: 'elisa.martins@arenago.example' }], 'EMAIL_NOT_VERIFIED');
  rejected(current, 'grantStaff', [D2, { email: 'fabio.nunes@arenago.example' }], 'ACCOUNT_INACTIVE');
  rejected(current, 'grantStaff', [D2, { email: 'gabriela.alves@arenago.example' }], 'ACCOUNT_INACTIVE');
  rejected(current, 'grantStaff', [D2, { email: 'nova.pessoa@arenago.example' }], 'ACCOUNT_NOT_FOUND');
  rejected(current, 'grantStaff', [D2, { email: '   ' }], 'VALIDATION_ERROR');
  assert.equal(current.accounts.length, 8, 'nenhuma conta foi criada');

  // KIDS-01 tem vínculo vigente de conta inativa (fábio): não conta.
  const kids = state.getEventStaff(current, KIDS);
  assert.deepEqual(plain(kids.map((item) => [item.email, item.apt, item.issue])), [
    ['bruno.costa@arenago.example', true, null],
    ['fabio.nunes@arenago.example', false, 'Conta inativa'],
  ]);
  const brunoGrant = kids.find((item) => item.apt).grant.id;
  const withoutBruno = apply(current, 'revokeStaff', KIDS, { grantId: brunoGrant });
  assert.equal(state.listCurrentStaffGrants(withoutBruno, KIDS).length, 1, 'vínculo do fábio segue vigente');
  assert.equal(readiness(withoutBruno, 'KIDS-01').checks.VERIFIED_ACTIVE_STAFF, false);

  // Vínculo de conta não verificada (fixture construída) também não conta.
  const unverified = {
    ...current,
    staffGrants: [...current.staffGrants, {
      id: 'grant-teste-elisa', eventId: D2, accountId: 'demo-admin-account-elisa', grantedAt: current.clockNow, revokedAt: null,
    }],
  };
  assert.equal(state.listCurrentStaffGrants(unverified, D2).length, 1);
  assert.deepEqual(plain(readiness(unverified, 'BEAST-D2').missing), ['VERIFIED_ACTIVE_STAFF']);
});

test('critério 3: Staff de um evento não satisfaz a prontidão de outro', () => {
  let current = session();
  // diego é Staff da Copa Noturna e carla do BEAST-D1, mas não do BEAST-D2.
  assert.equal(readiness(current, 'NOTURNA').checks.VERIFIED_ACTIVE_STAFF, true);
  assert.equal(readiness(current, 'BEAST-D1').checks.VERIFIED_ACTIVE_STAFF, true);
  assert.equal(readiness(current, 'BEAST-D2').checks.VERIFIED_ACTIVE_STAFF, false);

  current = apply(current, 'grantStaff', D2, { email: ' DIEGO.Rocha@arenago.example ' });
  assert.equal(readiness(current, 'BEAST-D2').ready, true, 'concessão no próprio evento');
  const d2Grant = state.listCurrentStaffGrants(current, D2)[0];
  assert.equal(d2Grant.eventId, D2);

  current = apply(current, 'revokeStaff', D2, { grantId: d2Grant.id });
  assert.equal(readiness(current, 'BEAST-D2').ready, false);
  assert.equal(readiness(current, 'NOTURNA').checks.VERIFIED_ACTIVE_STAFF, true, 'vínculo do outro evento intacto');
  assert.equal(state.listCurrentStaffGrants(current, NOTURNA).length, 1);
});

test('critério 4: a primeira participação histórica trava criação e nomes, mesmo já finalizada ou cancelada', () => {
  const current = session();
  // ARENA-XP já tem participações: criar e renomear bloqueados.
  rejected(current, 'createExperience', [XP, { name: 'Nova' }], 'EVENT_CONFIGURATION_LOCKED');
  rejected(current, 'renameExperience', [XP, XP_DANCE, { name: 'Dance 2' }], 'EVENT_CONFIGURATION_LOCKED');
  rejected(current, 'renameStation', [XP, XP_DANCE, XP_DANCE_2, { label: 'Palco' }], 'EVENT_CONFIGURATION_LOCKED');

  // BEAST-D1 ainda sem participação: as mesmas operações são permitidas.
  assert.equal(state.createExperience(current, D1, { name: 'Nova' }).result.ok, true);
  assert.equal(state.renameExperience(current, D1, D1_LUTA, { name: 'Luta Livre' }).result.ok, true);

  const variants = {
    'participação já finalizada': { participants: { externalWaiting: 0, active: 0, finished: 1 }, firstParticipationAt: '2026-11-05T11:00:00.000Z' },
    'participação cancelada (contadores zerados)': { firstParticipationAt: '2026-11-05T11:00:00.000Z' },
    'apenas espera externa': { participants: { externalWaiting: 1, active: 0, finished: 0 } },
  };
  for (const [label, patch] of Object.entries(variants)) {
    const locked = withHistory(current, D1, patch);
    rejected(locked, 'createExperience', [D1, { name: 'Nova' }], 'EVENT_CONFIGURATION_LOCKED');
    rejected(locked, 'renameExperience', [D1, D1_LUTA, { name: 'Luta Livre' }], 'EVENT_CONFIGURATION_LOCKED');
    rejected(locked, 'renameStation', [D1, D1_LUTA, 'demo-admin-station-d1-ringue-1', { label: 'Ringue A' }], 'EVENT_CONFIGURATION_LOCKED');
    assert.equal(state.addStation(locked, D1, D1_LUTA, { label: 'Ringue 2' }).result.ok, true, `${label}: adicionar estação continua`);
    assert.equal(state.getStructureRules(locked, event(locked, 'BEAST-D1')).history, true, label);
  }
});

test('critério 5: adicionar estação à experiência existente continua possível durante a operação', () => {
  let current = session();
  const queueBefore = plain(state.findExperience(current, XP, XP_DANCE).queue);
  current = apply(current, 'addStation', XP, XP_DANCE, { label: 'Estação 3' });
  const added = state.listStations(current, XP_DANCE).find((item) => item.label === 'Estação 3');
  assert.ok(added, 'estação criada mesmo com histórico');
  assert.equal(added.experienceId, XP_DANCE);
  assert.equal(added.availability, 'available');
  assert.deepEqual(plain(state.findExperience(current, XP, XP_DANCE).queue), queueBefore, 'fila e contadores não reiniciam');
  assert.deepEqual(plain(event(current, 'ARENA-XP').participants), { externalWaiting: 6, active: 18, finished: 41 });

  // Na janela residual (closing) também é permitido; encerrado, não.
  assert.equal(describe(current, 'NOTURNA').phase, 'closing');
  assert.equal(state.addStation(current, NOTURNA, 'demo-admin-exp-noturna-fliper', { label: 'Máquina 2' }).result.ok, true);
  rejected(current, 'addStation', [SUMMER, 'demo-admin-exp-summer-dance', { label: 'Estação 3' }], 'EVENT_OPERATION_ENDED');
  rejected(current, 'createExperience', [SUMMER, { name: 'Nova' }], 'EVENT_OPERATION_ENDED');
});

test('critério 6: várias estações compartilham a mesma experiência e a mesma fila', () => {
  let current = session();
  current = apply(current, 'addStation', XP, XP_DANCE, { label: 'Estação 3' });
  current = apply(current, 'addStation', XP, XP_DANCE, { label: 'Estação 4' });
  const stations = state.listStations(current, XP_DANCE);
  assert.equal(stations.length, 4);
  assert.ok(stations.every((item) => item.experienceId === XP_DANCE));
  assert.ok(stations.every((item) => !('queue' in item) && !('queueId' in item)), 'estação não tem fila própria');
  assert.equal(state.listExperiences(current, XP).length, 3, 'nenhuma fila/experiência nova');
  const view = state.describeExperience(current, event(current, 'ARENA-XP'), state.findExperience(current, XP, XP_DANCE));
  assert.equal(view.stationsTotal, 4);
  assert.equal(view.queueWaiting, 5, 'uma fila só, atendida por todas');
  assert.equal(view.stationsOccupied, 1, 'ocupação vem da chamada pendente, não da estação');
  assert.ok(!stations.some((item) => 'staffId' in item || 'staff' in item), 'sem Staff fixo na estação');
});

test('critério 7: IDs de outro evento ou de outra experiência são rejeitados sem mutação', () => {
  const current = session();
  rejected(current, 'renameExperience', [XP, D1_LUTA, { name: 'Invasão' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'addStation', [D1, XP_DANCE, { label: 'Invasão' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'renameStation', [D1, D1_LUTA, XP_DANCE_2, { label: 'Invasão' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'renameStation', [XP, XP_CORRIDA, XP_DANCE_2, { label: 'Invasão' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'setStationAvailability', [D1, XP_DANCE, XP_DANCE_2, { availability: 'unavailable' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'setStationAvailability', [XP, XP_VR, XP_DANCE_2, { availability: 'unavailable' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'revokeStaff', [D1, { grantId: 'demo-admin-grant-xp-ana' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'createExperience', ['evento-inexistente', { name: 'X' }], 'RESOURCE_NOT_FOUND');
  rejected(current, 'grantStaff', ['__proto__', { email: 'diego.rocha@arenago.example' }], 'RESOURCE_NOT_FOUND');
  assert.equal(state.findExperience(current, D1, XP_DANCE), null);
  assert.equal(state.findStation(current, XP, XP_VR, XP_DANCE_1), null);

  // Entradas herdadas do protótipo não valem (somente propriedades próprias).
  rejected(current, 'createExperience', [D1, Object.create({ name: 'Herdado' })], 'VALIDATION_ERROR');
  rejected(current, 'addStation', [D1, D1_LUTA, Object.create({ label: 'Herdado' })], 'VALIDATION_ERROR');
  rejected(current, 'setStationAvailability', [XP, XP_DANCE, XP_DANCE_2, Object.create({ availability: 'unavailable' })], 'VALIDATION_ERROR');
  rejected(current, 'grantStaff', [D2, Object.create({ email: 'diego.rocha@arenago.example' })], 'VALIDATION_ERROR');
  rejected(current, 'revokeStaff', [XP, Object.create({ grantId: 'demo-admin-grant-xp-ana' })], 'RESOURCE_NOT_FOUND');
});

test('critério 8: estação com chamada pendente não pode ser desativada', () => {
  const current = session();
  assert.ok(state.getPendingCall(current, XP_DANCE_1), 'fixture com chamada pendente');
  const result = rejected(current, 'setStationAvailability', [XP, XP_DANCE, XP_DANCE_1, { availability: 'unavailable' }],
    'STATION_HAS_PENDING_CALL');
  assert.match(result.message, /chamada pendente/);
  assert.equal(state.findStation(current, XP, XP_DANCE, XP_DANCE_1).availability, 'available');

  // A outra estação da mesma experiência, livre, pode ser desativada.
  const next = apply(current, 'setStationAvailability', XP, XP_DANCE, XP_DANCE_2, { availability: 'unavailable' });
  assert.equal(state.findStation(next, XP, XP_DANCE, XP_DANCE_2).availability, 'unavailable');
  assert.ok(state.getPendingCall(next, XP_DANCE_1), 'chamada preservada');
  const view = state.describeExperience(next, event(next, 'ARENA-XP'), state.findExperience(next, XP, XP_DANCE));
  assert.equal(view.acceptingNewEntries, true, 'estação disponível ocupada ainda conta como capacidade');
});

test('critério 9: revogar o último Staff ou desativar a última estação não encerra nem apaga participações', () => {
  let current = session();
  const before = plain(event(current, 'ARENA-XP'));
  current = apply(current, 'revokeStaff', XP, { grantId: 'demo-admin-grant-xp-ana' });
  const last = state.revokeStaff(current, XP, { grantId: 'demo-admin-grant-xp-bruno' });
  assert.equal(last.result.ok, true, 'revogar o último Staff é permitido');
  assert.match(last.result.message, /continua aberto/);
  current = last.state;

  const info = describe(current, 'ARENA-XP');
  assert.equal(info.phase, 'open', 'não regride para scheduled');
  assert.equal(info.statusStored, 'open');
  assert.equal(info.acceptingNewParticipations, false);
  assert.equal(info.capacitySuspended, true);
  assert.deepEqual(plain(state.getCapacityGaps(info.readiness)), ['sem Staff apto no evento']);
  const after = event(current, 'ARENA-XP');
  assert.deepEqual(plain(after.participants), before.participants, 'participações preservadas');
  assert.equal(after.closureMode, null, 'nenhum encerramento');
  assert.equal(state.listExperiences(current, XP).length, 3);
  assert.ok(state.getPendingCall(current, XP_DANCE_1), 'chamada pendente não é resolvida por falta de Staff');
  assert.ok(state.findExperience(current, XP, XP_DANCE).queue.waiting === 5, 'ninguém perde a vez');

  // Evento aberto durante a demonstração perde a última estação: segue aberto.
  let d1 = apply(session(), 'advanceClock', 60);
  assert.equal(describe(d1, 'BEAST-D1').phase, 'open');
  for (const [experienceId, stationId] of [[D1_LUTA, 'demo-admin-station-d1-ringue-1'],
    ['demo-admin-exp-d1-corrida', 'demo-admin-station-d1-sim-1'], ['demo-admin-exp-d1-corrida', 'demo-admin-station-d1-sim-2']]) {
    d1 = apply(d1, 'setStationAvailability', D1, experienceId, stationId, { availability: 'unavailable' });
  }
  const d1Info = describe(d1, 'BEAST-D1');
  assert.equal(d1Info.phase, 'open');
  assert.equal(d1Info.acceptingNewParticipations, false);
  assert.deepEqual(plain(state.getCapacityGaps(d1Info.readiness)), ['nenhuma estação disponível no evento']);
  assert.equal(event(d1, 'BEAST-D1').statusStored, 'scheduled', 'status armazenado não é reescrito');
});

test('critério 10: a capacidade volta só antes do corte e nunca reabre evento encerrado', () => {
  let current = session();
  current = apply(current, 'revokeStaff', XP, { grantId: 'demo-admin-grant-xp-ana' });
  current = apply(current, 'revokeStaff', XP, { grantId: 'demo-admin-grant-xp-bruno' });
  assert.equal(describe(current, 'ARENA-XP').acceptingNewParticipations, false);
  current = apply(current, 'grantStaff', XP, { email: 'ana.lima@arenago.example' });
  assert.equal(describe(current, 'ARENA-XP').acceptingNewParticipations, true, 'recupera antes do corte, sem botão de abrir');

  // Depois do corte oficial (20:00 UTC): conceder Staff não reabre entradas.
  let late = apply(current, 'revokeStaff', XP, { grantId: state.listCurrentStaffGrants(current, XP)[0].id });
  late = apply(late, 'advanceClock', 8 * 60);
  assert.equal(describe(late, 'ARENA-XP').phase, 'closing');
  late = apply(late, 'grantStaff', XP, { email: 'bruno.costa@arenago.example' });
  assert.equal(describe(late, 'ARENA-XP').acceptingNewParticipations, false, 'corte oficial prevalece');
  assert.equal(describe(late, 'ARENA-XP').phase, 'closing');

  // Depois do limite operacional (21:00 UTC): encerrado, nenhuma operação muda isso.
  late = apply(late, 'advanceClock', 60);
  assert.equal(describe(late, 'ARENA-XP').phase, 'closed');
  rejected(late, 'grantStaff', [XP, { email: 'diego.rocha@arenago.example' }], 'EVENT_OPERATION_ENDED');
  rejected(late, 'setStationAvailability', [XP, XP_CORRIDA, 'demo-admin-station-xp-corrida-b', { availability: 'available' }],
    'EVENT_OPERATION_ENDED');
  rejected(late, 'addStation', [XP, XP_DANCE, { label: 'Estação 9' }], 'EVENT_OPERATION_ENDED');
  assert.equal(describe(late, 'ARENA-XP').phase, 'closed');

  // Fase "closing" por horário oficial: restaurar recursos não reabre.
  let noturna = session();
  noturna = apply(noturna, 'grantStaff', NOTURNA, { email: 'heitor.ramos@arenago.example' });
  assert.equal(describe(noturna, 'NOTURNA').phase, 'closing');
  assert.equal(describe(noturna, 'NOTURNA').acceptingNewParticipations, false);

  // Encerramento administrativo: idem.
  let closing = apply(session(), 'closeEvent', XP, { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte' });
  closing = apply(closing, 'grantStaff', XP, { email: 'diego.rocha@arenago.example' });
  assert.equal(describe(closing, 'ARENA-XP').acceptingNewParticipations, false);
  closing = apply(closing, 'resetClock');
  assert.equal(describe(closing, 'ARENA-XP').phase, 'closing', 'F05 preservado');
});

test('C-14 por experiência: sem estação disponível só aquela fila suspende novas entradas', () => {
  let current = session();
  current = apply(current, 'setStationAvailability', XP, XP_CORRIDA, XP_CORRIDA_A, { availability: 'unavailable' });
  const xp = event(current, 'ARENA-XP');
  const corrida = state.describeExperience(current, xp, state.findExperience(current, XP, XP_CORRIDA));
  assert.equal(corrida.acceptingNewEntries, false);
  assert.match(corrida.entriesBlockedReason, /nenhuma estação desta experiência/);
  assert.equal(corrida.queueWaiting, 3, 'quem já aguarda continua na fila');
  for (const experienceId of [XP_DANCE, XP_VR]) {
    assert.equal(state.describeExperience(current, xp, state.findExperience(current, XP, experienceId)).acceptingNewEntries, true);
  }
  assert.equal(describe(current, 'ARENA-XP').acceptingNewParticipations, true, 'o evento segue aceitando');

  current = apply(current, 'setStationAvailability', XP, XP_CORRIDA, XP_CORRIDA_A, { availability: 'available' });
  assert.equal(state.describeExperience(current, event(current, 'ARENA-XP'),
    state.findExperience(current, XP, XP_CORRIDA)).acceptingNewEntries, true, 'recupera antes do corte');
});

test('C-05: configuração completada depois do início abre o evento sozinha, antes do corte', () => {
  let current = session();
  assert.equal(describe(current, 'KIDS-01').waitingReadiness, true);
  current = apply(current, 'setStationAvailability', KIDS, 'demo-admin-exp-kids-pintura', 'demo-admin-station-kids-mesa-1',
    { availability: 'available' });
  const info = describe(current, 'KIDS-01');
  assert.equal(info.phase, 'open');
  assert.equal(info.acceptingNewParticipations, true);
  assert.equal(info.openedAt, current.clockNow, 'abertura registrada no instante da configuração');

  // Perder a estação de novo não volta para "scheduled".
  current = apply(current, 'setStationAvailability', KIDS, 'demo-admin-exp-kids-pintura', 'demo-admin-station-kids-mesa-1',
    { availability: 'unavailable' });
  assert.equal(describe(current, 'KIDS-01').phase, 'open');
  assert.equal(describe(current, 'KIDS-01').capacitySuspended, true);
  assert.equal(apply(current, 'resetClock').events.find((item) => item.id === KIDS).openedAt, current.clockNow,
    'abertura no instante inicial continua registrada');
});

test('relógio: reiniciar desfaz só a abertura automática posterior; a regra C-14 vale na nova linha do tempo', () => {
  let current = apply(session(), 'advanceClock', 60);
  assert.equal(event(current, 'BEAST-D1').openedAt, '2026-11-05T13:00:00.000Z', 'abriu no início');
  current = apply(current, 'revokeStaff', D1, { grantId: 'demo-admin-grant-d1-carla' });
  assert.equal(describe(current, 'BEAST-D1').phase, 'open', 'continua aberto sem Staff');

  current = apply(current, 'resetClock');
  assert.equal(event(current, 'BEAST-D1').openedAt, null);
  assert.equal(describe(current, 'BEAST-D1').phase, 'scheduled', 'antes do início');
  current = apply(current, 'advanceClock', 60);
  const info = describe(current, 'BEAST-D1');
  assert.equal(info.phase, 'scheduled', 'sem Staff, não abre de novo');
  assert.equal(info.waitingReadiness, true);
});

test('validações: nomes e identificações aparados, obrigatórios, sem controle e com limite', () => {
  const current = session();
  for (const name of ['', '   ', 'x'.repeat(161), 'Linha\nquebrada', 42, null]) {
    rejected(current, 'createExperience', [D1, { name }], 'VALIDATION_ERROR');
    rejected(current, 'renameExperience', [D1, D1_LUTA, { name }], 'VALIDATION_ERROR');
  }
  for (const label of ['', 'x'.repeat(121), 'Tab\there']) {
    rejected(current, 'addStation', [D1, D1_LUTA, { label }], 'VALIDATION_ERROR');
  }
  assert.equal(state.createExperience(current, D1, { name: 'x'.repeat(160) }).result.ok, true, 'limite exato');
  assert.equal(state.addStation(current, D1, D1_LUTA, { label: 'y'.repeat(120) }).result.ok, true);
  rejected(current, 'renameExperience', [D1, D1_LUTA, { name: ' Arena de Luta ' }], 'NO_CHANGE');
  rejected(current, 'renameStation', [D1, D1_LUTA, 'demo-admin-station-d1-ringue-1', { label: 'Ringue 1' }], 'NO_CHANGE');
  rejected(current, 'setStationAvailability', [XP, XP_DANCE, XP_DANCE_2, { availability: 'available' }], 'NO_CHANGE');
  rejected(current, 'setStationAvailability', [XP, XP_DANCE, XP_DANCE_2, { availability: 'off' }], 'VALIDATION_ERROR');
  rejected(current, 'grantStaff', [XP, { email: 'ana.lima@arenago.example' }], 'STAFF_ALREADY_GRANTED');
  const revoked = apply(current, 'revokeStaff', XP, { grantId: 'demo-admin-grant-xp-ana' });
  rejected(revoked, 'revokeStaff', [XP, { grantId: 'demo-admin-grant-xp-ana' }], 'NO_CHANGE');
  const grant = revoked.staffGrants.find((item) => item.id === 'demo-admin-grant-xp-ana');
  assert.equal(grant.revokedAt, revoked.clockNow, 'revogar registra o instante, não apaga');
});

test('renomear preserva IDs e vínculos; registro local guarda antes/depois sem justificativa obrigatória', () => {
  let current = session();
  current = apply(current, 'renameExperience', D1, D1_LUTA, { name: 'Luta Livre' });
  current = apply(current, 'renameStation', D1, D1_LUTA, 'demo-admin-station-d1-ringue-1', { label: 'Ringue A' });
  const experience = state.findExperience(current, D1, D1_LUTA);
  assert.equal(experience.name, 'Luta Livre');
  assert.equal(experience.eventId, D1);
  const station = state.findStation(current, D1, D1_LUTA, 'demo-admin-station-d1-ringue-1');
  assert.equal(station.label, 'Ringue A');
  assert.equal(station.experienceId, D1_LUTA);
  const audit = event(current, 'BEAST-D1').audit;
  assert.deepEqual(plain(audit.map((entry) => [entry.action, entry.detail])), [
    ['EXPERIENCE_RENAME', 'Arena de Luta → Luta Livre'],
    ['STATION_RENAME', 'Ringue 1 → Ringue A'],
  ]);
  assert.deepEqual(plain(audit[0].before), { name: 'Arena de Luta' });
  assert.deepEqual(plain(audit[0].after), { name: 'Luta Livre' });
});

test('transições puras: estado anterior e fixtures congeladas permanecem intactos', () => {
  const current = session();
  const snapshot = JSON.stringify(current);
  apply(current, 'createExperience', D1, { name: 'Nova' });
  apply(current, 'addStation', XP, XP_DANCE, { label: 'Estação 3' });
  apply(current, 'setStationAvailability', XP, XP_DANCE, XP_DANCE_2, { availability: 'unavailable' });
  apply(current, 'grantStaff', D2, { email: 'diego.rocha@arenago.example' });
  apply(current, 'revokeStaff', XP, { grantId: 'demo-admin-grant-xp-ana' });
  assert.equal(JSON.stringify(current), snapshot, 'nenhuma mutação no estado recebido');
  assert.equal(data.adminDemoStations.length, 19);
  assert.equal(data.adminDemoStaffGrants.filter((grant) => grant.revokedAt === null).length, 9);
  assert.ok(Object.isFrozen(data.adminDemoExperiences[0]));
  assert.deepEqual(plain(data.adminExperienceNameSuggestions.slice(0, 1)), ['Just Dance']);
  assert.equal(expId(current, 'BEAST-D2', 'Just Dance'), 'demo-admin-exp-d2-dance', 'mesmo nome em outro evento é outra experiência');
});
