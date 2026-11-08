import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Armazena apenas userId/participationId/experienceId/chave de idempotência, nunca tokens. */
export function createArenaQueueIntentStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const webValues = new Map();
  let serial = Promise.resolve();
  const run = (job) => {
    const next = serial.then(job, job);
    serial = next.catch(() => {});
    return next;
  };
  const keyFor = (userId) => {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new Error('Usuário inválido para armazenamento da fila.');
    return `arenago.queue.intent.${userId.toLowerCase()}`;
  };
  async function secureAvailable() {
    if (typeof secureStore.getItemAsync !== 'function' || typeof secureStore.setItemAsync !== 'function'
        || typeof secureStore.deleteItemAsync !== 'function'
        || (typeof secureStore.isAvailableAsync === 'function' && !(await secureStore.isAvailableAsync()))) {
      throw new Error('Armazenamento seguro indisponível. A entrada na fila foi bloqueada.');
    }
  }
  async function read(userId) {
    const key = keyFor(userId);
    if (platformOS !== 'web') await secureAvailable();
    const raw = platformOS === 'web' ? webValues.get(key) ?? null : await secureStore.getItemAsync(key);
    if (raw === null) return null;
    let intent;
    try { intent = JSON.parse(raw); } catch { throw new Error('Intenção de fila armazenada inválida.'); }
    if (!intent || intent.userId !== userId || !UUID.test(intent.participationId ?? '')
        || !UUID.test(intent.experienceId ?? '') || !UUID.test(intent.key ?? '')) {
      throw new Error('Intenção de fila armazenada inválida.');
    }
    return intent;
  }
  return {
    get(userId) { return run(() => read(userId)); },
    set(intent) {
      return run(async () => {
        if (!intent || !UUID.test(intent.userId ?? '') || !UUID.test(intent.participationId ?? '')
          || !UUID.test(intent.experienceId ?? '') || !UUID.test(intent.key ?? '')) {
          throw new Error('Intenção de fila inválida.');
        }
        const key = keyFor(intent.userId), raw = JSON.stringify(intent);
        if (platformOS === 'web') webValues.set(key, raw);
        else { await secureAvailable(); await secureStore.setItemAsync(key, raw); }
      });
    },
    clear(userId, expectedKey) {
      return run(async () => {
        const intent = await read(userId);
        if (!intent || intent.key !== expectedKey) return;
        const key = keyFor(userId);
        if (platformOS === 'web') webValues.delete(key);
        else await secureStore.deleteItemAsync(key);
      });
    },
  };
}

export const defaultArenaQueueIntentStorage = createArenaQueueIntentStorage();
