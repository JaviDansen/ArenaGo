const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, createParticipantThemeStub, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');
const { verifiedAdminAuth } = require('./helpers/adminAuthFixture.cjs');
const { eventScheduleDraft, prepareSchedule, resolveEventTime } = loadModule('screens/admin/adminScheduleForm.js', require).exports;
const { changeAdminSchedule, renameAdminEvent } = loadModule('services/adminEventsService.js', require).exports;
const eventId = 'abcdef00-0000-4000-8000-000000000001';
const path = `/admin/events/${eventId}`;
const initial = { id: eventId, name: 'Arena do Norte', timezone: 'America/Fortaleza', accessCode: 'ARENA-TESTE',
  startsAt: '2090-11-05T21:00:00.123456Z', officialEndsAt: '2090-11-06T03:00:00.123456Z',
  operationalDeadlineAt: '2090-11-06T03:30:00.123456Z', updatedAt: '2090-11-01T15:00:00.234567Z',
  effectivePhase: 'scheduled', readiness: { ready: true } };
const readiness = { eventId, effectivePhase: 'scheduled', statusStored: 'scheduled', ready: true,
  missing: [], checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
    hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: true }, acceptingNewParticipations: false };

const text = (h, value) => h.nodes.some(n => n.type === 'Text' && textOf(n).includes(value));
function input(h, label) { return h.nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); }
function change(h, label, value) { h.act(() => input(h, label).props.onChangeText(value)); }
function button(h, label) { return h.nodes.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); }
async function settle(h, predicate) {
  for (let i = 0; i < 20; i++) {
    await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
    if (predicate()) return;
  }
  assert.fail('O estado esperado não apareceu.');
}
function mount({ event = initial, patch, read, ...options } = {}) {
  const calls = [];
  const httpClient = {
    async get(url, config) {
      assert.equal(config.auth, true);
      calls.push(url);
      if (read) return read(url);
      if (url === path) return { event };
      if (url === `${path}/readiness`) return readiness;
      assert.fail(`Rota inesperada: ${url}`);
    },
    patch,
  };
  const h = createHarness('screens/admin/AdminEventManagementInfoScreen.js', {
    props: { route: { params: { area: 'schedule', eventId } } },
    authContext: verifiedAdminAuth({ httpClient }), ...options,
  });
  return { h, calls, httpClient };
}

test('ADMIN-03 abre os três grupos em consulta, protege código/fuso e descarta edição', async () => {
  const { h, calls } = mount({ platform: 'web', patch: () => assert.fail('Consulta e descarte não persistem') });
  try {
    await settle(h, () => text(h, 'Acesso ao evento'));
    assert.deepEqual(calls, [path, `${path}/readiness`]);
    for (const label of ['Informações gerais', 'Datas e horários', 'ARENA-TESTE', 'America/Fortaleza', '18:00', '00:00']) {
      assert.ok(text(h, label), label);
    }
    assert.equal(h.nodes.filter(n => n.type === 'TextInput').length, 0);
    h.act(() => h.press('Editar nome'));
    assert.equal(button(h, 'Salvar nome').props.disabled, true);
    change(h, 'Nome do evento', 'Novo nome');
    assert.equal(button(h, 'Salvar nome').props.disabled, false);
    h.act(() => h.press('Descartar'));
    assert.ok(!input(h, 'Nome do evento') && text(h, initial.name));
    h.act(() => h.press('Editar horários'));
    assert.ok(input(h, 'Data de início') && input(h, 'Hora de término oficial'));
    assert.ok(!input(h, 'Código de acesso') && !input(h, 'Fuso horário'));
    change(h, 'Margem operacional (minutos)', '60');
    assert.ok(text(h, '01:00'));
    h.act(() => h.press('Salvar horários'));
    assert.ok(text(h, 'justificativa válida'));
  } finally { h.unmount(); }
});

test('ADMIN-03 salva nome uma vez e reconsulta, preservando dados oficiais em conflito', async () => {
  let saved = initial, release, rejectWrite = false;
  const writes = [];
  const { h, calls } = mount({ platform: 'web', read: url => url === path ? { event: saved } : readiness,
    patch: (url, payload, options) => {
      writes.push({ url, payload: { ...payload }, options });
      if (rejectWrite) throw { status: 409, code: 'EVENT_CONFIGURATION_LOCKED' };
      return new Promise(resolve => { release = () => { saved = { ...saved, name: payload.name }; resolve({ event: saved }); }; });
    } });
  try {
    await settle(h, () => text(h, initial.name));
    h.act(() => h.press('Editar nome'));
    change(h, 'Nome do evento', ' Arena oficial ');
    const send = button(h, 'Salvar nome').props.onPress;
    h.act(() => { void send(); void send(); });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, path);
    assert.deepEqual(writes[0].payload, { name: 'Arena oficial' });
    assert.equal(writes[0].options.auth, true);
    assert.equal(writes[0].options.retryOnUnauthorized, false);
    assert.ok(writes[0].options.headers['Idempotency-Key']);
    assert.ok(!text(h, 'Nome salvo.'));
    release();
    await settle(h, () => text(h, 'Nome salvo.') && text(h, 'Arena oficial') && !!button(h, 'Editar nome'));
    assert.equal(calls.filter(url => url === path).length, 2);
    rejectWrite = true;
    h.act(() => h.press('Editar nome'));
    change(h, 'Nome do evento', 'Não persistido');
    h.act(() => h.press('Salvar nome'));
    await settle(h, () => text(h, 'Já existe participação registrada') && text(h, 'Arena oficial'));
    assert.ok(!text(h, 'Não persistido') && !button(h, 'Editar nome'));
    assert.equal(calls.filter(url => url === path).length, 3);
  } finally { h.unmount(); }
});

test('ADMIN-03 bloqueia início vigente e confirma saída enquanto há edição não salva', async () => {
  let prevented, callback;
  const { h } = mount({ platform: 'web', event: { ...initial, startsAt: '2020-01-01T00:00:00.000000Z', effectivePhase: 'open' },
    preventRemove: (value, handle) => { prevented = value; callback = handle; } });
  try {
    await settle(h, () => !!button(h, 'Editar horários'));
    h.act(() => h.press('Editar horários'));
    assert.ok(!input(h, 'Data de início') && input(h, 'Data de término oficial'));
    change(h, 'Margem operacional (minutos)', '0');
    assert.equal(prevented, true);
    h.act(() => callback({ data: { action: { type: 'GO_BACK' } } }));
    assert.ok(text(h, 'Alterações não salvas'));
    h.act(() => h.press('Permanecer editando'));
    assert.equal(input(h, 'Margem operacional (minutos)').props.value, '0');
    h.act(() => callback({ data: { action: { type: 'GO_BACK' } } }));
    h.act(() => h.press('Descartar alterações'));
    assert.equal(h.navigationCalls.at(-1).action.type, 'GO_BACK');
  } finally { h.unmount(); }
});

test('ADMIN-03 interpreta fuso e meia-noite, rejeita horário inexistente ou ambíguo e preserva precisão', () => {
  assert.equal(resolveEventTime({ date: '06/11/2090', time: '00:00' }, initial.timezone), '2090-11-06T03:00:00.000Z');
  assert.throws(() => resolveEventTime({ date: '08/03/2026', time: '02:30' }, 'America/New_York'), /não existe/);
  assert.throws(() => resolveEventTime({ date: '01/11/2026', time: '01:30' }, 'America/New_York'), /ambígua/);
  assert.throws(() => resolveEventTime({ date: '30/02/2026', time: '10:00' }, 'UTC'), /Confira/);
  const draft = eventScheduleDraft(initial), now = Date.parse('2090-11-02T00:00:00Z');
  const startOnly = prepareSchedule(initial, draft, { ...draft, reason: 'Ajuste', start: { ...draft.start, time: '17:00' } }, now);
  assert.equal(startOnly.startsAt, '2090-11-05T20:00:00.000Z');
  assert.equal(startOnly.officialEndsAt, initial.officialEndsAt);
  assert.equal(startOnly.operationalDeadlineAt, initial.operationalDeadlineAt);
  for (const [margin, deadline] of [['0', '2090-11-06T03:00:00.123456Z'], ['60', '2090-11-06T04:00:00.123456Z']]) {
    assert.equal(prepareSchedule(initial, draft, { ...draft, reason: 'Ajuste', margin }, now).operationalDeadlineAt, deadline);
  }
  assert.throws(() => prepareSchedule(initial, draft, { ...draft, reason: 'Ajuste', margin: '61' }, now), /0 a 60/);
});

test('ADMIN-03 escreve somente campos autorizados e rejeita confirmação divergente', async () => {
  const body = { officialEndsAt: initial.officialEndsAt, operationalDeadlineAt: initial.operationalDeadlineAt,
    expectedUpdatedAt: initial.updatedAt, startsAt: '2090-11-05T20:00:00.000Z', reason: 'Ajuste' };
  await changeAdminSchedule({ patch: async (url, payload, config) => {
    assert.equal(url, `${path}/schedule`);
    assert.deepEqual({ ...payload }, body);
    assert.equal(config.headers['Idempotency-Key'], 'test-key');
    return { eventId, ...body };
  } }, eventId, { ...body, timezone: 'UTC', accessCode: 'IGNORE' }, 'test-key');
  await assert.rejects(renameAdminEvent({ patch: async () => ({ event: { id: 'other', name: 'Renomeado' } }) },
    eventId, 'Renomeado', 'test-key'), /não confirmada/);
});

test('ADMIN-03 reconsulta horários após conflito e só confirma programação aceita pelo servidor', async () => {
  let event = initial, conflict = true;
  const { h, calls } = mount({ platform: 'web', read: url => url === path ? { event } : readiness,
    patch: async (url, body) => {
      assert.equal(url, `${path}/schedule`);
      assert.equal(body.expectedUpdatedAt, event.updatedAt);
      assert.equal(body.reason, 'Ajuste autorizado');
      assert.equal(body.startsAt, '2090-11-05T20:00:00.000Z');
      assert.equal(body.officialEndsAt, '2090-11-06T04:00:00.000Z');
      assert.equal(body.operationalDeadlineAt, '2090-11-06T05:00:00.000Z');
      if (conflict) {
        event = { ...event, updatedAt: '2090-11-01T16:00:00.234567Z' };
        throw { status: 409, code: 'EVENT_SCHEDULE_STALE' };
      }
      event = { ...event, startsAt: body.startsAt, officialEndsAt: body.officialEndsAt, operationalDeadlineAt: body.operationalDeadlineAt };
      return { eventId, ...body };
    } });
  const enter = () => {
    h.act(() => h.press('Editar horários'));
    change(h, 'Hora de início', '17:00');
    change(h, 'Hora de término oficial', '01:00');
    change(h, 'Margem operacional (minutos)', '60');
    change(h, 'Justificativa', 'Ajuste autorizado');
    h.act(() => h.press('Salvar horários'));
  };
  try {
    await settle(h, () => !!button(h, 'Editar horários'));
    enter();
    await settle(h, () => text(h, 'O evento mudou durante a edição') && !!button(h, 'Editar horários') && !button(h, 'Editar horários').props.disabled);
    assert.equal(calls.filter(url => url === path).length, 2);
    assert.ok(!text(h, 'Programação salva.'));
    conflict = false;
    enter();
    await settle(h, () => text(h, 'Programação salva.') && text(h, '17:00') && text(h, '02:00'));
    assert.equal(calls.filter(url => url === path).length, 3);
  } finally { h.unmount(); }
});

test('ADMIN-03 bloqueia dados após 401/403/404 e ignora confirmação de sessão encerrada', async () => {
  for (const status of [401, 403, 404]) {
    const { h } = mount({ read: url => {
      if (url.endsWith('/readiness')) throw { status };
      return { event: initial };
    } });
    try {
      await settle(h, () => text(h, 'Evento indisponível'));
      assert.ok(!text(h, 'ARENA-TESTE') && !button(h, 'Editar nome'));
    } finally { h.unmount(); }
  }
  let resolve;
  const { h, httpClient, calls } = mount({ patch: () => new Promise(done => { resolve = done; }) });
  try {
    await settle(h, () => !!button(h, 'Editar nome'));
    h.act(() => h.press('Editar nome'));
    change(h, 'Nome do evento', 'Nome depois do logout');
    h.act(() => h.press('Salvar nome'));
    h.setAuthContext(verifiedAdminAuth({ isAuthenticated: false, httpClient }));
    resolve({ event: { ...initial, name: 'Nome depois do logout' } });
    await h.actAsync(() => new Promise(done => setImmediate(done)));
    assert.ok(!text(h, 'Nome salvo.') && !text(h, 'ARENA-TESTE'));
    assert.equal(calls.filter(url => url === path).length, 1);
  } finally { h.unmount(); }
});

test('ADMIN-03 copia e mostra QR local com o conteúdo aceito pelo leitor Participante', async () => {
  const copied = [];
  const { h } = mount({ copyToClipboard: value => copied.push(value) });
  try {
    await settle(h, () => text(h, 'ARENA-TESTE'));
    h.act(() => h.press('Copiar'));
    assert.deepEqual(copied, ['ARENA-TESTE']);
    assert.ok(text(h, 'Código copiado.'));
    h.act(() => h.press('Visualizar QR Code'));
    assert.ok(h.nodes.some(node => node.props.accessibilityRole === 'image' &&
      node.props.accessibilityLabel?.startsWith('QR Code com o código')));
    h.act(() => h.press('Fechar QR Code'));
    assert.ok(!text(h, 'QR Code do evento'));
  } finally { h.unmount(); }
  const styleStub = { StyleSheet: { create: value => value } };
  const { eventQrMatrix } = loadModule('screens/admin/components/AdminEventAccess.js', name => {
    if (name === 'react-native') return styleStub;
    if (name === './AdminLiveUI') return { liveColors: {} };
    return name.startsWith('.') ? {} : require(name);
  }).exports;
  const participant = loadModule('screens/event-entry/EventEntryScreen.js', name => {
    if (name === 'react-native') return styleStub;
    if (name === '../../theme') return createParticipantThemeStub();
    return {};
  }).exports;
  const matrix = eventQrMatrix(initial.accessCode, value => {
    assert.equal(value, initial.accessCode);
    assert.equal(participant.validateAndNormalizeQrCode(value).code, initial.accessCode);
    return require('toqr').toQR(value);
  });
  assert.ok(matrix.slice(0, 4).every(row => row.every(cell => !cell)));
  assert.ok(matrix[4][4]);
});
