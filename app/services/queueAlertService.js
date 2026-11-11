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
 * sem vibração em segundo plano e sem disparo para chamadas já ativas na inicialização.
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

  function checkAndAlert({ queueEntry, participationId, isInitial = false }) {
    if (!queueEntry || queueEntry.status !== 'called' || !participationId) {
      if (isInitial && participationId) {
        initializedParticipations.add(participationId);
      }
      return false;
    }

    const identity = typeof getIdentity === 'function' ? getIdentity() : null;
    if (!identity?.userId || identity.epoch === null || identity.epoch === undefined) {
      return false;
    }

    if (typeof isAppActive === 'function' && !isAppActive()) {
      return false;
    }

    const callKey = buildCallKey(identity, participationId, queueEntry);

    // Se é a carga inicial ou a primeira conferência desta participação, registrar sem vibrar
    if (isInitial || !initializedParticipations.has(participationId)) {
      initializedParticipations.add(participationId);
      alertedCallKeys.add(callKey);
      return false;
    }

    // Se esta chamada já foi alertada nesta sessão, não vibrar novamente
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
