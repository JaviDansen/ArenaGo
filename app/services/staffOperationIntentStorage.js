import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

function check(intent) {
  if (!intent || !isUuid(intent.userId) || !isUuid(intent.eventId) || !isUuid(intent.key)
      || !isUuid(intent.stationId) || !['call', 'complete'].includes(intent.kind)
      || (intent.kind === 'call' && (!isUuid(intent.experienceId) || intent.serviceSessionId !== null))
      || (intent.kind === 'complete' && (intent.experienceId !== null || !isUuid(intent.serviceSessionId)))) {
    throw new Error('Intenção operacional do Staff inválida.');
  }
  return intent;
}

/** Intenções de escrita (sem senha/token), isoladas por userId e mantidas após queda de rede. */
export function createStaffOperationIntentStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const webValues = new Map();
  let previous = Promise.resolve();
  const serialize = (work) => {
    const result = previous.then(work, work);
    previous = result.catch(() => {});
    return result;
  };
  const getKey = (userId) => {
    if (!isUuid(userId)) throw new Error('Usuário de Staff inválido.');
    return `arenago.staff.intent.${userId.toLowerCase()}`;
  };
  const ready = async () => {
    if (typeof secureStore.getItemAsync !== 'function'
        || typeof secureStore.setItemAsync !== 'function'
        || typeof secureStore.deleteItemAsync !== 'function'
        || (typeof secureStore.isAvailableAsync === 'function' && !(await secureStore.isAvailableAsync()))) {
      throw new Error('Armazenamento seguro indisponível. Operação Staff bloqueada.');
    }
  };
  async function rawRead(userId) {
    const key = getKey(userId);
    if (platformOS !== 'web') await ready();
    const raw = platformOS === 'web' ? webValues.get(key) ?? null : await secureStore.getItemAsync(key);
    if (raw === null) return null;
    let intent;
    try { intent = JSON.parse(raw); } catch { throw new Error('Intenção Staff armazenada inválida.'); }
    check(intent);
    if (intent.userId !== userId) throw new Error('Intenção Staff associada a outro usuário.');
    return intent;
  }
  return {
    get(userId) { return serialize(() => rawRead(userId)); },
    set(intent) {
      return serialize(async () => {
        check(intent);
        const key = getKey(intent.userId), raw = JSON.stringify(intent);
        if (platformOS === 'web') webValues.set(key, raw);
        else { await ready(); await secureStore.setItemAsync(key, raw); }
      });
    },
    clear(userId, expectedKey) {
      return serialize(async () => {
        const existing = await rawRead(userId);
        if (!existing || existing.key !== expectedKey) return;
        const key = getKey(userId);
        if (platformOS === 'web') webValues.delete(key);
        else await secureStore.deleteItemAsync(key);
      });
    },
  };
}

export const defaultStaffOperationIntentStorage = createStaffOperationIntentStorage();
