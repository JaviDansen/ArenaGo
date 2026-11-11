import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isDefinitiveEntryRejection, parseEntryResult, validEntryId } from './staffEntryService';

let queue = Promise.resolve();
const same = (a, b) => a && b && ['userId', 'sessionId', 'eventId', 'key', 'kind', 'participationId', 'enabled'].every(key => a[key] === b[key]);
function valid(record, userId) {
  if (!record || record.userId !== userId || !['userId', 'sessionId', 'eventId', 'key'].every(key => validEntryId(record[key])) ||
      !['reserved', 'dispatching', 'terminal', 'acknowledged', 'cancelled'].includes(record.phase) ||
      (record.kind === 'confirm' ? !validEntryId(record.participationId) || record.enabled !== null
        : record.kind !== 'toggle' || typeof record.enabled !== 'boolean' || record.participationId !== null)) return false;
  if (!['terminal', 'acknowledged'].includes(record.phase)) return record.outcome === undefined;
  if (record.outcome?.kind === 'rejected') return isDefinitiveEntryRejection(record.outcome) &&
    (record.outcome.code === null || typeof record.outcome.code === 'string');
  if (record.outcome?.kind !== 'confirmed') return false;
  try { parseEntryResult(record.outcome.result, record); return true; } catch { return false; }
}

/** Um único slot: reconhecimento é UPDATE lógico, sem exclusão ambígua de recibos. */
export function createStaffEntryIntentStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const serialize = work => { const promise = queue.then(work, work); queue = promise.catch(() => {}); return promise; };
  const keyFor = userId => {
    if (!validEntryId(userId)) throw new Error('Conta Staff inválida.');
    return `arenago.staff.entry.${userId.toLowerCase()}`;
  };
  async function read(userId) {
    if (platformOS === 'web' || typeof secureStore?.getItemAsync !== 'function' || typeof secureStore?.setItemAsync !== 'function' ||
        (typeof secureStore.isAvailableAsync === 'function' && !await secureStore.isAvailableAsync())) throw new Error('Armazenamento de entrada indisponível.');
    const raw = await secureStore.getItemAsync(keyFor(userId));
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (!valid(record, userId)) throw new Error('Intenção de entrada inválida.');
    return record;
  }
  const write = record => secureStore.setItemAsync(keyFor(record.userId), JSON.stringify(record));
  function transition(expected, phase, outcome) {
    return serialize(async () => {
      const current = await read(expected.userId);
      if (!same(current, expected) || current.phase !== (phase === 'dispatching' || phase === 'cancelled' ? 'reserved'
        : phase === 'terminal' ? 'dispatching' : 'terminal')) return false;
      const next = { ...current, phase, ...(outcome ? { outcome } : {}) };
      if (!valid(next, expected.userId)) throw new Error('Transição de entrada inválida.');
      await write(next);
      return true;
    });
  }
  return {
    isPersistent: platformOS !== 'web',
    get: userId => serialize(() => read(userId)),
    reserve: intent => serialize(async () => {
      if (!valid(intent, intent?.userId) || intent.phase !== 'reserved') throw new Error('Reserva inválida.');
      const previous = await read(intent.userId);
      if (previous && (!['acknowledged', 'cancelled'].includes(previous.phase) || previous.key === intent.key))
        return { created: false, intent: previous };
      await write(intent);
      return { created: true, intent };
    }),
    dispatch: intent => transition(intent, 'dispatching'),
    async finish(intent, outcome) { if (!await transition(intent, 'terminal', outcome)) throw new Error('Recibo de entrada não persistido.'); },
    acknowledge: intent => transition(intent, 'acknowledged'),
    cancelReserved: intent => transition(intent, 'cancelled'),
  };
}
export const defaultStaffEntryIntentStorage = createStaffEntryIntentStorage();
