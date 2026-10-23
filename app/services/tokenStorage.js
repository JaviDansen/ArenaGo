import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const REFRESH_TOKEN_STORAGE_KEY = 'arenago.auth.refresh_token';

/**
 * Cria o adaptador de armazenamento seguro do refresh token.
 *
 * Regras de segurança (Seção 9 da K02):
 * - Mobile (iOS / Android): utiliza `expo-secure-store` para persistir apenas o refresh token opaco.
 * - Web (`Platform.OS === 'web'`): mantém o refresh token apenas em memória durante a sessão da aba,
 *   sem usar `localStorage`, `sessionStorage` ou `AsyncStorage`.
 * - O `accessToken` JWT e senhas nunca passam por este armazenamento.
 * - Nenhum token é registrado em console/logs.
 *
 * @param {Object} [options]
 * @param {string} [options.platformOS]
 * @param {Object} [options.secureStore]
 */
export function createTokenStorage(options = {}) {
  const platformOS = options.platformOS ?? Platform?.OS ?? 'ios';
  const secureStore = options.secureStore ?? SecureStore;
  const isWeb = platformOS === 'web';

  let memoryRefreshToken = null;

  async function canUseNativeSecureStore() {
    if (isWeb) return false;
    if (!secureStore || typeof secureStore.getItemAsync !== 'function') {
      return false;
    }
    if (typeof secureStore.isAvailableAsync === 'function') {
      try {
        return Boolean(await secureStore.isAvailableAsync());
      } catch {
        return false;
      }
    }
    return true;
  }

  return {
    isPersistent: !isWeb,
    platformOS,

    async getRefreshToken() {
      if (isWeb) {
        return memoryRefreshToken;
      }
      const available = await canUseNativeSecureStore();
      if (!available) {
        return memoryRefreshToken;
      }
      const stored = await secureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
      return typeof stored === 'string' && stored.trim().length > 0 ? stored : null;
    },

    async setRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
        throw new Error('Refresh token inválido para armazenamento.');
      }
      const normalized = refreshToken.trim();
      if (isWeb) {
        memoryRefreshToken = normalized;
        return;
      }
      const available = await canUseNativeSecureStore();
      if (!available) {
        memoryRefreshToken = normalized;
        return;
      }
      const storeOptions =
        secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY !== undefined
          ? { keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
          : undefined;
      await secureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, normalized, storeOptions);
    },

    async clearRefreshToken() {
      memoryRefreshToken = null;
      if (isWeb) {
        return;
      }
      const available = await canUseNativeSecureStore();
      if (!available) {
        return;
      }
      await secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
    },
  };
}

export const defaultTokenStorage = createTokenStorage();
