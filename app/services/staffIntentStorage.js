import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value) => typeof value === 'string' && UUID.test(value);
const keyFor = (userId) => {
  if (!validId(userId)) throw new Error('Conta inválida para intenção Staff.');
  return `arenago.staff.operation.${userId.toLowerCase()}`;
};
const receiptKeyFor = (userId) => `${keyFor(userId)}.receipt`;
const acknowledgementKeyFor = (userId) => `${keyFor(userId)}.ack`;
let storageQueue = Promise.resolve();
const validOutcome = (intent) => {
  const outcome = intent.outcome;
  if (outcome?.kind === 'rejected') return Number.isInteger(outcome.status) &&
    (outcome.code === null || typeof outcome.code === 'string');
  if (outcome?.kind !== 'confirmed' || !outcome.result || typeof outcome.result !== 'object') return false;
  const result = outcome.result;
  if (intent.kind === 'call') return validId(result.id) && validId(result.queueEntryId) &&
    result.experienceId === intent.experienceId && result.stationId === intent.stationId &&
    typeof result.stationLabel === 'string' && Boolean(result.stationLabel.trim()) && result.status === 'pending';
  if (intent.kind === 'remove') return result.queueEntryId === intent.queueEntryId &&
    result.experienceId === intent.experienceId && result.status === 'closed' &&
    result.closeReason === 'staff_queue_removed' && validId(result.participationId) &&
    result.participationStatus === 'active';
  if (result.id !== intent.serviceSessionId) return false;
  if (intent.kind === 'complete') return result.status === 'completed' && result.queueEntryStatus === 'closed' &&
    result.closeReason === 'completed' && result.participationStatus === 'active';
  if (intent.kind !== 'absent' || result.status !== 'absent' || typeof result.requeued !== 'boolean') return false;
  const entry = result.newQueueEntry;
  return result.requeued ? validId(entry?.id) && entry.status === 'waiting' && typeof entry.queueOrder === 'string' &&
    /^[1-9]\d*$/.test(entry.queueOrder) && Number.isSafeInteger(entry.position) && entry.position > 0 : entry === null;
};
const valid = (intent, userId) => intent?.userId === userId && validId(intent.key) &&
  validId(intent.sessionId) && validId(intent.eventId) && validId(intent.stationId) &&
  ['reserved', 'dispatching', 'terminal'].includes(intent.phase) &&
  (intent.phase !== 'terminal' || validOutcome(intent)) &&
  (intent.kind === 'call' ? validId(intent.experienceId) && intent.serviceSessionId === null :
    intent.kind === 'remove' ? validId(intent.experienceId) && validId(intent.queueEntryId) &&
      intent.serviceSessionId === null :
    ['complete', 'absent'].includes(intent.kind) && intent.experienceId === null && validId(intent.serviceSessionId));

// Uma instância compartilhada serializa reserva, leitura e remoção; web bloqueia
// mutações até existir armazenamento durável apropriado para intenções.
export function createStaffIntentStorage({ platformOS = Platform.OS, secureStore = SecureStore } = {}) {
  const serialize = (work) => {
    const result = storageQueue.then(work, work);
    storageQueue = result.catch(() => {});
    return result;
  };
  async function available() {
    if (platformOS === 'web' || !secureStore || typeof secureStore.getItemAsync !== 'function' ||
        typeof secureStore.setItemAsync !== 'function' || typeof secureStore.deleteItemAsync !== 'function' ||
        (typeof secureStore.isAvailableAsync === 'function' && !await secureStore.isAvailableAsync()))
      throw new Error('Armazenamento persistente Staff indisponível. Operação bloqueada.');
  }
  async function readSlot(userId, key) {
    await available();
    const raw = await secureStore.getItemAsync(key);
    if (raw === null) return null;
    let intent;
    try { intent = JSON.parse(raw); } catch { throw new Error('Intenção Staff armazenada inválida.'); }
    // Registros anteriores sem fase podem representar um POST já enviado.
    if (intent && !intent.phase && key === keyFor(userId)) intent.phase = 'dispatching';
    if (!valid(intent, userId) || (key === receiptKeyFor(userId) && intent.phase !== 'terminal') ||
        (key === keyFor(userId) && intent.phase === 'terminal')) throw new Error('Intenção Staff armazenada inválida.');
    return intent;
  }
  async function read(userId) {
    const marker = await readAcknowledgement(userId);
    const receipt = await readSlot(userId, receiptKeyFor(userId));
    const intent = await readSlot(userId, keyFor(userId));
    if (marker?.status === 'pending') {
      if ((receipt && receipt.key !== marker.receipt.key) || (intent && intent.key !== marker.receipt.key))
        throw new Error('Reconhecimento Staff incompatível.');
      return receipt ?? { ...marker.receipt, acknowledgementPending: true };
    }
    if (receipt && intent && receipt.key !== intent.key) throw new Error('Registros Staff incompatíveis.');
    return receipt ?? intent;
  }
  async function readAcknowledgement(userId) {
    await available();
    const raw = await secureStore.getItemAsync(acknowledgementKeyFor(userId));
    if (raw === null) return null;
    let marker;
    try { marker = JSON.parse(raw); } catch { throw new Error('Reconhecimento Staff inválido.'); }
    if (!['pending', 'completed'].includes(marker?.status) || marker.receipt?.phase !== 'terminal' ||
        !valid(marker.receipt, userId)) throw new Error('Reconhecimento Staff inválido.');
    return marker;
  }
  return {
    isPersistent: platformOS !== 'web',
    get(userId) { return serialize(() => read(userId)); },
    reserve(intent) { return serialize(async () => {
      if (!valid(intent, intent?.userId) || intent.phase !== 'reserved') throw new Error('Intenção Staff inválida.');
      const marker = await readAcknowledgement(intent.userId);
      if (marker?.receipt.key === intent.key) throw new Error('Chave Staff já reconhecida.');
      const previous = await read(intent.userId);
      if (previous) return { created: false, intent: previous };
      await secureStore.setItemAsync(keyFor(intent.userId), JSON.stringify(intent));
      return { created: true, intent };
    }); },
    dispatch(userId, expectedKey) { return serialize(async () => {
      const current = await read(userId);
      if (!current || current.key !== expectedKey || current.phase !== 'reserved') return false;
      await secureStore.setItemAsync(keyFor(userId), JSON.stringify({ ...current, phase: 'dispatching' }));
      return true;
    }); },
    recordTerminal(userId, expectedKey, outcome) { return serialize(async () => {
      const current = await read(userId);
      if (current?.key === expectedKey && current.phase === 'terminal' &&
          JSON.stringify(current.outcome) === JSON.stringify(outcome)) return current;
      if (!current || current.key !== expectedKey || current.phase !== 'dispatching' ||
          !['confirmed', 'rejected'].includes(outcome?.kind)) throw new Error('Transição Staff inválida.');
      const receipt = { ...current, phase: 'terminal', outcome };
      if (!valid(receipt, userId)) throw new Error('Recibo Staff inválido.');
      await secureStore.setItemAsync(receiptKeyFor(userId), JSON.stringify(receipt));
      return receipt;
    }); },
    cancelReserved(userId, expectedKey) { return serialize(async () => {
      const current = await read(userId);
      if (!current || current.key !== expectedKey || current.phase !== 'reserved') return false;
      await secureStore.deleteItemAsync(keyFor(userId));
      return true;
    }); },
    clear(userId, expectedKey) { return serialize(async () => {
      const receipt = await readSlot(userId, receiptKeyFor(userId));
      const intent = await readSlot(userId, keyFor(userId));
      if (!receipt && !intent) {
        const marker = await readAcknowledgement(userId);
        if (marker?.status === 'pending' && marker.receipt.key === expectedKey) return;
      }
      if (!receipt || receipt.key !== expectedKey || (intent && intent.key !== expectedKey))
        throw new Error('Recibo terminal necessário para limpeza.');
      if (intent) await secureStore.deleteItemAsync(keyFor(userId));
    }); },
    acknowledge(userId, expectedKey, expectedScope) { return serialize(async () => {
      if (!validId(expectedKey)) throw new Error('Identificador de recibo inválido.');
      let marker = await readAcknowledgement(userId);
      const receipt = await readSlot(userId, receiptKeyFor(userId));
      const intent = await readSlot(userId, keyFor(userId));
      if (receipt && receipt.key !== expectedKey) return { kind: 'receipt_changed' };
      if (marker?.status === 'pending' && marker.receipt.key !== expectedKey) return { kind: 'receipt_changed' };
      const target = receipt ?? (marker?.receipt.key === expectedKey ? marker.receipt : null);
      if (!target) return { kind: 'receipt_absent' };
      if (target.sessionId !== expectedScope?.sessionId || target.eventId !== expectedScope?.eventId ||
          target.stationId !== expectedScope?.stationId || target.serviceSessionId !== expectedScope?.serviceSessionId ||
          target.kind !== expectedScope?.kind || target.experienceId !== expectedScope?.experienceId ||
          target.queueEntryId !== expectedScope?.queueEntryId)
        return { kind: 'receipt_changed' };
      if (intent) return { kind: 'cleanup_pending' };
      if (marker?.status === 'completed' && marker.receipt.key === expectedKey && !receipt)
        return { kind: 'already_acknowledged' };
      if (!marker || marker.status !== 'pending') {
        marker = { status: 'pending', receipt: target };
        try { await secureStore.setItemAsync(acknowledgementKeyFor(userId), JSON.stringify(marker)); }
        catch { return { kind: 'storage_error' }; }
      }
      if (receipt) {
        try { await secureStore.deleteItemAsync(receiptKeyFor(userId)); }
        catch {
          try {
            const remaining = await readSlot(userId, receiptKeyFor(userId));
            if (!remaining) return { kind: 'receipt_absent' };
            return { kind: remaining.key === expectedKey ? 'delete_failed' : 'receipt_changed' };
          } catch { return { kind: 'acknowledgement_uncertain' }; }
        }
      }
      try { await secureStore.setItemAsync(acknowledgementKeyFor(userId), JSON.stringify({ ...marker, status: 'completed' })); }
      catch { return { kind: 'acknowledgement_uncertain' }; }
      return { kind: 'acknowledged' };
    }); },
  };
}

export const defaultStaffIntentStorage = createStaffIntentStorage();
