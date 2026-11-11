/** Operações de participante na fila interna; nunca altera a participação localmente. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const invalid = (message) => new Error(message);

export function parseArenaExperiences(body, eventId) {
  if (!isUuid(eventId) || body?.eventId !== eventId || !Array.isArray(body.experiences)
      || typeof body.acceptingNewQueueEntries !== 'boolean') {
    throw invalid('O servidor retornou uma lista de experiências inválida.');
  }
  const ids = new Set();
  const experiences = body.experiences.map((item) => {
    if (!isUuid(item?.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()
        || !Number.isSafeInteger(item.waitingCount) || item.waitingCount < 0
        || typeof item.acceptingNewQueueEntries !== 'boolean') {
      throw invalid('O servidor retornou experiências inválidas.');
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, waitingCount: item.waitingCount,
      acceptingNewQueueEntries: item.acceptingNewQueueEntries };
  });
  return { acceptingNewQueueEntries: body.acceptingNewQueueEntries, experiences };
}

export function parseArenaQueue(body, participationId) {
  if (!isUuid(participationId) || body?.participationId !== participationId
      || !Object.prototype.hasOwnProperty.call(body, 'currentQueueEntry')) {
    throw invalid('O servidor retornou um estado de fila inválido.');
  }
  const entry = body.currentQueueEntry;
  if (entry === null) return null;
  if (!isUuid(entry?.id) || !isUuid(entry.experienceId)
      || typeof entry.experienceName !== 'string' || !entry.experienceName.trim()
      || !['waiting', 'called'].includes(entry.status)
      || (entry.status === 'waiting' && (!Number.isSafeInteger(entry.position) || entry.position < 1))
      || (entry.status === 'called' && (!entry.serviceSession
        || !isUuid(entry.serviceSession.id) || entry.serviceSession.status !== 'pending'
        || !isUuid(entry.serviceSession.station?.id)
        || typeof entry.serviceSession.station.label !== 'string'))) {
    throw invalid('O servidor retornou uma entrada de fila inválida.');
  }
  return { id: entry.id, experienceId: entry.experienceId,
    experienceName: entry.experienceName, status: entry.status,
    position: entry.status === 'waiting' ? entry.position : null,
    stationLabel: entry.status === 'called' ? entry.serviceSession.station.label : null,
    serviceSessionId: entry.status === 'called' ? entry.serviceSession.id : null };
}

export async function fetchArenaState(client, { participationId, eventId }) {
  if (!isUuid(participationId) || !isUuid(eventId)) throw invalid('Participação ou evento inválido.');
  const [catalog, queue] = await Promise.all([
    client.get(`/events/${eventId}/experiences`, { auth: true }),
    client.get(`/participations/${participationId}/queue`, { auth: true }),
  ]);
  return { ...parseArenaExperiences(catalog, eventId), currentQueueEntry: parseArenaQueue(queue, participationId) };
}

export function describeArenaError(error) {
  if (error?.isTimeout || error?.isNetworkError) return 'Conexão instável. Atualize para conferir o estado real da fila.';
  if (error?.status === 401 || error?.status === 403) return 'Sua sessão não permite a operação. Entre novamente.';
  if (error?.code === 'EVENT_REGISTRATION_CLOSED' || error?.code === 'EXPERIENCE_QUEUE_CLOSED')
    return 'A entrada nesta fila está encerrada.';
  if (error?.code === 'ALREADY_IN_INTERNAL_QUEUE') return 'Você já está em uma fila. Atualize o estado.';
  if (error?.code === 'PARTICIPATION_NOT_ACTIVE') return 'Sua participação não está mais ativa. Atualize a Arena.';
  if (error?.code === 'IDEMPOTENCY_KEY_REUSED') return 'A tentativa não pode ser repetida com outra intenção. Consulte o suporte.';
  return 'Não foi possível concluir a operação. Atualize para verificar o estado.';
}

/**
 * Coordena intenção persistida antes de POST, validação de estado antes do POST e reconciliação
 * por GET depois dele. Se a resposta for incerta, preserva a mesma chave para um retry seguro.
 * A storage é sempre por userId (nunca tokens). A validação de titularidade é do backend.
 */
export function createArenaQueueCoordinator({ client, storage, createKey, isCurrent = () => true }) {
  let flight = null;
  const requireContext = (c) => {
    if (!isUuid(c?.userId) || !isUuid(c?.eventId) || !isUuid(c?.participationId))
      throw invalid('Contexto de participação inválido.');
  };
  const alive = () => { if (!isCurrent()) throw invalid('A sessão foi alterada. Atualize a Arena.'); };

  async function read(context) {
    requireContext(context);
    alive();
    const state = await fetchArenaState(client, context);
    alive();
    let intent = await storage.get(context.userId);
    alive();
    if (intent && (!isUuid(intent.participationId) || !isUuid(intent.experienceId)
      || !isUuid(intent.key) || intent.userId !== context.userId)) {
      throw invalid('Existe uma intenção de fila local inválida. Não crie outra entrada.');
    }
    if (state.currentQueueEntry && intent?.participationId === context.participationId
        && intent.experienceId === state.currentQueueEntry.experienceId) {
      await storage.clear(context.userId, intent.key);
      alive();
      intent = null;
    }
    return { ...state, pendingIntent: intent };
  }

  function join(context, experienceId) {
    if (flight) return flight;
    const pending = (async () => {
      requireContext(context);
      if (!isUuid(experienceId)) throw invalid('Experiência inválida.');
      const before = await read(context);
      if (before.currentQueueEntry) return { kind: 'already', state: before };
      const currentIntent = before.pendingIntent;
      if (currentIntent && (currentIntent.participationId !== context.participationId
          || currentIntent.experienceId !== experienceId)) {
        return { kind: 'pending_other', state: before };
      }
      const choice = before.experiences.find((x) => x.id === experienceId);
      if (!choice) throw invalid('Experiência não disponível neste evento.');
      if (!before.acceptingNewQueueEntries || !choice.acceptingNewQueueEntries) {
        return { kind: 'closed', state: before };
      }
      let intent = currentIntent;
      if (!intent) {
        const key = createKey();
        if (!isUuid(key)) throw invalid('Não foi possível criar uma chave de operação segura.');
        intent = { userId: context.userId, participationId: context.participationId,
          experienceId, key };
        alive();
        await storage.set(intent); // Persistir ANTES da chamada de rede.
      }
      alive();
      let apiError = null;
      try {
        await client.post(`/participations/${context.participationId}/queue-entries`,
          { experienceId }, { auth: true, headers: { 'Idempotency-Key': intent.key },
            outcomeUnknownOnNetworkError: true });
      } catch (error) { apiError = error; }
      // Uma resposta 2xx sem formato esperado não significa falha: sempre confirmar por GET.
      let after = null;
      try { after = await read(context); }
      catch (readError) {
        if (!apiError) apiError = readError;
      }
      if (after?.currentQueueEntry?.experienceId === experienceId) {
        return { kind: 'confirmed', state: after };
      }
      return { kind: 'unconfirmed', state: after ?? before,
        message: apiError ? describeArenaError(apiError) :
          'Não foi possível confirmar a entrada. Confira o estado antes de tentar novamente.' };
    })();
    flight = pending;
    return pending.finally(() => { if (flight === pending) flight = null; });
  }

  return { read, join };
}
