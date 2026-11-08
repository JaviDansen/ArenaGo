import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);

export function createParticipationActionStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const web = new Map();
  let queue = Promise.resolve();
  const serialize = task => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };
  const storageKey = (userId, kind) => {
    if (!validId(userId) || !['finish', 'evaluation'].includes(kind)) throw new Error('Intenção inválida.');
    return `arenago.participation.${kind}.intent.${userId.toLowerCase()}`;
  };
  const available = async () => {
    if (typeof secureStore.getItemAsync !== 'function' || typeof secureStore.setItemAsync !== 'function'
        || typeof secureStore.deleteItemAsync !== 'function'
        || (typeof secureStore.isAvailableAsync === 'function' && !await secureStore.isAvailableAsync())) {
      throw new Error('Armazenamento seguro indisponível. Operação bloqueada.');
    }
  };
  const validIntent = (intent, userId, kind) => intent?.userId === userId && intent.kind === kind
    && validId(intent.participationId) && validId(intent.key)
    && (kind === 'finish' ? intent.payload === null : Number.isInteger(intent.payload?.rating)
      && intent.payload.rating >= 1 && intent.payload.rating <= 5
      && (intent.payload.comment === null || typeof intent.payload.comment === 'string'));
  async function read(userId, kind) {
    const key = storageKey(userId, kind);
    if (platformOS !== 'web') await available();
    const raw = platformOS === 'web' ? web.get(key) ?? null : await secureStore.getItemAsync(key);
    if (raw === null) return null;
    let intent;
    try { intent = JSON.parse(raw); } catch { throw new Error('Intenção armazenada inválida.'); }
    if (!validIntent(intent, userId, kind)) throw new Error('Intenção armazenada inválida.');
    return intent;
  }
  async function write(intent) {
    if (!validIntent(intent, intent?.userId, intent?.kind)) throw new Error('Intenção inválida.');
    const key = storageKey(intent.userId, intent.kind);
    if (platformOS === 'web') web.set(key, JSON.stringify(intent));
    else { await available(); await secureStore.setItemAsync(key, JSON.stringify(intent)); }
  }
  return {
    get(userId, kind) { return serialize(() => read(userId, kind)); },
    set(intent) { return serialize(() => write(intent)); },
    reserve(intent) { return serialize(async () => {
      const previous = await read(intent.userId, intent.kind);
      if (previous) return previous;
      await write(intent);
      return intent;
    }); },
    clear(userId, kind, expectedKey) {
      return serialize(async () => {
        const intent = await read(userId, kind);
        if (!intent || intent.key !== expectedKey) return;
        const key = storageKey(userId, kind);
        if (platformOS === 'web') web.delete(key);
        else await secureStore.deleteItemAsync(key);
      });
    },
  };
}

export const defaultParticipationActionStorage = createParticipationActionStorage();

const uncertain = error => Boolean(error?.outcomeUnknown || error?.isNetworkError || error?.code === 'IDEMPOTENCY_IN_PROGRESS');
const stale = () => new Error('A sessão mudou. Consulte novamente antes de continuar.');
const invalid = () => new Error('O servidor retornou uma resposta inválida. Consulte novamente antes de repetir.');

export function parseFinishedParticipation(body, participationId) {
  const value = body?.participation;
  if (value?.id !== participationId || !validId(value.eventId) || value.status !== 'finished'
      || value.finishReason !== 'voluntary' || !Number.isSafeInteger(value.completedServicesCount)
      || typeof value.evaluationEligibility?.eligible !== 'boolean'
      || typeof value.evaluationEligibility?.hasSubmitted !== 'boolean') throw invalid();
  return value;
}

export function parseSubmittedEvaluation(body, participationId) {
  const value = body?.evaluation;
  if (!validId(value?.id) || value.participationId !== participationId
      || !Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5
      || !(value.comment === null || typeof value.comment === 'string')) throw invalid();
  return value;
}

export function describeParticipationActionError(error, kind) {
  if (error?.message === 'A sessão mudou. Consulte novamente antes de continuar.') return error.message;
  if (error?.code === 'EVALUATION_ALREADY_SUBMITTED') return 'Esta participação já foi avaliada. Atualize o histórico.';
  if (error?.code === 'EVALUATION_NOT_ELIGIBLE' || error?.code === 'EVALUATION_SUBMISSION_EXPIRED') return 'Esta participação não está mais elegível para avaliação.';
  if (error?.code === 'PARTICIPATION_NOT_ACTIVE') return 'A participação já não está ativa. Atualize sua situação.';
  if (error?.status === 401 || error?.status === 403) return 'Sua sessão não permite esta operação. Entre novamente.';
  if (error?.status === 404) return 'Participação não encontrada nesta conta.';
  if (uncertain(error)) return `Não foi possível confirmar ${kind === 'finish' ? 'a saída' : 'o envio'}. Confira ou repita a mesma tentativa; nenhuma nova chave será criada.`;
  return error?.message || 'Operação não confirmada. Atualize e tente novamente.';
}

/** Persiste a chave antes do POST. Uma resposta incerta mantém a intenção para replay seguro. */
export function createParticipationActionCoordinator({ client, storage = defaultParticipationActionStorage,
  createKey = () => Crypto.randomUUID(), isCurrent = () => true }) {
  const check = () => { if (!isCurrent()) throw stale(); };
  async function intentFor(userId, kind, participationId, payload) {
    check();
    const intent = kind === 'evaluation' && !payload
      ? await storage.get(userId, kind)
      : await storage.reserve({ userId, kind, participationId, payload, key: createKey() });
    check();
    if (!intent) throw new Error('Não há avaliação pendente para conferir.');
    if (intent.participationId !== participationId) throw new Error('Há outra operação pendente nesta conta.');
    if (kind === 'evaluation' && !intent.payload) throw new Error('Não há avaliação pendente para conferir.');
    if (kind === 'evaluation' && payload && JSON.stringify(intent.payload) !== JSON.stringify(payload)) {
      throw new Error('Há um envio anterior pendente. Confira a tentativa anterior antes de mudar a avaliação.');
    }
    return intent;
  }
  async function readFinish(participationId) {
    const body = await client.get(`/participations/${participationId}`, { auth: true });
    if (body?.participation?.status !== 'finished' || body.participation.finishReason !== 'voluntary') return null;
    return body.participation;
  }
  async function readEvaluation(participationId) {
    const body = await client.get(`/participations/${participationId}/evaluation`, { auth: true });
    return body?.evaluation ? parseSubmittedEvaluation(body, participationId) : null;
  }
  async function finish(userId, participationId) {
    if (!validId(userId) || !validId(participationId)) throw new Error('Participação inválida.');
    const intent = await intentFor(userId, 'finish', participationId, null);
    try {
      check();
      const result = parseFinishedParticipation(await client.post(`/participations/${participationId}/finish`, {},
        { auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true }), participationId);
      check();
      await storage.clear(userId, 'finish', intent.key);
      return result;
    } catch (error) {
      if (!isCurrent()) throw stale();
      if (uncertain(error) || error?.code === 'PARTICIPATION_NOT_ACTIVE') {
        try {
          const result = await readFinish(participationId);
          check();
          if (result) { await storage.clear(userId, 'finish', intent.key); return result; }
        } catch (readError) { if (!isCurrent()) throw stale(); if (readError?.status === 401 || readError?.status === 403) throw readError; }
      }
      throw error;
    }
  }
  async function submit(userId, participationId, payload = null) {
    if (!validId(userId) || !validId(participationId)) throw new Error('Participação inválida.');
    if (payload && (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5
        || !(payload.comment === null || typeof payload.comment === 'string')
        || Array.from(payload.comment ?? '').length > 2000)) throw new Error('Avaliação inválida.');
    const intent = await intentFor(userId, 'evaluation', participationId, payload);
    try {
      check();
      const eligibility = await client.get(`/participations/${participationId}/evaluation-eligibility`, { auth: true });
      check();
      if (eligibility?.participationId !== participationId || typeof eligibility.eligible !== 'boolean'
          || typeof eligibility.submitted !== 'boolean' || typeof eligibility.pending !== 'boolean') throw invalid();
      if (eligibility.submitted) {
        const existing = await readEvaluation(participationId);
        check();
        if (existing) { await storage.clear(userId, 'evaluation', intent.key); return existing; }
        throw invalid();
      }
      if (!eligibility.eligible || !eligibility.pending) {
        await storage.clear(userId, 'evaluation', intent.key);
        throw new Error('Esta participação não está mais elegível para avaliação.');
      }
      const result = parseSubmittedEvaluation(await client.post(`/participations/${participationId}/evaluation`, intent.payload,
        { auth: true, headers: { 'Idempotency-Key': intent.key }, outcomeUnknownOnNetworkError: true }), participationId);
      check();
      await storage.clear(userId, 'evaluation', intent.key);
      return result;
    } catch (error) {
      if (!isCurrent()) throw stale();
      if (uncertain(error) || error?.code === 'EVALUATION_ALREADY_SUBMITTED') {
        try {
          const existing = await readEvaluation(participationId);
          check();
          if (existing) { await storage.clear(userId, 'evaluation', intent.key); return existing; }
        } catch (readError) { if (!isCurrent()) throw stale(); if (readError?.status === 401 || readError?.status === 403) throw readError; }
      }
      throw error;
    }
  }
  return { finish, submit, pending: (userId, kind) => storage.get(userId, kind) };
}
