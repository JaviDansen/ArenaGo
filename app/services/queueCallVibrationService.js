import { Vibration, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

export const QUEUE_CALL_VIBRATION_PATTERN = [0, 500, 200, 500, 200, 500];
export const QUEUE_CALL_VIBRATION_REPEAT = false;
export const BACKGROUND_QUEUE_CALL_TASK = 'ARENAGO_QUEUE_CALL_VIBRATION_TASK';

// Deduplicação em memória das sessões de atendimento já alertadas
const processedSessionIds = new Set();
// Ouvintes registrados no app (ex: RealArenaScreen)
const callListeners = new Set();

/**
 * Configura o comportamento do manipulador de notificações do Expo:
 * SUPRIME explicitamente alertas visuais, banners, sons e badges.
 */
try {
  if (typeof Notifications.setNotificationHandler === 'function') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
} catch {
  // Ignorado em ambientes sem suporte
}

/**
 * Valida o payload mínimo da chamada na fila.
 * Rejeita qualquer payload que contenha campos de apresentação visual ou estrutura inválida.
 */
export function validateQueueCallPayload(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type !== 'queue.called') return null;
  if (typeof data.serviceSessionId !== 'string' || !data.serviceSessionId.trim()) return null;

  return {
    type: 'queue.called',
    serviceSessionId: data.serviceSessionId.trim(),
    participationId: typeof data.participationId === 'string' ? data.participationId : null,
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    version: data.version ?? 1,
  };
}

/**
 * Executa o alerta vibratório exatamente uma vez por atendimento confirmado.
 * Retorna true se a vibração foi executada, false se for replay/duplicada ou inválida.
 */
export function processQueueCallAlert(rawPayload, { vibrationEngine = Vibration } = {}) {
  const payload = validateQueueCallPayload(rawPayload);
  if (!payload) return false;

  // Deduplicação: se a chamada já vibrou anteriormente, ignora
  if (processedSessionIds.has(payload.serviceSessionId)) {
    return false;
  }

  // Registra atendimento como já alertado
  processedSessionIds.add(payload.serviceSessionId);

  // Executa o padrão exato de 1,9 segundo: [0, 500, 200, 500, 200, 500]
  try {
    if (vibrationEngine && typeof vibrationEngine.vibrate === 'function') {
      vibrationEngine.vibrate(QUEUE_CALL_VIBRATION_PATTERN, QUEUE_CALL_VIBRATION_REPEAT);
    }
  } catch {
    // Falha de hardware tratada sem interromper o fluxo
  }

  // Notifica componentes em primeiro plano (ex: atualização da tela do participante)
  for (const listener of callListeners) {
    try {
      listener(payload);
    } catch {
      // Ignora erro em listener individual
    }
  }

  return true;
}

/**
 * Registra um ouvinte para quando o participante for chamado na fila.
 * Retorna função para cancelar a assinatura.
 */
export function addQueueCallListener(listener) {
  if (typeof listener !== 'function') return () => {};
  callListeners.add(listener);
  return () => {
    callListeners.delete(listener);
  };
}

/**
 * Limpa a deduplicação de sessões (útil para logout ou troca de usuário).
 */
export function resetQueueCallAlerts() {
  processedSessionIds.clear();
}

/**
 * Retorna se um atendimento já foi alertado pelo identificador.
 */
export function hasSessionBeenAlerted(serviceSessionId) {
  return processedSessionIds.has(serviceSessionId);
}

// -----------------------------------------------------------------------------
// Registro da tarefa em segundo plano (Headless Task)
// -----------------------------------------------------------------------------
try {
  if (typeof TaskManager.defineTask === 'function') {
    TaskManager.defineTask(BACKGROUND_QUEUE_CALL_TASK, async ({ data, error }) => {
      if (error) return;
      const notification = data?.notification;
      const payloadData =
        notification?.request?.content?.data ||
        data?.data ||
        data;

      processQueueCallAlert(payloadData);
    });
  }
} catch {
  // Ignorado em ambientes de teste ou sem suporte
}

/**
 * Inicializa a escuta de notificações em primeiro e segundo plano.
 */
export async function setupQueueCallNotificationHandlers() {
  if (Platform.OS === 'web') return null;

  try {
    // Registra a tarefa em segundo plano para notificações remotas recebidas
    if (typeof Notifications.registerTaskAsync === 'function') {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_QUEUE_CALL_TASK);
      if (!isRegistered) {
        await Notifications.registerTaskAsync(BACKGROUND_QUEUE_CALL_TASK);
      }
    }

    // Ouvinte em primeiro plano
    if (typeof Notifications.addNotificationReceivedListener === 'function') {
      const subscription = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification?.request?.content?.data;
        processQueueCallAlert(data);
      });
      return subscription;
    }
  } catch {
    // Ignorado se não suportado no ambiente atual
  }

  return null;
}
