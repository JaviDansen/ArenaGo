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
let inFlightCandidateToken = null;

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
}

/**
 * Obtém e registra o token de push do aparelho no backend do ArenaGo (`POST /devices/push-token`).
 * - Inclui `{ auth: true }` para enviar o cabeçalho `Authorization: Bearer <token>`.
 * - Cria o canal Android silencioso antes de obter o token.
 * - Valida o `projectId` EAS antes de solicitar o token ao Expo.
 * - Impede que uma operação iniciada antes do logout ou troca de sessão registre o dispositivo.
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

  const isSessionStillValid = () => {
    if (syncGeneration !== currentGeneration) return false;
    if (isCurrent && !isCurrent()) return false;
    if (getSessionEpoch && getSessionEpoch() !== startEpoch) return false;
    return true;
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

    inFlightCandidateToken = pushToken;

    // 5. Envia o token ao backend autenticado ({ auth: true })
    await client.post(
      '/devices/push-token',
      {
        pushToken,
        platform: platformOS === 'ios' ? 'ios' : 'android',
      },
      {
        auth: true,
        ...(capturedAccessToken ? { accessToken: capturedAccessToken } : {}),
        ...(startEpoch !== null && startEpoch !== undefined
          ? { _requestEpoch: startEpoch }
          : {}),
      }
    );

    // 6. Se houve logout ou troca de sessão enquanto o POST estava em trânsito, desfaz imediatamente
    if (!isSessionStillValid()) {
      if (typeof client.delete === 'function') {
        await client
          .delete('/devices/push-token', {
            auth: true,
            ...(capturedAccessToken ? { accessToken: capturedAccessToken } : {}),
            body: { pushToken },
          })
          .catch(() => undefined);
      }
      return null;
    }

    // 7. Salva localmente o token e o vínculo com o usuário autenticado
    if (secureStore && typeof secureStore.setItemAsync === 'function') {
      await secureStore
        .setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY, pushToken)
        .catch(() => undefined);
    }

    if (targetUserId) {
      await setActiveQueueCallUser(targetUserId, { secureStore });
    }

    return pushToken;
  } catch {
    // Falha silenciosa: a indisponibilidade de push não impede o uso do aplicativo
    return null;
  } finally {
    if (syncGeneration === currentGeneration) {
      inFlightCandidateToken = null;
    }
  }
}

/**
 * Remove o vínculo do token no backend (`DELETE /devices/push-token`) durante logout ou troca de conta.
 * - Cancela qualquer sincronização de registro em andamento.
 * - Envia `{ auth: true, body: { pushToken } }` respeitando o contrato de `httpClient.js`.
 */
export async function unregisterDevicePushToken(client, options = {}) {
  const platformOS = options.platformOS ?? Platform.OS;
  const secureStore = options.secureStore ?? SecureStore;
  const explicitAccessToken =
    typeof options.accessToken === 'string' && options.accessToken.trim()
      ? options.accessToken.trim()
      : null;

  // Invalida imediatamente qualquer tentativa de registro iniciada antes do logout
  cancelPendingPushTokenSync();
  const pendingToken = inFlightCandidateToken;
  inFlightCandidateToken = null;

  await clearActiveQueueCallUser({ secureStore });

  if (platformOS === 'web' || !client || typeof client.delete !== 'function') {
    return false;
  }

  try {
    const savedToken =
      secureStore && typeof secureStore.getItemAsync === 'function'
        ? await secureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY).catch(() => null)
        : null;

    const tokenToUnregister =
      (typeof savedToken === 'string' && savedToken.trim()) ||
      (typeof pendingToken === 'string' && pendingToken.trim()) ||
      null;

    if (tokenToUnregister) {
      await client
        .delete('/devices/push-token', {
          auth: true,
          ...(explicitAccessToken ? { accessToken: explicitAccessToken } : {}),
          body: {
            pushToken: tokenToUnregister,
          },
        })
        .catch(() => undefined);
    }

    if (secureStore && typeof secureStore.deleteItemAsync === 'function') {
      await secureStore
        .deleteItemAsync(SECURE_STORE_PUSH_TOKEN_KEY)
        .catch(() => undefined);
    }

    return true;
  } catch {
    return false;
  }
}
