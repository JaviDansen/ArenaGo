import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
  clearActiveQueueCallUser,
  setActiveQueueCallUser,
} from './queueCallVibrationService';

let Constants = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawConstants = require('expo-constants');
  Constants = rawConstants?.default ?? rawConstants;
} catch {
  // Opcional em ambientes de teste isolados sem expo-constants
}

export const SECURE_STORE_PUSH_TOKEN_KEY = 'arenago_device_push_token';
export const ANDROID_SILENT_CHANNEL_ID = 'arenago-silent-queue-calls';

const EAS_PROJECT_ID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let syncGeneration = 0;
let inFlightSyncRecord = null;
let latestCommittedSync = null;

/**
 * Valida se o projectId EAS está presente e segue o formato UUID oficial do EAS.
 */
export function validateEasProjectId(rawProjectId) {
  if (typeof rawProjectId !== 'string') return null;
  const trimmed = rawProjectId.trim();
  if (!EAS_PROJECT_ID_UUID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Resolve e valida o projectId EAS a partir das opções explícitas, variáveis de ambiente
 * ou manifesto do Expo (`Constants.easConfig` / `Constants.expoConfig`).
 */
export function resolveEasProjectId(options = {}) {
  const constantsModule = options.constants !== undefined ? options.constants : Constants;
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : undefined);

  const candidate =
    options.projectId ??
    env?.EXPO_PUBLIC_EAS_PROJECT_ID ??
    constantsModule?.easConfig?.projectId ??
    constantsModule?.expoConfig?.extra?.eas?.projectId ??
    null;

  return validateEasProjectId(candidate);
}

/**
 * Cria o canal silencioso obrigatório no Android 8.0+ antes de requisitar permissões
 * ou obter o push token, conforme documentação do Expo SDK 58.
 */
export async function ensureAndroidSilentChannel({
  notifications = Notifications,
  platformOS = Platform.OS,
} = {}) {
  if (platformOS !== 'android') return null;
  if (!notifications || typeof notifications.setNotificationChannelAsync !== 'function') {
    return null;
  }

  return notifications.setNotificationChannelAsync(ANDROID_SILENT_CHANNEL_ID, {
    name: 'Chamadas silenciosas da fila',
    importance: notifications.AndroidImportance?.LOW ?? 2,
    sound: null,
    enableVibrate: false,
    showBadge: false,
    lockscreenVisibility: notifications.AndroidNotificationVisibility?.SECRET ?? -1,
  });
}

/**
 * Invalida qualquer sincronização de token em andamento (ex: ao iniciar logout ou troca de conta).
 */
export function cancelPendingPushTokenSync() {
  syncGeneration += 1;
  latestCommittedSync = null;
}

/**
 * Obtém e registra o token de push do aparelho no backend do ArenaGo (`POST /devices/push-token`).
 * - Inclui `{ auth: true }` para enviar o cabeçalho `Authorization: Bearer <token>`.
 * - Cria o canal Android silencioso antes de obter o token.
 * - Valida o `projectId` EAS antes de solicitar o token ao Expo.
 * - Revalida a geração da sessão após cada operação assíncrona relevante.
 * - Impede que uma operação iniciada antes do logout ou troca de sessão grave token ou ative usuário obsoleto.
 */
export async function syncDevicePushToken(client, options = {}) {
  const platformOS = options.platformOS ?? Platform.OS;
  const notifications = options.notifications ?? Notifications;
  const secureStore = options.secureStore ?? SecureStore;

  if (platformOS === 'web' || !client || typeof client.post !== 'function') {
    return null;
  }

  const currentGeneration = ++syncGeneration;
  const getSessionEpoch =
    typeof options.getSessionEpoch === 'function' ? options.getSessionEpoch : null;
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : null;
  const startEpoch = getSessionEpoch ? getSessionEpoch() : null;
  const targetUserId =
    typeof options.userId === 'string' && options.userId.trim()
      ? options.userId.trim()
      : null;
  const capturedAccessToken =
    typeof options.accessToken === 'string' && options.accessToken.trim()
      ? options.accessToken.trim()
      : null;

  const record = {
    generation: currentGeneration,
    userId: targetUserId,
    accessToken: capturedAccessToken,
    pushToken: null,
    platform: platformOS === 'ios' ? 'ios' : 'android',
    postCompleted: false,
    unlinkedByLogout: false,
  };
  inFlightSyncRecord = record;

  const isSessionStillValid = () => {
    if (syncGeneration !== currentGeneration) return false;
    if (isCurrent && !isCurrent()) return false;
    if (getSessionEpoch && getSessionEpoch() !== startEpoch) return false;
    return true;
  };

  const compensateAndCleanup = async ({ wroteTokenToStore = false } = {}) => {
    const newerCommitted =
      latestCommittedSync && latestCommittedSync.generation > currentGeneration
        ? latestCommittedSync
        : null;
    const hasNewerActiveSync =
      newerCommitted !== null ||
      (inFlightSyncRecord !== null && inFlightSyncRecord.generation > currentGeneration);

    // 1. Limpar ou restaurar o token no SecureStore
    if (newerCommitted && newerCommitted.pushToken) {
      if (secureStore && typeof secureStore.setItemAsync === 'function') {
        await secureStore
          .setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY, newerCommitted.pushToken)
          .catch(() => undefined);
      }
    } else if (wroteTokenToStore || !hasNewerActiveSync) {
      if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
        await secureStore
          .deleteItemAsync(SECURE_STORE_PUSH_TOKEN_KEY)
          .catch(() => undefined);
      }
    }

    // 2. Limpar ou restaurar o usuário ativo
    if (newerCommitted && newerCommitted.userId) {
      await setActiveQueueCallUser(newerCommitted.userId, { secureStore });
    } else if (!hasNewerActiveSync) {
      await clearActiveQueueCallUser({ secureStore });
    }

    // 3. Compensar registro tardio no backend se o POST já havia concluído
    if (
      record.postCompleted &&
      !record.unlinkedByLogout &&
      record.pushToken &&
      typeof client.delete === 'function'
    ) {
      record.unlinkedByLogout = true;
      await client
        .delete('/devices/push-token', {
          auth: true,
          ...(capturedAccessToken ? { accessToken: capturedAccessToken } : {}),
          body: { pushToken: record.pushToken },
        })
        .catch(() => undefined);

      // Se houve troca direta de conta e a nova conta já havia registrado o mesmo token físico,
      // revalida o vínculo da nova conta para que a compensação da conta antiga não o deixe revogado.
      if (
        newerCommitted &&
        newerCommitted.pushToken === record.pushToken &&
        typeof client.post === 'function'
      ) {
        await client
          .post(
            '/devices/push-token',
            {
              pushToken: newerCommitted.pushToken,
              platform: newerCommitted.platform,
            },
            {
              auth: true,
              ...(newerCommitted.accessToken
                ? { accessToken: newerCommitted.accessToken }
                : {}),
            }
          )
          .catch(() => undefined);
      }
    }
  };

  try {
    if (!isSessionStillValid()) return null;

    // 1. Valida o projectId EAS antes de prosseguir
    const projectId = resolveEasProjectId(options);
    if (!projectId) {
      return null;
    }

    // 2. Cria o canal Android silencioso antes de solicitar permissão ou obter o token (SDK 58)
    await ensureAndroidSilentChannel({ notifications, platformOS });
    if (!isSessionStillValid()) return null;

    // 3. Verifica / solicita permissão de notificações
    const { status: existingStatus } = await notifications.getPermissionsAsync();
    if (!isSessionStillValid()) return null;

    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (!isSessionStillValid() || finalStatus !== 'granted') {
      return null;
    }

    // 4. Obtém o token Expo Push validando o projectId
    const tokenResult = await notifications
      .getExpoPushTokenAsync({ projectId })
      .catch(() => null);
    const pushToken =
      typeof tokenResult?.data === 'string' ? tokenResult.data.trim() : null;

    if (!pushToken || !isSessionStillValid()) {
      return null;
    }

    record.pushToken = pushToken;

    // 5. Envia o token ao backend autenticado ({ auth: true })
    await client.post(
      '/devices/push-token',
      {
        pushToken,
        platform: record.platform,
      },
      {
        auth: true,
        ...(capturedAccessToken ? { accessToken: capturedAccessToken } : {}),
        ...(startEpoch !== null && startEpoch !== undefined
          ? { _requestEpoch: startEpoch }
          : {}),
      }
    );
    record.postCompleted = true;

    // 6. Revalida geração após o POST: se houve logout ou troca de conta em trânsito, compensa imediatamente
    if (!isSessionStillValid()) {
      await compensateAndCleanup({ wroteTokenToStore: false });
      return null;
    }

    // 7. Salva localmente o token no SecureStore e revalida a geração imediatamente após a escrita
    if (secureStore && typeof secureStore.setItemAsync === 'function') {
      await secureStore
        .setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY, pushToken)
        .catch(() => undefined);
    }

    if (!isSessionStillValid()) {
      await compensateAndCleanup({ wroteTokenToStore: true });
      return null;
    }

    // 8. Atualiza o usuário ativo com verificação de aborto antes e durante a operação
    if (targetUserId) {
      const activated = await setActiveQueueCallUser(targetUserId, {
        secureStore,
        shouldAbort: () => !isSessionStillValid(),
      });
      if (!activated || !isSessionStillValid()) {
        await compensateAndCleanup({ wroteTokenToStore: true });
        return null;
      }
    }

    if (!isSessionStillValid()) {
      await compensateAndCleanup({ wroteTokenToStore: true });
      return null;
    }

    latestCommittedSync = {
      generation: currentGeneration,
      userId: targetUserId,
      accessToken: capturedAccessToken,
      pushToken,
      platform: record.platform,
    };

    return pushToken;
  } catch {
    // Falha silenciosa: a indisponibilidade de push não impede o uso do aplicativo
    if (!isSessionStillValid()) {
      await compensateAndCleanup({ wroteTokenToStore: false }).catch(() => undefined);
    }
    return null;
  } finally {
    if (inFlightSyncRecord === record) {
      inFlightSyncRecord = null;
    }
  }
}

/**
 * Remove o vínculo do token no backend (`DELETE /devices/push-token`) durante logout ou troca de conta.
 * - Cancela qualquer sincronização de registro em andamento.
 * - Envia `{ auth: true, body: { pushToken } }` respeitando o contrato de `httpClient.js`.
 * - Não bloqueia o logout caso a requisição de desvinculação falhe por erro de rede, limpando sempre o estado local.
 */
export async function unregisterDevicePushToken(client, options = {}) {
  const platformOS = options.platformOS ?? Platform.OS;
  const secureStore = options.secureStore ?? SecureStore;
  const explicitAccessToken =
    typeof options.accessToken === 'string' && options.accessToken.trim()
      ? options.accessToken.trim()
      : null;

  const activeRecord = inFlightSyncRecord;
  const committedRecord = latestCommittedSync;

  // Invalida imediatamente qualquer tentativa de registro iniciada antes do logout
  cancelPendingPushTokenSync();
  inFlightSyncRecord = null;
  latestCommittedSync = null;

  await clearActiveQueueCallUser({ secureStore });

  if (platformOS === 'web' || !client || typeof client.delete !== 'function') {
    if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
      await secureStore.deleteItemAsync(SECURE_STORE_PUSH_TOKEN_KEY).catch(() => undefined);
    }
    return false;
  }

  let remoteUnlinkSucceeded = true;

  try {
    const savedToken =
      secureStore && typeof secureStore.getItemAsync === 'function'
        ? await secureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY).catch(() => null)
        : null;

    const candidateFromCompletedInFlight =
      activeRecord &&
      activeRecord.postCompleted &&
      typeof activeRecord.pushToken === 'string' &&
      activeRecord.pushToken.trim()
        ? activeRecord.pushToken.trim()
        : null;

    const tokenToUnregister =
      candidateFromCompletedInFlight ||
      (typeof savedToken === 'string' && savedToken.trim()) ||
      (typeof committedRecord?.pushToken === 'string' && committedRecord.pushToken.trim()) ||
      null;

    const fallbackAccessToken =
      explicitAccessToken ||
      activeRecord?.accessToken ||
      committedRecord?.accessToken ||
      null;

    if (tokenToUnregister) {
      try {
        await client.delete('/devices/push-token', {
          auth: true,
          ...(fallbackAccessToken ? { accessToken: fallbackAccessToken } : {}),
          body: {
            pushToken: tokenToUnregister,
          },
        });
        if (activeRecord && activeRecord.pushToken === tokenToUnregister) {
          activeRecord.unlinkedByLogout = true;
        }
      } catch {
        remoteUnlinkSucceeded = false;
      }
    }
  } finally {
    if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
      await secureStore
        .deleteItemAsync(SECURE_STORE_PUSH_TOKEN_KEY)
        .catch(() => undefined);
    }
    await clearActiveQueueCallUser({ secureStore });
  }

  return remoteUnlinkSucceeded;
}
