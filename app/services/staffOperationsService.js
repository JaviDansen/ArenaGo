/** Operações reais de Staff. Sem navegação, estado fictício ou acesso direto ao banco. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === 'string' && UUID.test(s);
const bad = (message) => new Error(message);

function requireIds(...ids) {
  if (ids.some((id) => !isUuid(id))) throw bad('Identificador inválido para operação de Staff.');
}

export function parseStaffExperiences(body, eventId) {
  requireIds(eventId);
  if (body?.eventId !== eventId || !Array.isArray(body.experiences)) throw bad('Resposta inválida de experiências do evento.');
  const seen = new Set();
  const experiences = body.experiences.map((experience) => {
    if (!isUuid(experience?.id) || seen.has(experience.id) || typeof experience.name !== 'string' || !experience.name.trim()) {
      throw bad('Resposta inválida de experiência.');
    }
    seen.add(experience.id);
    return { id: experience.id, name: experience.name };
  });
  return { eventId, experiences };
}

export function parseStaffStations(body, eventId) {
  requireIds(eventId);
  if (body?.eventId !== eventId || !Array.isArray(body.stations)) {
    throw bad('Resposta inválida de estações do evento.');
  }
  const seen = new Set();
  const stations = body.stations.map((station) => {
    if (!isUuid(station?.id) || seen.has(station.id) || !isUuid(station.experienceId)
        || typeof station.label !== 'string' || !station.label.trim()
        || !['available', 'unavailable'].includes(station.availability)
        || (station.pendingServiceSessionId !== null && !isUuid(station.pendingServiceSessionId))) {
      throw bad('Resposta inválida de estação.');
    }
    seen.add(station.id);
    return { id: station.id, experienceId: station.experienceId, label: station.label,
      availability: station.availability,
      pendingServiceSessionId: station.pendingServiceSessionId };
  });
  return { eventId, stations };
}

export function parseStaffQueue(body, eventId, experienceId) {
  requireIds(eventId, experienceId);
  if (body?.eventId !== eventId || body.experienceId !== experienceId
      || !Number.isSafeInteger(body.waitingCount) || body.waitingCount < 0
      || typeof body.canCallWaitingEntries !== 'boolean'
      || (body.firstWaitingQueueEntryId !== null && !isUuid(body.firstWaitingQueueEntryId))) {
    throw bad('Resposta inválida da fila operacional.');
  }
  if ((body.waitingCount === 0 && body.firstWaitingQueueEntryId !== null)
      || (body.waitingCount > 0 && !body.firstWaitingQueueEntryId)) {
    throw bad('Fila operacional inconsistente.');
  }
  return { eventId, experienceId, waitingCount: body.waitingCount,
    canCallWaitingEntries: body.canCallWaitingEntries,
    firstWaitingQueueEntryId: body.firstWaitingQueueEntryId };
}

export function parseCalledSession(body, { experienceId, stationId }) {
  requireIds(experienceId, stationId);
  const session = body?.serviceSession;
  if (!isUuid(session?.id) || !isUuid(session.queueEntryId)
      || session.experienceId !== experienceId || session.station?.id !== stationId
      || typeof session.station?.label !== 'string' || !session.station.label.trim()
      || session.status !== 'pending') {
    throw bad('Resposta inesperada da chamada. Não gerar outra chamada.');
  }
  return { id: session.id, queueEntryId: session.queueEntryId,
    experienceId, stationId, stationLabel: session.station.label,
    status: session.status, calledAt: session.calledAt ?? null };
}

export function parseCompletedSession(body, serviceSessionId) {
  requireIds(serviceSessionId);
  if (body?.serviceSession?.id !== serviceSessionId
      || body.serviceSession.status !== 'completed'
      || body.queueEntry?.status !== 'closed'
      || body.queueEntry.closeReason !== 'completed'
      || body.participation?.status !== 'active'
      || body.participation?.currentQueueEntryId !== null) {
    throw bad('Resposta inesperada da conclusão. Não repetir com nova chave.');
  }
  return { id: serviceSessionId, status: 'completed', resolvedAt: body.serviceSession.resolvedAt ?? null,
    queueEntryStatus: 'closed', closeReason: 'completed',
    participationStatus: body.participation.status };
}

export function parseAbsentSession(body, serviceSessionId) {
  requireIds(serviceSessionId);
  const entry = body?.newQueueEntry;
  if (body?.serviceSession?.id !== serviceSessionId || body.serviceSession.status !== 'absent' ||
      !isUuid(body?.previousQueueEntry?.id) || body.previousQueueEntry.status !== 'closed' ||
      body.previousQueueEntry.closeReason !== 'absent' || typeof body.requeued !== 'boolean' ||
      (body.requeued ? (!isUuid(entry?.id) || entry.id.toLowerCase() === body.previousQueueEntry.id.toLowerCase() || entry.status !== 'waiting' ||
        typeof entry.queueOrder !== 'string' || !/^[1-9]\d*$/.test(entry.queueOrder) || !Number.isSafeInteger(entry.position) || entry.position < 1)
        : entry !== null)) {
    throw bad('Resposta inesperada da ausência. Não repetir com nova chave.');
  }
  return { id: serviceSessionId, status: 'absent', requeued: body.requeued,
    newQueueEntry: body.requeued ? { id: entry.id, status: entry.status,
      queueOrder: entry.queueOrder, position: entry.position } : null };
}

/** Leituras autenticadas; a API, não o app, autoriza o Staff para o evento. */
export async function fetchStaffExperiences(client, eventId) {
  requireIds(eventId);
  return parseStaffExperiences(await client.get(`/staff/events/${eventId}/experiences`, { auth: true }), eventId);
}

export async function fetchStaffStations(client, eventId) {
  requireIds(eventId);
  return parseStaffStations(await client.get(`/staff/events/${eventId}/stations`, { auth: true }), eventId);
}

export async function fetchStaffQueue(client, eventId, experienceId) {
  requireIds(eventId, experienceId);
  return parseStaffQueue(await client.get(
    `/staff/events/${eventId}/experiences/${experienceId}/queue`, { auth: true }), eventId, experienceId);
}

export function parseStaffStationState(body, eventId, experienceId, stationId) {
  requireIds(eventId, experienceId, stationId);
  if (body?.eventId !== eventId || body.experienceId !== experienceId || body.stationId !== stationId ||
      !['available', 'unavailable'].includes(body.availability) || typeof body.canCall !== 'boolean' ||
      !Number.isSafeInteger(body.waitingCount) || body.waitingCount < 0 || !Array.isArray(body.waiting) ||
      body.waiting.length !== body.waitingCount) throw bad('Estado operacional da estação inválido.');
  const seen = new Set();
  const waiting = body.waiting.map((row, index) => {
    if (!isUuid(row?.queueEntryId) || seen.has(row.queueEntryId.toLowerCase()) ||
        typeof row.displayName !== 'string' || !row.displayName.trim() || row.position !== index + 1)
      throw bad('Fila operacional inconsistente.');
    seen.add(row.queueEntryId.toLowerCase());
    return { queueEntryId: row.queueEntryId, displayName: row.displayName, position: row.position };
  });
  const pending = body.pending === null ? null : body.pending;
  if (pending && (!isUuid(pending.serviceSessionId) || !isUuid(pending.queueEntryId) ||
      typeof pending.displayName !== 'string' || !pending.displayName.trim() ||
      typeof pending.calledAt !== 'string' || !Number.isFinite(Date.parse(pending.calledAt)) ||
      new Date(pending.calledAt).toISOString() !== pending.calledAt)) throw bad('Atendimento pendente inválido.');
  if (body.pending === undefined || (pending && body.canCall) ||
      (body.availability === 'unavailable' && body.canCall)) throw bad('Estado de chamada inconsistente.');
  return { eventId, experienceId, stationId, availability: body.availability, canCall: body.canCall,
    waitingCount: body.waitingCount, waiting, pending: pending && {
      serviceSessionId: pending.serviceSessionId, queueEntryId: pending.queueEntryId,
      displayName: pending.displayName, calledAt: pending.calledAt } };
}

export async function fetchStaffStationState(client, eventId, experienceId, stationId) {
  requireIds(eventId, experienceId, stationId);
  return parseStaffStationState(await client.get(
    `/staff/events/${eventId}/experiences/${experienceId}/stations/${stationId}/operational-state`,
    { auth: true }), eventId, experienceId, stationId);
}

/**
 * As funções mutantes exigem a mesma chave estável em cada retry da MESMA intenção.
 * Usar createStaffOperationsCoordinator para guardar a chave antes do POST.
 */
export async function callNextStaff(client, { eventId, experienceId, stationId, idempotencyKey }) {
  requireIds(eventId, experienceId, stationId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/experiences/${experienceId}/stations/${stationId}/call-next`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true });
  return parseCalledSession(body, { experienceId, stationId });
}

export async function completeStaffService(client, { eventId, serviceSessionId, idempotencyKey }) {
  requireIds(eventId, serviceSessionId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/service-sessions/${serviceSessionId}/complete`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true });
  return parseCompletedSession(body, serviceSessionId);
}

export async function absentStaffService(client, { eventId, serviceSessionId, idempotencyKey }) {
  requireIds(eventId, serviceSessionId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/service-sessions/${serviceSessionId}/absent`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true });
  return parseAbsentSession(body, serviceSessionId);
}

export function parseRemovedQueueEntry(body, eventId, experienceId, queueEntryId) {
  requireIds(eventId, experienceId, queueEntryId);
  if (body?.eventId !== eventId || body.experienceId !== experienceId ||
      body.queueEntry?.id !== queueEntryId || body.queueEntry.status !== 'closed' ||
      body.queueEntry.closeReason !== 'staff_queue_removed' || !isUuid(body.participation?.id) ||
      body.participation.status !== 'active' || body.participation.currentQueueEntryId !== null)
    throw bad('Resposta inesperada da remoção. Não repetir a operação.');
  return { queueEntryId, experienceId, status: 'closed', closeReason: 'staff_queue_removed',
    participationId: body.participation.id, participationStatus: 'active' };
}

export function parseRemovedCalledSession(body, serviceSessionId) {
  requireIds(serviceSessionId);
  if (body?.serviceSession?.id !== serviceSessionId || body.serviceSession.status !== 'canceled' ||
      body.serviceSession.cancelReason !== 'staff_queue_removed' ||
      typeof body.serviceSession.resolvedAt !== 'string' || !Number.isFinite(Date.parse(body.serviceSession.resolvedAt)) ||
      new Date(body.serviceSession.resolvedAt).toISOString() !== body.serviceSession.resolvedAt ||
      body.queueEntry?.status !== 'closed' || body.queueEntry.closeReason !== 'staff_queue_removed' ||
      body.participation?.status !== 'active' || body.participation.currentQueueEntryId !== null)
    throw bad('Resposta inesperada da remoção do atendimento. Não repetir a operação.');
  return { id: serviceSessionId, status: 'canceled', cancelReason: 'staff_queue_removed',
    resolvedAt: body.serviceSession.resolvedAt, queueEntryStatus: 'closed',
    closeReason: 'staff_queue_removed', participationStatus: 'active' };
}

export async function removeCalledStaff(client, { eventId, serviceSessionId, idempotencyKey }) {
  requireIds(eventId, serviceSessionId, idempotencyKey);
  const body = await client.post(`/staff/events/${eventId}/service-sessions/${serviceSessionId}/remove`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, retryOnUnauthorized: false,
      outcomeUnknownOnNetworkError: true });
  return parseRemovedCalledSession(body, serviceSessionId);
}

export async function removeWaitingStaff(client, { eventId, experienceId, queueEntryId, idempotencyKey }) {
  requireIds(eventId, experienceId, queueEntryId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/experiences/${experienceId}/queue-entries/${queueEntryId}/remove`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, retryOnUnauthorized: false,
      outcomeUnknownOnNetworkError: true });
  return parseRemovedQueueEntry(body, eventId, experienceId, queueEntryId);
}

const definitiveConflicts = new Set(['QUEUE_EMPTY', 'STATION_UNAVAILABLE', 'STATION_HAS_PENDING_CALL',
  'SERVICE_NOT_PENDING', 'EVENT_OPERATION_ENDED', 'QUEUE_ENTRY_NOT_WAITING']);

/** Uma resposta inválida ou um erro após envio pode ocultar um commit. */
export function classifyStaffOperationError(error) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (error?.outcomeUnknown || error?.isNetworkError || error?.isTimeout || !status || status >= 500)
    return { kind: 'uncertain', status, code };
  if (code === 'IDEMPOTENCY_IN_PROGRESS' || code === 'IDEMPOTENCY_REQUEST_CONFLICT')
    return { kind: 'pending_reconciliation', status, code };
  if ((status === 409 && definitiveConflicts.has(code)) || [400, 401, 403, 404].includes(status))
    return { kind: 'rejected', status, code };
  return { kind: 'pending_reconciliation', status, code };
}

export function createStaffOperationsCoordinator({ client, storage, createKey, isCurrent }) {
  if (typeof isCurrent !== 'function' || typeof createKey !== 'function' || storage?.isPersistent !== true ||
      ['get', 'reserve', 'dispatch', 'recordTerminal', 'cancelReserved', 'clear', 'acknowledge']
        .some((name) => typeof storage?.[name] !== 'function'))
    throw bad('Contexto verificado e armazenamento persistente são obrigatórios.');
  let inflight = null;
  function alive(context, intent) { if (!isCurrent(context, intent)) throw bad('Sessão alterada. Não enviar nova operação.'); }
  function contextValid(context) { requireIds(context?.userId, context?.eventId, context?.sessionId); }
  function conflict(existing, next) {
    return existing && (existing.kind !== next.kind || existing.eventId !== next.eventId || existing.sessionId !== next.sessionId
      || existing.userId !== next.userId || existing.experienceId !== next.experienceId
      || existing.stationId !== next.stationId || existing.serviceSessionId !== next.serviceSessionId
      || existing.queueEntryId !== next.queueEntryId);
  }
  async function getIntent(context) {
    alive(context);
    const intent = await storage.get(context.userId);
    alive(context);
    return intent;
  }
  async function execute(context, desired, check, operation) {
    contextValid(context);
    const existing = await getIntent(context);
    alive(context, desired);
    if (conflict(existing, desired)) return { kind: 'pending_other' };
    // O backend não expõe prazo de retenção nem estado da chave; replay após
    // resultado desconhecido poderia executar novamente após eventual expurgo.
    if (existing) return existing.phase === 'terminal'
      ? { kind: 'terminal_pending', outcome: existing.outcome, receiptId: existing.key }
      : { kind: existing.phase === 'reserved' ? 'reserved' : 'pending_reconciliation' };
    if (!existing) {
      let possible;
      try { possible = await check(); }
      catch (error) {
        alive(context, desired);
        return { kind: 'rejected', phase: 'precondition', status: error?.status ?? null,
          code: error?.code ?? null, network: Boolean(error?.isNetworkError) };
      }
      alive(context, desired);
      if (!possible) return { kind: 'blocked' };
    }
    const intent = { ...desired, key: createKey(), phase: 'reserved' };
    requireIds(intent.key);
    alive(context, desired);
    const reservation = await storage.reserve(intent);
    if (!isCurrent(context, desired)) {
      if (reservation?.created) { try { await storage.cancelReserved(context.userId, intent.key); } catch { /* ainda bloqueada ou removida */ } }
      return { kind: 'stale' };
    }
    if (!reservation?.created) return { kind: 'pending_reconciliation' };
    let dispatched;
    try { dispatched = await storage.dispatch(context.userId, intent.key); }
    catch { return isCurrent(context, desired) ? { kind: 'storage_error' } : { kind: 'stale' }; }
    if (!isCurrent(context, desired)) return { kind: 'stale' };
    if (!dispatched) return { kind: 'pending_reconciliation' };
    let outcome;
    try {
      const result = await operation(intent.key);
      outcome = { kind: 'confirmed', result };
    } catch (error) {
      const classification = classifyStaffOperationError(error);
      if (classification.kind !== 'rejected') return isCurrent(context, desired) ? classification : { kind: 'stale' };
      outcome = classification;
    }
    // A resposta histórica pertence à intenção original mesmo após logout.
    try { await storage.recordTerminal(context.userId, intent.key, outcome); }
    catch {
      if (!isCurrent(context, desired)) return { kind: 'stale' };
      return outcome.kind === 'confirmed' ? { kind: 'confirmed_cleanup_pending', result: outcome.result, receiptId: intent.key }
        : { kind: 'rejected_cleanup_pending', status: outcome.status, code: outcome.code, receiptId: intent.key };
    }
    if (!isCurrent(context, desired)) return { kind: 'stale' };
    try { await storage.clear(context.userId, intent.key); }
    catch {
      if (!isCurrent(context, desired)) return { kind: 'stale' };
      return outcome.kind === 'confirmed' ? { kind: 'confirmed_cleanup_pending', result: outcome.result, receiptId: intent.key }
        : { kind: 'rejected_cleanup_pending', status: outcome.status, code: outcome.code, receiptId: intent.key };
    }
    return isCurrent(context, desired) ? { ...outcome, receiptId: intent.key } : { kind: 'stale' };
  }
  function single(work, context, scope) {
    if (inflight) return Promise.resolve({ kind: 'busy' });
    const promise = work();
    inflight = promise;
    return promise.catch((error) => {
      if (!isCurrent(context, scope) || error?.message === 'Sessão alterada. Não enviar nova operação.') return { kind: 'stale' };
      throw error;
    }).finally(() => { if (inflight === promise) inflight = null; });
  }
  async function scoped(context, work, getScope = () => undefined) {
    try { return await work(); }
    catch (error) {
      if (!isCurrent(context, getScope()) || error?.message === 'Sessão alterada. Não enviar nova operação.') return { kind: 'stale' };
      throw error;
    }
  }
  return {
    async readStations(context) { contextValid(context); const value = await fetchStaffStations(client, context.eventId); alive(context); return value; },
    async readQueue(context, experienceId) {
      contextValid(context); const value = await fetchStaffQueue(client, context.eventId, experienceId); alive(context); return value;
    },
    async readStationState(context, experienceId, stationId) {
      contextValid(context); const value = await fetchStaffStationState(client, context.eventId, experienceId, stationId);
      alive(context); return value;
    },
    callNext(context, experienceId, stationId) {
      context = { ...context };
      return single(async () => {
        contextValid(context); requireIds(experienceId, stationId);
        const desired = { kind: 'call', userId: context.userId, eventId: context.eventId, sessionId: context.sessionId,
          experienceId, stationId, serviceSessionId: null };
        return execute(context, desired, async () => {
          const [queue, { stations }] = await Promise.all([
            fetchStaffQueue(client, context.eventId, experienceId),
            fetchStaffStations(client, context.eventId),
          ]);
          const station = stations.find((s) => s.id === stationId && s.experienceId === experienceId);
          return Boolean(queue.waitingCount > 0 && queue.canCallWaitingEntries && station
            && station.availability === 'available' && station.pendingServiceSessionId === null);
        }, (key) => callNextStaff(client, { eventId: context.eventId, experienceId, stationId, idempotencyKey: key }));
      }, context, { ...context, kind: 'call', experienceId, stationId, serviceSessionId: null });
    },
    complete(context, serviceSessionId, stationId) {
      context = { ...context };
      return single(async () => {
        contextValid(context); requireIds(serviceSessionId, stationId);
        const desired = { kind: 'complete', userId: context.userId, eventId: context.eventId, sessionId: context.sessionId,
          experienceId: null, stationId, serviceSessionId };
        return execute(context, desired, async () => {
          const { stations } = await fetchStaffStations(client, context.eventId);
          return stations.some((s) => s.id === stationId && s.pendingServiceSessionId === serviceSessionId);
        }, (key) => completeStaffService(client, { eventId: context.eventId, serviceSessionId, idempotencyKey: key }));
      }, context, { ...context, kind: 'complete', experienceId: null, stationId, serviceSessionId });
    },
    absent(context, serviceSessionId, stationId) {
      context = { ...context };
      return single(async () => {
        contextValid(context); requireIds(serviceSessionId, stationId);
        const desired = { kind: 'absent', userId: context.userId, eventId: context.eventId, sessionId: context.sessionId,
          experienceId: null, stationId, serviceSessionId };
        return execute(context, desired, async () => {
          const { stations } = await fetchStaffStations(client, context.eventId);
          return stations.some((s) => s.id === stationId && s.pendingServiceSessionId === serviceSessionId);
        }, (key) => absentStaffService(client, { eventId: context.eventId, serviceSessionId, idempotencyKey: key }));
      }, context, { ...context, kind: 'absent', experienceId: null, stationId, serviceSessionId });
    },
    removeCalled(context, experienceId, stationId, serviceSessionId) {
      context = { ...context };
      return single(async () => {
        contextValid(context); requireIds(experienceId, stationId, serviceSessionId);
        const desired = { kind: 'remove_called', userId: context.userId, eventId: context.eventId,
          sessionId: context.sessionId, experienceId, stationId, serviceSessionId };
        return execute(context, desired, async () => {
          const { stations } = await fetchStaffStations(client, context.eventId);
          return stations.some(s => s.id === stationId && s.experienceId === experienceId &&
            s.pendingServiceSessionId === serviceSessionId);
        }, key => removeCalledStaff(client, { eventId: context.eventId, serviceSessionId, idempotencyKey: key }));
      }, context, { ...context, kind: 'remove_called', experienceId, stationId, serviceSessionId });
    },
    removeWaiting(context, experienceId, stationId, queueEntryId) {
      context = { ...context };
      return single(async () => {
        contextValid(context); requireIds(experienceId, stationId, queueEntryId);
        const desired = { kind: 'remove', userId: context.userId, eventId: context.eventId,
          sessionId: context.sessionId, experienceId, stationId, serviceSessionId: null, queueEntryId };
        return execute(context, desired, async () => {
          const state = await fetchStaffStationState(client, context.eventId, experienceId, stationId);
          return state.waiting.some(row => row.queueEntryId === queueEntryId);
        }, key => removeWaitingStaff(client, { eventId: context.eventId, experienceId, queueEntryId,
          idempotencyKey: key }));
      }, context, { ...context, kind: 'remove', experienceId, stationId, serviceSessionId: null, queueEntryId });
    },
    pending(context) { context = { ...context }; return scoped(context, async () => {
      contextValid(context);
      const intent = await getIntent(context);
      if (!intent) return { kind: 'none' };
      if (intent.sessionId !== context.sessionId || intent.eventId !== context.eventId ||
          !isUuid(context.stationId) || intent.stationId !== context.stationId) return { kind: 'pending_other' };
      alive(context, intent);
      return intent.phase === 'terminal' ? { kind: 'terminal_pending', operation: intent.kind, outcome: intent.outcome,
        receiptId: intent.key, serviceSessionId: intent.kind === 'call' && intent.outcome?.kind === 'confirmed'
          ? intent.outcome.result.id : intent.serviceSessionId }
        : { kind: intent.phase === 'reserved' ? 'reserved' : 'pending_reconciliation', operation: intent.kind,
          receiptId: intent.key };
    }); },
    cancelReserved(context, expectedKey = null) { context = { ...context }; return scoped(context, async () => {
      contextValid(context);
      if (expectedKey !== null) requireIds(expectedKey);
      const intent = await getIntent(context);
      if (!intent || intent.phase !== 'reserved' || intent.sessionId !== context.sessionId ||
          intent.eventId !== context.eventId || intent.stationId !== context.stationId ||
          (expectedKey !== null && intent.key !== expectedKey))
        return { kind: 'blocked' };
      const cancelled = await storage.cancelReserved(context.userId, intent.key);
      return isCurrent(context) ? { kind: cancelled ? 'cancelled' : 'blocked' } : { kind: 'stale' };
    }); },
    cleanupTerminal(context, receiptId) { context = { ...context };
      let scope = { ...context, key: receiptId };
      return scoped(context, async () => {
      contextValid(context);
      requireIds(receiptId);
      alive(context, scope);
      const intent = await getIntent(context);
      alive(context, scope);
      if (!intent || intent.phase !== 'terminal' || intent.sessionId !== context.sessionId ||
          intent.eventId !== context.eventId || intent.stationId !== context.stationId) return { kind: 'blocked' };
      if (intent.key !== receiptId) return { kind: 'receipt_changed' };
      scope = intent;
      alive(context, intent);
      try { await storage.clear(context.userId, intent.key); }
      catch { return isCurrent(context, intent) ? { kind: 'cleanup_pending' } : { kind: 'stale' }; }
      return isCurrent(context, intent) ? { kind: 'terminal_pending', outcome: intent.outcome, receiptId } : { kind: 'stale' };
    }, () => scope); },
    acknowledgeTerminal(context, receiptId) { context = { ...context };
      let scope = { ...context, key: receiptId };
      return scoped(context, async () => {
      contextValid(context);
      requireIds(receiptId);
      alive(context, scope);
      let intent;
      try { intent = await getIntent(context); }
      catch {
        return isCurrent(context) && isCurrent(context, scope)
          ? { kind: 'acknowledgement_uncertain' } : { kind: 'stale' };
      }
      alive(context, scope);
      if (!intent) return { kind: 'receipt_absent' };
      scope = intent;
      alive(context, intent);
      if (intent.phase !== 'terminal' || intent.sessionId !== context.sessionId ||
          intent.eventId !== context.eventId || intent.stationId !== context.stationId) return { kind: 'blocked' };
      if (intent.key !== receiptId) return { kind: 'receipt_changed' };
      const serviceId = intent.serviceSessionId ?? (intent.kind === 'call' && intent.outcome?.kind === 'confirmed'
        ? intent.outcome.result.id : null);
      if (serviceId && serviceId !== context.serviceSessionId) return { kind: 'blocked' };
      alive(context, intent);
      let acknowledged;
      try { acknowledged = await storage.acknowledge(context.userId, receiptId, intent); }
      catch { return isCurrent(context, intent) ? { kind: 'acknowledgement_uncertain' } : { kind: 'stale' }; }
      return isCurrent(context, intent) ? acknowledged : { kind: 'stale' };
    }, () => scope); },
  };
}
