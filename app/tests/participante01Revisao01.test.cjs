// PARTICIPANTE-01 — Revisão 01: correções após auditoria (AUD-P01-01..05).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule } = require('./helpers/questionnaireHarness.cjs');

const service = loadModule('services/eventAdmissionService.js', (name) => {
  if (name === 'react-native') return { Platform: { OS: 'web' } };
  if (name === 'expo-crypto') return { randomUUID: () => assert.fail('chave criada só pelo createKey do teste') };
  if (name === 'expo-secure-store') return {};
  if (name === './httpClient') return { httpClient: {} };
  return require(name);
}).exports;

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '12121212-1212-4212-8212-121212121212';
const tick = () => new Promise(resolve => setImmediate(resolve));
const uuid = (prefix, n) => `${prefix}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

/**
 * Backend simulado fiel ao contrato real (participations.service / join-idempotency):
 * - a chave é reservada ANTES da elegibilidade; chave já concluída ⇒ replay do resultado gravado;
 * - recusa de elegibilidade faz rollback da reserva (a chave não fica gravada);
 * - mesma chave com outro evento ⇒ IDEMPOTENCY_KEY_REUSED;
 * - GET /participations/:id devolve o status efetivo de uma participação da própria conta.
 */
function backend() {
  const db = { participations: [], keys: new Map(), creations: 0, joinPosts: [], lookups: 0, events: {
    ABC: { id: EVENT_A, state: 'open', queue: true }, XYZ: { id: EVENT_B, state: 'open', queue: false } } };
  let dropNextJoinResponse = false, failNext = null, holdJoin = null, holdLookup = null;
  const eventById = id => Object.values(db.events).find(event => event.id === id);
  const current = userId => db.participations.find(p => p.userId === userId && ['waiting', 'active'].includes(p.status)) ?? null;
  const reasons = (userId, event) => {
    const list = [];
    if (current(userId)) list.push('PARTICIPATION_ALREADY_CURRENT');
    if (event.state === 'not_started') list.push('EVENT_NOT_STARTED');
    if (event.state === 'closed') list.push('EVENT_REGISTRATION_CLOSED');
    if (event.state === 'not_ready') list.push('EVENT_NOT_READY');
    return list;
  };
  const clientFor = (getUser) => ({
    async post(path, body, options) {
      const userId = getUser();
      if (path === '/events/lookup') {
        db.lookups += 1;
        if (holdLookup) { const gate = holdLookup; holdLookup = null; await gate.promise; }
        const event = db.events[body.accessCode];
        if (!event) throw { status: 404, code: 'EVENT_NOT_FOUND' };
        const blocking = reasons(userId, event);
        return { event: { id: event.id, name: `Evento ${body.accessCode}`, timezone: 'America/Sao_Paulo',
          startsAt: '2026-11-08T10:00:00.000Z', officialEndsAt: '2026-11-08T20:00:00.000Z',
          operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: event.queue },
        eligibility: { eligible: blocking.length === 0, blockingReasons: blocking } };
      }
      assert.equal(path, '/participations');
      const key = options.headers['Idempotency-Key'];
      db.joinPosts.push({ userId, eventId: body.eventId, key });
      if (holdJoin) { const gate = holdJoin; holdJoin = null; await gate.promise; }
      if (failNext) { const error = failNext; failNext = null; throw error; }
      const record = db.keys.get(`${userId}#${key}`);
      if (record) {
        if (record.eventId !== body.eventId) throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };
        return { participationId: record.participationId };
      }
      const event = eventById(body.eventId);
      if (!event) throw { status: 404, code: 'EVENT_NOT_FOUND' };
      const blocking = reasons(userId, event);
      if (blocking.length) throw { status: 409, code: blocking[0] };
      db.creations += 1;
      const participation = { id: uuid('2', db.creations), userId, eventId: event.id, status: event.queue ? 'waiting' : 'active' };
      db.participations.push(participation);
      db.keys.set(`${userId}#${key}`, { eventId: event.id, participationId: participation.id });
      if (dropNextJoinResponse) { dropNextJoinResponse = false; throw { isNetworkError: true, isTimeout: true, outcomeUnknown: true }; }
      return { participationId: participation.id };
    },
    async get(path) {
      const userId = getUser();
      const id = path.split('/').at(-1);
      const participation = db.participations.find(p => p.id === id && p.userId === userId);
      if (!participation) throw { status: 404, code: 'PARTICIPATION_NOT_FOUND' };
      return { participation: { id: participation.id, eventId: participation.eventId, status: participation.status,
        joinedAt: '2026-11-08T13:00:00.000000Z', arenaEnteredAt: null,
        finishedAt: participation.status === 'finished' ? '2026-11-08T15:00:00.000000Z' : null,
        finishReason: participation.status === 'finished' ? 'admin_immediate' : null, externalQueue: null } };
    },
  });
  return {
    db, current, clientFor,
    finish(id) { db.participations.find(p => p.id === id).status = 'finished'; },
    dropNextJoinResponse() { dropNextJoinResponse = true; },
    failNext(error) { failNext = error; },
    holdJoin() { holdJoin = deferred(); return holdJoin; },
    holdLookup() { holdLookup = deferred(); return holdLookup; },
  };
}

let keySequence = 0;

/** Store real ligado ao backend simulado; `reopen()` simula fechar e abrir o app (mesmo armazenamento). */
function app(server = backend(), { storage = service.createAdmissionIntentStorage({ platformOS: 'web' }), userId = USER_A } = {}) {
  let identity = { userId, epoch: 1 };
  let snapshotReady = true, getFails = false;
  const client = server.clientFor(() => identity?.userId);
  const store = service.createEventAdmissionStore({
    client: { post: client.post, get: async (...args) => { if (getFails) throw { isNetworkError: true }; return client.get(...args); } },
    getIdentity: () => identity,
    refreshParticipation: async () => {},
    getParticipationSnapshot: () => ({ userId: identity?.userId, epoch: identity?.epoch,
      status: snapshotReady ? 'ready' : 'error', participation: snapshotReady ? server.current(identity?.userId) : null }),
    intentStorage: storage,
    createKey: () => uuid('3', ++keySequence),
  });
  store.setIdentity(identity);
  return {
    store, server, storage,
    keysUsed: () => server.db.joinPosts.map(post => post.key),
    setSnapshotReady(value) { snapshotReady = value; },
    setGetFails(value) { getFails = value; },
    switchTo(nextUser) { identity = nextUser ? { userId: nextUser, epoch: identity.epoch + 1 } : null; store.setIdentity(identity); },
    reopen() { return app(server, { storage, userId: identity.userId }); },
  };
}

// ---------------------------------------------------------------- AUD-P01-01

test('R01-01: ingresso em A, finalização e ingresso em B na mesma sessão, com intenções e chaves próprias', async () => {
  const a = app();
  await a.store.lookup('ABC');
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'complete');
  const participationA = a.server.current(USER_A).id;
  assert.equal(await a.storage.get(USER_A), null, 'intenção de A resolvida');
  a.server.finish(participationA);

  const found = await a.store.lookup('XYZ');
  assert.equal(found.kind, 'found');
  const state = a.store.getSnapshot();
  assert.equal(state.confirmedParticipationId, null, 'B não herda a confirmação de A');
  assert.equal(state.outcome, null);
  assert.equal(state.error, null);
  assert.equal(state.status, 'ready');
  assert.equal(state.pendingIntent, null);

  assert.equal((await a.store.confirm(EVENT_B)).kind, 'complete');
  const [joinA, joinB] = a.server.db.joinPosts;
  assert.equal(joinA.eventId, EVENT_A);
  assert.equal(joinB.eventId, EVENT_B);
  assert.notEqual(joinA.key, joinB.key, 'B tem sua própria chave idempotente');
  assert.equal(a.server.db.creations, 2);
  assert.notEqual(a.store.getSnapshot().confirmedParticipationId, participationA);
  assert.equal(a.store.getSnapshot().confirmedParticipationId, a.server.current(USER_A).id);
});

test('R01-02: reingresso permitido no mesmo evento cria nova intenção independente', async () => {
  const a = app();
  await a.store.lookup('ABC');
  await a.store.confirm(EVENT_A);
  a.server.finish(a.server.current(USER_A).id);
  await a.store.lookup('ABC');
  assert.equal(a.store.getSnapshot().confirmedParticipationId, null);
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'complete');
  const keys = a.keysUsed();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(a.server.db.creations, 2);
});

test('R01-02: intenção residual do mesmo evento já encerrado é reconhecida como histórica, sem criar outra', async () => {
  const a = app();
  await a.store.lookup('ABC');
  await a.store.confirm(EVENT_A);
  const first = a.server.current(USER_A).id;
  a.server.finish(first);
  // Simula falha ao remover a intenção: ela continua no aparelho com a chave de A.
  const key = a.keysUsed()[0];
  await a.storage.set({ userId: USER_A, eventId: EVENT_A, key, confirmedParticipationId: null });
  await a.store.lookup('ABC');
  const replay = await a.store.confirm(EVENT_A);
  assert.equal(replay.kind, 'historical');
  assert.equal(a.server.db.creations, 1, 'replay não cria participação');
  assert.equal(a.keysUsed()[1], key, 'mesma chave da operação original');
  assert.equal(await a.storage.get(USER_A), null);
  await a.store.revalidate();
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'complete');
  assert.equal(a.server.db.creations, 2);
  assert.notEqual(a.keysUsed()[2], key);
});

test('R01-03: resposta tardia de A não altera o estado de B; ingresso concorrente não compartilha resultado', async () => {
  const a = app();
  await a.store.lookup('ABC');
  const gate = a.server.holdJoin();
  const joinA = a.store.confirm(EVENT_A);
  await tick();
  await a.store.lookup('XYZ');
  const stateB = a.store.getSnapshot();
  assert.equal(stateB.event.id, EVENT_B);
  assert.deepEqual(structuredClone(stateB.pendingIntent), { eventId: EVENT_A, sameEvent: false, confirmed: false });
  const concurrent = await a.store.confirm(EVENT_B);
  assert.equal(concurrent.kind, 'error');
  assert.match(concurrent.message, /Aguarde a conclusão/);
  assert.equal(a.server.db.joinPosts.length, 1, 'B não reaproveita nem dispara POST durante o voo de A');

  gate.resolve();
  assert.equal((await joinA).kind, 'stale');
  const after = a.store.getSnapshot();
  assert.equal(after.event.id, EVENT_B);
  assert.equal(after.confirmedParticipationId, null, 'identificador de A não vaza para B');
  assert.equal(after.status, 'ready');
  // A confirmação de A foi persistida (a prova do servidor não se perde) e B exige verificá-la.
  assert.equal((await a.storage.get(USER_A)).confirmedParticipationId, a.server.current(USER_A).id);
  const recovered = await a.store.reconcile();
  assert.equal(recovered.kind, 'resolved');
  assert.equal(recovered.outcome, 'current');
  assert.equal(a.server.db.creations, 1);
});

test('R01-03: lookup tardio de A não sobrescreve a consulta de B', async () => {
  const a = app();
  const gate = a.server.holdLookup();
  const lookupA = a.store.lookup('ABC');
  await tick();
  await a.store.lookup('XYZ');
  gate.resolve();
  assert.equal((await lookupA).kind, 'stale');
  assert.equal(a.store.getSnapshot().event.id, EVENT_B);
});

test('R01-03: consultar outro evento não elimina intenção realmente incerta', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.failNext({ isNetworkError: true });
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'uncertain');
  const before = await a.storage.get(USER_A);
  await a.store.lookup('XYZ');
  assert.deepEqual(await a.storage.get(USER_A), before);
  assert.equal(a.store.getSnapshot().pendingIntent.sameEvent, false);
  const blocked = await a.store.confirm(EVENT_B);
  assert.equal(blocked.kind, 'error');
  assert.match(blocked.message, /tentativa de ingresso anterior/);
  assert.equal(a.server.db.joinPosts.length, 1, 'nenhum POST para B');
});

// ---------------------------------------------------------------- AUD-P01-02

test('R01-04/05: POST aplicado com resposta perdida, reabertura, ALREADY_CURRENT, recuperação e ingresso em B', async () => {
  const first = app();
  await first.store.lookup('ABC');
  first.server.dropNextJoinResponse();
  assert.equal((await first.store.confirm(EVENT_A)).kind, 'uncertain');
  const original = await first.storage.get(USER_A);
  assert.equal(original.eventId, EVENT_A);
  assert.equal(original.confirmedParticipationId, null);
  assert.equal(first.server.db.creations, 1, 'o servidor aplicou o POST');

  const reopened = first.reopen();
  await reopened.store.lookup('ABC');
  const snapshot = reopened.store.getSnapshot();
  assert.deepEqual(structuredClone(snapshot.eligibility.blockingReasons), ['PARTICIPATION_ALREADY_CURRENT']);
  assert.deepEqual(structuredClone(snapshot.pendingIntent), { eventId: EVENT_A, sameEvent: true, confirmed: false });

  const recovered = await reopened.store.reconcile();
  assert.equal(recovered.kind, 'resolved');
  assert.equal(recovered.outcome, 'current');
  assert.equal(recovered.participation.id, reopened.server.current(USER_A).id);
  assert.equal(reopened.server.db.creations, 1, 'uma única criação em A');
  const posts = reopened.server.db.joinPosts;
  assert.equal(posts.length, 2);
  assert.equal(posts[1].key, original.key, 'replay com a chave original');
  assert.equal(posts[1].eventId, EVENT_A, 'replay com o mesmo corpo (fingerprint)');
  assert.equal(await reopened.storage.get(USER_A), null, 'intenção resolvida com prova do servidor');

  reopened.server.finish(recovered.participation.id);
  await reopened.store.lookup('XYZ');
  assert.equal(reopened.store.getSnapshot().pendingIntent, null);
  assert.equal((await reopened.store.confirm(EVENT_B)).kind, 'complete');
  assert.notEqual(reopened.server.db.joinPosts[2].key, original.key, 'B tem nova intenção');
  assert.equal(reopened.server.db.creations, 2);
});

test('R01-06: recuperação com participação já finalizada é tratada como resultado histórico', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.dropNextJoinResponse();
  await a.store.confirm(EVENT_A);
  a.server.finish(a.server.db.participations[0].id);
  await a.store.lookup('XYZ');
  const blocked = await a.store.confirm(EVENT_B);
  assert.equal(blocked.kind, 'error', 'sem verificação, B continua bloqueado');
  const recovered = await a.store.reconcile();
  assert.equal(recovered.kind, 'resolved');
  assert.equal(recovered.outcome, 'historical');
  assert.equal(recovered.participation.status, 'finished');
  assert.equal(a.store.getSnapshot().confirmedParticipationId, null, 'participação encerrada não vira corrente');
  assert.equal(await a.storage.get(USER_A), null);
  await a.store.revalidate();
  assert.equal((await a.store.confirm(EVENT_B)).kind, 'complete');
  assert.equal(a.server.db.creations, 2);
});

test('R01-06: confirmação cuja participação terminou antes da sincronização não fica presa em "Atualizar"', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.setSnapshotReady(false);
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'confirmed_unsynced');
  a.server.finish(a.server.db.participations[0].id);
  a.setSnapshotReady(true);
  assert.equal((await a.store.retrySync()).kind, 'historical');
  assert.equal(await a.storage.get(USER_A), null);
  assert.equal(a.server.db.joinPosts.length, 1, 'ressincronização não repete o POST');
});

test('R01-07: falhas durante a reconciliação preservam a intenção e não criam outra chave', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.dropNextJoinResponse();
  await a.store.confirm(EVENT_A);
  const original = await a.storage.get(USER_A);

  a.server.failNext({ isNetworkError: true, isTimeout: true });
  const network = await a.store.reconcile();
  assert.equal(network.kind, 'uncertain');
  assert.deepEqual(await a.storage.get(USER_A), original);

  a.server.failNext({ status: 503, code: 'INTERNAL' });
  assert.equal((await a.store.reconcile()).kind, 'uncertain');

  // Replay ok, mas a leitura da própria participação falha: sem prova do desfecho, nada é liberado.
  a.server.finish(a.server.db.participations[0].id);
  a.setGetFails(true);
  const unreadable = await a.store.reconcile();
  assert.equal(unreadable.kind, 'uncertain');
  const kept = await a.storage.get(USER_A);
  assert.equal(kept.key, original.key);
  assert.equal(kept.confirmedParticipationId, a.server.db.participations[0].id, 'prova do replay persistida');

  a.setGetFails(false);
  assert.equal((await a.store.reconcile()).outcome, 'historical');
  assert.equal(a.server.db.creations, 1);
  assert.ok(a.keysUsed().every(key => key === original.key));
});

test('R01-08: sem prova suficiente a intenção fica bloqueada explicitamente, sem sucesso presumido', async () => {
  for (const [error, pattern] of [
    [{ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }, /Procure o suporte/],
    [{ status: 401, code: 'SESSION_EXPIRED' }, /Entre novamente/],
    [{ status: 403, code: 'USER_INACTIVE' }, /Entre novamente/],
  ]) {
    const a = app();
    await a.store.lookup('ABC');
    a.server.failNext({ isNetworkError: true });
    await a.store.confirm(EVENT_A);
    const original = await a.storage.get(USER_A);
    a.server.failNext(error);
    const result = await a.store.reconcile();
    assert.equal(result.kind, 'blocked');
    assert.match(result.message, pattern);
    assert.deepEqual(await a.storage.get(USER_A), original);
    assert.equal(a.store.getSnapshot().recovery.status, 'blocked');
    assert.equal(a.server.db.creations, 0);
  }

  // Armazenamento ilegível: nenhuma chave nova é criada.
  const broken = { get: async () => { throw new Error('corrompido'); }, set: async () => assert.fail('não grava'), clear: async () => {} };
  const b = app(backend(), { storage: broken });
  await b.store.lookup('ABC');
  assert.deepEqual(structuredClone(b.store.getSnapshot().pendingIntent), { unreadable: true });
  assert.equal((await b.store.reconcile()).kind, 'blocked');
  assert.equal((await b.store.confirm(EVENT_A)).kind, 'uncertain');
  assert.equal(b.server.db.joinPosts.length, 0);
});

test('R01-08: o servidor prova que a chave não foi aplicada — intenção liberada sem nenhuma criação', async () => {
  const server = backend();
  const a = app(server);
  await a.store.lookup('ABC');
  a.server.failNext({ isNetworkError: true }); // falhou antes de chegar ao servidor
  await a.store.confirm(EVENT_A);
  // Enquanto isso, outro aparelho da conta ingressou em B.
  server.db.participations.push({ id: uuid('9', 1), userId: USER_A, eventId: EVENT_B, status: 'active' });
  const result = await a.store.reconcile();
  assert.equal(result.kind, 'resolved');
  assert.equal(result.outcome, 'not_applied');
  assert.equal(await a.storage.get(USER_A), null);
  assert.equal(server.db.creations, 0);
});

test('R01-18: troca de conta durante a reconciliação descarta a resposta e isola a intenção', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const a = app(backend(), { storage });
  await a.store.lookup('ABC');
  a.server.failNext({ isNetworkError: true });
  await a.store.confirm(EVENT_A);
  const gate = a.server.holdJoin();
  const pending = a.store.reconcile();
  await tick();
  a.switchTo(USER_B);
  gate.resolve();
  assert.equal((await pending).kind, 'stale');
  assert.equal(a.store.getSnapshot().userId, USER_B);
  assert.equal(a.store.getSnapshot().recovery.status, 'idle');
  assert.equal(await storage.get(USER_B), null);
  assert.ok(await storage.get(USER_A), 'intenção de A não é apagada pela troca de conta');
});

test('R01-22: toques repetidos — um único POST de ingresso e uma única reconciliação', async () => {
  const a = app();
  await a.store.lookup('ABC');
  const gate = a.server.holdJoin();
  const taps = [a.store.confirm(EVENT_A), a.store.confirm(EVENT_A), a.store.confirm(EVENT_A)];
  await tick();
  gate.resolve();
  const results = await Promise.all(taps);
  assert.ok(results.every(result => result.kind === 'complete'));
  assert.equal(a.server.db.joinPosts.length, 1);

  const b = app();
  await b.store.lookup('ABC');
  b.server.dropNextJoinResponse();
  await b.store.confirm(EVENT_A);
  const hold = b.server.holdJoin();
  const recon = [b.store.reconcile(), b.store.reconcile()];
  await tick();
  hold.resolve();
  await Promise.all(recon);
  assert.equal(b.server.db.joinPosts.length, 2, 'POST original + um único replay');
  assert.equal(b.server.db.creations, 1);
});

// ---------------------------------------------------------------- AUD-P01-03

test('R01-09/10/11: revalidação oficial atualiza abertura, encerramento e prontidão', async () => {
  const a = app();
  a.server.db.events.ABC.state = 'not_started';
  await a.store.lookup('ABC');
  assert.equal(a.store.getSnapshot().eligibility.eligible, false);
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'error');
  assert.equal(a.server.db.joinPosts.length, 0);

  a.server.db.events.ABC.state = 'open';
  await a.store.revalidate();
  assert.equal(a.store.getSnapshot().eligibility.eligible, true);
  assert.equal(a.store.getSnapshot().eligibilityStatus, 'fresh');

  a.server.db.events.ABC.state = 'not_ready';
  await a.store.revalidate();
  assert.deepEqual(structuredClone(a.store.getSnapshot().eligibility.blockingReasons), ['EVENT_NOT_READY']);
  a.server.db.events.ABC.state = 'open';
  await a.store.revalidate();

  // Fecha entre a revalidação e o toque: recusa definitiva, intenção liberada, apresentação deve revalidar.
  a.server.db.events.ABC.state = 'closed';
  const refused = await a.store.confirm(EVENT_A);
  assert.equal(refused.kind, 'error');
  assert.equal(refused.revalidate, true);
  assert.equal(await a.storage.get(USER_A), null, 'recusa de elegibilidade prova que a chave não foi aplicada');
  await a.store.revalidate();
  assert.deepEqual(structuredClone(a.store.getSnapshot().eligibility.blockingReasons), ['EVENT_REGISTRATION_CLOSED']);
  assert.equal(a.server.db.creations, 0);
});

test('R01-09: durante a revalidação o ingresso fica bloqueado; respostas de outra operação são descartadas', async () => {
  const a = app();
  await a.store.lookup('ABC');
  const gate = a.server.holdLookup();
  const pending = a.store.revalidate();
  await tick();
  assert.equal(a.store.getSnapshot().eligibilityStatus, 'revalidating');
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'error');
  const lookupsBefore = a.server.db.lookups;
  void a.store.revalidate(); void a.store.revalidate();
  assert.equal(a.server.db.lookups, lookupsBefore, 'sem consultas concorrentes redundantes');
  await a.store.lookup('XYZ'); // nova operação
  gate.resolve();
  assert.equal((await pending).kind, 'stale');
  assert.equal(a.store.getSnapshot().event.id, EVENT_B);
  assert.equal(a.server.db.joinPosts.length, 0);
});

test('R01-12: perfil completado — revalidação libera o mesmo evento', async () => {
  let complete = false;
  // Simula PROFILE_INCOMPLETE até o questionário ser salvo no servidor.
  const store = service.createEventAdmissionStore({
    client: { post: async (path, body) => {
      if (path === '/events/lookup') return { event: { id: EVENT_A, name: 'A', timezone: 'America/Sao_Paulo',
        startsAt: '2026-11-08T10:00:00.000Z', officialEndsAt: '2026-11-08T20:00:00.000Z',
        operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: true },
      eligibility: complete ? { eligible: true, blockingReasons: [] } : { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } };
      return assert.fail(`sem POST ${path} ${body}`);
    } },
    getIdentity: () => ({ userId: USER_A, epoch: 1 }),
    refreshParticipation: async () => {}, getParticipationSnapshot: () => ({}),
    intentStorage: service.createAdmissionIntentStorage({ platformOS: 'web' }),
  });
  store.setIdentity({ userId: USER_A, epoch: 1 });
  await store.lookup('ABC');
  assert.equal(store.getSnapshot().eligibility.eligible, false);
  complete = true;
  await store.revalidate();
  assert.equal(store.getSnapshot().eligibility.eligible, true);
  assert.equal(store.getSnapshot().event.id, EVENT_A);
});

test('R01-12: questionário aberto pela confirmação volta para a jornada do evento', async () => {
  const answers = { hasCompleted: true,
    aboutYou: { birthDate: '1998-12-31', gender: 'Feminino', otherGender: null, education: 'Superior' },
    yourGames: ['Minecraft'], gamesMarket: { marketKnowledge: 'Conheço um pouco.', marketInterest: 'Sim, tenho interesse.' } };
  const run = async (params, canGoBack) => {
    let marked = 0;
    const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
      authContext: { isAuthenticated: true, user: { id: 'A', name: 'Ana', hasCompletedQuestionnaire: true },
        httpClient: { async get(path) { return path.startsWith('/games') ? { games: [] } : answers; },
          async put() { return { message: 'ok' }; } },
        markQuestionnaireCompleted() { marked++; }, async fetchCurrentUser() {} },
      fields: ['handleFinishQuestionnaire'], props: { route: { params } }, canGoBack,
    });
    await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
    h.act(() => h.press('Avançar para a próxima etapa'));
    h.act(() => h.press('Avançar para a Etapa 3'));
    h.act(c => c.handleFinishQuestionnaire());
    await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
    assert.equal(marked, 1);
    const calls = h.navigationCalls;
    h.unmount();
    return calls;
  };
  const journey = await run({ mode: 'edit', returnTo: 'EventConfirmation' }, true);
  assert.deepEqual(journey.map(call => call.type), ['back']);
  // Edição a partir do Perfil continua voltando ao Perfil.
  const profile = await run({ mode: 'edit' }, true);
  assert.equal(profile[0].type, 'popTo');
  assert.equal(profile[0].params.screen, 'Perfil');
});

// ---------------------------------------------------------------- AUD-P01-04/05 (hook da Home)

const eventTime = loadModule('utils/eventTime.js', require).exports;
const overviewUtils = loadModule('utils/homeOverview.js', name => name === './eventTime.js' ? eventTime : require(name)).exports;
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const historyItem = (id = P1, extra = {}) => ({ participationId: id, event: { id: EVENT_A, name: `Evento ${id.slice(-1)}` },
  status: 'finished', joinedAt: '2026-11-08T13:00:00.000000Z', arenaEnteredAt: null,
  finishedAt: '2026-11-08T15:00:00.000000Z', completedServicesCount: 1,
  evaluation: { eligible: true, submitted: false, pending: true }, ...extra });

function hookRig(services) {
  const slots = [], cleanups = [];
  let cursor = 0, effects = [];
  const react = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(callback, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, k) => !Object.is(value, previous[k]))) { slots[i] = deps; effects.push({ i, callback }); }
    },
  };
  const module = loadModule('screens/home/useHomeOverview.js', name => {
    if (name === 'react') return react;
    if (name === '../../services/participationHistoryService.js') return services;
    if (name === '../../utils/homeOverview.js') return overviewUtils;
    return require(name);
  }).exports;
  return function render(params) {
    cursor = 0; module.useHomeOverview(params);
    for (const { i, callback } of effects.splice(0)) {
      if (typeof cleanups[i] === 'function') cleanups[i]();
      const cleanup = callback();
      cleanups[i] = typeof cleanup === 'function' ? cleanup : null;
    }
    cursor = 0; const result = module.useHomeOverview(params); effects = [];
    return result;
  };
}
const clients = new Map();
const authFor = (userId, epoch = 1) => {
  const key = `${userId}#${epoch}`;
  if (!clients.has(key)) clients.set(key, { id: key });
  return { isAuthenticated: true, user: { id: userId }, httpClient: clients.get(key), getSessionEpoch: () => epoch, isIdentityVerified: () => true };
};
const returned = ids => ({ pendingEvaluationParticipationIds: ids, recentFinalization: null });

test('R01-13/14: histórico publicado sem esperar a avaliação; timeout vira erro com retry funcional', async () => {
  const eligibility = [deferred(), deferred()];
  let pendingCalls = 0;
  const render = hookRig({
    fetchParticipationHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingEvaluationHistoryItem: () => eligibility[pendingCalls++].promise,
  });
  const params = { auth: authFor(USER_A), enabled: true, focused: true, returnState: returned([P1]), returnStateVersion: 1 };
  render(params);
  await tick();
  const early = render(params);
  assert.equal(early.status, 'history', 'histórico não espera a consulta secundária');
  assert.equal(early.pending.status, 'checking');
  assert.equal(overviewUtils.describePendingEvaluation(early.pending, early.recent).actionable, false);

  eligibility[0].reject(Object.assign(new Error('timeout'), { isNetworkError: true, isTimeout: true }));
  await tick(); await tick();
  const failed = render(params);
  assert.equal(failed.status, 'history', 'histórico preservado');
  assert.equal(failed.pending.status, 'error', 'falha não é apresentada como ausência');
  assert.equal(failed.pending.error, 'network');

  failed.retryPending();
  const retrying = render(params);
  assert.equal(retrying.pending.status, 'checking');
  assert.equal(pendingCalls, 2);
  eligibility[1].resolve(historyItem());
  await tick();
  const restored = render(params);
  assert.equal(restored.pending.status, 'single');
  assert.equal(restored.pending.item.participationId, P1);
  assert.equal(restored.status, 'history');
});

test('R01-14: avaliação inelegível, já enviada ou múltipla é representada sem consulta indevida', async () => {
  let calls = 0;
  const render = hookRig({
    fetchParticipationHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingEvaluationHistoryItem: async () => { calls++; return null; },
  });
  const base = { auth: authFor(USER_A), enabled: true, focused: true, returnStateVersion: 1 };
  render({ ...base, returnState: returned([P1]) });
  await tick();
  assert.equal(render({ ...base, returnState: returned([P1]) }).pending.status, 'none', 'inelegível/enviada: ausência confirmada');
  const multiple = render({ ...base, returnState: returned([P1, P2]) });
  assert.equal(multiple.pending.status, 'multiple');
  assert.equal(multiple.pending.count, 2);
  assert.equal(calls, 1, 'várias pendências não consultam uma por conta própria');
});

test('R01-15: histórico vazio não continua afirmado durante revalidação; histórico novo substitui', async () => {
  let page = { items: [], nextCursor: null };
  const gate = [];
  const render = hookRig({
    fetchParticipationHistory: () => { const d = deferred(); gate.push(d); return d.promise; },
    fetchPendingEvaluationHistoryItem: async () => null,
  });
  const params = v => ({ auth: authFor(USER_A), enabled: true, focused: true, returnState: returned([]), returnStateVersion: v });
  render(params(1));
  gate[0].resolve(page); await tick();
  assert.equal(render(params(1)).status, 'empty');
  const revalidating = render(params(2));
  assert.equal(revalidating.status, 'loading', 'sem afirmar ausência enquanto verifica');
  page = { items: [historyItem()], nextCursor: null };
  gate[1].resolve(page); await tick();
  const filled = render(params(2));
  assert.equal(filled.status, 'history');
  // Histórico confirmado permanece visível (sem flicker) durante a próxima atualização.
  const refreshing = render(params(3));
  assert.equal(refreshing.status, 'history');
  assert.equal(refreshing.refreshing, true);
  assert.equal(refreshing.recent.participationId, P1);
});

test('R01-16: avaliação que deixou de ser pendente tem a ação invalidada até a nova confirmação', async () => {
  const answers = [deferred(), deferred()];
  let n = 0;
  const render = hookRig({
    fetchParticipationHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingEvaluationHistoryItem: () => answers[n++].promise,
  });
  const params = v => ({ auth: authFor(USER_A), enabled: true, focused: true, returnState: returned([P1]), returnStateVersion: v });
  render(params(1));
  answers[0].resolve(historyItem()); await tick();
  assert.equal(render(params(1)).pending.status, 'single');
  // Avaliação enviada em outro contexto → nova versão do retorno.
  const invalidated = render(params(2));
  assert.equal(invalidated.pending.status, 'checking');
  assert.equal(invalidated.pending.item, null, 'CTA anterior não fica habilitado');
  answers[1].resolve(null); await tick();
  assert.equal(render(params(2)).pending.status, 'none');
});

test('R01-17: respostas fora de ordem na mesma conta — vale apenas a mais recente', async () => {
  const pages = [deferred(), deferred()];
  let n = 0;
  const render = hookRig({
    fetchParticipationHistory: () => pages[n++].promise,
    fetchPendingEvaluationHistoryItem: async () => null,
  });
  const params = v => ({ auth: authFor(USER_A), enabled: true, focused: true, returnState: returned([]), returnStateVersion: v });
  render(params(1));
  render(params(2));
  pages[1].resolve({ items: [historyItem(P2)], nextCursor: null }); await tick();
  pages[0].resolve({ items: [], nextCursor: null }); await tick();
  const result = render(params(2));
  assert.equal(result.status, 'history');
  assert.equal(result.recent.participationId, P2, 'resposta antiga não sobrescreve a mais recente');
});

test('R01-18: troca de conta e logout não exibem dados da conta anterior', async () => {
  const pages = { [USER_A]: deferred(), [USER_B]: deferred() };
  const render = hookRig({
    fetchParticipationHistory: client => pages[client.id.split('#')[0]].promise,
    fetchPendingEvaluationHistoryItem: async () => historyItem(),
  });
  const base = { enabled: true, focused: true, returnState: returned([P1]), returnStateVersion: 1 };
  render({ ...base, auth: authFor(USER_A) });
  render({ ...base, auth: authFor(USER_B) });
  pages[USER_A].resolve({ items: [historyItem()], nextCursor: null }); await tick();
  const b = render({ ...base, auth: authFor(USER_B) });
  assert.equal(b.status, 'loading');
  assert.equal(b.recent, null);
  const loggedOut = render({ ...base, auth: { isAuthenticated: false } });
  assert.equal(loggedOut.status, 'loading');
  assert.equal(loggedOut.pending.item, null);
});

test('R01: horário do evento recente é identificado como horário da participação', () => {
  const ingress = overviewUtils.describeRecentParticipation(historyItem());
  assert.equal(ingress.timeLabel, 'Seu ingresso');
  const entered = overviewUtils.describeRecentParticipation(historyItem(P1, { arenaEnteredAt: '2026-11-08T13:05:00.000000Z' }));
  assert.equal(entered.timeLabel, 'Sua entrada na Arena');
});
