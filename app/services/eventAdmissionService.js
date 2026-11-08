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
    (value.confirmedParticipationId === null || validUuid(value.confirmedParticipationId));
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

/** Orquestra a consulta, o POST idempotente e a leitura definitiva da participação por sessão. */
export function createEventAdmissionStore({
  client = httpClient,
  getIdentity,
  refreshParticipation,
  getParticipationSnapshot,
  intentStorage = defaultAdmissionIntentStorage,
  createKey = () => Crypto.randomUUID(),
}) {
  const empty = (identity = null) => ({ userId: identity?.userId ?? null, epoch: identity?.epoch ?? null,
    status: 'idle', event: null, eligibility: null, error: null, confirmedParticipationId: null });
  let state = empty(), generation = 0, lookupSequence = 0;
  let joinFlight = null, syncFlight = null;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const matches = (identity, version) => {
    const current = getIdentity();
    return Boolean(identity && current && version === generation &&
      identity.userId === current.userId && identity.epoch === current.epoch &&
      state.userId === identity.userId && state.epoch === identity.epoch);
  };
  const capture = () => state.userId === null ? null : { userId: state.userId, epoch: state.epoch };

  function setIdentity(identity) {
    generation += 1; lookupSequence += 1;
    joinFlight = null; syncFlight = null;
    publish(empty(identity));
  }

  async function lookup(accessCode) {
    const identity = capture(), version = generation, sequence = ++lookupSequence;
    if (!matches(identity, version)) return { kind: 'stale' };
    const code = typeof accessCode === 'string' ? accessCode.trim() : '';
    if (!code) {
      const message = 'Digite o código do evento.';
      publish({ ...state, status: 'error', event: null, eligibility: null, error: message });
      return { kind: 'error', message };
    }
    publish({ ...state, status: 'looking_up', event: null, eligibility: null, error: null });
    try {
      const result = parseEventLookupResponse(await client.post('/events/lookup', { accessCode: code }, { auth: true }));
      if (!matches(identity, version) || sequence !== lookupSequence) return { kind: 'stale' };
      publish({ ...state, status: 'ready', ...result, error: null });
      return { kind: 'found', ...result };
    } catch (error) {
      if (!matches(identity, version) || sequence !== lookupSequence) return { kind: 'stale' };
      const message = describeAdmissionError(error, 'lookup');
      publish({ ...state, status: 'error', event: null, eligibility: null, error: message });
      return { kind: 'error', message };
    }
  }

  async function synchronize(identity, version, confirmedId, eventId) {
    if (syncFlight) return syncFlight;
    const pending = (async () => {
      try { await refreshParticipation(); }
      catch { /* O estado de leitura já informa a falha; o ingresso continua confirmado. */ }
      if (!matches(identity, version)) return { kind: 'stale' };
      const snapshot = getParticipationSnapshot();
      if (snapshot.userId === identity.userId && snapshot.epoch === identity.epoch &&
          snapshot.status === 'ready' && snapshot.participation?.id === confirmedId &&
          snapshot.participation.eventId === eventId &&
          ['active', 'waiting'].includes(snapshot.participation.status)) {
        publish({ ...state, status: 'complete', confirmedParticipationId: confirmedId, error: null });
        try {
          const intent = await intentStorage.get(identity.userId);
          if (intent?.confirmedParticipationId === confirmedId) await intentStorage.clear(identity.userId, intent.key);
        } catch { /* Uma intenção residual só permite replay; a leitura do servidor confirmou o ingresso. */ }
        if (!matches(identity, version)) return { kind: 'stale' };
        return { kind: 'complete', participation: snapshot.participation };
      }
      const message = 'Ingresso confirmado, mas a participação ainda não pôde ser sincronizada. Atualize sem repetir o ingresso.';
      publish({ ...state, status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: message });
      return { kind: 'confirmed_unsynced' };
    })();
    syncFlight = pending;
    try { return await pending; }
    finally { if (syncFlight === pending) syncFlight = null; }
  }

  async function retrySync() {
    const identity = capture(), version = generation;
    if (!matches(identity, version)) return { kind: 'stale' };
    const confirmedId = state.confirmedParticipationId;
    if (!confirmedId || !state.event?.id) return { kind: 'error' };
    return synchronize(identity, version, confirmedId, state.event.id);
  }

  function confirm(eventId) {
    if (joinFlight) return joinFlight;
    const identity = capture(), version = generation;
    if (!matches(identity, version) || state.event?.id !== eventId || !state.eligibility?.eligible) {
      return Promise.resolve({ kind: 'error', message: 'Este evento não está disponível para ingresso.' });
    }
    if (state.confirmedParticipationId) return retrySync();
    const pending = (async () => {
      let intent;
      let confirmedId = null;
      publish({ ...state, status: 'joining', error: null });
      try {
        intent = await intentStorage.get(identity.userId);
        if (!matches(identity, version)) return { kind: 'stale' };
        if (intent && intent.eventId !== eventId) {
          const error = new Error('Há outra tentativa de ingresso pendente nesta conta. Confira essa tentativa antes de iniciar outra.');
          error.code = 'ADMISSION_OTHER_EVENT_PENDING';
          throw error;
        }
        if (!intent) {
          const key = createKey();
          if (!validUuid(key)) throw new Error('Não foi possível gerar uma chave segura para o ingresso.');
          intent = { userId: identity.userId, eventId, key, confirmedParticipationId: null };
          await intentStorage.set(intent);
        }
        if (!matches(identity, version)) return { kind: 'stale' };
        confirmedId = intent.confirmedParticipationId;
        if (!confirmedId) {
          const response = await client.post('/participations', { eventId }, {
            auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true,
          });
          confirmedId = parseParticipationCreationResponse(response);
          await intentStorage.set({ ...intent, confirmedParticipationId: confirmedId });
        }
        if (!matches(identity, version)) return { kind: 'stale' };
        publish({ ...state, status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: null });
        return synchronize(identity, version, confirmedId, eventId);
      } catch (error) {
        if (!matches(identity, version)) return { kind: 'stale' };
        if (confirmedId) {
          const message = 'Ingresso confirmado. Não foi possível atualizar a participação agora; tente sincronizar novamente.';
          publish({ ...state, status: 'confirmed_unsynced', confirmedParticipationId: confirmedId, error: message });
          return { kind: 'confirmed_unsynced' };
        }
        const uncertain = Boolean(error?.isNetworkError || error?.status >= 500 ||
          error?.code === 'IDEMPOTENCY_IN_PROGRESS' || error?.code === 'INVALID_ADMISSION_RESPONSE');
        if (intent && !uncertain && error?.status && error.status < 500 &&
            error.code !== 'PARTICIPATION_ALREADY_CURRENT' && error.code !== 'IDEMPOTENCY_KEY_REUSED') {
          try { await intentStorage.clear(identity.userId, intent.key); }
          catch { /* Preserva a chave caso o armazenamento não confirme sua remoção. */ }
        }
        const message = error?.code === 'ADMISSION_OTHER_EVENT_PENDING' ? error.message :
          describeAdmissionError(error, 'join');
        publish({ ...state, status: uncertain ? 'uncertain' : 'error', error: message });
        return { kind: uncertain ? 'uncertain' : 'error', message };
      }
    })();
    joinFlight = pending;
    return pending.finally(() => { if (joinFlight === pending) joinFlight = null; });
  }

  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity, lookup, confirm, retrySync, isCurrent: () => matches(capture(), generation) };
}
