import { Vibration, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';

export const QUEUE_CALL_VIBRATION_PATTERN = [0, 500, 200, 500, 200, 500];
export const QUEUE_CALL_VIBRATION_REPEAT = false;
export const BACKGROUND_QUEUE_CALL_TASK = 'ARENAGO_QUEUE_CALL_VIBRATION_TASK';

export const ACTIVE_PUSH_USER_STORAGE_KEY = 'arenago_push_active_user_id';
export const ALERTED_SESSIONS_STORAGE_KEY = 'arenago_alerted_service_sessions_v1';
export const MAX_ALERT_STALENESS_MS = 5 * 60 * 1000;
const MAX_PERSISTED_SESSIONS_PER_USER = 100;

const FORBIDDEN_PRESENTATION_KEYS = [
  'title',
  'body',
  'message',
  'subtitle',
  'sound',
  'alert',
  'badge',
];

export const SILENT_NOTIFICATION_BEHAVIOR = Object.freeze({
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
});

// Estado em memória sincronizado com SecureStore por usuário
const processedSessionIdsGlobal = new Set();
const processedSessionsByUser = new Map();
const endedSessionIds = new Set();
const inFlightSessionIds = new Set();
const callListeners = new Set();

let activeUserIdInMemory = null;
let isExplicitlyLoggedOut = false;
let activeUserStateGeneration = 0;
let callStateValidator = null;
let backgroundTaskExecutorRef = null;

function getUserSessionSet(userKey) {
  const key = userKey || '__anonymous__';
  let set = processedSessionsByUser.get(key);
  if (!set) {
    set = new Set();
    processedSessionsByUser.set(key, set);
  }
  return set;
}

/**
 * Configura o comportamento do manipulador de notificações do Expo SDK 58:
 * SUPRIME explicitamente banners, lista de notificações, sons e badges.
 */
export function configureSilentNotificationHandler(notificationsModule = Notifications) {
  try {
    if (notificationsModule && typeof notificationsModule.setNotificationHandler === 'function') {
      notificationsModule.setNotificationHandler({
        handleNotification: async () => ({ ...SILENT_NOTIFICATION_BEHAVIOR }),
      });
    }
  } catch {
    // Ignorado em ambientes sem suporte nativo
  }
}

configureSilentNotificationHandler(Notifications);

/**
 * Valida o payload técnico mínimo da chamada na fila.
 * Rejeita qualquer payload que contenha campos de apresentação visual/sonora ou estrutura malformada.
 */
export function validateQueueCallPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  for (const forbiddenKey of FORBIDDEN_PRESENTATION_KEYS) {
    if (data[forbiddenKey] !== undefined && data[forbiddenKey] !== null) {
      return null;
    }
  }

  if (data.type !== 'queue.called') return null;
  if (typeof data.serviceSessionId !== 'string' || !data.serviceSessionId.trim()) return null;

  if (
    data.participationId !== undefined &&
    data.participationId !== null &&
    (typeof data.participationId !== 'string' || !data.participationId.trim())
  ) {
    return null;
  }

  if (
    data.eventId !== undefined &&
    data.eventId !== null &&
    (typeof data.eventId !== 'string' || !data.eventId.trim())
  ) {
    return null;
  }

  if (
    data.userId !== undefined &&
    data.userId !== null &&
    (typeof data.userId !== 'string' || !data.userId.trim())
  ) {
    return null;
  }

  let normalizedCalledAt = null;
  if (data.calledAt !== undefined && data.calledAt !== null) {
    const parsedTime = Date.parse(String(data.calledAt));
    if (!Number.isFinite(parsedTime)) {
      return null;
    }
    normalizedCalledAt = new Date(parsedTime).toISOString();
  }

  if (data.version !== undefined && data.version !== 1 && data.version !== '1') {
    return null;
  }

  return {
    type: 'queue.called',
    serviceSessionId: data.serviceSessionId.trim(),
    participationId:
      typeof data.participationId === 'string' ? data.participationId.trim() : null,
    eventId: typeof data.eventId === 'string' ? data.eventId.trim() : null,
    userId: typeof data.userId === 'string' ? data.userId.trim() : null,
    calledAt: normalizedCalledAt,
    version: 1,
  };
}

/**
 * Extrai e valida o payload do formato real de `NotificationTaskPayload` do Expo SDK 58.
 * Suporta:
 * - `data.data.dataString` (JSON serializado pelo `RemoteMessageSerializer` do Android)
 * - `data.dataString` (JSON serializado conforme documentação do `NotificationTaskPayload`)
 * - `data.data.body` (fallback JSON serializado de mensagens remotas FCM)
 * - `data.notification.request.content.data` (notificações entregues sem campos visuais)
 * Rejeita `NotificationResponse` (toques de ação) e qualquer JSON malformado.
 */
export function extractNotificationTaskPayload(taskData) {
  if (!taskData || typeof taskData !== 'object' || Array.isArray(taskData)) {
    return null;
  }

  // Ignora respostas de interação do usuário (NotificationResponse)
  if ('actionIdentifier' in taskData) {
    return null;
  }

  // Rejeita se houver objeto de notificação visual do sistema acoplado
  const rawNotif = taskData.notification;
  if (rawNotif && typeof rawNotif === 'object') {
    if (
      rawNotif.title != null ||
      rawNotif.body != null ||
      rawNotif.request?.content?.title != null ||
      rawNotif.request?.content?.body != null
    ) {
      return null;
    }
  }

  // 1. Formato Android RemoteMessageSerializer: { notification: null, data: { dataString: "{...}" } }
  if (
    taskData.data &&
    typeof taskData.data === 'object' &&
    !Array.isArray(taskData.data) &&
    Object.prototype.hasOwnProperty.call(taskData.data, 'dataString')
  ) {
    const rawString = taskData.data.dataString;
    if (typeof rawString !== 'string' || !rawString.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawString);
      return validateQueueCallPayload(parsed);
    } catch {
      return null;
    }
  }

  // 2. Formato direto NotificationTaskPayload: { dataString: "{...}" }
  if (Object.prototype.hasOwnProperty.call(taskData, 'dataString')) {
    const rawString = taskData.dataString;
    if (typeof rawString !== 'string' || !rawString.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawString);
      return validateQueueCallPayload(parsed);
    } catch {
      return null;
    }
  }

  // 3. Formato FCM body string em data.data.body
  if (
    taskData.data &&
    typeof taskData.data === 'object' &&
    !Array.isArray(taskData.data) &&
    Object.prototype.hasOwnProperty.call(taskData.data, 'body') &&
    taskData.data.type === undefined
  ) {
    if (typeof taskData.data.body !== 'string' || !taskData.data.body.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(taskData.data.body);
      return validateQueueCallPayload(parsed);
    } catch {
      return null;
    }
  }

  // 4. Formato de evento em primeiro plano / iOS: notification.request.content.data
  if (rawNotif?.request?.content?.data && typeof rawNotif.request.content.data === 'object') {
    const contentData = rawNotif.request.content.data;
    if (Object.prototype.hasOwnProperty.call(contentData, 'dataString')) {
      if (typeof contentData.dataString !== 'string' || !contentData.dataString.trim()) {
        return null;
      }
      try {
        return validateQueueCallPayload(JSON.parse(contentData.dataString));
      } catch {
        return null;
      }
    }
    return validateQueueCallPayload(contentData);
  }

  // 5. Objeto de dados direto em taskData.data ou taskData
  if (taskData.data && typeof taskData.data === 'object' && !Array.isArray(taskData.data)) {
    return validateQueueCallPayload(taskData.data);
  }

  return validateQueueCallPayload(taskData);
}

async function readPersistedActiveUserId(secureStore = SecureStore) {
  if (!secureStore || typeof secureStore.getItemAsync !== 'function') {
    return null;
  }
  try {
    const raw = await secureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY);
    if (!raw || typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.userId === 'string' && parsed.userId.trim()) {
      return parsed.userId.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function readPersistedAlertedMap(secureStore = SecureStore) {
  if (!secureStore || typeof secureStore.getItemAsync !== 'function') {
    return {};
  }
  try {
    const raw = await secureStore.getItemAsync(ALERTED_SESSIONS_STORAGE_KEY);
    if (!raw || typeof raw !== 'string') return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

async function persistAlertedSessionForUser(
  userId,
  serviceSessionId,
  secureStore = SecureStore
) {
  if (!secureStore || typeof secureStore.setItemAsync !== 'function') {
    return;
  }
  const key = userId || '__anonymous__';
  try {
    const map = await readPersistedAlertedMap(secureStore);
    const existing = Array.isArray(map[key]) ? map[key].filter((x) => typeof x === 'string') : [];
    if (!existing.includes(serviceSessionId)) {
      existing.push(serviceSessionId);
    }
    map[key] = existing.slice(-MAX_PERSISTED_SESSIONS_PER_USER);
    await secureStore.setItemAsync(ALERTED_SESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Falha de escrita no SecureStore não interrompe o alerta já vibrado
  }
}

/**
 * Define o usuário autenticado atual para isolamento de alertas em primeiro e segundo plano.
 * Protegido por geração monotônica e `shouldAbort` para impedir que operações iniciadas
 * antes do logout ou de uma troca de conta ativem um usuário obsoleto.
 */
export async function setActiveQueueCallUser(
  userId,
  { secureStore = SecureStore, shouldAbort = null } = {}
) {
  if (typeof shouldAbort === 'function' && shouldAbort()) {
    return false;
  }

  const normalized = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  if (!normalized) {
    await clearActiveQueueCallUser({ secureStore });
    return false;
  }

  const myGeneration = ++activeUserStateGeneration;
  const isOperationStale = () =>
    myGeneration !== activeUserStateGeneration ||
    (typeof shouldAbort === 'function' && Boolean(shouldAbort()));

  const rollbackOrRestoreActiveUser = async () => {
    if (
      myGeneration !== activeUserStateGeneration &&
      activeUserIdInMemory &&
      !isExplicitlyLoggedOut
    ) {
      if (secureStore && typeof secureStore.setItemAsync === 'function') {
        await secureStore
          .setItemAsync(
            ACTIVE_PUSH_USER_STORAGE_KEY,
            JSON.stringify({ userId: activeUserIdInMemory, updatedAt: Date.now() })
          )
          .catch(() => undefined);
      }
      return;
    }

    if (myGeneration === activeUserStateGeneration) {
      activeUserIdInMemory = null;
      isExplicitlyLoggedOut = true;
    }
    if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
      await secureStore.deleteItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY).catch(() => undefined);
    }
  };

  activeUserIdInMemory = normalized;
  isExplicitlyLoggedOut = false;

  if (secureStore && typeof secureStore.setItemAsync === 'function') {
    await secureStore
      .setItemAsync(
        ACTIVE_PUSH_USER_STORAGE_KEY,
        JSON.stringify({ userId: normalized, updatedAt: Date.now() })
      )
      .catch(() => undefined);
  }

  if (isOperationStale()) {
    await rollbackOrRestoreActiveUser();
    return false;
  }

  const persistedMap = await readPersistedAlertedMap(secureStore);
  if (isOperationStale()) {
    await rollbackOrRestoreActiveUser();
    return false;
  }

  const userList = Array.isArray(persistedMap[normalized]) ? persistedMap[normalized] : [];
  const userSet = getUserSessionSet(normalized);
  for (const sessionId of userList) {
    if (typeof sessionId === 'string' && sessionId.trim()) {
      userSet.add(sessionId.trim());
    }
  }
  return true;
}

/**
 * Remove o usuário ativo durante logout, impedindo que alertas da conta anterior vibrem.
 */
export async function clearActiveQueueCallUser({ secureStore = SecureStore } = {}) {
  activeUserStateGeneration += 1;
  activeUserIdInMemory = null;
  isExplicitlyLoggedOut = true;
  if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
    await secureStore.deleteItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY).catch(() => undefined);
  }
}

/**
 * Retorna o ID do usuário autenticado ativo em memória (ou `null` quando deslogado).
 */
export function getActiveQueueCallUser() {
  return activeUserIdInMemory;
}

/**
 * Registra que uma sessão de atendimento já foi encerrada/concluída/cancelada,
 * impedindo que notificações atrasadas produzam vibração.
 */
export function markQueueCallSessionEnded(serviceSessionId) {
  if (typeof serviceSessionId === 'string' && serviceSessionId.trim()) {
    endedSessionIds.add(serviceSessionId.trim());
  }
}

/**
 * Configura um validador opcional do estado atual da chamada (ex: consulta HTTP ao backend quando disponível).
 * Deve retornar `'pending'`, `'ended'` ou `'unknown'`.
 */
export function setQueueCallStateValidator(validator) {
  callStateValidator = typeof validator === 'function' ? validator : null;
}

function isAlertStale(payload, nowMs, maxAgeMs) {
  if (!payload.calledAt) return false;
  const calledAtMs = Date.parse(payload.calledAt);
  if (!Number.isFinite(calledAtMs)) return true;
  return nowMs - calledAtMs > maxAgeMs;
}

function executeHardwareVibration(vibrationEngine) {
  if (!vibrationEngine || typeof vibrationEngine.vibrate !== 'function') {
    return false;
  }
  try {
    vibrationEngine.vibrate(QUEUE_CALL_VIBRATION_PATTERN, QUEUE_CALL_VIBRATION_REPEAT);
    return true;
  } catch {
    return false;
  }
}

function notifyForegroundListeners(payload) {
  for (const listener of callListeners) {
    try {
      listener(payload);
    } catch {
      // Ignora erro em listener individual
    }
  }
}

/**
 * Execução síncrona do alerta vibratório com isolamento de usuário, verificação de atraso e proteção
 * para não marcar como executada caso o hardware de vibração falhe.
 */
export function processQueueCallAlert(
  rawPayload,
  {
    vibrationEngine = Vibration,
    currentUserId = activeUserIdInMemory,
    nowMs = Date.now(),
    maxAlertAgeMs = MAX_ALERT_STALENESS_MS,
    secureStore = SecureStore,
  } = {}
) {
  const payload =
    validateQueueCallPayload(rawPayload) || extractNotificationTaskPayload(rawPayload);
  if (!payload) return false;

  // Bloqueia se o usuário fez logout explícito
  if (isExplicitlyLoggedOut && !currentUserId) {
    return false;
  }

  // Isolamento de conta: se o payload especifica userId, exige correspondência exata com o usuário ativo
  if (payload.userId && currentUserId && payload.userId !== currentUserId) {
    return false;
  }
  if (payload.userId && !currentUserId && isExplicitlyLoggedOut) {
    return false;
  }

  const effectiveUserId = currentUserId || payload.userId || null;
  const userSet = getUserSessionSet(effectiveUserId);

  // Deduplicação e proteção contra concorrência foreground/background ou chamada já encerrada
  if (
    inFlightSessionIds.has(payload.serviceSessionId) ||
    endedSessionIds.has(payload.serviceSessionId) ||
    userSet.has(payload.serviceSessionId) ||
    (!effectiveUserId && processedSessionIdsGlobal.has(payload.serviceSessionId))
  ) {
    return false;
  }

  // Rejeita alertas atrasados além da janela máxima
  if (isAlertStale(payload, nowMs, maxAlertAgeMs)) {
    return false;
  }

  inFlightSessionIds.add(payload.serviceSessionId);
  try {
    // Executa o padrão exato de 1,9 segundo: [0, 500, 200, 500, 200, 500]
    // IMPORTANTE: não marca como executada se houver falha na execução da vibração
    const vibrated = executeHardwareVibration(vibrationEngine);
    if (!vibrated) {
      return false;
    }

    userSet.add(payload.serviceSessionId);
    processedSessionIdsGlobal.add(payload.serviceSessionId);
    void persistAlertedSessionForUser(effectiveUserId, payload.serviceSessionId, secureStore);

    notifyForegroundListeners(payload);
    return true;
  } finally {
    inFlightSessionIds.delete(payload.serviceSessionId);
  }
}

/**
 * Processamento assíncrono completo (usado em background headless e no listener de primeiro plano).
 * - Não pressupõe disponibilidade de `AuthContext` (consulta `SecureStore` diretamente após reinício).
 * - Sobrevive ao reinício do processo respeitando o usuário autenticado.
 * - Valida o estado atual da chamada quando há validador disponível.
 * - Nunca marca a vibração como executada se a chamada a `Vibration.vibrate` falhar.
 */
export async function processQueueCallAlertAsync(
  rawPayload,
  {
    vibrationEngine = Vibration,
    currentUserId = undefined,
    nowMs = Date.now(),
    maxAlertAgeMs = MAX_ALERT_STALENESS_MS,
    secureStore = SecureStore,
    validateCallState = callStateValidator,
    requireAuthenticatedUser = false,
  } = {}
) {
  const payload =
    validateQueueCallPayload(rawPayload) || extractNotificationTaskPayload(rawPayload);
  if (!payload) return false;

  // Reserva síncrona imediata para impedir duplicidade entre listener foreground e task background
  if (
    inFlightSessionIds.has(payload.serviceSessionId) ||
    endedSessionIds.has(payload.serviceSessionId)
  ) {
    return false;
  }

  inFlightSessionIds.add(payload.serviceSessionId);
  try {
    // 1. Resolver o usuário autenticado (memória ou SecureStore em execução headless)
    let resolvedUserId =
      currentUserId !== undefined ? currentUserId : activeUserIdInMemory;

    if (!resolvedUserId && !isExplicitlyLoggedOut) {
      resolvedUserId = await readPersistedActiveUserId(secureStore);
    }

    if (isExplicitlyLoggedOut && currentUserId === undefined) {
      return false;
    }

    if ((requireAuthenticatedUser || payload.userId) && !resolvedUserId) {
      return false;
    }

    if (payload.userId && resolvedUserId && payload.userId !== resolvedUserId) {
      return false;
    }

    const effectiveUserId = resolvedUserId || payload.userId || null;
    const userSet = getUserSessionSet(effectiveUserId);

    // 2. Verificar deduplicação em memória
    if (
      userSet.has(payload.serviceSessionId) ||
      (!effectiveUserId && processedSessionIdsGlobal.has(payload.serviceSessionId))
    ) {
      return false;
    }

    // 3. Verificar deduplicação persistida no SecureStore (sobrevive ao reinício do processo)
    const persistedMap = await readPersistedAlertedMap(secureStore);
    const persistedKey = effectiveUserId || '__anonymous__';
    const persistedList = Array.isArray(persistedMap[persistedKey])
      ? persistedMap[persistedKey]
      : [];
    for (const id of persistedList) {
      if (typeof id === 'string') {
        userSet.add(id);
      }
    }
    if (userSet.has(payload.serviceSessionId)) {
      return false;
    }

    // 4. Rejeitar alertas excessivamente atrasados
    if (isAlertStale(payload, nowMs, maxAlertAgeMs)) {
      return false;
    }

    // 5. Validar se a chamada já foi encerrada, quando possível confirmar o estado atual
    if (typeof validateCallState === 'function') {
      try {
        const stateOutcome = await validateCallState(payload);
        if (stateOutcome === 'ended' || stateOutcome === false) {
          endedSessionIds.add(payload.serviceSessionId);
          return false;
        }
      } catch {
        // Quando a confirmação de rede não é possível (ex: offline ou background sem JWT em memória),
        // prossegue respeitando a janela de validade e a deduplicação persistida.
      }
    }

    // 6. Executar vibração de 1,9s e só registrar sucesso se não houver falha de execução
    const vibrated = executeHardwareVibration(vibrationEngine);
    if (!vibrated) {
      return false;
    }

    userSet.add(payload.serviceSessionId);
    processedSessionIdsGlobal.add(payload.serviceSessionId);
    await persistAlertedSessionForUser(effectiveUserId, payload.serviceSessionId, secureStore);

    notifyForegroundListeners(payload);
    return true;
  } finally {
    inFlightSessionIds.delete(payload.serviceSessionId);
  }
}

/**
 * Registra um ouvinte para quando o participante for chamado na fila.
 */
export function addQueueCallListener(listener) {
  if (typeof listener !== 'function') return () => {};
  callListeners.add(listener);
  return () => {
    callListeners.delete(listener);
  };
}

/**
 * Limpa a deduplicação em memória e desativa o usuário ativo no logout.
 */
export function resetQueueCallAlerts({
  clearPersistedUser = true,
  secureStore = SecureStore,
} = {}) {
  processedSessionIdsGlobal.clear();
  processedSessionsByUser.clear();
  endedSessionIds.clear();
  inFlightSessionIds.clear();
  if (clearPersistedUser) {
    activeUserStateGeneration += 1;
    activeUserIdInMemory = null;
    isExplicitlyLoggedOut = false;
    if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
      void secureStore.deleteItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY).catch(() => undefined);
    }
  }
}

/**
 * Retorna se um atendimento já foi alertado pelo identificador para o usuário atual.
 */
export function hasSessionBeenAlerted(serviceSessionId, userId = activeUserIdInMemory) {
  if (userId) {
    return getUserSessionSet(userId).has(serviceSessionId);
  }
  return (
    processedSessionIdsGlobal.has(serviceSessionId) ||
    getUserSessionSet(null).has(serviceSessionId)
  );
}

/**
 * Callback real da tarefa em segundo plano para `TaskManager.defineTask`.
 */
export async function executeBackgroundNotificationTask(
  taskEvent,
  options = {}
) {
  const NoData = Notifications.BackgroundNotificationTaskResult?.NoData ?? 1;
  const NewData = Notifications.BackgroundNotificationTaskResult?.NewData ?? 0;
  const Failed = Notifications.BackgroundNotificationTaskResult?.Failed ?? 2;

  if (!taskEvent || typeof taskEvent !== 'object') {
    return NoData;
  }
  if (taskEvent.error) {
    return Failed;
  }

  const extracted = extractNotificationTaskPayload(taskEvent.data);
  if (!extracted) {
    return NoData;
  }

  const vibrated = await processQueueCallAlertAsync(extracted, {
    requireAuthenticatedUser: Boolean(extracted.userId),
    ...options,
  });

  return vibrated ? NewData : NoData;
}

export function getRegisteredBackgroundTaskExecutor() {
  return backgroundTaskExecutorRef;
}

// -----------------------------------------------------------------------------
// Definição e registro da Headless Task no escopo de inicialização do módulo
// Garante funcionamento quando o bundle JS é carregado em background sem React montado.
// -----------------------------------------------------------------------------
try {
  if (typeof TaskManager.defineTask === 'function') {
    backgroundTaskExecutorRef = (taskEvent) => executeBackgroundNotificationTask(taskEvent);
    TaskManager.defineTask(BACKGROUND_QUEUE_CALL_TASK, backgroundTaskExecutorRef);
  }
} catch {
  // Ignorado em ambientes de teste ou sem suporte
}

try {
  if (
    Platform.OS !== 'web' &&
    typeof Notifications.registerTaskAsync === 'function'
  ) {
    void Notifications.registerTaskAsync(BACKGROUND_QUEUE_CALL_TASK).catch(() => undefined);
  }
} catch {
  // Ignorado na carga inicial se o módulo nativo não estiver disponível
}

/**
 * Garante o registro da tarefa em segundo plano e inicializa o ouvinte de primeiro plano.
 */
export async function setupQueueCallNotificationHandlers({
  notificationsModule = Notifications,
  taskManagerModule = TaskManager,
  platformOS = Platform.OS,
} = {}) {
  if (platformOS === 'web') return null;

  configureSilentNotificationHandler(notificationsModule);

  try {
    if (typeof notificationsModule.registerTaskAsync === 'function') {
      const isRegistered =
        typeof taskManagerModule?.isTaskRegisteredAsync === 'function'
          ? await taskManagerModule.isTaskRegisteredAsync(BACKGROUND_QUEUE_CALL_TASK)
          : false;
      if (!isRegistered) {
        await notificationsModule.registerTaskAsync(BACKGROUND_QUEUE_CALL_TASK);
      }
    }

    if (typeof notificationsModule.addNotificationReceivedListener === 'function') {
      const subscription = notificationsModule.addNotificationReceivedListener((notification) => {
        const extracted = extractNotificationTaskPayload({ notification });
        if (extracted) {
          void processQueueCallAlertAsync(extracted);
        }
      });
      return subscription;
    }
  } catch {
    // Ignorado se não suportado no ambiente atual
  }

  return null;
}
