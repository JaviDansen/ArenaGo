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
