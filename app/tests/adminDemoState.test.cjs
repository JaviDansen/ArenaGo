// Regras locais da Área Admin (ADM01). Funções puras, sem servidor.
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
const phaseOf = (current, code) => state.getEffectivePhase(event(current, code), current.clockNow);

function draft(overrides = {}) {
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
    ...overrides,
  };
}

function advance(current, minutes) {
  return state.advanceClock(current, minutes).state;
}

// ─── Fuso horário e conversão ───────────────────────────────────────────

test('fuso: horário digitado é interpretado no fuso do evento, nunca no do aparelho', () => {
  assert.equal(time.localToInstant('05/11/2026', '10:00', 'America/Sao_Paulo'), '2026-11-05T13:00:00.000Z');
  assert.equal(time.localToInstant('05/11/2026', '10:00', 'America/Manaus'), '2026-11-05T14:00:00.000Z');
  assert.equal(time.localToInstant('05/11/2026', '10:00', 'America/Noronha'), '2026-11-05T12:00:00.000Z');
  assert.equal(time.localToInstant('05/11/2026', '22:30', 'America/Rio_Branco'), '2026-11-06T03:30:00.000Z');
  assert.equal(time.formatInstant('2026-11-06T03:30:00.000Z', 'America/Rio_Branco'), '05/11/2026 22:30');
  assert.equal(time.formatInstantWithZone('2026-11-05T13:00:00.000Z', 'America/Sao_Paulo'),
    '05/11/2026 10:00 (America/Sao_Paulo, UTC−3)');
});

test('fuso: só aceita fusos IANA reais da lista, comparando como propriedade própria', () => {
  for (const zone of ['America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Noronha']) {
    assert.ok(time.isSupportedTimezone(zone), zone);
  }
  for (const zone of ['', 'UTC-3', 'GMT-03:00', 'America/Fake', 'america/sao_paulo', 'toString',
    '__proto__', 'constructor', null, undefined, 42]) {
    assert.equal(time.isSupportedTimezone(zone), false, String(zone));
  }
});

test('datas: rejeita datas e horas impossíveis ou fora do formato', () => {
  for (const [date, hour] of [['31/02/2026', '10:00'], ['29/02/2027', '10:00'], ['2026-11-05', '10:00'],
    ['05/13/2026', '10:00'], ['05/11/2026', '24:00'], ['05/11/2026', '10:60'], ['05/11/2026', '9:00'],
    ['05/11/2019', '10:00']]) {
    assert.equal(time.localToInstant(date, hour, 'America/Sao_Paulo'), null, `${date} ${hour}`);
  }
  assert.ok(time.localToInstant('29/02/2028', '00:00', 'America/Sao_Paulo'), 'ano bissexto válido');
  assert.equal(time.maskDateInput('05112026'), '05/11/2026');
  assert.equal(time.maskTimeInput('1030'), '10:30');
  assert.deepEqual(plain(time.shiftLocal('31/12/2026', '23:45', 30)), { date: '01/01/2027', time: '00:15' });
  assert.equal(time.shiftLocal('31/02/2026', '10:00', 30), null);
});

// ─── Código de ingresso ─────────────────────────────────────────────────

test('código: normaliza com trim e maiúsculas e é único em todo o histórico, inclusive encerrados', () => {
  assert.equal(state.normalizeAccessCode('  beast-d9 \n'), 'BEAST-D9');
  const current = session();
  for (const taken of ['ARENA-XP', ' arena-xp ', 'summer-24', 'TESTE-01']) {
    const result = state.createEvent(current, draft({ accessCode: taken }));
    assert.equal(result.result.ok, false, taken);
    assert.equal(result.result.code, 'ACCESS_CODE_ALREADY_USED');
    assert.match(result.result.errors.accessCode, /reservado/);
    assert.equal(result.state, current, 'estado intacto');
  }
});

test('código: criado é gravado normalizado e o duplicado logo depois é recusado', () => {
  const first = state.createEvent(session(), draft({ accessCode: '  novo-01 ' }));
  assert.equal(first.result.ok, true);
  assert.equal(event(first.state, 'NOVO-01').accessCode, 'NOVO-01');
  const again = state.createEvent(first.state, draft({ accessCode: 'Novo-01' }));
  assert.equal(again.result.code, 'ACCESS_CODE_ALREADY_USED');
});

test('código: nenhuma operação de gestão altera o código (imutável)', () => {
  let current = state.createEvent(session(), draft()).state;
  const id = event(current, 'NOVO-01').id;
  current = state.changeSchedule(current, id, {
    officialEndDate: '10/11/2026', officialEndTime: '19:00',
    operationalDeadlineDate: '10/11/2026', operationalDeadlineTime: '19:00',
    reason: 'Ajuste de horário', accessCode: 'OUTRO',
  }).state;
  current = state.setExternalQueue(current, id, { enabled: false, reason: 'Teste da fila', accessCode: 'OUTRO' }).state;
  current = state.closeEvent(current, id, { mode: 'immediate', reason: 'Teste de encerramento', accessCode: 'OUTRO' }).state;
  assert.equal(state.findEvent(current, id).accessCode, 'NOVO-01');
  assert.ok(!current.events.some((item) => item.accessCode === 'OUTRO'));
});

// ─── Criação ────────────────────────────────────────────────────────────

test('criar: formulário vazio aponta todos os campos obrigatórios', () => {
  const result = state.validateEventDraft({}, []);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(),
    ['accessCode', 'externalQueueEnabled', 'name', 'reason', 'timezone'].sort());
});

test('criar: evento nasce "scheduled", não pronto, sem experiência e sem Staff', () => {
  const { state: next, result } = state.createEvent(session(), draft());
  assert.equal(result.ok, true);
  const created = state.findEvent(next, result.eventId);
  assert.equal(created.statusStored, 'scheduled');
  assert.equal(created.startsAt, '2026-11-10T13:00:00.000Z');
  assert.equal(created.officialEndsAt, '2026-11-10T21:00:00.000Z');
  assert.equal(created.operationalDeadlineAt, '2026-11-10T21:30:00.000Z');
  assert.equal(created.closureMode, null);
  assert.equal(created.closureRequestedAt, null);
  assert.equal(created.adminDeadlineAt, null);
  const readiness = state.getReadiness(created);
  assert.equal(readiness.ready, false);
  assert.deepEqual(plain(readiness.missing), ['EXPERIENCE_WITH_AVAILABLE_STATION', 'VERIFIED_ACTIVE_STAFF']);
  assert.equal(state.getEffectivePhase(created, next.clockNow), 'scheduled');
  for (const field of ['local', 'location', 'tipo', 'type', 'descricao', 'description', 'stations']) {
    assert.ok(!(field in created), `campo fora do DTO: ${field}`);
  }
});

test('criar: horários respeitam início < oficial ≤ limite ≤ oficial + 60 min', () => {
  const base = session();
  const cases = [
    [{ officialEndTime: '10:00' }, 'officialEndsAt'],
    [{ officialEndTime: '09:00' }, 'officialEndsAt'],
    [{ operationalDeadlineTime: '19:01' }, 'operationalDeadlineAt'],
    [{ operationalDeadlineTime: '17:59' }, 'operationalDeadlineAt'],
    [{ operationalDeadlineDate: '11/11/2026' }, 'operationalDeadlineAt'],
    [{ operationalDeadlineTime: '' }, 'operationalDeadlineAt'],
    [{ operationalDeadlineDate: '31/02/2026' }, 'operationalDeadlineAt'],
  ];
  for (const [override, field] of cases) {
    const result = state.createEvent(base, draft(override));
    assert.equal(result.result.ok, false, JSON.stringify(override));
    assert.ok(result.result.errors[field], `${JSON.stringify(override)} → ${field}`);
  }
  for (const limit of ['18:00', '19:00']) {
    const result = state.createEvent(base, draft({ operationalDeadlineTime: limit }));
    assert.equal(result.result.ok, true, `limite ${limit} (margem 0 e 60 min)`);
  }
  assert.equal(state.validateSchedule('2026-11-10T13:00:00.000Z', '2026-11-10T21:00:00.000Z',
    '2026-11-10T22:00:00.000Z').ok, true);
  assert.equal(state.validateSchedule('2026-11-10T13:00:00.000Z', '2026-11-10T21:00:00.000Z',
    '2026-11-10T22:00:00.001Z').code, 'DEADLINE_MARGIN_TOO_LONG');
  assert.equal(state.validateSchedule('2026-11-10T13:00:00.000Z', '2026-11-10T21:00:00.000Z',
    '2026-11-10T20:59:00.000Z').code, 'DEADLINE_BEFORE_OFFICIAL_END');
});

test('criar: fuso inválido, nome longo e justificativa curta são recusados', () => {
  const base = session();
  assert.ok(state.createEvent(base, draft({ timezone: 'America/Fake' })).result.errors.timezone);
  assert.ok(state.createEvent(base, draft({ timezone: 'UTC-3' })).result.errors.timezone);
  assert.ok(state.createEvent(base, draft({ name: 'x'.repeat(181) })).result.errors.name);
  assert.ok(state.createEvent(base, draft({ name: '   ' })).result.errors.name);
  assert.ok(state.createEvent(base, draft({ reason: 'ok' })).result.errors.reason);
  assert.ok(state.createEvent(base, draft({ externalQueueEnabled: 'sim' })).result.errors.externalQueueEnabled);
});

test('criar: só lê propriedades próprias do rascunho (nada herdado do protótipo)', () => {
  const inherited = Object.create(draft());
  const result = state.validateEventDraft(inherited, []);
  assert.equal(result.ok, false);
  assert.ok(result.errors.name && result.errors.accessCode && result.errors.timezone);
});

// ─── Fases efetivas e prontidão ─────────────────────────────────────────

test('fase: status armazenado é distinto da fase efetiva calculada pelo relógio', () => {
  const current = session();
  assert.equal(current.clockNow, '2026-11-05T12:00:00.000Z');
  assert.equal(phaseOf(current, 'ARENA-XP'), 'open');
  assert.equal(phaseOf(current, 'BEAST-D1'), 'scheduled');
  const noturna = event(current, 'NOTURNA');
  assert.equal(noturna.statusStored, 'open', 'status armazenado defasado');
  assert.equal(phaseOf(current, 'NOTURNA'), 'closing', 'horário oficial passou');
  assert.equal(phaseOf(current, 'SUMMER-24'), 'closed');
  assert.equal(phaseOf(advance(current, 15), 'NOTURNA'), 'closed', 'limite operacional alcançado');
});

test('fase: abertura é automática no início só se pronto; sem prontidão continua sem aceitar entradas', () => {
  let current = session();
  const kids = state.describeEvent(event(current, 'KIDS-01'), current.clockNow);
  assert.equal(kids.phase, 'scheduled');
  assert.equal(kids.waitingReadiness, true);
  assert.equal(kids.acceptingNewParticipations, false);
  assert.deepEqual(plain(kids.readiness.missing), ['EXPERIENCE_WITH_AVAILABLE_STATION']);

  current = advance(current, 60); // 13:00 UTC = início do BEAST-D1
  const beast = state.describeEvent(event(current, 'BEAST-D1'), current.clockNow);
  assert.equal(beast.phase, 'open');
  assert.equal(beast.statusStored, 'scheduled', 'nenhum "Abrir Evento" foi necessário');
  assert.equal(beast.acceptingNewParticipations, true);
});

test('painel: contadores coerentes com as fixtures e o relógio', () => {
  const current = session();
  assert.deepEqual(plain(state.getPanelSummary(current)),
    { total: 7, notReady: 2, scheduled: 3, open: 1, closing: 1, closed: 2 });
  const created = state.createEvent(current, draft()).state;
  const summary = state.getPanelSummary(created);
  assert.equal(summary.total, 8);
  assert.equal(summary.scheduled, 4);
  assert.equal(summary.notReady, 3);
});

test('lista: busca por nome ou código e filtro pelas quatro fases (sem "archived")', () => {
  const current = session();
  const codes = (list) => plain(list.map(({ event: item }) => item.accessCode));
  assert.deepEqual(codes(state.listEvents(current, { query: 'beast' })), ['BEAST-D1', 'BEAST-D2']);
  assert.deepEqual(codes(state.listEvents(current, { query: ' noturna ' })), ['NOTURNA']);
  assert.deepEqual(codes(state.listEvents(current, { phase: 'closed' })), ['SUMMER-24', 'TESTE-01']);
  assert.deepEqual(codes(state.listEvents(current, { phase: 'closing' })), ['NOTURNA']);
  assert.deepEqual(codes(state.listEvents(current, { phase: 'archived' })), []);
  assert.deepEqual(plain(data.ADMIN_PHASES), ['scheduled', 'open', 'closing', 'closed']);
});

// ─── Alterar horários ───────────────────────────────────────────────────

test('horários: alteração antes do corte oficial ajusta oficial e limite juntos', () => {
  const current = session();
  const id = event(current, 'ARENA-XP').id;
  const { state: next, result } = state.changeSchedule(current, id, {
    officialEndDate: '05/11/2026', officialEndTime: '18:00',
    operationalDeadlineDate: '05/11/2026', operationalDeadlineTime: '18:00', reason: 'Ajuste da organização',
  });
  assert.equal(result.ok, true);
  const changed = state.findEvent(next, id);
  assert.equal(changed.officialEndsAt, '2026-11-05T21:00:00.000Z', 'Fortaleza UTC−3');
  assert.equal(changed.operationalDeadlineAt, '2026-11-05T21:00:00.000Z', 'margem zero permitida');
  assert.equal(changed.startsAt, event(current, 'ARENA-XP').startsAt, 'início não muda');
  assert.equal(changed.audit.at(-1).reason, 'Ajuste da organização');
});

test('horários: depois do horário oficial, em encerramento ou encerrado, não há reabertura', () => {
  let current = session();
  const noturna = event(current, 'NOTURNA').id;
  const tryChange = (stateNow, id) => state.changeSchedule(stateNow, id, {
    officialEndDate: '06/11/2026', officialEndTime: '10:00',
    operationalDeadlineDate: '06/11/2026', operationalDeadlineTime: '10:30', reason: 'Tentar estender',
  });
  assert.equal(tryChange(current, noturna).result.code, 'EVENT_TIME_CHANGE_CLOSED');
  assert.equal(tryChange(current, event(current, 'SUMMER-24').id).result.code, 'EVENT_ALREADY_CLOSED');

  const arena = event(current, 'ARENA-XP').id;
  current = state.closeEvent(current, arena, { mode: 'controlled', controlledMinutes: '30', reason: 'Chuva forte' }).state;
  assert.equal(tryChange(current, arena).result.code, 'EVENT_TIME_CHANGE_CLOSED');
});

test('horários: novo encerramento precisa ser futuro, depois do início e com margem de 0–60', () => {
  const current = session();
  const id = event(current, 'BEAST-D1').id;
  const change = (input) => state.changeSchedule(current, id, { reason: 'Ajuste de horário', ...input });
  const at = (endTime, limitTime = endTime) => ({ officialEndDate: '05/11/2026', officialEndTime: endTime,
    operationalDeadlineDate: '05/11/2026', operationalDeadlineTime: limitTime });
  assert.ok(change(at('08:30'))
    .result.errors.officialEndsAt, 'antes do relógio');
  assert.ok(change(at('09:30'))
    .result.errors.officialEndsAt, 'antes do início do evento');
  assert.ok(change(at('20:00', '21:01')).result.errors.operationalDeadlineAt);
  assert.ok(change(at('20:00', '19:59')).result.errors.operationalDeadlineAt);
  assert.equal(change(at('18:00', '18:30'))
    .result.code, 'NO_CHANGE');
  assert.ok(change({ ...at('20:00', '21:00'), reason: '' })
    .result.errors.reason);
});

// ─── Fila externa ───────────────────────────────────────────────────────

test('fila externa: desligar libera quem espera; religar vale só para novas entradas', () => {
  let current = session();
  const id = event(current, 'ARENA-XP').id;
  const off = state.setExternalQueue(current, id, { enabled: false, reason: 'Fluxo baixo' });
  assert.equal(off.result.ok, true);
  assert.equal(off.result.released, 6);
  current = off.state;
  assert.deepEqual(plain(state.findEvent(current, id).participants), { externalWaiting: 0, active: 24, finished: 41 });
  const on = state.setExternalQueue(current, id, { enabled: true, reason: 'Fluxo alto' });
  assert.equal(on.result.ok, true);
  assert.deepEqual(plain(state.findEvent(on.state, id).participants), { externalWaiting: 0, active: 24, finished: 41 });
  assert.match(on.result.message, /próximas entradas/);
  assert.equal(state.setExternalQueue(on.state, id, { enabled: true, reason: 'Repetido' }).result.code, 'NO_CHANGE');
});

test('fila externa: é operação distinta das inscrições e não reabre depois do corte', () => {
  const current = session();
  for (const code of ['NOTURNA', 'SUMMER-24']) {
    const result = state.setExternalQueue(current, event(current, code).id, { enabled: false, reason: 'Tentativa' });
    assert.equal(result.result.code, 'EVENT_REGISTRATION_CLOSED', code);
    assert.equal(result.state, current);
  }
  const before = event(current, 'ARENA-XP');
  const changed = state.findEvent(
    state.setExternalQueue(current, before.id, { enabled: false, reason: 'Fluxo baixo' }).state, before.id);
  assert.equal(changed.officialEndsAt, before.officialEndsAt, 'não mexe no corte de inscrições');
  assert.equal(changed.statusStored, before.statusStored);
});

// ─── Encerramento antecipado ────────────────────────────────────────────

test('encerrar imediato: finaliza abertas, preserva conclusões e não reabre', () => {
  const current = session();
  const id = event(current, 'ARENA-XP').id;
  assert.equal(state.closeEvent(current, id, { mode: 'immediate', reason: '' }).result.code, 'VALIDATION_ERROR');
  const { state: next, result } = state.closeEvent(current, id, { mode: 'immediate', reason: 'Queda de energia' });
  assert.equal(result.ok, true);
  const closed = state.findEvent(next, id);
  assert.equal(closed.statusStored, 'closed');
  assert.equal(closed.closureMode, 'immediate');
  assert.equal(closed.closureRequestedAt, next.clockNow);
  assert.equal(closed.adminDeadlineAt, next.clockNow);
  assert.deepEqual(plain(closed.participants), { externalWaiting: 0, active: 0, finished: 65 });
  assert.equal(state.getEffectivePhase(closed, next.clockNow), 'closed');
  assert.equal(state.closeEvent(next, id, { mode: 'immediate', reason: 'De novo' }).result.code, 'EVENT_ALREADY_CLOSED');
});

test('encerrar controlado: corta entradas agora, finaliza espera externa e respeita 1–60 min e o limite', () => {
  const current = session();
  const id = event(current, 'ARENA-XP').id;
  const close = (minutes) => state.closeEvent(current, id, { mode: 'controlled', controlledMinutes: minutes, reason: 'Chuva forte' });
  for (const invalid of ['0', '61', '', 'x']) {
    assert.equal(close(invalid).result.code, 'CLOSURE_DEADLINE_INVALID', invalid);
  }
  const { state: next, result } = close('45');
  assert.equal(result.ok, true);
  const closing = state.findEvent(next, id);
  assert.equal(closing.statusStored, 'closing');
  assert.equal(closing.closureRequestedAt, '2026-11-05T12:00:00.000Z');
  assert.equal(closing.adminDeadlineAt, '2026-11-05T12:45:00.000Z');
  assert.deepEqual(plain(closing.participants), { externalWaiting: 0, active: 18, finished: 47 });
  assert.equal(state.getEffectivePhase(closing, next.clockNow), 'closing');
  assert.equal(state.getEffectivePhase(closing, state.advanceClock(next, 45).state.clockNow), 'closed');

  const again = state.closeEvent(next, id, { mode: 'controlled', controlledMinutes: '10', reason: 'Outro controlado' });
  assert.equal(again.result.code, 'CLOSURE_DEADLINE_INVALID', 'controlado → controlado não aprovado');
  assert.equal(state.closeEvent(next, id, { mode: 'immediate', reason: 'Antecipar fim' }).result.ok, true);
});

test('encerrar controlado: nunca além do limite operacional; sem janela exige imediato', () => {
  const current = session();
  const noturna = event(current, 'NOTURNA').id; // limite operacional às 12:15 UTC
  const availability = state.getCloseAvailability(event(current, 'NOTURNA'), current.clockNow);
  assert.equal(availability.maxControlledMinutes, 15);
  assert.equal(state.closeEvent(current, noturna, { mode: 'controlled', controlledMinutes: '16', reason: 'Fim antecipado' })
    .result.code, 'CLOSURE_DEADLINE_INVALID');
  assert.equal(state.closeEvent(current, noturna, { mode: 'controlled', controlledMinutes: '15', reason: 'Fim antecipado' })
    .result.ok, true);

  const late = advance(current, 14); // resta 1 min
  assert.equal(state.getCloseAvailability(event(late, 'NOTURNA'), late.clockNow).maxControlledMinutes, 1);
  const lateHalf = state.advanceClock(late, 1).state;
  assert.equal(state.closeEvent(lateHalf, noturna, { mode: 'controlled', controlledMinutes: '1', reason: 'Tarde' })
    .result.code, 'EVENT_ALREADY_CLOSED');
});

test('sessão: fixtures congeladas não são alteradas pelas transições', () => {
  const current = session();
  const id = event(current, 'ARENA-XP').id;
  state.closeEvent(current, id, { mode: 'immediate', reason: 'Queda de energia' });
  assert.equal(data.adminDemoEvents[0].statusStored, 'open');
  assert.equal(event(current, 'ARENA-XP').statusStored, 'open', 'estado anterior intacto');
  assert.equal(state.advanceClock(current, 0).result.ok, false);
  assert.equal(state.resetClock(advance(current, 30)).state.clockNow, data.ADMIN_DEMO_CLOCK_START);
});
