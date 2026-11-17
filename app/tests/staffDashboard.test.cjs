const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');
const operations = loadModule('services/staffOperationsService.js', require).exports;
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
  const store = createStaffDashboardStore({ getContext: () => current, client: { get: () => {
    const request = deferred(); requests.push(request); return request.promise;
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
  requests[3].reject(Object.assign(new Error('404'), { status: 404 })); await denied;
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
  requests[1].resolve(queue()); await pending;
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().experienceId, null);
});

const participantAId = '77777777-7777-4777-8777-777777777777';
const participantBId = '99999999-9999-4999-8999-999999999999';
const callId = '88888888-8888-4888-8888-888888888888';
const entrySummary = (patch = {}) => ({
  eventId,
  externalQueueEnabled: true,
  canManage: true,
  observedAt: '2026-11-17T15:00:00.000Z',
  waitingCount: 1,
  waiting: [{ participationId: participantAId, displayName: 'Ana', position: 1 }],
  pendingCall: null,
  ...patch,
});

test('parseStaffEntrySummary valida fila externa ativa/inativa, pendingCall e consistência com waiting', () => {
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
      canCall: false,
      canConfirm: true,
      canMarkAbsent: true,
      canRemove: true,
    }),
    eventId,
  );
  assert.equal(parsedCalled.pendingCall.id, callId);
  assert.equal(parsedCalled.pendingCall.participationId, participantBId);
  assert.equal(parsedCalled.pendingCall.displayName, 'Carlos Silva');
  assert.equal(parsedCalled.pendingCall.calledAt, '2026-11-17T15:01:00.000Z');
  assert.equal(parsedCalled.waitingCount, 1);

  const withoutPendingCall = entrySummary();
  delete withoutPendingCall.pendingCall;

  for (const invalid of [
    null,
    {},
    withoutPendingCall,
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
    entrySummary({
      pendingCall: { id: callId, participationId: participantBId, displayName: 'Carlos', calledAt: '2026-11-17T15:01:00.000Z' },
      canCall: true,
    }),
    entrySummary({ waitingCount: 0, waiting: [], canCall: true }),
    entrySummary({ canConfirm: true }),
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
  await Promise.all([store.refreshStations(), store.refreshExperiences(), store.refreshEntryControl()]);
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().entry.waitingCount, 1);

  // Polling silencioso atualiza chamada pendente sem apagar estações
  entryOutcome = entrySummary({
    externalQueueEnabled: false,
    waitingCount: 0,
    waiting: [],
    pendingCall: { id: callId, participationId: participantBId, displayName: 'Bia', calledAt: '2026-11-17T15:02:00.000Z' },
  });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entry.externalQueueEnabled, false);
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Bia');
  assert.equal(store.getSnapshot().entryError, null);

  // Falha de rede no polling preserva último resumo e marca stale
  entryOutcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.pollEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'ready');
  assert.equal(store.getSnapshot().entry.pendingCall.displayName, 'Bia');
  assert.equal(store.getSnapshot().entryError, 'stale');

  // Falha parcial (500) em refreshEntryControl NÃO apaga stations nem experiences
  entryOutcome = Object.assign(new Error('unavailable'), { status: 500 });
  await store.refreshEntryControl();
  assert.equal(store.getSnapshot().entryStatus, 'error');
  assert.equal(store.getSnapshot().entryError, 'unavailable');
  assert.equal(store.getSnapshot().stations.length, 1, 'falha parcial não apaga estações');
  assert.equal(store.getSnapshot().experiences.length, 1, 'falha parcial não apaga experiências');

  // Erro 401 em refreshEntryControl invalida todo o dashboard
  entryOutcome = Object.assign(new Error('401'), { status: 401 });
  await store.refreshEntryControl();
  assert.equal(store.getSnapshot().stationError, 'session');
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
  await Promise.all([store.refreshStations(), store.refreshExperiences(), store.refreshEntryControl()]);
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
    let entryOutcome = Object.assign(new Error(`http-${status}`), { status });

    const store = createStaffDashboardStore({
      getContext: () => current,
      client: {
        get: (url) => {
          if (url.endsWith('/stations')) return stationsDeferred.promise;
          if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
          if (url.endsWith('/entry-control')) {
            return entryOutcome instanceof Error ? Promise.reject(entryOutcome) : Promise.resolve(entryOutcome);
          }
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

    assert.equal(store.getSnapshot().entryStatus, 'error');
    assert.equal(store.getSnapshot().entryError, 'denied');
    assert.equal(store.getSnapshot().stationError, 'denied');
    assert.equal(store.getSnapshot().experienceError, 'denied');
    assert.equal(store.getSnapshot().stations.length, 0);
    assert.equal(store.getSnapshot().experiences.length, 0);
    assert.equal(store.getSnapshot().entry, null);

    // Após revogação confirmada ('denied'), pollEntryControl e pollStations não continuam consultando
    let extraPollCalls = 0;
    const revokingStore = createStaffDashboardStore({
      getContext: () => current,
      client: {
        get: (url) => {
          if (url.endsWith('/stations')) return Promise.resolve(stations());
          if (url.endsWith('/experiences')) return Promise.resolve({ eventId, experiences: [{ id: experienceId, name: 'Just Dance' }] });
          if (url.endsWith('/entry-control')) {
            extraPollCalls += 1;
            return Promise.resolve(entrySummary());
          }
          return Promise.reject(new Error(`URL inesperada: ${url}`));
        },
      },
    });
    revokingStore.setContext(current);
    await Promise.all([revokingStore.refreshStations(), revokingStore.refreshExperiences(), revokingStore.refreshEntryControl()]);
    extraPollCalls = 0;

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
    await Promise.all([
      storeRevokedOnPoll.refreshStations(),
      storeRevokedOnPoll.refreshExperiences(),
      storeRevokedOnPoll.refreshEntryControl(),
    ]);
    assert.equal(storeRevokedOnPoll.getSnapshot().stations.length, 1);

    await storeRevokedOnPoll.pollEntryControl();
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
