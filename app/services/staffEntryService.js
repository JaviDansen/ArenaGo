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
  if (!['canCall','canConfirm','canMarkAbsent','canRemove'].every(k => typeof body[k] === 'boolean') ||
      !(body.pendingCall === null || (validEntryId(body.pendingCall?.id) && validEntryId(body.pendingCall?.participationId) &&
        !seen.has(body.pendingCall.participationId.toLowerCase()) && typeof body.pendingCall.displayName === 'string' &&
        body.pendingCall.displayName.trim() && instant(body.pendingCall.calledAt)))) return invalid();
  if ((body.canCall && (body.pendingCall || !body.externalQueueEnabled || !body.canManage || !waiting.length)) ||
      (body.canConfirm && (!body.pendingCall || !body.externalQueueEnabled || !body.canManage)) ||
      ((body.canMarkAbsent || body.canRemove) && (!body.pendingCall || !body.externalQueueEnabled))) return invalid();
  return { pendingCall: body.pendingCall, canCall: body.canCall, canConfirm: body.canConfirm,
    canMarkAbsent: body.canMarkAbsent, canRemove: body.canRemove, eventId, externalQueueEnabled: body.externalQueueEnabled, canManage: body.canManage,
    observedAt: body.observedAt, waitingCount: body.waitingCount, waiting };
}
export function parseEntryResult(body, intent) {
  if (body?.eventId !== intent.eventId) return invalid();
  if (['call','confirm_call','absent','remove'].includes(intent.kind)) {
    const c = body.call, p = body.participation;
    const status = {call:'pending',confirm_call:'confirmed',absent:'absent',remove:'removed'}[intent.kind];
    if (!validEntryId(c?.id) || !validEntryId(c.participationId) || p?.id !== c.participationId || c.status !== status ||
        !instant(c.calledAt) || (status === 'pending' ? c.resolvedAt !== null : !instant(c.resolvedAt)) ||
        (intent.kind !== 'call' && (c.id !== intent.callId || c.participationId !== intent.participationId)) ||
        typeof body.requeued !== 'boolean' ||
        (intent.kind !== 'absent' && body.requeued) ||
        (intent.kind === 'call' && p.status !== 'waiting') ||
        (intent.kind === 'confirm_call' && (p.status !== 'active' || !instant(p.arenaEnteredAt))) ||
        (intent.kind === 'remove' && (p.status !== 'canceled' || p.finishReason !== 'staff_external_wait_removed')) ||
        (intent.kind === 'absent' && (body.requeued ? p.status !== 'waiting' : p.status !== 'finished' || p.finishReason !== 'external_absence_after_entry_cutoff')) ||
        (p.externalQueueOrder !== null && (typeof p.externalQueueOrder !== 'string' || !/^[1-9]\d*$/.test(p.externalQueueOrder) ||
          p.externalQueueOrder.length > 19 || BigInt(p.externalQueueOrder)>9223372036854775807n))) return invalid();
    if ((c.resolvedAt && Date.parse(c.resolvedAt) < Date.parse(c.calledAt)) ||
        (p.status !== 'active' && p.arenaEnteredAt !== null) ||
        (['waiting','active'].includes(p.status) && p.finishReason !== null) ||
        (body.requeued && !p.externalQueueOrder)) return invalid();
    return { eventId: body.eventId, call: {id:c.id,participationId:c.participationId,status:c.status,calledAt:c.calledAt,resolvedAt:c.resolvedAt},
      participation: {id:p.id,status:p.status,arenaEnteredAt:p.arenaEnteredAt,finishReason:p.finishReason,externalQueueOrder:p.externalQueueOrder}, requeued: body.requeued };
  }
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
  (error?.status === 409 && ['ENTRY_NOT_FIRST', 'EVENT_ENTRY_UNAVAILABLE', 'ENTRY_CALL_REQUIRED', 'ENTRY_CALL_PENDING', 'ENTRY_CALL_NOT_PENDING', 'ENTRY_QUEUE_EMPTY'].includes(error.code));

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
    if (!isCurrent(context) || state.status !== 'ready' || !state.data || state.storageError || state.pending ||
        storage.isPersistent !== true || !['userId', 'sessionId', 'eventId'].every(key => validEntryId(context[key]))) return { kind: 'blocked' };
    const data = state.data, call = data.pendingCall;
    if (action.kind === 'toggle' ? !data.canManage || typeof action.enabled !== 'boolean' || action.enabled === data.externalQueueEnabled
      : action.kind === 'call' ? !data.canCall || Boolean(call)
        : !['confirm_call','absent','remove'].includes(action.kind) || !call || action.callId !== call.id ||
          !data[{confirm_call:'canConfirm',absent:'canMarkAbsent',remove:'canRemove'}[action.kind]]) return { kind: 'blocked' };
    const intent = { userId: context.userId, sessionId: context.sessionId, eventId: context.eventId, key: createKey(),
      kind: action.kind, participationId: ['confirm_call','absent','remove'].includes(action.kind) ? call.participationId : null,
      callId: ['confirm_call','absent','remove'].includes(action.kind) ? call.id : null,
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
          const base = `/staff/events/${context.eventId}/entry-control`;
          const body = intent.kind === 'toggle'
            ? await client.patch(base, { enabled: intent.enabled }, options)
            : await client.post(intent.kind === 'call' ? `${base}/call-next`
              : `${base}/calls/${intent.callId}/${intent.kind === 'confirm_call' ? 'confirm' : intent.kind}`, {}, options);
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
      let writeFailed = false;
      try { await storage[cancel ? 'cancelReserved' : 'acknowledge'](intent); }
      catch { writeFailed = true; }
      const persisted = await storage.get(context.userId);
      if (!isCurrent(context)) return { kind: 'stale' };
      const verified = persisted?.key === key && persisted.phase === (cancel ? 'cancelled' : 'acknowledged') &&
        owns(persisted, context);
      if (verified) publish({ pending: null, feedback: null, storageError: false, knownOutcome: null });
      if (writeFailed && !verified) publish({ storageError: true });
      return { kind: verified ? 'done' : writeFailed ? 'storage_error' : 'blocked' };
    } catch { if (isCurrent(context)) publish({ storageError: true }); return { kind: isCurrent(context) ? 'storage_error' : 'stale' }; }
    finally { if (isCurrent(context)) { publish({ busy: false }); await refresh(); } }
  }
  return { getSnapshot: () => state, setContext, isCurrent, refresh, mutate,
    acknowledge: key => resolveLocal(key), cancelReserved: key => resolveLocal(key, true),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
