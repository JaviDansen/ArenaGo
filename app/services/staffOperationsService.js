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
      || body.participation?.currentQueueEntryId !== null) {
    throw bad('Resposta inesperada da conclusão. Não repetir com nova chave.');
  }
  return { id: serviceSessionId, status: 'completed', resolvedAt: body.serviceSession.resolvedAt ?? null,
    queueEntryStatus: 'closed', closeReason: 'completed',
    participationStatus: body.participation.status };
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

/**
 * As funções mutantes exigem a mesma chave estável em cada retry da MESMA intenção.
 * Usar createStaffOperationsCoordinator para guardar a chave antes do POST.
 */
export async function callNextStaff(client, { eventId, experienceId, stationId, idempotencyKey }) {
  requireIds(eventId, experienceId, stationId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/experiences/${experienceId}/stations/${stationId}/call-next`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, outcomeUnknownOnNetworkError: true });
  return parseCalledSession(body, { experienceId, stationId });
}

export async function completeStaffService(client, { eventId, serviceSessionId, idempotencyKey }) {
  requireIds(eventId, serviceSessionId, idempotencyKey);
  const body = await client.post(
    `/staff/events/${eventId}/service-sessions/${serviceSessionId}/complete`, {},
    { auth: true, headers: { 'Idempotency-Key': idempotencyKey }, outcomeUnknownOnNetworkError: true });
  return parseCompletedSession(body, serviceSessionId);
}

export function createStaffOperationsCoordinator({ client, storage, createKey, isCurrent = () => true }) {
  let inflight = null;
  function alive() { if (!isCurrent()) throw bad('Sessão alterada. Não enviar nova operação.'); }
  function contextValid(context) { requireIds(context?.userId, context?.eventId); }
  function conflict(existing, next) {
    return existing && (existing.kind !== next.kind || existing.eventId !== next.eventId
      || existing.userId !== next.userId || existing.experienceId !== next.experienceId
      || existing.stationId !== next.stationId || existing.serviceSessionId !== next.serviceSessionId);
  }
  async function getIntent(context) {
    alive();
    const intent = await storage.get(context.userId);
    alive();
    return intent;
  }
  async function execute(context, desired, check, operation) {
    contextValid(context);
    const existing = await getIntent(context);
    if (conflict(existing, desired)) return { kind: 'pending_other' };
    // Somente a intenção inicial é submetida a pré-condições de leitura.
    // Depois de um timeout, reexecutar a mesma chave permite replay idempotente.
    if (!existing) {
      const possible = await check();
      alive();
      if (!possible) return { kind: 'blocked' };
    }
    const intent = existing ?? { ...desired, key: createKey() };
    requireIds(intent.key);
    if (!existing) { alive(); await storage.set(intent); alive(); }
    let error = null;
    try {
      const result = await operation(intent.key);
      alive();
      await storage.clear(context.userId, intent.key);
      return { kind: 'confirmed', result };
    } catch (e) { error = e; }
    alive();
    return { kind: 'unconfirmed', code: error?.code ?? null,
      message: 'Não foi possível confirmar a operação. Consulte o estado e repita somente com a chave preservada.' };
  }
  function single(work) {
    if (inflight) return inflight;
    const promise = work();
    inflight = promise;
    return promise.finally(() => { if (inflight === promise) inflight = null; });
  }
  return {
    async readStations(context) { contextValid(context); const value = await fetchStaffStations(client, context.eventId); alive(); return value; },
    async readQueue(context, experienceId) {
      contextValid(context); const value = await fetchStaffQueue(client, context.eventId, experienceId); alive(); return value;
    },
    callNext(context, experienceId, stationId) {
      return single(async () => {
        contextValid(context); requireIds(experienceId, stationId);
        const desired = { kind: 'call', userId: context.userId, eventId: context.eventId,
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
      });
    },
    complete(context, serviceSessionId, stationId) {
      return single(async () => {
        contextValid(context); requireIds(serviceSessionId, stationId);
        const desired = { kind: 'complete', userId: context.userId, eventId: context.eventId,
          experienceId: null, stationId, serviceSessionId };
        return execute(context, desired, async () => {
          const { stations } = await fetchStaffStations(client, context.eventId);
          return stations.some((s) => s.id === stationId && s.pendingServiceSessionId === serviceSessionId);
        }, (key) => completeStaffService(client, { eventId: context.eventId, serviceSessionId, idempotencyKey: key }));
      });
    },
    async pending(context) { contextValid(context); return getIntent(context); },
  };
}
