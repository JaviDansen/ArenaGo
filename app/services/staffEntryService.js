const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validEntryId = (value) => typeof value === 'string' && UUID.test(value);
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const invalid = () => { throw new Error('Resposta inválida do Controle de Entrada.'); };
export function parseEntryState(body, eventId) {
  if (!validEntryId(eventId) || body?.eventId !== eventId || typeof body.externalQueueEnabled !== 'boolean' ||
      typeof body.canManage !== 'boolean' || !instant(body.observedAt) || !Array.isArray(body.waiting) ||
      !Number.isSafeInteger(body.waitingCount) || body.waitingCount !== body.waiting.length) return invalid();
  const seen = new Set();
  const waiting = body.waiting.map((row, index) => {
    if (!validEntryId(row?.participationId) || seen.has(row.participationId.toLowerCase()) ||
        typeof row.displayName !== 'string' || !row.displayName.trim() || row.position !== index + 1) return invalid();
    seen.add(row.participationId.toLowerCase());
    return { participationId: row.participationId, displayName: row.displayName, position: row.position };
  });
  return { eventId, externalQueueEnabled: body.externalQueueEnabled, canManage: body.canManage,
    observedAt: body.observedAt, waitingCount: body.waitingCount, waiting };
}
export function parseEntryResult(body, intent) {
  if (body?.eventId !== intent.eventId) return invalid();
  if (intent.kind === 'confirm') {
    if (body.participation?.id !== intent.participationId || body.participation.status !== 'active' ||
        !instant(body.participation.arenaEnteredAt)) return invalid();
    return { eventId: body.eventId, participation: { id: body.participation.id, status: 'active', arenaEnteredAt: body.participation.arenaEnteredAt } };
  }
  if (intent.kind !== 'toggle' || body.externalQueueEnabled !== intent.enabled || !Number.isSafeInteger(body.releasedCount) ||
      body.releasedCount < 0 || (intent.enabled && body.releasedCount !== 0) ||
      (body.changedAt !== undefined ? !instant(body.changedAt) : body.releasedCount !== 0)) return invalid();
  return { eventId: body.eventId, externalQueueEnabled: body.externalQueueEnabled, releasedCount: body.releasedCount,
    ...(body.changedAt ? { changedAt: body.changedAt } : {}) };
}
const same = (a, b) => Boolean(a && b && ['userId', 'sessionId', 'eventId', 'epoch', 'revision'].every(key => a[key] === b[key]));
const owns = (intent, context) => intent && ['userId', 'sessionId', 'eventId'].every(key => intent[key] === context[key]);
const active = (intent) => intent && !['acknowledged', 'cancelled'].includes(intent.phase) ? intent : null;
const empty = () => ({ context: null, status: 'idle', data: null, error: null, busy: false, pending: null, storageError: false, feedback: null, knownOutcome: null });
const failure = (error) => error?.status === 401 ? 'session' : [403, 404].includes(error?.status) ? 'denied'
  : error?.isNetworkError || error?.isTimeout ? 'network' : 'unavailable';
export const isDefinitiveEntryRejection = (error) => [400, 401, 403, 404].includes(error?.status) ||
  (error?.status === 409 && ['ENTRY_NOT_FIRST', 'EVENT_ENTRY_UNAVAILABLE'].includes(error.code));

/** Sem replay de POST: um dispatching desconhecido só permite consultas. */
export function createStaffEntryStore({ client, storage, createKey, getContext }) {
  let state = empty(), generation = 0, readGeneration = 0, flight = null;
  const listeners = new Set();
  const publish = (patch) => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
  const isCurrent = (context = state.context) => same(context, state.context) && same(context, getContext());
  function setContext(context) { generation++; readGeneration++; state = empty(); publish({ context }); }
  async function refresh() {
    const context = state.context, currentGeneration = generation, request = ++readGeneration;
    if (!isCurrent(context)) return;
    const current = () => generation === currentGeneration && request === readGeneration && isCurrent(context);
    publish({ status: 'loading', data: null, error: null });
    let pending = null, storageError = false;
    try { pending = active(await storage.get(context.userId)); } catch { storageError = true; }
    if (!current()) return;
    publish({ pending, storageError });
    try {
      const data = parseEntryState(await client.get(`/staff/events/${context.eventId}/entry-control`, { auth: true }), context.eventId);
      if (current()) publish({ status: 'ready', data });
    } catch (error) { if (current()) publish({ status: 'error', data: null, error: failure(error) }); }
  }
  async function mutate(action) {
    if (flight) return { kind: 'busy' };
    const context = state.context;
    if (!isCurrent(context) || state.status !== 'ready' || !state.data?.canManage || state.storageError || state.pending ||
        storage.isPersistent !== true || !['userId', 'sessionId', 'eventId'].every(key => validEntryId(context[key]))) return { kind: 'blocked' };
    if (action.kind === 'confirm' ? !state.data.externalQueueEnabled || action.participationId !== state.data.waiting[0]?.participationId
      : action.kind !== 'toggle' || typeof action.enabled !== 'boolean' || action.enabled === state.data.externalQueueEnabled) return { kind: 'blocked' };
    const intent = { userId: context.userId, sessionId: context.sessionId, eventId: context.eventId, key: createKey(),
      kind: action.kind, participationId: action.kind === 'confirm' ? action.participationId : null,
      enabled: action.kind === 'toggle' ? action.enabled : null, phase: 'reserved' };
    if (!validEntryId(intent.key)) throw new Error('Chave de entrada inválida.');
    publish({ busy: true, feedback: null, knownOutcome: null });
    const work = async () => {
      let knownOutcome = null;
      try {
        const reserved = await storage.reserve(intent);
        if (!isCurrent(context)) return { kind: 'stale' };
        if (!reserved.created) { publish({ pending: active(reserved.intent) }); return { kind: 'blocked' }; }
        publish({ pending: intent });
        const dispatched = await storage.dispatch(intent);
        if (!isCurrent(context)) return { kind: 'stale' };
        if (!dispatched) return { kind: 'blocked' };
        publish({ pending: { ...intent, phase: 'dispatching' } });
        let outcome;
        try {
          const options = { auth: true, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true,
            headers: { 'Idempotency-Key': intent.key } };
          const body = intent.kind === 'confirm'
            ? await client.post(`/staff/events/${context.eventId}/entry-control/participants/${intent.participationId}/confirm`, {}, options)
            : await client.patch(`/staff/events/${context.eventId}/entry-control`, { enabled: intent.enabled }, options);
          outcome = { kind: 'confirmed', result: parseEntryResult(body, intent) };
        } catch (error) {
          if (!isDefinitiveEntryRejection(error)) {
            if (isCurrent(context)) publish({ feedback: 'uncertain' });
            return { kind: isCurrent(context) ? 'uncertain' : 'stale' };
          }
          outcome = { kind: 'rejected', status: error.status, code: typeof error.code === 'string' ? error.code : null };
        }
        // O resultado definitivo pertence à intenção original, inclusive após logout.
        knownOutcome = outcome;
        await storage.finish(intent, outcome);
        if (!isCurrent(context)) return { kind: 'stale' };
        publish({ pending: { ...intent, phase: 'terminal', outcome }, feedback: outcome.kind });
        return { kind: outcome.kind, status: outcome.status };
      } catch {
        if (!isCurrent(context)) return { kind: 'stale' };
        publish({ storageError: true, feedback: 'storage', knownOutcome });
        return { kind: 'storage_error' };
      } finally {
        if (isCurrent(context)) { publish({ busy: false }); await refresh(); }
      }
    };
    flight = work();
    try { return await flight; } finally { flight = null; }
  }
  async function resolveLocal(key, cancel = false) {
    const context = state.context, intent = state.pending;
    if (flight || state.busy || !isCurrent(context) || !owns(intent, context) || intent.key !== key ||
        intent.phase !== (cancel ? 'reserved' : 'terminal')) return { kind: 'blocked' };
    publish({ busy: true });
    try {
      const done = await storage[cancel ? 'cancelReserved' : 'acknowledge'](intent);
      if (!isCurrent(context)) return { kind: 'stale' };
      if (done) publish({ pending: null, feedback: null, storageError: false, knownOutcome: null });
      return { kind: done ? 'done' : 'blocked' };
    } catch { if (isCurrent(context)) publish({ storageError: true }); return { kind: isCurrent(context) ? 'storage_error' : 'stale' }; }
    finally { if (isCurrent(context)) { publish({ busy: false }); await refresh(); } }
  }
  return { getSnapshot: () => state, setContext, isCurrent, refresh, mutate,
    acknowledge: key => resolveLocal(key), cancelReserved: key => resolveLocal(key, true),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
