import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_PUSH_TOKEN_KEY = 'arenago_device_push_token';

/**
 * Obtém ou registra o token de push do aparelho no backend do ArenaGo.
 */
export async function syncDevicePushToken(client) {
  if (Platform.OS === 'web' || !client) return null;

  try {
    // 1. Verifica/solicita permissão
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    // 2. Obtém o token Expo Push
    const tokenResult = await Notifications.getExpoPushTokenAsync().catch(() => null);
    const pushToken = tokenResult?.data;

    if (!pushToken || typeof pushToken !== 'string') {
      return null;
    }

    // 3. Envia o token ao backend
    await client.post('/devices/push-token', {
      pushToken,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });

    // 4. Salva localmente para desvinculação no logout
    await SecureStore.setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY, pushToken).catch(() => undefined);

    return pushToken;
  } catch {
    // Falha silenciosa: a perda de push não impede o uso do aplicativo
    return null;
  }
}

/**
 * Remove o vínculo do token no backend durante o logout ou troca de conta.
 */
export async function unregisterDevicePushToken(client) {
  if (Platform.OS === 'web' || !client) return false;

  try {
    const savedToken = await SecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY).catch(() => null);
    if (savedToken) {
      await client.delete('/devices/push-token', {
        pushToken: savedToken,
      }).catch(() => undefined);
      await SecureStore.deleteItemAsync(SECURE_STORE_PUSH_TOKEN_KEY).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}
