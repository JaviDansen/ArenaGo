const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT = '11111111-1111-4111-8111-111111111111';
const PARTICIPATION = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const lookupBody = {
  event: { id: EVENT, name: 'Arena', timezone: 'America/Sao_Paulo',
    startsAt: '2026-11-08T10:00:00.000Z', officialEndsAt: '2026-11-08T20:00:00.000Z',
    operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: true },
  eligibility: { eligible: true, blockingReasons: [] },
};
const service = loadModule('services/eventAdmissionService.js', (name) => {
  if (name === 'react-native') return { Platform: { OS: 'web' } };
  if (name === 'expo-crypto') return { randomUUID: () => KEY };
  if (name === 'expo-secure-store') return {};
  if (name === './httpClient') return { httpClient: {} };
  return require(name);
}).exports;


function rig({ post, refresh, storage } = {}) {
  let epoch = 1;
  let identity = { userId: USER_A, epoch };
  let current = { userId: USER_A, epoch, status: 'ready', participation: null };

  const requests = [];
  const intentStorage = storage ?? service.createAdmissionIntentStorage({ platformOS: 'web' });

  const store = service.createEventAdmissionStore({
    client: {
      post: async (...args) => {
        requests.push(args);
        return post
          ? post(...args)
          : args[0] === '/events/lookup'
            ? lookupBody
            : { participationId: PARTICIPATION };
      },
    },
    getIdentity: () => identity,
    refreshParticipation: async () => {
      if (refresh) {
        return refresh((value) => { current = value; });
      }

      current = {
        ...current,
        participation: {
          id: PARTICIPATION,
          eventId: EVENT,
          status: 'waiting',
          externalQueue: { position: 7 },
        },
      };
    },
    getParticipationSnapshot: () => current,
    intentStorage,
    createKey: () => KEY,
  });

  store.setIdentity(identity);

  return {
    store,
    requests,
    intentStorage,

    switchTo(userId) {
      epoch += 1;
      identity = userId ? { userId, epoch } : null;

      current = {
        userId: identity?.userId ?? null,
        epoch: identity?.epoch ?? null,
        status: 'ready',
        participation: null,
      };

      store.setIdentity(identity);
    },
  };
}


test('consulta autenticada valida o contrato, inclusive inelegibilidade', async () => {
  const h = rig({ post: async () => ({ ...lookupBody,
    eligibility: { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } }) });
  const result = await h.store.lookup('  Código X  ');
  assert.equal(result.kind, 'found');
  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(structuredClone(h.requests[0]), ['/events/lookup', { accessCode: 'Código X' }, { auth: true }]);
  assert.equal((await h.store.confirm(EVENT)).kind, 'error');
  assert.equal(h.requests.length, 1);
});

test('código vazio e resposta inválida impedem navegação e ingresso', async () => {
  const h = rig({ post: async () => ({ event: { id: 'bad' }, eligibility: {} }) });
  assert.equal((await h.store.lookup('  ')).kind, 'error');
  assert.equal(h.requests.length, 0);
  assert.equal((await h.store.lookup('X')).kind, 'error');
  assert.equal(h.store.getSnapshot().event, null);
});

test('erro 401 ou evento inexistente mantém o estado sem evento', async () => {
  for (const error of [{ status: 401, code: 'SESSION_EXPIRED' }, { status: 404, code: 'EVENT_NOT_FOUND' }]) {
    const h = rig({ post: async () => { throw error; } });
    assert.equal((await h.store.lookup('X')).kind, 'error');
    assert.equal(h.store.getSnapshot().event, null);
    assert.ok(h.store.getSnapshot().error);
  }
});

test('ingresso único usa chave segura e sincroniza participação waiting real', async () => {
  const h = rig();
  await h.store.lookup('ABC');
  const result = await h.store.confirm(EVENT);
  assert.equal(result.kind, 'complete');
  assert.equal(result.participation.externalQueue.position, 7);
  assert.equal(h.store.getSnapshot().status, 'complete');
  assert.deepEqual(structuredClone(h.requests[1]), ['/participations', { eventId: EVENT },
    { auth: true, headers: { 'Idempotency-Key': KEY }, outcomeUnknownOnNetworkError: true }]);
  assert.equal(await h.intentStorage.get(USER_A), null);
});

test('duplo toque compartilha uma única requisição POST', async () => {
  let release, count = 0;
  const h = rig({ post: async (path) => {
    if (path === '/events/lookup') return lookupBody;
    count++;
    return new Promise((resolve) => { release = resolve; });
  } });
  await h.store.lookup('ABC');
  const first = h.store.confirm(EVENT), second = h.store.confirm(EVENT);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
  release({ participationId: PARTICIPATION });
  assert.equal((await first).kind, 'complete');
  assert.equal((await second).kind, 'complete');
});

test('erro de rede ou timeout preserva a chave e repete a mesma operação', async () => {
  for (const error of [{ isNetworkError: true }, { isNetworkError: true, isTimeout: true }]) {
    let attempt = 0;
    const h = rig({ post: async (path) => {
      if (path === '/events/lookup') return lookupBody;
      if (++attempt === 1) throw error;
      return { participationId: PARTICIPATION };
    } });
    await h.store.lookup('ABC');
    assert.equal((await h.store.confirm(EVENT)).kind, 'uncertain');
    assert.equal((await h.intentStorage.get(USER_A)).key, KEY);
    assert.equal((await h.store.confirm(EVENT)).kind, 'complete');
    assert.equal(h.requests[1][2].headers['Idempotency-Key'], h.requests[2][2].headers['Idempotency-Key']);
  }
});

test('resposta HTTP inválida ou erro 5xx preserva chave para retry seguro', async () => {
  for (const firstResponse of [null, { error: { status: 503 } }]) {
    let attempt = 0;
    const h = rig({ post: async (path) => {
      if (path === '/events/lookup') return lookupBody;
      if (++attempt === 1) {
        if (firstResponse?.error) throw firstResponse.error;
        return firstResponse;
      }
      return { participationId: PARTICIPATION };
    } });
    await h.store.lookup('ABC');
    assert.equal((await h.store.confirm(EVENT)).kind, 'uncertain');
    assert.equal((await h.store.confirm(EVENT)).kind, 'complete');
    assert.equal(h.requests[1][2].headers['Idempotency-Key'], KEY);
    assert.equal(h.requests[2][2].headers['Idempotency-Key'], KEY);
  }
});

test('HTTP 201 seguido de falha no GET permite apenas ressincronizar', async () => {
  let refreshes = 0;
  const h = rig({ refresh: async (set) => {
    if (++refreshes === 1) set({ userId: USER_A, epoch: 1, status: 'error', participation: null });
    else set({ userId: USER_A, epoch: 1, status: 'ready', participation: { id: PARTICIPATION,
      eventId: EVENT, status: 'active', externalQueue: null } });
  } });
  await h.store.lookup('ABC');
  assert.equal((await h.store.confirm(EVENT)).kind, 'confirmed_unsynced');
  assert.equal(h.requests.filter(([path]) => path === '/participations').length, 1);
  assert.equal((await h.store.retrySync()).kind, 'complete');
  assert.equal(h.requests.filter(([path]) => path === '/participations').length, 1);
});

test('intenção incerta persiste após reinicialização e fica isolada por usuário', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const first = rig({ storage, post: async (path) => {
    if (path === '/events/lookup') return lookupBody;
    throw { isNetworkError: true };
  } });
  await first.store.lookup('ABC');
  assert.equal((await first.store.confirm(EVENT)).kind, 'uncertain');
  const second = rig({ storage });
  await second.store.lookup('ABC');
  assert.equal((await second.store.confirm(EVENT)).kind, 'complete');
  assert.equal(second.requests[1][2].headers['Idempotency-Key'], KEY);
  second.switchTo(USER_B);
  assert.equal(await storage.get(USER_B), null);
});

test('iOS persiste somente intenção por conta no SecureStore e apaga só sua chave', async () => {
  const values = new Map();
  const secureStore = {
    isAvailableAsync: async () => true,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
  const first = service.createAdmissionIntentStorage({ platformOS: 'ios', secureStore });
  const intent = { userId: USER_A, eventId: EVENT, key: KEY, confirmedParticipationId: null };
  await first.set(intent);
  assert.equal(values.size, 1);
  assert.doesNotMatch([...values.values()][0], /Bearer|accessToken|refreshToken/);
  const second = service.createAdmissionIntentStorage({ platformOS: 'ios', secureStore });
  assert.equal((await second.get(USER_A)).key, KEY);
  assert.equal(await second.get(USER_B), null);
  await second.clear(USER_A, '44444444-4444-4444-8444-444444444444');
  assert.equal(values.size, 1);
  await second.clear(USER_A, KEY);
  assert.equal(values.size, 0);
});

test('logout e troca de conta descartam respostas antigas', async () => {
  let releaseLookup, releaseJoin;
  const h = rig({ post: (path) => path === '/events/lookup'
    ? new Promise((resolve) => { releaseLookup = resolve; })
    : new Promise((resolve) => { releaseJoin = resolve; }) });
  const oldLookup = h.store.lookup('ABC');
  h.switchTo(null);
  releaseLookup(lookupBody);
  assert.equal((await oldLookup).kind, 'stale');
  h.switchTo(USER_A);
  const newLookup = h.store.lookup('ABC');
  releaseLookup(lookupBody);
  await newLookup;
  const oldJoin = h.store.confirm(EVENT);
  await new Promise((resolve) => setImmediate(resolve));
  h.switchTo(USER_B);
  releaseJoin({ participationId: PARTICIPATION });
  assert.equal((await oldJoin).kind, 'stale');
  assert.equal(h.store.getSnapshot().userId, USER_B);
  assert.equal(h.store.getSnapshot().status, 'idle');
});
