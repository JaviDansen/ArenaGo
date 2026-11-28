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
    // createdAt (R01), attempts e eventName (R02) são opcionais: intenções antigas continuam válidas.
    (value.createdAt === undefined || (typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)))) &&
    (value.attempts === undefined || (Number.isSafeInteger(value.attempts) && value.attempts >= 0)) &&
    (value.eventName === undefined || (typeof value.eventName === 'string' && value.eventName.length <= 200));
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

const INTENT_STATES = new Set(['completed', 'not_found', 'in_progress', 'abandoned', 'conflict']);

/** R02: resposta de consulta/abandono de intenção (`{ intent: { state, participationId? } }`). */
export function parseAdmissionIntentResponse(body, allowed = INTENT_STATES) {
  const intent = body?.intent;
  if (!intent || !allowed.has(intent.state)) throw responseError();
  if (intent.state === 'completed') {
    if (!validUuid(intent.participationId)) throw responseError();
    return { state: 'completed', participationId: intent.participationId };
  }
  return { state: intent.state };
}

/** Recusas de domínio/validação a uma requisição de ingresso efetivamente processada. */
const REFUSAL_CODES = new Set([
  'VALIDATION_ERROR', 'EVENT_NOT_FOUND', 'PARTICIPATION_ALREADY_CURRENT', 'PROFILE_INCOMPLETE',
  'EVENT_NOT_STARTED', 'EVENT_REGISTRATION_CLOSED', 'EVENT_NOT_READY',
]);

/**
 * Classifica a falha de um POST de ingresso **para a requisição que a recebeu**.
 * `refused` não prova, sozinho, que a intenção foi resolvida: outra requisição anterior com a
 * mesma chave pode estar em trânsito. Só a primeira e única tentativa recusada libera a
 * intenção (ver `confirm`); recusas durante a recuperação exigem consulta ou abandono.
 */
export function classifyJoinFailure(error) {
  if (error?.code === 'ADMISSION_OTHER_EVENT_PENDING') return 'other_pending';
  if (error?.code === 'ADMISSION_INTENT_ABANDONED') return 'abandoned';
  if (error?.isNetworkError || error?.isTimeout || !error?.status || error.status >= 500 ||
      error?.code === 'IDEMPOTENCY_IN_PROGRESS' || error?.code === 'INVALID_ADMISSION_RESPONSE') return 'uncertain';
  if (error.status === 401 || error.status === 403) return 'session';
  if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'conflict';
  if ([400, 404, 409, 422].includes(error.status) && REFUSAL_CODES.has(error.code)) return 'refused';
  // Outros 4xx sem semântica conhecida não provam nada sobre a chave: preservar.
  return 'unknown';
}

/**
 * Persiste somente a intenção e sua chave, isoladas pelo UUID da conta; nenhum token é salvo.
 * Toda leitura-comparação-escrita roda dentro da mesma fila serializada (seção crítica):
 * `create` não sobrescreve outra intenção, `update` e `clear` só agem sobre a chave esperada.
 */
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
  async function write(intent) {
    if (!validIntent(intent, intent?.userId)) throw new Error('Intenção de ingresso inválida.');
    const key = storageKey(intent.userId), value = JSON.stringify(intent);
    if (platformOS === 'web') webValues.set(key, value);
    else await secureStore.setItemAsync(key, value);
  }
  async function remove(userId) {
    const key = storageKey(userId);
    if (platformOS === 'web') webValues.delete(key);
    else await secureStore.deleteItemAsync(key);
  }
  const matchesExpected = (intent, expected) =>
    Object.entries(expected).every(([field, value]) => (intent[field] ?? null) === value);
  return {
    get(userId) { return enqueue(() => read(userId)); },
    /** Gravação incondicional (compatibilidade); o store usa as operações condicionais abaixo. */
    set(intent) { return enqueue(() => write(intent)); },
    /** Cria somente se a conta não tiver intenção; caso contrário devolve a existente intacta. */
    create(intent) {
      return enqueue(async () => {
        const existing = await read(intent?.userId);
        if (existing) return { created: false, intent: existing };
        await write(intent);
        return { created: true, intent };
      });
    },
    /**
     * Atualiza somente se a intenção atual tiver a chave esperada. `patch` pode ser função do
     * valor atual (transição atômica). Identidade (conta, evento, chave) nunca muda.
     * Devolve a intenção gravada ou `null` quando ela não é mais a atual.
     */
    update(userId, expectedKey, patch) {
      return enqueue(async () => {
        const existing = await read(userId);
        if (!existing || existing.key !== expectedKey) return null;
        const changes = typeof patch === 'function' ? patch(existing) : patch;
        const next = { ...existing, ...changes, userId: existing.userId, eventId: existing.eventId, key: existing.key };
        await write(next);
        return next;
      });
    },
    /** Remove somente a chave esperada, opcionalmente exigindo campos (ex.: `attempts: 1`). */
    clear(userId, keyToClear, expected = {}) {
      return enqueue(async () => {
        const intent = await read(userId);
        if (!intent || intent.key !== keyToClear || !matchesExpected(intent, expected)) return false;
        await remove(userId);
        return true;
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
  otherPending: 'Há uma tentativa de ingresso anterior nesta conta que ainda não foi resolvida. Resolva essa tentativa antes de iniciar outra.',
  samePending: 'Há uma tentativa de ingresso anterior neste evento ainda sem resultado confirmado. Verifique, repita ou cancele essa tentativa.',
  previousBusy: 'Aguarde a conclusão da tentativa de ingresso anterior.',
  unsynced: 'Ingresso confirmado, mas a participação ainda não pôde ser sincronizada. Atualize sem repetir o ingresso.',
  unsyncedAfterError: 'Ingresso confirmado. Não foi possível atualizar a participação agora; tente sincronizar novamente.',
  historical: 'Sua tentativa anterior foi registrada e essa participação já foi encerrada. Você pode iniciar um novo ingresso.',
  abandoned: 'A tentativa anterior foi cancelada definitivamente e não poderá mais ser concluída. Nenhuma participação foi criada por ela.',
  notFound: 'O servidor ainda não tem registro do resultado da tentativa anterior. Ela continua guardada: você pode verificar novamente, repetir o ingresso ou cancelar a tentativa.',
  inProgress: 'A tentativa anterior ainda está sendo processada pelo servidor. Verifique novamente em instantes.',
  repeatRefused: 'O servidor recusou a repetição agora. A tentativa anterior continua sem resultado confirmado; você pode verificar novamente ou cancelá-la.',
  recoveryUncertain: 'Não foi possível confirmar a tentativa anterior agora. Ela continua guardada com segurança; tente verificar novamente.',
  recoverySession: 'Sua sessão não permitiu resolver a tentativa anterior. Entre novamente e tente outra vez.',
  recoveryConflict: 'A tentativa anterior não pôde ser confirmada com segurança. Procure o suporte do evento; nenhum novo ingresso foi criado.',
  recoveryInconsistent: 'O servidor não confirmou a participação da tentativa anterior. Procure o suporte do evento; nenhum novo ingresso foi criado.',
  recoveryStorage: 'Não foi possível ler ou atualizar a tentativa anterior guardada neste aparelho. Nenhum novo ingresso foi criado.',
  revalidateFailed: 'Não foi possível atualizar a situação do evento. Tente novamente antes de confirmar.',
  revalidateOtherEvent: 'Este código agora corresponde a outro evento. Consulte o evento novamente.',
};

/** Resumo público da intenção persistida; a chave idempotente nunca sai do store. */
function describeIntent(intent, eventId) {
  if (!intent) return null;
  return { eventId: intent.eventId, eventName: intent.eventName ?? null, sameEvent: intent.eventId === eventId,
    confirmed: Boolean(intent.confirmedParticipationId) };
}

/**
 * Orquestra a consulta, o POST idempotente e a leitura definitiva da participação por sessão.
 *
 * Cada consulta (`lookup`) abre uma nova operação: estado de confirmação, erros e resultados de
 * sincronização de operações anteriores não são herdados, e respostas tardias delas não publicam
 * nada. A intenção persistida (chave idempotente) pertence à conta, não à operação, e só é
 * liberada por resolução autoritativa do servidor ou por recusa da sua primeira e única tentativa.
 *
 * Recuperação de uma intenção anterior (R02), sempre com a chave e o corpo originais:
 * - `reconcile` (Verificar): somente consulta (`/participations/admission-intents/lookup`);
 * - `repeatPrevious` (Repetir): POST original, por ação explícita — pode concluir o ingresso;
 * - `abandonPrevious` (Cancelar): abandono terminal no servidor; nunca cancela participação existente.
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
    recovery: { status: 'idle', message: null, action: null } });
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
  const pendingSummary = (pending, eventId) => (pending.failed ? { unreadable: true } : describeIntent(pending.intent, eventId));

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
        pendingIntent: pendingSummary(pending, result.event.id) });
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
   * Não abre nova operação e não interfere em ingresso ou recuperação em curso (devolve `busy`).
   */
  function revalidate() {
    const ctx = capture();
    if (!matches(ctx) || !state.event?.id || !accessCode) return Promise.resolve({ kind: 'unavailable' });
    if (revalidateFlight?.operation === operation) return revalidateFlight.promise;
    if (joinFlight?.operation === operation || recoveryFlight?.operation === operation) return Promise.resolve({ kind: 'busy' });
    const eventId = state.event.id, code = accessCode;
    const promise = (async () => {
      // A autorização anterior deixa de valer enquanto a consulta estiver em andamento.
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
          pendingIntent: pendingSummary(pending, eventId) });
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

  async function clearIntent(userId, intentKey, expected) {
    try { return await intentStorage.clear(userId, intentKey, expected); }
    catch { return false; /* Preserva a chave caso o armazenamento não confirme sua remoção. */ }
  }

  /** Grava a prova do servidor só na intenção da mesma chave; nunca sobrescreve outra intenção. */
  async function recordConfirmation(userId, intentKey, confirmedId) {
    try { return Boolean(await intentStorage.update(userId, intentKey, { confirmedParticipationId: confirmedId })); }
    catch { return false; }
  }

  /**
   * Envia o POST original da intenção (mesma chave e mesmo corpo), contando antes a tentativa.
   * Devolve `{ kind: 'confirmed', participationId }`, `{ kind: 'failed', error, attempts }` ou
   * `{ kind: 'replaced' }` quando a intenção deixou de ser a atual antes do envio.
   */
  async function sendIntent(userId, intent) {
    let counted;
    try {
      counted = await intentStorage.update(userId, intent.key,
        (current) => ({ attempts: (Number.isSafeInteger(current.attempts) ? current.attempts : 1) + 1 }));
    } catch (error) { return { kind: 'storage_failed', error }; }
    if (!counted) return { kind: 'replaced' };
    try {
      const response = await client.post('/participations', { eventId: intent.eventId }, {
        auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true,
      });
      const participationId = parseParticipationCreationResponse(response);
      // Persistir antes de qualquer checagem de operação: a prova do servidor não pode se perder,
      // mas só é gravada se esta ainda for a intenção atual (condicionada à chave).
      await recordConfirmation(userId, intent.key, participationId);
      return { kind: 'confirmed', participationId };
    } catch (error) {
      return { kind: 'failed', error, attempts: counted.attempts };
    }
  }

  /**
   * Resolve um ingresso cujo identificador foi confirmado pelo servidor (resposta 201 ou replay).
   * Corrente → `complete`; encerrada/cancelada (GET /participations/:id) → `historical`.
   * Somente esses dois desfechos liberam a intenção persistida.
   */
  async function settleConfirmed(ctx, confirmedId, eventId, intentKey = null) {
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
      const key = intentKey ?? (await intentStorage.get(ctx.userId))?.key;
      if (key) await intentStorage.clear(ctx.userId, key, { confirmedParticipationId: confirmedId });
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

  function synchronize(ctx, confirmedId, eventId, intentKey = null) {
    if (syncFlight?.operation === ctx.operation && syncFlight.confirmedId === confirmedId) return syncFlight.promise;
    const promise = (async () => {
      const settled = await settleConfirmed(ctx, confirmedId, eventId, intentKey);
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
    update(ctx, { pendingIntent: pendingSummary(pending, state.event?.id) });
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
      update(ctx, { status: 'joining', error: null, outcome: null });
      const fail = async (message, extra = {}) => {
        if (!matches(ctx)) return { kind: 'stale' };
        update(ctx, { status: extra.uncertain ? 'uncertain' : 'error', error: message });
        await refreshPendingIntent(ctx);
        return { kind: extra.uncertain ? 'uncertain' : 'error', message, revalidate: Boolean(extra.revalidate) };
      };
      let intent;
      try {
        const key = createKey();
        if (!validUuid(key)) throw new Error('Não foi possível gerar uma chave segura para o ingresso.');
        // Criação condicional: nunca sobrescreve uma intenção anterior ainda não resolvida.
        const created = await intentStorage.create({ userId: ctx.userId, eventId, key, confirmedParticipationId: null,
          createdAt: now().toISOString(), attempts: 0, eventName: state.event?.name?.slice(0, 200) });
        intent = created.intent;
        if (!matches(ctx)) return { kind: 'stale' };
        if (!created.created) {
          if (intent.eventId !== eventId) return fail(MESSAGES.otherPending);
          if (intent.confirmedParticipationId) {
            update(ctx, { status: 'confirmed_unsynced', confirmedParticipationId: intent.confirmedParticipationId, error: null });
            return synchronize(ctx, intent.confirmedParticipationId, eventId, intent.key);
          }
          // Tentativa anterior do mesmo evento sem resultado: repetir exige ação explícita (R02).
          return fail(MESSAGES.samePending);
        }
      } catch {
        return fail(MESSAGES.recoveryStorage);
      }
      const sent = await sendIntent(ctx.userId, intent);
      if (sent.kind === 'confirmed') {
        if (!matches(ctx)) return { kind: 'stale' };
        update(ctx, { status: 'confirmed_unsynced', confirmedParticipationId: sent.participationId, error: null });
        return synchronize(ctx, sent.participationId, eventId, intent.key);
      }
      if (sent.kind === 'replaced' || sent.kind === 'storage_failed') return fail(MESSAGES.recoveryStorage);
      const failure = classifyJoinFailure(sent.error);
      if (failure === 'abandoned') {
        await clearIntent(ctx.userId, intent.key, { confirmedParticipationId: null });
        return fail(MESSAGES.abandoned, { revalidate: true });
      }
      if (failure === 'refused') {
        // Só a primeira e única tentativa com esta chave prova, pela recusa, que nada será criado.
        const released = sent.attempts === 1 &&
          await clearIntent(ctx.userId, intent.key, { attempts: 1, confirmedParticipationId: null });
        return fail(describeAdmissionError(sent.error, 'join'), { revalidate: released });
      }
      return fail(describeAdmissionError(sent.error, 'join'), { uncertain: failure === 'uncertain' });
    })();
    const flight = { operation, promise };
    joinFlight = flight;
    return promise.finally(() => { if (joinFlight === flight) joinFlight = null; });
  }

  /** Executa uma ação de recuperação com voo exclusivo por operação. */
  function recover(action, run) {
    const ctx = capture();
    if (!matches(ctx)) return Promise.resolve({ kind: 'stale' });
    if (recoveryFlight?.operation === operation) {
      return recoveryFlight.action === action ? recoveryFlight.promise
        : Promise.resolve({ kind: 'error', message: MESSAGES.previousBusy });
    }
    if (joinFlight) return Promise.resolve({ kind: 'error', message: MESSAGES.previousBusy });
    const promise = (async () => {
      update(ctx, { recovery: { status: 'checking', message: null, action } });
      const finish = async (status, message, extra = {}) => {
        if (!matches(ctx)) return { kind: 'stale' };
        await refreshPendingIntent(ctx);
        update(ctx, { recovery: { status, message, action } });
        return { kind: status, message, ...extra };
      };
      let intent;
      try { intent = await intentStorage.get(ctx.userId); }
      catch { return finish('blocked', MESSAGES.recoveryStorage); }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (!intent) return finish('resolved', null, { outcome: 'none' });
      const settle = async (confirmedId) => {
        const settled = await settleConfirmed(ctx, confirmedId, intent.eventId, intent.key);
        if (settled.kind === 'stale') return { kind: 'stale' };
        if (settled.kind === 'inconsistent') return finish('blocked', MESSAGES.recoveryInconsistent);
        if (settled.kind === 'confirmed_unsynced') return finish('uncertain', MESSAGES.recoveryUncertain);
        return finish('resolved', settled.kind === 'historical' ? MESSAGES.historical : null,
          { outcome: settled.kind === 'complete' ? 'current' : 'historical', participation: settled.participation });
      };
      const abandoned = async () => {
        // Resultado terminal no servidor: a chave nunca mais poderá criar participação.
        const cleared = await clearIntent(ctx.userId, intent.key, { confirmedParticipationId: null });
        return cleared ? finish('resolved', MESSAGES.abandoned, { outcome: 'abandoned' }) : finish('blocked', MESSAGES.recoveryStorage);
      };
      if (intent.confirmedParticipationId) return settle(intent.confirmedParticipationId);
      return run({ ctx, intent, finish, settle, abandoned });
    })();
    const flight = { operation, action, promise };
    recoveryFlight = flight;
    return promise.finally(() => { if (recoveryFlight === flight) recoveryFlight = null; });
  }

  const recoveryFailure = (error, finish) => {
    const failure = classifyJoinFailure(error);
    if (failure === 'session') return finish('blocked', MESSAGES.recoverySession);
    if (failure === 'conflict') return finish('blocked', MESSAGES.recoveryConflict);
    if (error?.code === 'IDEMPOTENCY_IN_PROGRESS') return finish('uncertain', MESSAGES.inProgress);
    return finish('uncertain', MESSAGES.recoveryUncertain);
  };

  const intentRequest = (path, intent) => client.post(path, { eventId: intent.eventId }, {
    auth: true, headers: { 'Idempotency-Key': intent.key },
  });

  /** Verificar tentativa anterior: somente consulta, sem nenhum efeito de ingresso. */
  function reconcile() {
    return recover('verify', async ({ ctx, intent, finish, settle, abandoned }) => {
      let result;
      try { result = parseAdmissionIntentResponse(await intentRequest('/participations/admission-intents/lookup', intent)); }
      catch (error) {
        if (!identityMatches(ctx)) return { kind: 'stale' };
        return recoveryFailure(error, finish);
      }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (result.state === 'completed') {
        await recordConfirmation(ctx.userId, intent.key, result.participationId);
        return settle(result.participationId);
      }
      if (result.state === 'abandoned') return abandoned();
      if (result.state === 'in_progress') return finish('uncertain', MESSAGES.inProgress);
      if (result.state === 'conflict') return finish('blocked', MESSAGES.recoveryConflict);
      // not_found: ausência atual não é prova; a intenção continua guardada.
      return finish('unconfirmed', MESSAGES.notFound);
    });
  }

  /** Repetir ingresso anterior: POST original por ação explícita; pode concluir o ingresso. */
  function repeatPrevious() {
    return recover('repeat', async ({ ctx, intent, finish, settle, abandoned }) => {
      const sent = await sendIntent(ctx.userId, intent);
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (sent.kind === 'confirmed') return settle(sent.participationId);
      if (sent.kind === 'replaced' || sent.kind === 'storage_failed') return finish('blocked', MESSAGES.recoveryStorage);
      const failure = classifyJoinFailure(sent.error);
      if (failure === 'abandoned') return abandoned();
      if (failure === 'refused') {
        if (sent.attempts === 1 &&
            await clearIntent(ctx.userId, intent.key, { attempts: 1, confirmedParticipationId: null })) {
          // Nunca enviada antes: esta recusa é da única requisição com a chave.
          return finish('resolved', describeAdmissionError(sent.error, 'join'), { outcome: 'not_applied' });
        }
        return finish('unconfirmed', `${describeAdmissionError(sent.error, 'join')} ${MESSAGES.repeatRefused}`);
      }
      return recoveryFailure(sent.error, finish);
    });
  }

  /** Cancelar tentativa anterior: abandono terminal; se o ingresso venceu, recupera a participação. */
  function abandonPrevious() {
    return recover('abandon', async ({ ctx, intent, finish, settle, abandoned }) => {
      let result;
      try {
        result = parseAdmissionIntentResponse(await intentRequest('/participations/admission-intents/abandon', intent),
          new Set(['abandoned', 'completed']));
      } catch (error) {
        if (!identityMatches(ctx)) return { kind: 'stale' };
        return recoveryFailure(error, finish);
      }
      if (!identityMatches(ctx)) return { kind: 'stale' };
      if (result.state === 'completed') {
        await recordConfirmation(ctx.userId, intent.key, result.participationId);
        return settle(result.participationId);
      }
      return abandoned();
    });
  }

  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity, lookup, revalidate, confirm, retrySync, reconcile, repeatPrevious, abandonPrevious,
    isCurrent: () => matches(capture()) };
}
