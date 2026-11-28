// Backend simulado de ingresso compartilhado pelos testes da PARTICIPANTE-01 (R01 e R02).
const assert = require('node:assert/strict');

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
 * Fiel ao contrato real (participations.service, join-idempotency e participant-admission.controller):
 * - a chave é reservada ANTES da elegibilidade; chave concluída ⇒ replay do resultado gravado;
 * - recusa de elegibilidade faz rollback da reserva (a chave não fica gravada);
 * - mesma chave com outro evento ⇒ IDEMPOTENCY_KEY_REUSED;
 * - R02: `admission-intents/lookup` só lê (not_found/completed/abandoned/conflict);
 *   `admission-intents/abandon` grava resultado terminal na mesma chave; ingresso com chave
 *   abandonada ⇒ 409 ADMISSION_INTENT_ABANDONED; ingresso concluído antes ⇒ abandono devolve completed.
 * - GET /participations/:id devolve o status efetivo de uma participação da própria conta.
 */
function backend() {
  const db = { participations: [], keys: new Map(), creations: 0, joinPosts: [], intentRequests: [], lookups: 0, events: {
    ABC: { id: EVENT_A, state: 'open', queue: true }, XYZ: { id: EVENT_B, state: 'open', queue: false } } };
  let dropNextJoinResponse = false, dropNextIntentResponse = false, failNext = null, failNextIntent = null;
  let holdJoin = null, holdJoinResponse = null, holdLookup = null, holdIntent = null;
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
      const key = options.headers['Idempotency-Key'];
      const recordKey = `${userId}#${key}`;
      if (path === '/participations/admission-intents/lookup' || path === '/participations/admission-intents/abandon') {
        const kind = path.endsWith('lookup') ? 'lookup' : 'abandon';
        assert.deepEqual(Object.keys(body), ['eventId'], 'mesmo corpo do ingresso original');
        db.intentRequests.push({ kind, userId, eventId: body.eventId, key });
        if (holdIntent) { const gate = holdIntent; holdIntent = null; await gate.promise; }
        if (failNextIntent) { const error = failNextIntent; failNextIntent = null; throw error; }
        const record = db.keys.get(recordKey);
        if (kind === 'lookup') {
          if (!record) return { intent: { state: 'not_found' } };
          if (record.eventId !== body.eventId) return { intent: { state: 'conflict' } };
          return record.abandoned ? { intent: { state: 'abandoned' } }
            : { intent: { state: 'completed', participationId: record.participationId } };
        }
        if (record) {
          if (record.eventId !== body.eventId) throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };
          return record.abandoned ? { intent: { state: 'abandoned' } }
            : { intent: { state: 'completed', participationId: record.participationId } };
        }
        db.keys.set(recordKey, { eventId: body.eventId, abandoned: true });
        if (dropNextIntentResponse) { dropNextIntentResponse = false; throw { isNetworkError: true, isTimeout: true }; }
        return { intent: { state: 'abandoned' } };
      }
      assert.equal(path, '/participations');
      db.joinPosts.push({ userId, eventId: body.eventId, key });
      if (holdJoin) { const gate = holdJoin; holdJoin = null; await gate.promise; }
      if (failNext) { const error = failNext; failNext = null; throw error; }
      const record = db.keys.get(recordKey);
      if (record) {
        if (record.eventId !== body.eventId) throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };
        if (record.abandoned) throw { status: 409, code: 'ADMISSION_INTENT_ABANDONED' };
        return { participationId: record.participationId };
      }
      const event = eventById(body.eventId);
      if (!event) throw { status: 404, code: 'EVENT_NOT_FOUND' };
      const blocking = reasons(userId, event);
      if (blocking.length) throw { status: 409, code: blocking[0] };
      db.creations += 1;
      const participation = { id: uuid('2', db.creations), userId, eventId: event.id, status: event.queue ? 'waiting' : 'active' };
      db.participations.push(participation);
      db.keys.set(recordKey, { eventId: event.id, participationId: participation.id });
      if (holdJoinResponse) { const gate = holdJoinResponse; holdJoinResponse = null; await gate.promise; }
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
    failNextIntent(error) { failNextIntent = error; },
    /** Grava o abandono, mas a resposta se perde. */
    dropNextIntentResponse() { dropNextIntentResponse = true; },
    /** Segura o POST antes de ser processado (requisição ainda "em trânsito"). */
    holdJoin() { holdJoin = deferred(); return holdJoin; },
    /** Processa e grava o POST, mas segura a resposta (efeito aplicado, resposta tardia). */
    holdJoinResponse() { holdJoinResponse = deferred(); return holdJoinResponse; },
    holdLookup() { holdLookup = deferred(); return holdLookup; },
    holdIntent() { holdIntent = deferred(); return holdIntent; },
    participationsOf(userId) { return db.participations.filter(p => p.userId === userId); },
  };
}

let keySequence = 0;

/** Store real ligado ao backend simulado; `reopen()` simula fechar e abrir o app (mesmo armazenamento). */
function createApp(service) {
  return function app(server = backend(), {
    storage = service.createAdmissionIntentStorage({ platformOS: 'web' }), userId = USER_A,
  } = {}) {
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
      intentRequests: (kind) => server.db.intentRequests.filter(request => !kind || request.kind === kind),
      setSnapshotReady(value) { snapshotReady = value; },
      setGetFails(value) { getFails = value; },
      switchTo(nextUser) { identity = nextUser ? { userId: nextUser, epoch: identity.epoch + 1 } : null; store.setIdentity(identity); },
      /** Logout seguido de novo login na mesma conta (nova época de sessão). */
      relogin() { const id = identity.userId; store.setIdentity(null); identity = { userId: id, epoch: identity.epoch + 1 }; store.setIdentity(identity); },
      reopen() { return app(server, { storage, userId: identity.userId }); },
    };
  };
}

module.exports = { backend, createApp, USER_A, USER_B, EVENT_A, EVENT_B, tick, uuid, deferred };
