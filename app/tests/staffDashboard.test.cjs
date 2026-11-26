const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');
const entryService = loadModule('services/staffEntryService.js', require).exports;
const operations = loadModule('services/staffOperationsService.js', (name) => {
  if (name === './staffEntryService.js' || name === './staffEntryService') return entryService;
  return require(name);
}).exports;
const { createStaffDashboardStore } = loadModule('services/staffDashboardService.js', (name) => {
  if (name === './staffOperationsService') return operations;
  return require(name);
}).exports;

const eventId = '11111111-1111-4111-8111-111111111111';
const otherEventId = '22222222-2222-4222-8222-222222222222';
const experienceId = '33333333-3333-4333-8333-333333333333';
const stationId = '44444444-4444-4444-8444-444444444444';
const secondExperienceId = '55555555-5555-4555-8555-555555555555';
const secondStationId = '66666666-6666-4666-8666-666666666666';
const context = (event = eventId, userId = 'a', revision = 1) => ({ eventId: event, userId, epoch: 1, revision });
const stations = (event = eventId) => ({ eventId: event, stations: [{ id: stationId, experienceId,
  label: 'Estação real', availability: 'available', pendingServiceSessionId: null, pendingCalledAt: null }] });
const queue = (event = eventId) => ({ eventId: event, experienceId, waitingCount: 0,
  canCallWaitingEntries: false, acceptingNewEntries: false, firstWaitingQueueEntryId: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };

test('polling preserva dados durante rede, atualiza estação e fila e descarta contexto antigo', async () => {
  let current = context(), stationResult = stations(), queueResult = queue();
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: async url =>
    url.endsWith('/stations') ? stationResult : queueResult } });
  store.setContext(current); await store.refreshStations(); await store.refreshQueue(experienceId);
  stationResult = { ...stations(), stations: [{ ...stations().stations[0], availability: 'unavailable' }] };
  queueResult = { ...queue(), waitingCount: 2, firstWaitingQueueEntryId: stationId };
  await store.pollStations(); await store.pollQueue();
  assert.equal(store.getSnapshot().stations[0].availability, 'unavailable');
  assert.equal(store.getSnapshot().queue.waitingCount, 2);
  stationResult = Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
  await store.pollStations();
  assert.equal(store.getSnapshot().stations[0].availability, 'unavailable');
  assert.equal(store.getSnapshot().stationError, 'stale');
  const late = deferred(); stationResult = late.promise;
  const old = store.pollStations(); current = context(otherEventId); store.setContext(current);
  late.resolve(stations()); await old;
  assert.equal(store.getSnapshot().stations.length, 0);
});

test('consulta estações e fila reais com cliente autenticado e somente experiência retornada', async () => {
  const current = context(), calls = [];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: async (url, options) => {
    calls.push({ url, options }); return url.endsWith('/stations') ? stations() : queue();
  } } });
  store.setContext(current);
  await store.refreshStations();
  assert.equal(store.getSnapshot().stations[0].label, 'Estação real');
  await store.refreshQueue(otherEventId);
  assert.equal(calls.length, 1, 'ID arbitrário não inicia consulta');
  await store.refreshQueue(experienceId);
  assert.equal(store.getSnapshot().queue.waitingCount, 0);
  assert.deepEqual(calls.map((item) => item.url), [`/staff/events/${eventId}/stations`,
    `/staff/events/${eventId}/experiences/${experienceId}/queue`]);
  assert.ok(calls.every((item) => item.options.auth === true));
});

test('lista vazia, rede, 401 e 403 limpam dados e permitem nova leitura', async () => {
  const current = context(); let result = stations();
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: async () => {
    if (result instanceof Error) throw result; return result;
  } } });
  store.setContext(current);
  await store.refreshStations();
  result = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.refreshStations();
  assert.equal(store.getSnapshot().stationError, 'network');
  assert.equal(store.getSnapshot().stations.length, 0);
  result = Object.assign(new Error('401'), { status: 401 });
  await store.refreshStations();
  assert.equal(store.getSnapshot().stationError, 'session');
  result = { eventId, stations: [] };
  await store.refreshStations();
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stations.length, 0);
  result = stations(); await store.refreshStations();
  result = Object.assign(new Error('403'), { status: 403 });
  await store.refreshQueue(experienceId);
  assert.equal(store.getSnapshot().stationError, 'denied');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().queue, null);
});

test('troca de evento, revisão, logout e respostas fora de ordem descartam dados', async () => {
  let current = context(); const requests = [];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  store.setContext(current);
  const first = store.refreshStations(), second = store.refreshStations();
  requests[1].resolve({ eventId, stations: [] }); await second;
  requests[0].resolve(stations()); await first;
  assert.equal(store.getSnapshot().stations.length, 0);
  const old = store.refreshStations();
  current = context(otherEventId, 'b', 2); store.setContext(current);
  const fresh = store.refreshStations();
  requests[2].resolve(stations()); await old;
  requests[3].resolve(stations(otherEventId)); await fresh;
  assert.equal(store.getSnapshot().context.eventId, otherEventId);
  const pendingQueue = store.refreshQueue(experienceId);
  current = null;
  requests[4].resolve(queue(otherEventId)); await pendingQueue;
  assert.equal(store.isCurrent(), false);
  store.setContext(null);
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().stations.length, 0);
});

test('respostas inválidas e filas concorrentes não substituem a leitura mais recente', async () => {
  const current = context(), requests = [];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  store.setContext(current);
  const invalid = store.refreshStations(); requests[0].resolve({ eventId, stations: [{ id: 'inválido' }] }); await invalid;
  assert.equal(store.getSnapshot().stationError, 'unavailable');
  const load = store.refreshStations(); requests[1].resolve(stations()); await load;
  const old = store.refreshQueue(experienceId), latest = store.refreshQueue(experienceId);
  requests[3].resolve(queue()); await latest;
  requests[2].resolve({ ...queue(), waitingCount: 2, firstWaitingQueueEntryId: stationId }); await old;
  assert.equal(store.getSnapshot().queue.waitingCount, 0);
});

test('troca de experiência descarta fila anterior e 404 limpa os dados do evento', async () => {
  const current = context(), requests = [];
  const verificationStarted = deferred();
  const stationsPath = `/staff/events/${current.eventId}/stations`;
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: (path) => {
    const request = { ...deferred(), path };
    requests.push(request);
    if (path === stationsPath && requests.length > 1) verificationStarted.resolve(request);
    return request.promise;
  } } });
  store.setContext(current);
  const load = store.refreshStations();
  const response = stations();
  response.stations.push({ ...response.stations[0], id: secondStationId, experienceId: secondExperienceId });
  requests[0].resolve(response); await load;
  const old = store.refreshQueue(experienceId), latest = store.refreshQueue(secondExperienceId);
  requests[2].resolve({ ...queue(), experienceId: secondExperienceId }); await latest;
  requests[1].resolve(queue()); await old;
  assert.equal(store.getSnapshot().queue.experienceId, secondExperienceId);
  const denied = store.refreshQueue(secondExperienceId);
  assert.equal(requests[3].path, `/staff/events/${current.eventId}/experiences/${secondExperienceId}/queue`);
  requests[3].reject(Object.assign(new Error('404'), { status: 404 }));
  const verification = await Promise.race([
    verificationStarted.promise,
    denied.then(() => assert.fail('O 404 da fila deve iniciar a verificação de acesso ao evento')),
  ]);
  assert.equal(store.getSnapshot().queueStatus, 'error');
  assert.equal(store.getSnapshot().queueError, 'denied');
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stations.length, 2);
  verification.reject(Object.assign(new Error('404'), { status: 404 }));
  await denied;
  assert.equal(store.getSnapshot().stationError, 'denied');
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().stations.length, 0);
});

test('descoberta autenticada valida experiências, inclui experiência sem estação e preserva IDs reais', async () => {
  const current = context(), calls = [];
  const experiences = [{ id: experienceId, name: 'Just Dance' }, { id: secondExperienceId, name: 'Sem estação' }];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: async (url, options) => {
    calls.push({ url, options }); return { eventId, experiences };
  } } });
  store.setContext(current); await store.refreshExperiences();
  assert.deepEqual(JSON.parse(JSON.stringify(store.getSnapshot().experiences)), experiences);
  assert.equal(calls[0].url, `/staff/events/${eventId}/experiences`);
  assert.equal(calls[0].options.auth, true);
  for (const invalid of [null, {}, { eventId: otherEventId, experiences }, { eventId, experiences: [experiences[0], experiences[0]] },
    { eventId, experiences: [{ id: experienceId, name: '' }] }, { eventId, experiences: [{ id: 'invalid', name: 'A' }] }]) {
    assert.throws(() => operations.parseStaffExperiences(invalid, eventId));
  }
  assert.equal(operations.parseStaffExperiences({ eventId, experiences: [] }, eventId).experiences.length, 0);
});

test('revalidação de experiências descarta respostas antigas em troca de usuário, evento e revisão', async () => {
  let current = context(); const requests = [];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  store.setContext(current);
  const older = store.refreshExperiences(), newer = store.refreshExperiences();
  requests[1].resolve({ eventId, experiences: [] }); await newer;
  requests[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Antiga' }] }); await older;
  assert.equal(store.getSnapshot().experiences.length, 0);
  const pending = store.refreshExperiences();
  current = context(otherEventId, 'b', 2); store.setContext(current);
  requests[2].resolve({ eventId, experiences: [{ id: experienceId, name: 'Antiga' }] }); await pending;
  assert.equal(store.getSnapshot().context.eventId, otherEventId);
  assert.equal(store.getSnapshot().experiences.length, 0);
  const logout = store.refreshExperiences(); current = null;
  requests[3].resolve({ eventId: otherEventId, experiences: [{ id: experienceId, name: 'Antiga' }] }); await logout;
  store.setContext(null); assert.equal(store.getSnapshot().experiences.length, 0);
});

test('experiências tratam rede, 401, 403 e 404 sem manter dados protegidos', async () => {
  for (const [error, kind] of [[{ isNetworkError: true }, 'network'], [{ status: 401 }, 'session'],
    [{ status: 403 }, 'denied'], [{ status: 404 }, 'denied']]) {
    const current = context(); let failure = false;
    const store = createStaffDashboardStore({ getContext: () => current, client: { get: async () => {
      if (failure) throw Object.assign(new Error('falha'), error);
      return { eventId, experiences: [{ id: experienceId, name: 'Real' }] };
    } } });
    store.setContext(current); await store.refreshExperiences(); failure = true; await store.refreshExperiences();
    assert.equal(store.getSnapshot().experienceError, kind);
    assert.equal(store.getSnapshot().experiences.length, 0);
  }
});

test('retorno da estação invalida consulta de fila ainda pendente', async () => {
  const current = context(), requests = [];
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  store.setContext(current);
  const load = store.refreshStations(); requests[0].resolve(stations()); await load;
  const pending = store.refreshQueue(experienceId); store.clearQueue();
  const cleared = store.getSnapshot();
  store.clearQueue();
  assert.strictEqual(store.getSnapshot(), cleared);
  requests[1].resolve(queue()); await pending;
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().experienceId, null);
});

const participantAId = '77777777-7777-4777-8777-777777777777';
const participantBId = '99999999-9999-4999-8999-999999999999';
const callId = '88888888-8888-4888-8888-888888888888';
const entrySummary = (patch = {}) => {
  const base = {
    eventId,
    externalQueueEnabled: true,
    canManage: true,
    observedAt: '2026-11-17T15:00:00.000Z',
    waitingCount: 1,
    waiting: [{ participationId: participantAId, displayName: 'Ana', position: 1 }],
    pendingCall: null,
    ...patch,
  };
  const hasCall = Boolean(base.pendingCall);
  return {
    canCall: base.canManage && base.externalQueueEnabled && !hasCall && base.waitingCount > 0,
    canConfirm: base.canManage && base.externalQueueEnabled && hasCall,
    canMarkAbsent: base.externalQueueEnabled && hasCall,
    canRemove: base.externalQueueEnabled && hasCall,
    ...base,
  };
};

test('parseStaffEntrySummary reutiliza contrato oficial, exige campos obrigatórios e preserva janela residual', () => {
  const parsedWaiting = operations.parseStaffEntrySummary(entrySummary(), eventId);
  assert.equal(parsedWaiting.externalQueueEnabled, true);
  assert.equal(parsedWaiting.waitingCount, 1);
  assert.equal(parsedWaiting.pendingCall, null);

  const parsedCalled = operations.parseStaffEntrySummary(
    entrySummary({
      waitingCount: 1,
      waiting: [{ participationId: participantAId, displayName: 'Ana', position: 1 }],
      pendingCall: {
        id: callId,
        participationId: participantBId,
        displayName: '  Carlos Silva  ',
        calledAt: '2026-11-17T15:01:00.000Z',
      },
    }),
    eventId,
  );
  assert.equal(parsedCalled.pendingCall.id, callId);
  assert.equal(parsedCalled.pendingCall.participationId, participantBId);
  assert.equal(parsedCalled.pendingCall.displayName, 'Carlos Silva');
  assert.equal(parsedCalled.pendingCall.calledAt, '2026-11-17T15:01:00.000Z');
  assert.equal(parsedCalled.waitingCount, 1);

  const parsedInactive = operations.parseStaffEntrySummary(
    entrySummary({
      externalQueueEnabled: false,
      waitingCount: 0,
      waiting: [],
      pendingCall: null,
    }),
    eventId,
  );
  assert.equal(parsedInactive.externalQueueEnabled, false);
  assert.equal(parsedInactive.pendingCall, null);

  // Regra da janela residual do backend: canManage=false não impede canMarkAbsent/canRemove quando há pendingCall
  const parsedResidual = operations.parseStaffEntrySummary(
    entrySummary({
      externalQueueEnabled: true,
      canManage: false,
      waitingCount: 0,
      waiting: [],
      pendingCall: {
        id: callId,
        participationId: participantBId,
        displayName: 'Carlos Residual',
        calledAt: '2026-11-17T15:01:00.000Z',
      },
      canCall: false,
      canConfirm: false,
      canMarkAbsent: true,
      canRemove: true,
    }),
    eventId,
  );
  assert.equal(parsedResidual.canManage, false);
  assert.equal(parsedResidual.pendingCall.displayName, 'Carlos Residual');

  const withoutPendingCall = entrySummary();
  delete withoutPendingCall.pendingCall;
  const withoutObservedAt = entrySummary();
  delete withoutObservedAt.observedAt;
  const withoutFlag = entrySummary();
  delete withoutFlag.canRemove;

  for (const invalid of [
    null,
    {},
    withoutPendingCall,
    withoutObservedAt,
    withoutFlag,
    entrySummary({ pendingCall: undefined }),
    entrySummary({ eventId: otherEventId }),
    entrySummary({ waitingCount: 2 }),
    entrySummary({ externalQueueEnabled: 'yes' }),
    entrySummary({ observedAt: '2026-11-17' }),
    entrySummary({ pendingCall: { id: 'invalido', participationId: participantBId, displayName: 'Ana', calledAt: '2026-11-17T15:01:00.000Z' } }),
    entrySummary({ pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: null } }),
    entrySummary({ pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: 'data-invalida' } }),
    entrySummary({ pendingCall: { id: callId, participationId: participantAId, displayName: 'Ana', calledAt: '2026-11-17T15:01:00.000Z' } }),
    entrySummary({ pendingCall: { id: callId, participationId: participantAId.toUpperCase(), displayName: 'Ana', calledAt: '2026-11-17T15:01:00.000Z' } }),
    entrySummary({
      waitingCount: 2,
      waiting: [
        { participationId: participantAId, displayName: 'Ana', position: 1 },
        { participationId: participantAId, displayName: 'Ana 2', position: 2 },
      ],
    }),
    entrySummary({
      waitingCount: 2,
      waiting: [
        { participationId: participantAId, displayName: 'Ana', position: 2 },
        { participationId: participantBId, displayName: 'Bia', position: 1 },
      ],
    }),
    // Fila externa desativada é incompatível com chamada pendente ou fila aguardando
    entrySummary({
      externalQueueEnabled: false,
      waitingCount: 0,
      waiting: [],
      pendingCall: { id: callId, participationId: participantBId, displayName: 'Bia', calledAt: '2026-11-17T15:02:00.000Z' },
    }),
    entrySummary({
      externalQueueEnabled: false,
      waitingCount: 1,
      waiting: [{ participationId: participantAId, displayName: 'Ana', position: 1 }],
      pendingCall: null,
    }),
    entrySummary({
      pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: '2026-11-17T15:01:00.000Z' },
      canCall: true,
    }),
    entrySummary({ waitingCount: 1, canCall: false }),
    entrySummary({ waitingCount: 0, waiting: [], canCall: true }),
    entrySummary({ canConfirm: true }),
    entrySummary({
      pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: '2026-11-17T15:01:00.000Z' },
      canConfirm: false,
    }),
    entrySummary({
      pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: '2026-11-17T15:01:00.000Z' },
      canMarkAbsent: true,
      canRemove: false,
    }),
    entrySummary({ canCall: 'yes' }),
  ]) {
    assert.throws(() => operations.parseStaffEntrySummary(invalid, eventId));
  }
});

test('refreshEntryControl e pollEntryControl isolam falhas parciais e descartam respostas obsoletas', async () => {
  let current = context();
  let entryOutcome = entrySummary();
  const requests = [];

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (url.endsWith('/stations')) return Promise.resolve(stations());
        if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        if (entryOutcome instanceof Promise) return entryOutcome;
        if (entryOutcome instanceof Error) return Promise.reject(entryOutcome);
        return Promise.resolve(entryOutcome);
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().entry.waitingCount, 1);

  // Polling silencioso atualiza chamada pendente com fila ativa sem apagar estações
  entryOutcome = entrySummary({
    externalQueueEnabled: true,
    waitingCount: 0,
    waiting: [],
    pendingCall: { id: callId, participationId: participantBId, displayName: 'Bia', calledAt: '2026-11-17T15:02:00.000Z' },
  });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entry.externalQueueEnabled, true);
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Bia');
  assert.equal(store.getSnapshot().entryError, null);

  // Falha de rede no polling preserva último resumo e marca stale
  entryOutcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Bia');
  assert.equal(store.getSnapshot().entryError, 'stale');

  // Retomada para fila desativada sem chamada pendente
  entryOutcome = entrySummary({
    externalQueueEnabled: false,
    waitingCount: 0,
    waiting: [],
    pendingCall: null,
  });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entry.externalQueueEnabled, false);
  assert.equal(store.getSnapshot().entry.pendingCall, null);
  assert.equal(store.getSnapshot().entryError, null);

  // Falha parcial (500) em refreshEntryControl NÃO apaga stations nem experiences
  entryOutcome = Object.assign(new Error('unavailable'), { status: 500 });
  await store.refreshEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().entryError, 'unavailable');
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().stations.length, 1, 'falha parcial não apaga estações');
  assert.equal(store.getSnapshot().experiences.length, 1, 'falha parcial não apaga experiências');

  // Erro 401 em refreshEntryControl invalida todo o dashboard
  entryOutcome = Object.assign(new Error('401'), { status: 401 });
  await store.refreshEntryControl();
  assert.equal(store.getSnapshot().stationError, 'session');
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().stations.length, 0);

  // Troca de evento descarta resposta obsoleta de entrada pendente
  const storeAsync = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: () => {
        const req = deferred();
        requests.push(req);
        return req.promise;
      },
    },
  });
  storeAsync.setContext(current);
  const oldReq = storeAsync.refreshEntryControl();
  current = context(otherEventId, 'b', 2);
  storeAsync.setContext(current);
  requests[0].resolve(entrySummary());
  await oldReq;
  assert.equal(storeAsync.getSnapshot().entry, null);
});

test('pollEntryControl e pollStations recuperam automaticamente após falhas transitórias e mantêm leituras independentes', async () => {
  const current = context();
  let stationOutcome = Object.assign(new Error('stations-500'), { status: 500 });
  let entryOutcome = Object.assign(new Error('entry-500'), { status: 500 });
  const gets = [];

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        gets.push(url);
        if (url.endsWith('/stations')) {
          return stationOutcome instanceof Error ? Promise.reject(stationOutcome) : Promise.resolve(stationOutcome);
        }
        if (url.endsWith('/experiences')) {
          return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        }
        if (url.endsWith('/entry-control')) {
          return entryOutcome instanceof Error ? Promise.reject(entryOutcome) : Promise.resolve(entryOutcome);
        }
        return Promise.reject(new Error(`URL inesperada: ${url}`));
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().stationStatus, 'error');
  assert.equal(store.getSnapshot().stationError, 'unavailable');
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().entryError, 'unavailable');

  // Nova falha transitória no polling sem dados prévios mantém status error elegível para nova tentativa (sem marcar stale)
  entryOutcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().entryError, 'network');
  assert.equal(store.getSnapshot().entry, null);

  // /entry-control recupera de forma independente mesmo com /stations ainda em erro
  entryOutcome = entrySummary({ waitingCount: 1 });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().entryError, null);
  assert.equal(store.getSnapshot().entry.waitingCount, 1);
  assert.equal(store.getSnapshot().stationStatus, 'error');

  // /stations também recupera via polling quando o servidor volta
  stationOutcome = stations();
  await store.pollStations();
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stationError, null);
  assert.equal(store.getSnapshot().stations.length, 1);
  assert.ok(gets.every((url) => typeof url === 'string'), 'somente GETs executados na recuperação');
});

test('perda de autorização (403 e 404) em /entry-control limpa dados operacionais protegidos e descarta voos pendentes', async () => {
  for (const status of [403, 404]) {
    // Caso A: 403/404 na carga inicial via refreshEntryControl invalida estações em voo e limpa dados
    const current = context();
    const stationsDeferred = deferred();
    const entryOutcome = Object.assign(new Error(`http-${status}`), { status });

    const store = createStaffDashboardStore({
      getContext: () => current,
      client: {
        get: (url) => {
          if (url.endsWith('/stations')) return stationsDeferred.promise;
          if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
          if (url.endsWith('/entry-control')) return Promise.reject(entryOutcome);
          return Promise.reject(new Error(`URL inesperada: ${url}`));
        },
      },
    });

    store.setContext(current);
    const pendingStations = store.refreshStations();
    await store.refreshExperiences();
    await store.refreshEntryControl();
    stationsDeferred.resolve(stations());
    await pendingStations;

    assert.equal(store.getSnapshot().accessStatus, 'denied');
    assert.equal(store.getSnapshot().accessLocked, true);
    assert.equal(store.getSnapshot().entryStatus, 'error');
    assert.equal(store.getSnapshot().entryError, 'denied');
    assert.equal(store.getSnapshot().stationError, 'denied');
    assert.equal(store.getSnapshot().experienceError, 'denied');
    assert.equal(store.getSnapshot().stations.length, 0);
    assert.equal(store.getSnapshot().experiences.length, 0);
    assert.equal(store.getSnapshot().entry, null);

    // Caso B: revogação detectada durante pollEntryControl também limpa estações, experiências e entrada
    let pollStep = 0;
    const storeRevokedOnPoll = createStaffDashboardStore({
      getContext: () => current,
      client: {
        get: (url) => {
          if (url.endsWith('/stations')) return Promise.resolve(stations());
          if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
          if (url.endsWith('/entry-control')) {
            pollStep += 1;
            if (pollStep === 1) return Promise.resolve(entrySummary());
            return Promise.reject(Object.assign(new Error(`http-${status}`), { status }));
          }
          return Promise.reject(new Error(`URL inesperada: ${url}`));
        },
      },
    });
    storeRevokedOnPoll.setContext(current);
    await storeRevokedOnPoll.refreshPanel();
    assert.equal(storeRevokedOnPoll.getSnapshot().stations.length, 1);

    await storeRevokedOnPoll.pollEntryControl();
    assert.equal(storeRevokedOnPoll.getSnapshot().accessLocked, true);
    assert.equal(storeRevokedOnPoll.getSnapshot().accessStatus, 'denied');
    assert.equal(storeRevokedOnPoll.getSnapshot().entryError, 'denied');
    assert.equal(storeRevokedOnPoll.getSnapshot().stationError, 'denied');
    assert.equal(storeRevokedOnPoll.getSnapshot().experienceError, 'denied');
    assert.equal(storeRevokedOnPoll.getSnapshot().stations.length, 0);
    assert.equal(storeRevokedOnPoll.getSnapshot().experiences.length, 0);
    assert.equal(storeRevokedOnPoll.getSnapshot().entry, null);
    assert.equal(storeRevokedOnPoll.getSnapshot().queue, null);

    // Após denied, polls subsequentes não executam novos GETs
    await storeRevokedOnPoll.pollEntryControl();
    assert.equal(pollStep, 2);
  }
});

test('AUD-02: bloqueio de autorização sobrevive à revalidação, GET antigo 403/404 concorrente, 500 posterior e troca de evento/sessão', async () => {
  // 1. Negativa seguida de atualização manual -> durante carregamento e se uma leitura retornar 500 permanece bloqueado
  let current = context();
  let mode = 'deny403';
  const defStations = [];
  const defExperiences = [];
  const defEntry = [];

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (mode === 'deferred') {
          const d = deferred();
          if (url.endsWith('/stations')) defStations.push(d);
          else if (url.endsWith('/experiences')) defExperiences.push(d);
          else if (url.endsWith('/entry-control')) defEntry.push(d);
          return d.promise;
        }
        if (mode === 'deny403') return Promise.reject(Object.assign(new Error('403'), { status: 403 }));
        if (mode === 'err500') {
          if (url.endsWith('/entry-control')) return Promise.reject(Object.assign(new Error('500'), { status: 500 }));
          if (url.endsWith('/stations')) return Promise.resolve(stations());
          return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        }
        if (url.endsWith('/stations')) return Promise.resolve(stations());
        if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        return Promise.resolve(entrySummary());
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessStatus, 'denied');
  assert.equal(store.getSnapshot().accessLocked, true);

  // Atualização manual enquanto pendente: mantém accessLocked=true e accessStatus='revalidating' mesmo após /stations resolver 200
  mode = 'deferred';
  const revalPromise = store.refreshPanel();
  assert.equal(store.getSnapshot().accessStatus, 'revalidating');
  assert.equal(store.getSnapshot().accessLocked, true);

  defStations[0].resolve(stations());
  defExperiences[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  await Promise.resolve();
  assert.equal(store.getSnapshot().accessLocked, true, 'não libera enquanto /entry-control ainda revalida');
  assert.equal(store.getSnapshot().accessStatus, 'revalidating');
  assert.equal(store.getSnapshot().stations.length, 0, 'não expõe estações antes de confirmação positiva completa');

  // Atualização posterior retornando 500 NÃO pode desbloquear nem expor dados parciais
  defEntry[0].reject(Object.assign(new Error('500'), { status: 500 }));
  await revalPromise;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().accessStatus, 'denied');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().entry, null);

  mode = 'err500';
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().accessStatus, 'denied');
  assert.equal(store.getSnapshot().stations.length, 0);

  // Recuperação SOMENTE após confirmação positiva 200 de todas as consultas
  mode = 'ok';
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().accessStatus, 'granted');
  assert.equal(store.getSnapshot().stations.length, 1);
  assert.equal(store.getSnapshot().entry.waitingCount, 1);

  // 2. GET antigo retornando 403/404 enquanto outro GET do mesmo contexto está em andamento invalida o GET em voo
  const reqStations = [];
  const reqEntry = [];
  const concurrentStore = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        const d = deferred();
        if (url.endsWith('/stations')) reqStations.push(d);
        else if (url.endsWith('/entry-control')) reqEntry.push(d);
        else return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        return d.promise;
      },
    },
  });
  concurrentStore.setContext(current);
  const oldGet = concurrentStore.refreshEntryControl();
  const newerGet = concurrentStore.refreshEntryControl();
  const inFlightStations = concurrentStore.refreshStations();

  // O GET antigo rejeita com 404 enquanto newerGet e inFlightStations ainda estão pendentes
  reqEntry[0].reject(Object.assign(new Error('404'), { status: 404 }));
  await oldGet;
  // Mesmo se newerGet e inFlightStations resolverem 200 logo depois, respostas são descartadas e acesso permanece bloqueado
  reqEntry[1].resolve(entrySummary());
  reqStations[0].resolve(stations());
  await Promise.all([newerGet, inFlightStations]);

  assert.equal(concurrentStore.getSnapshot().accessLocked, true);
  assert.equal(concurrentStore.getSnapshot().accessStatus, 'denied');
  assert.equal(concurrentStore.getSnapshot().entry, null);
  assert.equal(concurrentStore.getSnapshot().stations.length, 0);

  // 3. Troca de evento e sessão durante revalidação reseta bloqueio para novo contexto e descarta atrasados
  const oldRevokedDelay = deferred();
  const switchStore = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (url.includes(eventId)) return oldRevokedDelay.promise;
        if (url.endsWith('/stations')) return Promise.resolve(stations(otherEventId));
        if (url.endsWith('/experiences')) return Promise.resolve({ eventId: otherEventId, experiences: [{ id: experienceId, name: 'VR' }] });
        return Promise.resolve({ ...entrySummary(), eventId: otherEventId });
      },
    },
  });
  switchStore.setContext(current);
  const pendingOld = switchStore.refreshEntryControl();
  current = context(otherEventId, 'b', 2);
  switchStore.setContext(current);
  oldRevokedDelay.reject(Object.assign(new Error('403'), { status: 403 }));
  await pendingOld;
  assert.equal(switchStore.getSnapshot().accessLocked, false, 'negativa atrasada de outro evento/sessão não bloqueia novo contexto');
  await switchStore.refreshPanel();
  assert.equal(switchStore.getSnapshot().accessStatus, 'granted');
  assert.equal(switchStore.getSnapshot().stations[0].eventId ?? otherEventId, otherEventId);

  // 4. reportAccessDenied propaga perda confirmada pela subtela de Entrada
  switchStore.reportAccessDenied('denied');
  assert.equal(switchStore.getSnapshot().accessLocked, true);
  assert.equal(switchStore.getSnapshot().accessStatus, 'denied');
  assert.equal(switchStore.getSnapshot().stations.length, 0);
  assert.equal(switchStore.getSnapshot().entry, null);
});

test('R3-01: revalidação parcial após negativa nunca deixa domínios presos em loading (200/200/500, 500/200/200, rede após dois 200, tentativas consecutivas e troca de contexto)', async () => {
  let current = context();
  let reqStations = [];
  let reqExperiences = [];
  let reqEntry = [];
  let mode = 'deny403';

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (mode === 'deny403') return Promise.reject(Object.assign(new Error('403'), { status: 403 }));
        const d = deferred();
        if (url.endsWith('/stations')) reqStations.push(d);
        else if (url.endsWith('/experiences')) reqExperiences.push(d);
        else if (url.endsWith('/entry-control')) reqEntry.push(d);
        return d.promise;
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessLocked, true);

  // 1. Revalidação após negativa com 200, 200, 500
  mode = 'manual';
  const attempt1 = store.refreshPanel();
  assert.equal(store.getSnapshot().stationStatus, 'loading');
  assert.equal(store.getSnapshot().experienceStatus, 'loading');
  assert.equal(store.getSnapshot().entryStatus, 'loading');

  reqStations[0].resolve(stations());
  reqExperiences[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  await Promise.resolve();
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().stations.length, 0);

  reqEntry[0].reject(Object.assign(new Error('500'), { status: 500 }));
  await attempt1;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().accessStatus, 'denied');
  assert.notEqual(store.getSnapshot().stationStatus, 'loading');
  assert.notEqual(store.getSnapshot().experienceStatus, 'loading');
  assert.notEqual(store.getSnapshot().entryStatus, 'loading');
  assert.equal(store.getSnapshot().stationStatus, 'error');
  assert.equal(store.getSnapshot().experienceStatus, 'error');
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().entryError, 'unavailable');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().experiences.length, 0);
  assert.equal(store.getSnapshot().entry, null);

  // 2. Revalidação após negativa com 500, 200, 200 (falha ocorre primeiro)
  reqStations = [];
  reqExperiences = [];
  reqEntry = [];
  const attempt2 = store.refreshPanel();
  reqStations[0].reject(Object.assign(new Error('500'), { status: 500 }));
  await Promise.resolve();
  reqExperiences[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  reqEntry[0].resolve(entrySummary());
  await attempt2;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().stationStatus, 'error');
  assert.equal(store.getSnapshot().stationError, 'unavailable');
  assert.equal(store.getSnapshot().experienceStatus, 'error');
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().experiences.length, 0);
  assert.equal(store.getSnapshot().entry, null);

  // 3. Revalidação após negativa com falha de rede após dois 200
  reqStations = [];
  reqExperiences = [];
  reqEntry = [];
  const attempt3 = store.refreshPanel();
  reqStations[0].resolve(stations());
  reqEntry[0].resolve(entrySummary());
  await Promise.resolve();
  reqExperiences[0].reject(Object.assign(new Error('offline'), { isNetworkError: true }));
  await attempt3;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().stationStatus, 'error');
  assert.equal(store.getSnapshot().experienceStatus, 'error');
  assert.equal(store.getSnapshot().experienceError, 'network');
  assert.equal(store.getSnapshot().entryStatus, 'error');

  // 4. Duas tentativas consecutivas de revalidação e recuperação completa quando os três retornam 200
  reqStations = [];
  reqExperiences = [];
  reqEntry = [];
  const waveA = store.refreshPanel();
  const waveB = store.refreshPanel();
  // Respostas atrasadas da waveA não interferem na waveB
  reqStations[0].reject(Object.assign(new Error('500'), { status: 500 }));
  reqExperiences[0].resolve({ eventId, experiences: [] });
  reqEntry[0].resolve(entrySummary());
  await waveA;

  reqStations[1].resolve(stations());
  reqExperiences[1].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  reqEntry[1].resolve(entrySummary());
  await waveB;

  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().accessStatus, 'granted');
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().experienceStatus, 'ready');
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().stations.length, 1);

  // 5. Troca de evento e logout durante tentativa de revalidação
  store.reportAccessDenied('denied');
  reqStations = [];
  reqExperiences = [];
  reqEntry = [];
  const inFlightSwitch = store.refreshPanel();
  current = context(otherEventId, 'b', 2);
  store.setContext(current);
  reqStations[0].resolve(stations());
  reqExperiences[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  reqEntry[0].reject(Object.assign(new Error('500'), { status: 500 }));
  await inFlightSwitch;
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().context.eventId, otherEventId);

  current = null;
  store.setContext(null);
  assert.equal(store.getSnapshot().stationStatus, 'idle');
  assert.equal(store.getSnapshot().accessLocked, false);
});

test('R3-03: negativa 404 em fila abandonada é descartada e 404 na fila ativa diferencia experiência indisponível de perda de acesso ao evento', async () => {
  const current = context();
  let queueReqs = [];
  let stationVerifyMode = 'ok';

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (url.endsWith('/queue')) {
          const d = deferred();
          queueReqs.push({ url, d });
          return d.promise;
        }
        if (url.endsWith('/stations')) {
          if (stationVerifyMode === 'deny403') {
            return Promise.reject(Object.assign(new Error('403'), { status: 403 }));
          }
          const base = stations();
          base.stations.push({ ...base.stations[0], id: secondStationId, experienceId: secondExperienceId });
          return Promise.resolve(base);
        }
        if (url.endsWith('/experiences')) {
          return Promise.resolve({
            eventId,
            experiences: [
              { id: experienceId, name: 'Just Dance' },
              { id: secondExperienceId, name: 'Street Fighter' },
            ],
          });
        }
        return Promise.resolve(entrySummary());
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().stations.length, 2);

  // 1. 404 tardio da fila após saída da estação (clearQueue) não bloqueia o evento
  const abandonedExit = store.refreshQueue(experienceId);
  store.clearQueue();
  queueReqs[0].d.reject(Object.assign(new Error('404'), { status: 404 }));
  await abandonedExit;
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stations.length, 2);
  assert.equal(store.getSnapshot().queueStatus, 'idle');

  // 2. 404 tardio da fila anterior após troca de estação/experiência não afeta a nova fila nem bloqueia o evento
  queueReqs = [];
  const firstQueue = store.refreshQueue(experienceId);
  const secondQueue = store.refreshQueue(secondExperienceId);
  queueReqs[1].d.resolve({ ...queue(), experienceId: secondExperienceId });
  await secondQueue;
  queueReqs[0].d.reject(Object.assign(new Error('404'), { status: 404 }));
  await firstQueue;
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().queueStatus, 'ready');
  assert.equal(store.getSnapshot().queue.experienceId, secondExperienceId);

  // 3. 404 na fila ativa com acesso ao evento ainda válido bloqueia apenas a fila e preserva dados do painel
  queueReqs = [];
  stationVerifyMode = 'ok';
  const active404ValidEvent = store.pollQueue(secondExperienceId);
  queueReqs[0].d.reject(Object.assign(new Error('404'), { status: 404 }));
  await active404ValidEvent;
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().accessStatus, 'granted');
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stations.length, 2);
  assert.equal(store.getSnapshot().experienceStatus, 'ready');
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().queueStatus, 'error');
  assert.equal(store.getSnapshot().queueError, 'denied');
  assert.equal(store.getSnapshot().queue, null);

  // 4. 404 na fila ativa com perda real de acesso ao evento (403 em /stations) bloqueia todo o evento
  queueReqs = [];
  stationVerifyMode = 'deny403';
  const active404RevokedEvent = store.refreshQueue(secondExperienceId);
  queueReqs[0].d.reject(Object.assign(new Error('404'), { status: 404 }));
  await active404RevokedEvent;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().accessStatus, 'denied');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().experiences.length, 0);
  assert.equal(store.getSnapshot().entry, null);
  assert.equal(store.getSnapshot().queue, null);
});

async function startQueueAccessVerification({ poll = false } = {}) {
  let current = context();
  let stationResult = stations();
  let queueDenied = false;
  let verificationPending = false;
  const verificationStarted = deferred();
  const verification = deferred();
  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      async get(url) {
        if (url.endsWith('/queue')) {
          if (!queueDenied) return queue(current.eventId);
          verificationPending = true;
          throw Object.assign(new Error('Fila indisponível'), { status: 404 });
        }
        if (url.endsWith('/stations')) {
          if (verificationPending) {
            verificationPending = false;
            verificationStarted.resolve();
            return verification.promise;
          }
          return stationResult;
        }
        if (url.endsWith('/experiences')) {
          return { eventId: current.eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] };
        }
        if (url.endsWith('/entry-control')) return entrySummary({ eventId: current.eventId });
        throw new Error(`GET inesperado: ${url}`);
      },
    },
  });

  store.setContext(current);
  await store.refreshPanel();
  if (poll) await store.refreshQueue(experienceId);
  queueDenied = true;
  const queueRead = poll ? store.pollQueue() : store.refreshQueue(experienceId);
  await Promise.race([
    verificationStarted.promise,
    queueRead.then(() => assert.fail('O 404 da fila deve iniciar a verificação de acesso ao evento')),
  ]);
  return {
    store, verification, queueRead,
    setStations(next) { stationResult = next; },
    setContext(next) { current = next; store.setContext(next); },
  };
}

test('verificação de acesso atrasada após 404 preserva estações atualizadas no retorno ao painel', async () => {
  const { store, verification, queueRead, setStations } = await startQueueAccessVerification();
  const newer = stations();
  newer.stations[0].pendingServiceSessionId = secondStationId;

  store.clearQueue();
  setStations(newer);
  await store.revalidateOnReturn();
  assert.equal(store.getSnapshot().stations[0].pendingServiceSessionId, secondStationId);

  verification.resolve(stations());
  await queueRead;
  assert.equal(store.getSnapshot().stations[0].pendingServiceSessionId, secondStationId);
  assert.equal(store.getSnapshot().stationStatus, 'ready');
  assert.equal(store.getSnapshot().stationError, null);
});

test('verificação positiva após abandonar a fila preserva a fila limpa e o erro da leitura normal', async () => {
  const { store, verification, queueRead, setStations } = await startQueueAccessVerification();
  store.clearQueue();
  setStations({ eventId, stations: null });
  await store.refreshStations();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.stationStatus, 'error');
  assert.equal(snapshot.stationError, 'unavailable');
  assert.equal(snapshot.queueStatus, 'idle');
  assert.equal(snapshot.experienceId, null);
  assert.equal(snapshot.queue, null);
  assert.equal(snapshot.accessLocked, false);

  verification.resolve(stations());
  await queueRead;
  assert.equal(store.getSnapshot(), snapshot);
});

test('negativa confirmada na verificação de escopo do evento limpa os dados protegidos', async () => {
  for (const status of [403, 404]) {
    const { store, verification, queueRead } = await startQueueAccessVerification();
    assert.equal(store.getSnapshot().queueError, 'denied');
    assert.equal(store.getSnapshot().accessLocked, false);

    verification.reject(Object.assign(new Error('Acesso ao evento negado'), { status }));
    await queueRead;
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.accessStatus, 'denied');
    assert.equal(snapshot.accessLocked, true);
    assert.equal(snapshot.stations.length, 0);
    assert.equal(snapshot.experiences.length, 0);
    assert.equal(snapshot.entry, null);
    assert.equal(snapshot.queue, null);
  }
});

test('falha transitória na verificação mantém só a fila bloqueada e preserva as estações', async () => {
  for (const details of [{ status: 500 }, { isNetworkError: true }]) {
    const { store, verification, queueRead } = await startQueueAccessVerification({ poll: true });
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.queueStatus, 'error');
    assert.equal(snapshot.queueError, 'denied');
    assert.equal(snapshot.queue, null);
    assert.equal(snapshot.accessStatus, 'granted');
    assert.equal(snapshot.accessLocked, false);
    assert.equal(snapshot.stationError, null);

    verification.reject(Object.assign(new Error('Falha transitória'), details));
    await queueRead;
    assert.equal(store.getSnapshot(), snapshot);
  }
});

test('verificação antiga preserva o novo evento, o logout e a revogação do contexto vigente', async () => {
  const switched = await startQueueAccessVerification();
  switched.setContext(context(otherEventId));
  switched.setStations(stations(otherEventId));
  await switched.store.refreshPanel();
  const nextEvent = switched.store.getSnapshot();
  assert.equal(nextEvent.context.eventId, otherEventId);
  assert.equal(nextEvent.stationStatus, 'ready');
  switched.verification.reject(Object.assign(new Error('Evento anterior'), { status: 404 }));
  await switched.queueRead;
  assert.equal(switched.store.getSnapshot(), nextEvent);

  const loggedOut = await startQueueAccessVerification();
  loggedOut.setContext(null);
  const empty = loggedOut.store.getSnapshot();
  loggedOut.verification.resolve(stations());
  await loggedOut.queueRead;
  assert.equal(loggedOut.store.getSnapshot(), empty);

  const revoked = await startQueueAccessVerification();
  revoked.store.reportAccessDenied();
  const locked = revoked.store.getSnapshot();
  assert.equal(locked.accessLocked, true);
  revoked.verification.resolve(stations());
  await revoked.queueRead;
  assert.equal(revoked.store.getSnapshot(), locked);
});

test('R3-04: recuperação controlada de experiências desconhecidas (GET em voo, falha de rede, mesma assinatura e inexistente sem loop)', async () => {
  let current = context();
  const expReqs = [];
  let stationList = stations().stations;

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (url.endsWith('/stations')) return Promise.resolve({ eventId: current.eventId, stations: stationList });
        if (url.endsWith('/entry-control')) return Promise.resolve({ ...entrySummary(), eventId: current.eventId });
        if (url.endsWith('/experiences')) {
          const d = deferred();
          expReqs.push(d);
          return d.promise;
        }
        return Promise.resolve({});
      },
    },
  });

  store.setContext(current);
  const initPromise = store.refreshPanel();
  expReqs[0].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  await initPromise;
  assert.equal(store.getSnapshot().experienceStatus, 'ready');

  // 1. Experiência desconhecida surge enquanto um GET /experiences já estava em andamento
  const inFlightExp = store.pollExperiences();
  assert.equal(expReqs.length, 2);

  // Antes de expReqs[1] terminar, chega uma estação apontando para secondExperienceId (órfã)
  stationList = [
    ...stations().stations,
    { ...stations().stations[0], id: secondStationId, experienceId: secondExperienceId, name: 'Estação Órfã' },
  ];
  await store.pollStations();

  // syncOrphanExperiences chamado enquanto expReqs[1] está em voo não dispara requisição duplicada nem queima a assinatura
  await store.syncOrphanExperiences();
  assert.equal(expReqs.length, 2);

  // expReqs[1] (iniciada antes da órfã existir) resolve sem secondExperienceId
  expReqs[1].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  await inFlightExp;

  // Agora syncOrphanExperiences deve disparar 1 nova consulta para a assinatura órfã atual
  const orphanRetry1 = store.syncOrphanExperiences();
  assert.equal(expReqs.length, 3);

  // 2. Falha inicial de rede ao tentar sincronizar a experiência desconhecida
  expReqs[2].reject(Object.assign(new Error('offline'), { isNetworkError: true }));
  await orphanRetry1;
  assert.equal(store.getSnapshot().experienceError, 'stale');
  // Enquanto stale, syncOrphanExperiences não entra em loop síncrono imediato; aguarda o polling de 5s
  await store.syncOrphanExperiences();
  assert.equal(expReqs.length, 3);

  // 3. Recuperação posterior pelo polling de 5s mantendo a mesma assinatura e encontrando a experiência
  const pollRecovery = store.pollExperiences();
  assert.equal(expReqs.length, 4);
  expReqs[3].resolve({
    eventId,
    experiences: [
      { id: experienceId, name: 'Just Dance' },
      { id: secondExperienceId, name: 'Street Fighter' },
    ],
  });
  await pollRecovery;
  assert.equal(store.getSnapshot().experienceError, null);
  assert.equal(store.getSnapshot().experiences.length, 2);

  // 4. Experiência persistentemente inexistente não gera loop infinito após resposta 200 válida
  const unknownExpId = '99999999-9999-4999-8999-999999999999';
  stationList = [
    ...stationList,
    { ...stations().stations[0], id: '88888888-8888-4888-8888-888888888888', experienceId: unknownExpId, name: 'Estação Fantasma' },
  ];
  await store.pollStations();

  const ghostCheck = store.syncOrphanExperiences();
  assert.equal(expReqs.length, 5);
  expReqs[4].resolve({
    eventId,
    experiences: [
      { id: experienceId, name: 'Just Dance' },
      { id: secondExperienceId, name: 'Street Fighter' },
    ],
  });
  await ghostCheck;

  // Nova chamada com a mesma assinatura não dispara outra requisição (sem loop infinito)
  await store.syncOrphanExperiences();
  assert.equal(expReqs.length, 5);

  // 5. Troca de evento durante tentativa descarta resposta antiga
  const refreshBeforeSwitch = store.refreshExperiences();
  assert.equal(expReqs.length, 6);
  current = context(otherEventId, 'b', 2);
  store.setContext(current);
  expReqs[5].resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
  await refreshBeforeSwitch;
  assert.equal(store.getSnapshot().context.eventId, otherEventId);
  assert.equal(store.getSnapshot().experiences.length, 0);
});

test('STAFF02-AUD-01: verifyStationAccess limpa cache nominal imediatamente, separa verificação (Caso A/B/C) e descarta respostas tardias', async () => {
  let current = context();
  let nextStationsResponse = null;
  let stationCalls = 0;
  let postCalls = 0;

  function startWithControlledStations(startRequest) {
    assert.equal(nextStationsResponse, null, 'não deve haver resposta de /stations pendente de consumo');
    const response = deferred();
    nextStationsResponse = response;
    const result = startRequest();
    assert.equal(nextStationsResponse, null, 'a requisição deve consumir a resposta de /stations programada');
    return { response, result };
  }

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: (url) => {
        if (url.endsWith('/stations')) {
          stationCalls += 1;
          const response = nextStationsResponse;
          nextStationsResponse = null;
          return response?.promise ?? Promise.resolve(stations(current.eventId));
        }
        if (url.endsWith('/experiences')) {
          return Promise.resolve({ eventId: current.eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
        }
        if (url.endsWith('/entry-control')) {
          return Promise.resolve(entrySummary({
            eventId: current.eventId,
            waitingCount: 0,
            waiting: [],
            canCall: false,
            pendingCall: {
              id: callId,
              participationId: participantBId,
              displayName: 'Carlos Nominal Cache',
              calledAt: '2026-11-17T15:01:00.000Z',
            },
          }));
        }
        return Promise.resolve({});
      },
      post: async () => {
        postCalls += 1;
        throw new Error('POST inesperado durante a verificação de acesso');
      },
    },
  });

  // Carrega painel com dados nominais em cache
  store.setContext(current);
  await store.refreshPanel();
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Carlos Nominal Cache');
  assert.equal(store.getSnapshot().stations.length, 1);

  // Caso A: verifyStationAccess limpa cache imediatamente antes de /stations resolver e NÃO publica a lista de verificação
  const verify = () => store.verifyStationAccess({ stationId, experienceId });
  const callsBeforeVerify = stationCalls;
  const { response: responseA, result: caseA } = startWithControlledStations(verify);
  assert.equal(stationCalls, callsBeforeVerify + 1);
  assert.equal(store.getSnapshot().verifyingAccess, true);
  assert.equal(store.getSnapshot().accessUncertain, true);
  assert.equal(store.getSnapshot().entry, null, 'dados nominais removidos enquanto verificação está pendente');
  assert.equal(store.getSnapshot().stations.length, 0);
  assert.equal(store.getSnapshot().experiences.length, 0);

  // revalidateOnReturn durante verificação pendente não dispara leituras concorrentes prematuras
  await store.revalidateOnReturn();
  assert.equal(stationCalls, callsBeforeVerify + 1);

  // /stations resolve 200 (Caso A) -> libera incerteza de evento sem publicar dados de verificação como atualização do painel
  responseA.resolve(stations(current.eventId));
  const resA = await caseA;
  assert.equal(resA.outcome, 'local_denied');
  assert.equal(store.getSnapshot().accessLocked, false);
  assert.equal(store.getSnapshot().verifyingAccess, false);
  assert.equal(store.getSnapshot().accessUncertain, false);
  assert.equal(store.getSnapshot().stations.length, 0, 'consulta de verificação não publica dados operacionais do painel');
  assert.equal(store.getSnapshot().entry, null);

  // Caso C: /stations falha com 500/rede -> mantém cache limpo, accessUncertain=true, barra poll/parcial e recupera no refreshPanel completo
  await store.refreshPanel();
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Carlos Nominal Cache');

  for (const errDetails of [{ status: 500 }, { isNetworkError: true }]) {
    const { response, result: caseC } = startWithControlledStations(verify);
    response.reject(Object.assign(new Error('transient'), errDetails));
    const resC = await caseC;
    assert.equal(resC.outcome, 'uncertain');
    assert.equal(store.getSnapshot().accessLocked, false);
    assert.equal(store.getSnapshot().verifyingAccess, false);
    assert.equal(store.getSnapshot().accessUncertain, true);
    assert.equal(store.getSnapshot().entry, null);
    assert.equal(store.getSnapshot().stations.length, 0);

    // refreshPanel parcial (entry=200 antes de stations falhar 500) não expõe dados parciais enquanto accessUncertain=true
    const { response: retryResponse, result: partialRetry } = startWithControlledStations(() => store.refreshPanel());
    await Promise.resolve();
    assert.equal(store.getSnapshot().entry, null, 'não expõe entry antes da confirmação completa');
    retryResponse.reject(Object.assign(new Error('still-500'), { status: 500 }));
    await partialRetry;
    assert.equal(store.getSnapshot().accessUncertain, true);
    assert.equal(store.getSnapshot().entry, null);
    assert.notEqual(store.getSnapshot().entryStatus, 'loading');
  }

  // Recuperação completa 200 libera acessoUncertain
  await store.refreshPanel();
  assert.equal(store.getSnapshot().accessUncertain, false);
  assert.equal(store.getSnapshot().accessStatus, 'granted');
  assert.equal(store.getSnapshot().stations.length, 1);

  // Caso B: /stations responde 401, 403 ou 404 -> bloqueia evento/sessão e mantém tudo limpo
  for (const [status, expectedOutcome, expectedStatus] of [
    [403, 'event_denied', 'denied'],
    [404, 'event_denied', 'denied'],
    [401, 'session', 'session'],
  ]) {
    current = context(eventId, 'a', current.revision + 1);
    store.setContext(current);
    await store.refreshPanel();
    assert.equal(store.getSnapshot().accessStatus, 'granted', `painel reinicializado antes da verificação com ${status}`);
    assert.equal(store.getSnapshot().accessLocked, false);
    assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Carlos Nominal Cache');

    const { response, result: caseB } = startWithControlledStations(verify);
    response.reject(Object.assign(new Error(String(status)), { status }));
    const resB = await caseB;
    assert.equal(resB.outcome, expectedOutcome);
    assert.equal(store.getSnapshot().accessLocked, true);
    assert.equal(store.getSnapshot().accessStatus, expectedStatus);
    assert.equal(store.getSnapshot().verifyingAccess, false);
    assert.equal(store.getSnapshot().accessUncertain, false);
    assert.equal(store.getSnapshot().entry, null);
    assert.equal(store.getSnapshot().stations.length, 0);
  }

  // Uma negativa tardia pertence ao evento e à conta de origem.
  for (const nextContext of [context(otherEventId, 'a'), context(eventId, 'b')]) {
    current = context(eventId, 'a', current.revision + 1);
    store.setContext(current);
    await store.refreshPanel();
    const { response, result: staleVerify } = startWithControlledStations(verify);

    current = nextContext;
    store.setContext(current);
    response.reject(Object.assign(new Error('403-old'), { status: 403 }));
    const resStale = await staleVerify;
    assert.equal(resStale.outcome, 'stale');
    assert.equal(store.getSnapshot().context.eventId, nextContext.eventId);
    assert.equal(store.getSnapshot().context.userId, nextContext.userId);
    assert.equal(store.getSnapshot().accessLocked, false);
    assert.equal(store.getSnapshot().entry, null);
  }
  assert.equal(postCalls, 0, 'a verificação de acesso não envia POST');
});

test('STAFF-04: timeout classifica como network e pollQueue recupera automaticamente após erro inicial transitório sem fabricar fila vazia', async () => {
  const current = context();
  let stationMode = 'ok';
  let queueMode = 'timeout';
  let queueGets = 0;

  const store = createStaffDashboardStore({
    getContext: () => current,
    client: {
      get: async (url) => {
        if (url.endsWith('/stations')) {
          if (stationMode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
          return stations();
        }
        if (url.endsWith('/experiences')) {
          return { eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] };
        }
        if (url.endsWith('/entry-control')) {
          return entrySummary();
        }
        if (url.endsWith('/queue')) {
          queueGets += 1;
          if (queueMode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
          if (queueMode === '503') throw Object.assign(new Error('503'), { status: 503 });
          if (queueMode === 'malformed') return { eventId, experienceId, waitingCount: -1 };
          if (queueMode === '403') throw Object.assign(new Error('403'), { status: 403 });
          return { ...queue(), waitingCount: 3, canCallWaitingEntries: true, firstWaitingQueueEntryId: stationId };
        }
        throw new Error(`URL inesperada: ${url}`);
      },
    },
  });

  store.setContext(current);
  stationMode = 'timeout';
  await store.refreshStations();
  assert.equal(store.getSnapshot().stationStatus, 'error');
  assert.equal(store.getSnapshot().stationError, 'network', 'timeout em /stations classifica como network');

  stationMode = 'ok';
  await store.refreshPanel();
  assert.equal(store.getSnapshot().stationStatus, 'ready');

  // Falha inicial por timeout em /queue mantém queue=null e permite recuperação automática via pollQueue
  await store.refreshQueue(experienceId);
  assert.equal(store.getSnapshot().queueStatus, 'error');
  assert.equal(store.getSnapshot().queueError, 'network');
  assert.equal(store.getSnapshot().queue, null);

  // Nova falha transitória (503 e payload inválido) no pollQueue mantém status error sem fabricar fila vazia
  queueMode = '503';
  await store.pollQueue(experienceId);
  assert.equal(store.getSnapshot().queueStatus, 'error');
  assert.equal(store.getSnapshot().queueError, 'unavailable');
  assert.equal(store.getSnapshot().queue, null);

  queueMode = 'malformed';
  await store.pollQueue(experienceId);
  assert.equal(store.getSnapshot().queueStatus, 'error');
  assert.equal(store.getSnapshot().queueError, 'unavailable');
  assert.equal(store.getSnapshot().queue, null);

  // Recuperação automática por GET publica dados oficiais sem precisar sair da tela
  queueMode = 'ok';
  await store.pollQueue(experienceId);
  assert.equal(store.getSnapshot().queueStatus, 'ready');
  assert.equal(store.getSnapshot().queueError, null);
  assert.equal(store.getSnapshot().queue.waitingCount, 3);

  // Negativa de autorização (403) bloqueia acesso e impede novas consultas em pollQueue
  queueMode = '403';
  await store.pollQueue(experienceId);
  const callsAfter403 = queueGets;
  assert.equal(store.getSnapshot().accessLocked, true);
  assert.equal(store.getSnapshot().queue, null);
  await store.pollQueue(experienceId);
  assert.equal(queueGets, callsAfter403, 'pollQueue não volta a consultar após 403');
});
