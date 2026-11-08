const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARTICIPATION = '22222222-2222-4222-8222-222222222222';
const EVENT = '11111111-1111-4111-8111-111111111111';
const KEY = '33333333-3333-4333-8333-333333333333';
const EVALUATION = '44444444-4444-4444-8444-444444444444';
const finished = { id: PARTICIPATION, eventId: EVENT, status: 'finished', finishReason: 'voluntary',
  completedServicesCount: 1, evaluationEligibility: { eligible: true, hasSubmitted: false } };
const evaluation = { id: EVALUATION, participationId: PARTICIPATION, rating: 5, comment: null };
const service = loadModule('services/participationActionService.js', name => {
  if (name === 'react-native') return { Platform: { OS: 'web' } };
  if (name === 'expo-crypto') return { randomUUID: () => KEY };
  if (name === 'expo-secure-store') return {};
  return require(name);
}).exports;

function setup(client) {
  const storage = service.createParticipationActionStorage({ platformOS: 'web' });
  let current = true;
  const coordinator = service.createParticipationActionCoordinator({ client, storage,
    createKey: () => KEY, isCurrent: () => current });
  return { storage, coordinator, changeSession: () => { current = false; } };
}

test('finish envia corpo vazio e chave persistida antes do POST; replay conserva a mesma chave', async () => {
  const calls = [];
  let attempts = 0;
  const client = {
    async post(path, body, options) {
      attempts += 1;
      calls.push({ path, body, options });
      assert.equal((await h.storage.get(USER, 'finish')).key, KEY);
      if (attempts === 1) throw Object.assign(new Error('timeout'), { isNetworkError: true, outcomeUnknown: true });
      return { participation: finished };
    },
    async get() { return { participation: { status: 'active' } }; },
  };
  const h = setup(client);
  await assert.rejects(h.coordinator.finish(USER, PARTICIPATION), /timeout/);
  assert.equal((await h.storage.get(USER, 'finish')).key, KEY);
  assert.equal((await h.coordinator.finish(USER, PARTICIPATION)).status, 'finished');
  assert.equal(await h.storage.get(USER, 'finish'), null);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.path, `/participations/${PARTICIPATION}/finish`);
    assert.equal(JSON.stringify(call.body), '{}');
    assert.equal(call.options.auth, true);
    assert.equal(call.options.headers['Idempotency-Key'], KEY);
    assert.equal(call.options.outcomeUnknownOnNetworkError, true);
  }
});

test('resposta incerta da saída é reconciliada por leitura da participação real', async () => {
  const h = setup({
    async post() { throw Object.assign(new Error('rede'), { isNetworkError: true, outcomeUnknown: true }); },
    async get(path, options) {
      assert.equal(path, `/participations/${PARTICIPATION}`);
      assert.equal(options.auth, true);
      return { participation: finished };
    },
  });
  assert.equal((await h.coordinator.finish(USER, PARTICIPATION)).status, 'finished');
  assert.equal(await h.storage.get(USER, 'finish'), null);
});

test('avaliação confirma elegibilidade no servidor, envia uma vez e limpa intenção', async () => {
  const calls = [];
  const h = setup({
    async get(path, options) {
      calls.push(['get', path, options]);
      return { participationId: PARTICIPATION, eligible: true, submitted: false, pending: true };
    },
    async post(path, body, options) {
      calls.push(['post', path, body, options]);
      assert.equal((await h.storage.get(USER, 'evaluation')).key, KEY);
      return { evaluation };
    },
  });
  assert.equal((await h.coordinator.submit(USER, PARTICIPATION, { rating: 5, comment: null })).id, EVALUATION);
  assert.equal(await h.storage.get(USER, 'evaluation'), null);
  assert.equal(calls[0][1], `/participations/${PARTICIPATION}/evaluation-eligibility`);
  assert.equal(calls[1][1], `/participations/${PARTICIPATION}/evaluation`);
  assert.equal(JSON.stringify(calls[1][2]), JSON.stringify({ rating: 5, comment: null }));
  assert.equal(calls[1][3].headers['Idempotency-Key'], KEY);
});

test('inelegibilidade impede POST e envio incerto preserva payload para replay', async () => {
  let eligible = false, posts = 0;
  const h = setup({
    async get(path) {
      if (path.endsWith('/evaluation-eligibility')) return { participationId: PARTICIPATION, eligible, submitted: false, pending: eligible };
      return { evaluation: null };
    },
    async post() { posts += 1; throw Object.assign(new Error('rede'), { isNetworkError: true, outcomeUnknown: true }); },
  });
  await assert.rejects(h.coordinator.submit(USER, PARTICIPATION, { rating: 4, comment: null }), /elegível/);
  assert.equal(posts, 0);
  assert.equal(await h.storage.get(USER, 'evaluation'), null);
  eligible = true;
  await assert.rejects(h.coordinator.submit(USER, PARTICIPATION, { rating: 4, comment: null }), /rede/);
  assert.equal(posts, 1);
  await assert.rejects(h.coordinator.submit(USER, PARTICIPATION, { rating: 5, comment: null }), /envio anterior/);
  assert.equal(posts, 1);
  assert.equal(JSON.stringify((await h.storage.get(USER, 'evaluation')).payload), JSON.stringify({ rating: 4, comment: null }));
});

test('envio incerto reconciliado por GET não repete avaliação; conta distinta não vê intenção', async () => {
  const h = setup({
    async get(path) {
      return path.endsWith('/evaluation-eligibility')
        ? { participationId: PARTICIPATION, eligible: true, submitted: false, pending: true }
        : { evaluation };
    },
    async post() { throw Object.assign(new Error('timeout'), { isNetworkError: true, outcomeUnknown: true }); },
  });
  assert.equal((await h.coordinator.submit(USER, PARTICIPATION, { rating: 5, comment: null })).id, EVALUATION);
  assert.equal(await h.storage.get(USER, 'evaluation'), null);
  await h.storage.set({ userId: USER, kind: 'finish', participationId: PARTICIPATION, key: KEY, payload: null });
  assert.equal(await h.storage.get(OTHER, 'finish'), null);
});

test('troca de sessão durante operação descarta resposta atrasada', async () => {
  let resolvePost;
  const h = setup({
    post: () => new Promise(resolve => { resolvePost = resolve; }),
    async get() { return { participation: finished }; },
  });
  const task = h.coordinator.finish(USER, PARTICIPATION);
  while (!resolvePost) await Promise.resolve();
  h.changeSession();
  resolvePost({ participation: finished });
  await assert.rejects(task, /sessão mudou/);
  assert.equal((await h.storage.get(USER, 'finish')).key, KEY);
});
