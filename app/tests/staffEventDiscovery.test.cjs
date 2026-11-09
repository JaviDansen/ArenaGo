const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { parseStaffEvents, createStaffEventsStore } = loadModule('services/staffEventsService.js', require).exports;
const event = { id: '11111111-1111-4111-8111-111111111111', name: 'Evento real', status: 'open' };
const identity = (userId = 'a', epoch = 1, revision = 1) => ({ userId, epoch, revision });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };

test('lista Staff aceita somente o contrato conhecido e preserva o ID para seleção', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseStaffEvents({ events: [event] }))), [event]);
  assert.equal(parseStaffEvents({ events: [] }).length, 0);
  for (const body of [null, {}, { events: null }, { events: [{ ...event, id: 'outro' }] },
    { events: [{ ...event, name: '' }] }, { events: [{ ...event, status: 'unknown' }] },
    { events: [event, event] }]) assert.throws(() => parseStaffEvents(body));
});

test('consulta autenticada, seleção e atualização manual removem seleção anterior', async () => {
  let current = identity();
  const calls = [];
  let response = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async (...args) => { calls.push(args); return response; } },
    getIdentity: () => current });
  store.setIdentity(current);
  assert.equal(store.select(event.id), false, 'seleção aguarda resposta autorizada');
  await store.refresh();
  assert.equal(calls[0][0], '/staff/events');
  assert.equal(calls[0][1].auth, true);
  assert.equal(store.select('11111111-1111-4111-8111-111111111112'), false);
  assert.equal(store.select(event.id), true);
  assert.equal(store.getSnapshot().selected.id, event.id);
  response = { events: [] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.getSnapshot().selected, null);
});

test('401 e falha de rede limpam dados e permitem atualização posterior', async () => {
  const current = identity();
  let outcome = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  } }, getIdentity: () => current });
  store.setIdentity(current);
  await store.refresh();
  store.select(event.id);
  outcome = Object.assign(new Error('unauthorized'), { status: 401 });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'session');
  assert.equal(store.getSnapshot().selected, null);
  assert.equal(store.getSnapshot().events.length, 0);
  outcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'network');
  outcome = { events: [event] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
});

test('troca de conta, geração, revisão e respostas fora de ordem descartam dados antigos', async () => {
  let current = identity();
  const requests = [];
  const store = createStaffEventsStore({ client: { get: () => { const pending = deferred(); requests.push(pending); return pending.promise; } },
    getIdentity: () => current });
  store.setIdentity(current);
  const first = store.refresh();
  const second = store.refresh();
  requests[1].resolve({ events: [] });
  await second;
  requests[0].resolve({ events: [event] });
  await first;
  assert.equal(store.getSnapshot().events.length, 0);

  const third = store.refresh();
  current = identity('b', 2, 2);
  store.setIdentity(current);
  requests[2].resolve({ events: [event] });
  await third;
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.select(event.id), false);
  current = identity('b', 2, 3);
  assert.equal(store.isCurrent(), false, 'revalidação bloqueia imediatamente o estado anterior');
  store.setIdentity(null);
  assert.equal(store.getSnapshot().selected, null);
});
