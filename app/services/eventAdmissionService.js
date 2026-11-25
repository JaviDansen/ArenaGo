import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { httpClient } from './httpClient';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTENT_PREFIX = 'arenago.admission.intent.';

function validUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function responseError() {
  const error = new Error('O servidor retornou dados de ingresso inválidos. Tente novamente.');
  error.code = 'INVALID_ADMISSION_RESPONSE';
  return error;
}

export function parseEventLookupResponse(body) {
  const event = body?.event;
  const eligibility = body?.eligibility;
  if (!validUuid(event?.id) || typeof event.name !== 'string' || !event.name.trim() ||
      typeof event.timezone !== 'string' || !event.timezone.trim() ||
      typeof event.externalQueueEnabled !== 'boolean' ||
      !['startsAt', 'officialEndsAt', 'operationalDeadlineAt'].every((field) =>
        typeof event[field] === 'string' && Number.isFinite(Date.parse(event[field]))) ||
      typeof eligibility?.eligible !== 'boolean' || !Array.isArray(eligibility.blockingReasons) ||
      !eligibility.blockingReasons.every((reason) => typeof reason === 'string' && reason.length > 0) ||
      (eligibility.eligible && eligibility.blockingReasons.length > 0)) {
    throw responseError();
  }
  return {
    event: { id: event.id, name: event.name, timezone: event.timezone, startsAt: event.startsAt,
      officialEndsAt: event.officialEndsAt, operationalDeadlineAt: event.operationalDeadlineAt,
      externalQueueEnabled: event.externalQueueEnabled },
    eligibility: { eligible: eligibility.eligible, blockingReasons: [...eligibility.blockingReasons] },
  };
}

export function parseParticipationCreationResponse(body) {
  if (!validUuid(body?.participationId)) throw responseError();
  return body.participationId;
}

function validIntent(value, userId) {
  return value && value.userId === userId && validUuid(value.eventId) && validUuid(value.key) &&
    (value.confirmedParticipationId === null || validUuid(value.confirmedParticipationId)) &&
    // createdAt é informativo (R01); intenções gravadas antes dele continuam válidas.
    (value.createdAt === undefined || (typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))));
}

const PARTICIPATION_STATUS = new Set(['waiting', 'active', 'finished', 'canceled']);

/** Leitura autoritativa de uma participação da própria conta (GET /participations/:id). */
export function parseOwnedParticipationResponse(body, participationId) {
  const participation = body?.participation;
  if (!participation || participation.id !== participationId || !validUuid(participation.eventId) ||
      !PARTICIPATION_STATUS.has(participation.status)) {
    throw responseError();
  }
  return { id: participation.id, eventId: participation.eventId, status: participation.status,
    finishedAt: participation.finishedAt ?? null, finishReason: participation.finishReason ?? null };
}

/**
 * Códigos que o backend só devolve depois de reservar a chave sem encontrar registro anterior
 * (o replay de `reserveJoinIntentWithTx` precede a elegibilidade e o rollback desfaz a reserva).
 * Para a chave enviada, eles provam que o POST não foi aplicado; a intenção pode ser liberada.
 */
const NOT_APPLIED_CODES = new Set([
  'VALIDATION_ERROR', 'EVENT_NOT_FOUND', 'PARTICIPATION_ALREADY_CURRENT', 'PROFILE_INCOMPLETE',
  'EVENT_NOT_STARTED', 'EVENT_REGISTRATION_CLOSED', 'EVENT_NOT_READY',
]);

/** Classifica a falha do POST de ingresso para a chave enviada. */
export function classifyJoinFailure(error) {
  if (error?.code === 'ADMISSION_OTHER_EVENT_PENDING') return 'other_pending';
  if (error?.isNetworkError || error?.isTimeout || !error?.status || error.status >= 500 ||
      error?.code === 'IDEMPOTENCY_IN_PROGRESS' || error?.code === 'INVALID_ADMISSION_RESPONSE') return 'uncertain';
  if (error.status === 401 || error.status === 403) return 'session';
  if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'conflict';
  if ([400, 404, 409, 422].includes(error.status) && NOT_APPLIED_CODES.has(error.code)) return 'not_applied';
  // Outros 4xx sem semântica conhecida não provam nada sobre a chave: preservar.
  return 'unknown';
}

/** Persiste somente a intenção e sua chave, isoladas pelo UUID da conta; nenhum token é salvo. */
export function createAdmissionIntentStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const webValues = new Map();
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const pending = queue.then(task, task);
    queue = pending.catch(() => {});
    return pending;
  };
  const storageKey = (userId) => {
    if (!validUuid(userId)) throw new Error('Identidade inválida para a intenção de ingresso.');
    return `${INTENT_PREFIX}${userId.toLowerCase()}`;
  };
  async function readRaw(key) {
    if (platformOS === 'web') return webValues.get(key) ?? null;
    if (typeof secureStore.getItemAsync !== 'function' || typeof secureStore.setItemAsync !== 'function' ||
        typeof secureStore.deleteItemAsync !== 'function' ||
        (typeof secureStore.isAvailableAsync === 'function' && !await secureStore.isAvailableAsync())) {
      throw new Error('O armazenamento seguro não está disponível para este ingresso.');
    }
    return secureStore.getItemAsync(key);
  }
  async function read(userId) {
    const raw = await readRaw(storageKey(userId));
    if (raw === null) return null;
    let intent;
    try { intent = JSON.parse(raw); }
    catch { throw new Error('A intenção de ingresso armazenada está inválida.'); }
    if (!validIntent(intent, userId)) throw new Error('A intenção de ingresso armazenada está inválida.');
    return intent;
  }
  return {
    get(userId) { return enqueue(() => read(userId)); },
    set(intent) {
      return enqueue(async () => {
        if (!validIntent(intent, intent?.userId)) throw new Error('Intenção de ingresso inválida.');
        const key = storageKey(intent.userId), value = JSON.stringify(intent);
        if (platformOS === 'web') webValues.set(key, value);
        else await secureStore.setItemAsync(key, value);
      });
    },
    clear(userId, keyToClear) {
      return enqueue(async () => {
        const intent = await read(userId);
        if (!intent || intent.key !== keyToClear) return;
        const key = storageKey(userId);
        if (platformOS === 'web') webValues.delete(key);
        else await secureStore.deleteItemAsync(key);
      });
    },
  };
}

export const defaultAdmissionIntentStorage = createAdmissionIntentStorage();

export function describeAdmissionError(error, operation = 'lookup') {
  if (error?.isTimeout) return 'O tempo de resposta terminou. O resultado pode ter sido confirmado; tente novamente com segurança.';
  if (error?.isNetworkError) return 'Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.';
  if (error?.status === 401 || error?.status === 403) return 'Sua sessão não permite esta operação. Entre novamente, se necessário.';
  switch (error?.code) {
    case 'VALIDATION_ERROR': return 'Confira o código ou os dados informados e tente novamente.';
    case 'EVENT_NOT_FOUND': return 'Nenhum evento foi encontrado para esse código.';
    case 'EVENT_NOT_STARTED': return 'O evento ainda não começou.';
    case 'EVENT_NOT_READY': return 'O evento ainda não está pronto para receber participantes.';
    case 'EVENT_REGISTRATION_CLOSED': return 'As entradas neste evento foram encerradas.';
    case 'PROFILE_INCOMPLETE': return 'Complete o questionário e escolha seus jogos antes de ingressar.';
    case 'PARTICIPATION_ALREADY_CURRENT': return 'Você já possui uma participação corrente. Atualize sua participação.';
    case 'IDEMPOTENCY_IN_PROGRESS': return 'Seu ingresso ainda está sendo processado. Tente atualizar em instantes.';
    case 'IDEMPOTENCY_KEY_REUSED': return 'Esta tentativa entrou em conflito com outra solicitação. Procure suporte.';
    case 'INVALID_ADMISSION_RESPONSE': return error.message;
    default: return operation === 'lookup'
      ? 'Não foi possível consultar o evento agora.'
      : 'Não foi possível confirmar o ingresso agora. Tente novamente com segurança.';
  }
}

const MESSAGES = {
  otherPending: 'Há uma tentativa de ingresso anterior nesta conta que ainda não foi resolvida. Verifique essa tentativa antes de iniciar outra.',
  previousBusy: 'Aguarde a conclusão da tentativa de ingresso anterior.',
  unsynced: 'Ingresso confirmado, mas a participação ainda não pôde ser sincronizada. Atualize sem repetir o ingresso.',
  unsyncedAfterError: 'Ingresso confirmado. Não foi possível atualizar a participação agora; tente sincronizar novamente.',
  historical: 'Sua tentativa anterior foi registrada e essa participação já foi encerrada. Você pode iniciar um novo ingresso.',
  recoveryUncertain: 'Não foi possível confirmar a tentativa anterior agora. Ela continua guardada com segurança; tente verificar novamente.',
  recoverySession: 'Sua sessão não permitiu verificar a tentativa anterior. Entre novamente e tente outra vez.',
  recoveryConflict: 'A tentativa anterior não pôde ser confirmada com segurança. Procure o suporte do evento; nenhum novo ingresso foi criado.',
  recoveryInconsistent: 'O servidor não confirmou a participação da tentativa anterior. Procure o suporte do evento; nenhum novo ingresso foi criado.',
  recoveryStorage: 'Não foi possível ler a tentativa anterior guardada neste aparelho. Nenhum novo ingresso foi criado.',
  revalidateFailed: 'Não foi possível atualizar a situação do evento. Tente novamente antes de confirmar.',
  revalidateOtherEvent: 'Este código agora corresponde a outro evento. Consulte o evento novamente.',
};

/** Resumo público da intenção persistida; a chave idempotente nunca sai do store. */
function describeIntent(intent, eventId) {
  if (!intent) return null;
  return { eventId: intent.eventId, sameEvent: intent.eventId === eventId,
    confirmed: Boolean(intent.confirmedParticipationId) };
}

/**
 * Orquestra a consulta, o POST idempotente e a leitura definitiva da participação por sessão.
 *
 * Cada consulta (`lookup`) abre uma nova operação: estado de confirmação, erros e resultados de
 * sincronização de operações anteriores não são herdados, e respostas tardias delas não publicam
 * nada. A intenção persistida (chave idempotente) pertence à conta, não à operação, e só é
 * liberada por resolução autoritativa do servidor.
 */
export function createEventAdmissionStore({
  client = httpClient,
  getIdentity,
  refreshParticipation,
  getParticipationSnapshot,
  intentStorage = defaultAdmissionIntentStorage,
  createKey = () => Crypto.randomUUID(),
  now = () => new Date(),
}) {
  const empty = (identity = null, operation = 0) => ({ userId: identity?.userId ?? null, epoch: identity?.epoch ?? null,
    operation, status: 'idle', event: null, eligibility: null, eligibilityStatus: 'none', error: null,
    confirmedParticipationId: null, outcome: null, pendingIntent: null,
    recovery: { status: 'idle', message: null } });
  let state = empty(), generation = 0, operation = 0, lookupSequence = 0;
  let accessCode = null;
  // Voos são marcados com a operação que os criou; outra operação nunca recebe seu resultado.
  let joinFlight = null, syncFlight = null, recoveryFlight = null, revalidateFlight = null;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const capture = () => state.userId === null ? null
    : { userId: state.userId, epoch: state.epoch, version: generation, operation };
  const identityMatches = (ctx) => {
    const current = getIdentity();
    return Boolean(ctx && current && ctx.version === generation &&
      ctx.userId === current.userId && ctx.epoch === current.epoch &&
      state.userId === ctx.userId && state.epoch === ctx.epoch);
  };
  const matches = (ctx) => identityMatches(ctx) && ctx.operation === operation && state.operation === operation;
  const update = (ctx, patch) => {
    if (!matches(ctx)) return false;
    publish({ ...state, ...patch });
    return true;
  };

  function setIdentity(identity) {
    generation += 1; lookupSequence += 1; operation += 1;
    accessCode = null;
    joinFlight = null; syncFlight = null; recoveryFlight = null; revalidateFlight = null;
    publish(empty(identity, operation));
  }

  async function readPendingIntent(ctx) {
    try { return { intent: await intentStorage.get(ctx.userId), failed: false }; }
    catch { return { intent: null, failed: true }; }
  }

  async function lookup(code) {
    if (state.userId === null) return { kind: 'stale' };
    // Nova consulta = nova operação: nada da operação anterior é herdado.
    operation += 1;
    const ctx = capture(), sequence = ++lookupSequence;
    if (!identityMatches(ctx)) return { kind: 'stale' };
    const normalized = typeof code === 'string' ? code.trim() : '';
    accessCode = null;
    if (!normalized) {
      const message = 'Digite o código do evento.';
      publish({ ...empty(ctx, operation), status: 'error', error: message });
      return { kind: 'error', message };
    }
    publish({ ...empty(ctx, operation), status: 'looking_up' });
    try {
      const result = parseEventLookupResponse(await client.post('/events/lookup', { accessCode: normalized }, { auth: true }));
      if (!matches(ctx) || sequence !== lookupSequence) return { kind: 'stale' };
      const pending = await readPendingIntent(ctx);
      if (!matches(ctx) || sequence !== lookupSequence) return { kind: 'stale' };
      accessCode = normalized;
      publish({ ...state, status: 'ready', ...result, eligibilityStatus: 'fresh', error: null,
        pendingIntent: pending.failed ? { unreadable: true } : describeIntent(pending.intent, result.event.id) });
      return { kind: 'found', ...result };
    } catch (error) {
      if (!matches(ctx) || sequence !== lookupSequence) return { kind: 'stale' };
      const message = describeAdmissionError(error, 'lookup');
      publish({ ...state, status: 'error', event: null, eligibility: null, error: message });
      return { kind: 'error', message };
    }
  }

  /**
   * Revalida a elegibilidade do mesmo evento pelo contrato real (`POST /events/lookup`).
   * Não abre nova operação: confirmação e recuperação em curso desta operação são preservadas.
   */
  function revalidate() {
    const ctx = capture();
    if (!matches(ctx) || !state.event?.id || !accessCode) return Promise.resolve({ kind: 'unavailable' });
    if (revalidateFlight?.operation === operation) return revalidateFlight.promise;
    if (joinFlight?.operation === operation) return Promise.resolve({ kind: 'busy' });
    const eventId = state.event.id, code = accessCode;
    const promise = (async () => {
      update(ctx, { eligibilityStatus: 'revalidating' });
      try {
        const result = parseEventLookupResponse(await client.post('/events/lookup', { accessCode: code }, { auth: true }));
        if (!matches(ctx)) return { kind: 'stale' };
        if (result.event.id !== eventId) {
          update(ctx, { eligibilityStatus: 'error', eligibility: null, error: MESSAGES.revalidateOtherEvent });
          return { kind: 'other_event' };
        }
        const pending = await readPendingIntent(ctx);
        if (!matches(ctx)) return { kind: 'stale' };
        const terminal = ['joining', 'complete'].includes(state.status);
        update(ctx, { event: result.event, eligibility: result.eligibility, eligibilityStatus: 'fresh',
          // Erro de uma tentativa recusada deixa de valer quando o servidor reapresenta o estado.
          error: state.status === 'error' || state.status === 'ready' ? null : state.error,
          status: terminal || state.status === 'uncertain' || state.status === 'confirmed_unsynced' ? state.status : 'ready',
          pendingIntent: pending.failed ? { unreadable: true } : describeIntent(pending.intent, eventId) });
        return { kind: 'found', ...result };
      } catch (error) {
        if (!matches(ctx)) return { kind: 'stale' };
        update(ctx, { eligibilityStatus: 'error',
          error: error?.status === 401 || error?.status === 403 ? describeAdmissionError(error) : MESSAGES.revalidateFailed });
        return { kind: 'error' };
      }
    })();
    const flight = { operation, promise };
    revalidateFlight = flight;
    return promise.finally(() => { if (revalidateFlight === flight) revalidateFlight = null; });
  }

  async function readOwnedParticipation(participationId) {
    if (typeof client.get !== 'function') throw responseError();
    return parseOwnedParticipationResponse(
      await client.get(`/participations/${participationId}`, { auth: true }), participationId);
  }

  async function clearIntent(userId, intentKey) {
    try { await intentStorage.clear(userId, intentKey); return true; }
    catch { return false; /* Preserva a chave caso o armazenamento não confirme sua remoção. */ }
  }

  /**
   * Resolve um ingresso cujo identificador foi confirmado pelo servidor (resposta 201 ou replay).
   * Corrente → `complete`; encerrada/cancelada (GET /participations/:id) → `historical`.
   * Somente esses dois desfechos liberam a intenção persistida.
   */
  async function settleConfirmed(ctx, confirmedId, eventId) {
    try { await refreshParticipation(); }
    catch { /* O estado de leitura já informa a falha; o ingresso continua confirmado. */ }
    if (!identityMatches(ctx)) return { kind: 'stale' };
    const snapshot = getParticipationSnapshot();
    const ownSnapshot = snapshot.userId === ctx.userId && snapshot.epoch === ctx.epoch && snapshot.status === 'ready';
    let participation = null;
    if (ownSnapshot && snapshot.participation?.id === confirmedId && snapshot.participation.eventId === eventId &&
        ['active', 'waiting'].includes(snapshot.participation.status)) {
      participation = snapshot.participation;
    } else if (ownSnapshot) {
      // /current não mostra esta participação: a ausência não é prova; consultar a própria participação.
      try { participation = await readOwnedParticipation(confirmedId); }
      catch { participation = null; }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (participation && participation.eventId !== eventId) return { kind: 'inconsistent' };
    }
    if (!participation) return { kind: 'confirmed_unsynced' };
    const historical = ['finished', 'canceled'].includes(participation.status);
    try {
      const intent = await intentStorage.get(ctx.userId);
      if (intent?.confirmedParticipationId === confirmedId) await intentStorage.clear(ctx.userId, intent.key);
    } catch { /* Uma intenção residual só permite replay; a leitura do servidor confirmou o desfecho. */ }
    if (!identityMatches(ctx)) return { kind: 'stale' };
    return { kind: historical ? 'historical' : 'complete', participation };
  }

  function publishSettled(ctx, confirmedId, settled) {
    if (settled.kind === 'complete') {
      update(ctx, { status: 'complete', confirmedParticipationId: confirmedId, outcome: 'current', error: null });
    } else if (settled.kind === 'historical') {
      // A participação desta intenção terminou: não há o que sincronizar; um novo ingresso volta a ser possível.
      update(ctx, { status: 'ready', confirmedParticipationId: null, outcome: 'historical', error: MESSAGES.historical });
    } else if (settled.kind === 'inconsistent') {
      update(ctx, { status: 'error', confirmedParticipationId: null, error: MESSAGES.recoveryInconsistent });
    } else if (settled.kind === 'confirmed_unsynced') {
      update(ctx, { status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: MESSAGES.unsynced });
    }
  }

  function synchronize(ctx, confirmedId, eventId) {
    if (syncFlight?.operation === ctx.operation && syncFlight.confirmedId === confirmedId) return syncFlight.promise;
    const promise = (async () => {
      const settled = await settleConfirmed(ctx, confirmedId, eventId);
      if (settled.kind === 'stale' || !matches(ctx)) return { kind: 'stale' };
      publishSettled(ctx, confirmedId, settled);
      return settled.kind === 'inconsistent' ? { kind: 'error', message: MESSAGES.recoveryInconsistent } : settled;
    })();
    const flight = { operation: ctx.operation, confirmedId, promise };
    syncFlight = flight;
    return promise.finally(() => { if (syncFlight === flight) syncFlight = null; });
  }

  async function retrySync() {
    const ctx = capture();
    if (!matches(ctx)) return { kind: 'stale' };
    const confirmedId = state.confirmedParticipationId;
    if (!confirmedId || !state.event?.id) return { kind: 'error' };
    return synchronize(ctx, confirmedId, state.event.id);
  }

  async function refreshPendingIntent(ctx) {
    const pending = await readPendingIntent(ctx);
    update(ctx, { pendingIntent: pending.failed ? { unreadable: true } : describeIntent(pending.intent, state.event?.id) });
  }

  function confirm(eventId) {
    const ctx = capture();
    if (joinFlight?.operation === operation) return joinFlight.promise;
    if (!matches(ctx) || state.event?.id !== eventId || !state.eligibility?.eligible || state.eligibilityStatus !== 'fresh') {
      return Promise.resolve({ kind: 'error', message: 'Este evento não está disponível para ingresso.' });
    }
    // Uma tentativa de outra operação ainda em voo deve terminar antes (sem compartilhar resultado).
    if (joinFlight || recoveryFlight) return Promise.resolve({ kind: 'error', message: MESSAGES.previousBusy });
    if (state.confirmedParticipationId) return retrySync();
    const promise = (async () => {
      let intent;
      let confirmedId = null;
      update(ctx, { status: 'joining', error: null, outcome: null });
      try {
        intent = await intentStorage.get(ctx.userId);
        if (!matches(ctx)) return { kind: 'stale' };
        if (intent && intent.eventId !== eventId) {
          const error = new Error(MESSAGES.otherPending);
          error.code = 'ADMISSION_OTHER_EVENT_PENDING';
          throw error;
        }
        if (!intent) {
          const key = createKey();
          if (!validUuid(key)) throw new Error('Não foi possível gerar uma chave segura para o ingresso.');
          intent = { userId: ctx.userId, eventId, key, confirmedParticipationId: null, createdAt: now().toISOString() };
          await intentStorage.set(intent);
        }
        if (!matches(ctx)) return { kind: 'stale' };
        confirmedId = intent.confirmedParticipationId;
        if (!confirmedId) {
          // Intenção nova ou incerta do mesmo evento: mesma chave e mesmo corpo ⇒ replay seguro.
          const response = await client.post('/participations', { eventId }, {
            auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true,
          });
          confirmedId = parseParticipationCreationResponse(response);
          // Persistir antes de checar a operação: a prova do servidor não pode se perder.
          await intentStorage.set({ ...intent, confirmedParticipationId: confirmedId });
        }
        if (!matches(ctx)) return { kind: 'stale' };
        update(ctx, { status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: null });
        return synchronize(ctx, confirmedId, eventId);
      } catch (error) {
        if (!matches(ctx)) return { kind: 'stale' };
        if (confirmedId) {
          update(ctx, { status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: MESSAGES.unsyncedAfterError });
          return { kind: 'confirmed_unsynced' };
        }
        const failure = classifyJoinFailure(error);
        if (intent && failure === 'not_applied') {
          await clearIntent(ctx.userId, intent.key);
          if (!matches(ctx)) return { kind: 'stale' };
        }
        const message = failure === 'other_pending' ? error.message : describeAdmissionError(error, 'join');
        const uncertain = failure === 'uncertain';
        update(ctx, { status: uncertain ? 'uncertain' : 'error', error: message });
        if (failure === 'other_pending' || failure === 'not_applied') await refreshPendingIntent(ctx);
        return { kind: uncertain ? 'uncertain' : 'error', message,
          // Recusa definitiva do servidor: a apresentação deve ser revalidada.
          revalidate: failure === 'not_applied' };
      }
    })();
    const flight = { operation, promise };
    joinFlight = flight;
    return promise.finally(() => { if (joinFlight === flight) joinFlight = null; });
  }

  /**
   * Reconcilia a intenção persistida (de qualquer evento) sem criar nova chave.
   * Sem identificador confirmado, repete o POST original (mesma chave e mesmo corpo): o backend
   * devolve o resultado gravado ou prova que a chave não foi aplicada. Nunca presume sucesso.
   */
  function reconcile() {
    const ctx = capture();
    if (!matches(ctx)) return Promise.resolve({ kind: 'stale' });
    if (recoveryFlight?.operation === operation) return recoveryFlight.promise;
    if (joinFlight) return Promise.resolve({ kind: 'error', message: MESSAGES.previousBusy });
    const promise = (async () => {
      update(ctx, { recovery: { status: 'checking', message: null } });
      const finish = async (status, message, extra = {}) => {
        if (!matches(ctx)) return { kind: 'stale' };
        await refreshPendingIntent(ctx);
        update(ctx, { recovery: { status, message } });
        return { kind: status, message, ...extra };
      };
      let intent;
      try { intent = await intentStorage.get(ctx.userId); }
      catch { return finish('blocked', MESSAGES.recoveryStorage); }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (!intent) return finish('resolved', null, { outcome: 'none' });
      let confirmedId = intent.confirmedParticipationId;
      if (!confirmedId) {
        try {
          const response = await client.post('/participations', { eventId: intent.eventId }, {
            auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true,
          });
          confirmedId = parseParticipationCreationResponse(response);
          await intentStorage.set({ ...intent, confirmedParticipationId: confirmedId });
        } catch (error) {
          if (!identityMatches(ctx)) return { kind: 'stale' };
          if (confirmedId) return finish('uncertain', MESSAGES.recoveryUncertain);
          const failure = classifyJoinFailure(error);
          if (failure === 'not_applied') {
            // O servidor provou que a chave original não foi aplicada: nenhuma participação foi criada por ela.
            const cleared = await clearIntent(ctx.userId, intent.key);
            return cleared ? finish('resolved', null, { outcome: 'not_applied' })
              : finish('blocked', MESSAGES.recoveryStorage);
          }
          if (failure === 'session') return finish('blocked', MESSAGES.recoverySession);
          if (failure === 'conflict') return finish('blocked', MESSAGES.recoveryConflict);
          return finish('uncertain', MESSAGES.recoveryUncertain);
        }
      }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      const settled = await settleConfirmed(ctx, confirmedId, intent.eventId);
      if (settled.kind === 'stale') return { kind: 'stale' };
      if (settled.kind === 'inconsistent') return finish('blocked', MESSAGES.recoveryInconsistent);
      if (settled.kind === 'confirmed_unsynced') return finish('uncertain', MESSAGES.recoveryUncertain);
      return finish('resolved', settled.kind === 'historical' ? MESSAGES.historical : null,
        { outcome: settled.kind === 'complete' ? 'current' : 'historical', participation: settled.participation });
    })();
    const flight = { operation, promise };
    recoveryFlight = flight;
    return promise.finally(() => { if (recoveryFlight === flight) recoveryFlight = null; });
  }

  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity, lookup, revalidate, confirm, retrySync, reconcile, isCurrent: () => matches(capture()) };
}
