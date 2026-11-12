export function defaultVibrate() {
  try {
    const rn = require('react-native');
    rn?.Vibration?.vibrate?.(500);
  } catch {
    // Falha silenciosa caso o dispositivo não suporte vibração
  }
}

/**
 * Gerenciador de alertas locais para novas chamadas na fila da Arena.
 * Garante uma única vibração por nova chamada, sem repetições periódicas,
 * sem vibração em segundo plano, sem vibração retroativa ao retomar do segundo plano
 * e com isolamento estrito por usuário, sessão e participação.
 */
export function createQueueAlertManager({
  getIdentity,
  vibrate = defaultVibrate,
  isAppActive = () => true,
} = {}) {
  const alertedCallKeys = new Set();
  const initializedParticipations = new Set();

  function buildCallKey(identity, participationId, queueEntry) {
    const sessionId = queueEntry.serviceSessionId || queueEntry.stationLabel || queueEntry.id;
    return `${identity.userId}:${identity.epoch}:${participationId}:${queueEntry.id}:${sessionId}`;
  }

  function reset() {
    alertedCallKeys.clear();
    initializedParticipations.clear();
  }

  function checkAndAlert({
    queueEntry,
    participationId,
    isInitial = false,
    isResuming = false,
    suppressVibration = false,
  }) {
    if (!queueEntry || queueEntry.status !== 'called' || !participationId) {
      if (isInitial && participationId) {
        const id = typeof getIdentity === 'function' ? getIdentity() : null;
        if (id?.userId && id.epoch !== null && id.epoch !== undefined) {
          initializedParticipations.add(`${id.userId}:${id.epoch}:${participationId}`);
        }
      }
      return false;
    }

    const identity = typeof getIdentity === 'function' ? getIdentity() : null;
    if (!identity?.userId || identity.epoch === null || identity.epoch === undefined) {
      return false;
    }

    const partSessionKey = `${identity.userId}:${identity.epoch}:${participationId}`;
    const callKey = buildCallKey(identity, participationId, queueEntry);
    const active = typeof isAppActive === 'function' ? isAppActive() : true;

    // Se a chamada foi detectada enquanto o aplicativo estava em segundo plano:
    // registramos a chave para evitar alerta retroativo quando o app for reaberto,
    // mas não efetuamos vibração.
    if (!active) {
      initializedParticipations.add(partSessionKey);
      alertedCallKeys.add(callKey);
      return false;
    }

    // Se é carga inicial, conferência inicial desta participação, retorno do segundo plano
    // (retomada) ou supressão solicitada: registramos a chamada sem produzir vibração.
    if (isInitial || isResuming || suppressVibration || !initializedParticipations.has(partSessionKey)) {
      initializedParticipations.add(partSessionKey);
      alertedCallKeys.add(callKey);
      return false;
    }

    // Se esta chamada já foi alertada nesta sessão/participação, não vibrar novamente
    if (alertedCallKeys.has(callKey)) {
      return false;
    }

    alertedCallKeys.add(callKey);
    try {
      vibrate();
    } catch {
      // Aviso visual preservado mesmo se vibração falhar
    }
    return true;
  }

  return {
    checkAndAlert,
    reset,
    hasAlerted(callKey) { return alertedCallKeys.has(callKey); },
  };
}
