import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const REFRESH_TOKEN_STORAGE_KEY = 'arenago.auth.refresh_token';

/**
 * Erro estruturado para falhas de acesso ao armazenamento seguro (`SecureStore`).
 * Permite diferenciar ausência real de credencial (`null`) de falha de leitura/escrita.
 */
export class TokenStorageError extends Error {
  constructor(
    message,
    { code = 'STORAGE_ERROR', operation = 'read', cause = undefined } = {}
  ) {
    super(message);
    this.name = 'TokenStorageError';
    this.kind = 'storage';
    this.code = code;
    this.operation = operation;
    this.detail = message;
    this.isStorageError = true;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Cria o adaptador de armazenamento seguro do refresh token.
 *
 * Regras de segurança (Seção 9 da K02 e correções da auditoria):
 * - Mobile (iOS / Android): utiliza `expo-secure-store` para persistir apenas o refresh token opaco.
 * - Web (`Platform.OS === 'web'`): mantém o refresh token apenas em memória durante a sessão da aba,
 *   sem usar `localStorage`, `sessionStorage` ou `AsyncStorage`.
 * - Diferencia explicitamente ausência de token (`null` / `status: 'empty'`), credencial legível
 *   (`status: 'ok'`) e falha ao consultar o `SecureStore` (lança `TokenStorageError` / `status: 'error'`).
 * - Serializa operações internamente para evitar condições de corrida no acesso ao `SecureStore`.
 * - O `accessToken` JWT e senhas nunca passam por este armazenamento.
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
  let operationQueue = Promise.resolve();

  function enqueue(operation) {
    const next = operationQueue.then(operation, operation);
    operationQueue = next.catch(() => {});
    return next;
  }

  async function assertNativeSecureStoreAvailable(operation) {
    if (
      !secureStore ||
      typeof secureStore.getItemAsync !== 'function' ||
      typeof secureStore.setItemAsync !== 'function' ||
      typeof secureStore.deleteItemAsync !== 'function'
    ) {
      throw new TokenStorageError(
        'O armazenamento seguro do dispositivo não está disponível neste ambiente.',
        { code: 'STORAGE_UNAVAILABLE', operation }
      );
    }

    if (typeof secureStore.isAvailableAsync === 'function') {
      let available = false;
      try {
        available = Boolean(await secureStore.isAvailableAsync());
      } catch (cause) {
        throw new TokenStorageError(
          'Falha ao verificar a disponibilidade do armazenamento seguro do dispositivo.',
          { code: 'STORAGE_AVAILABILITY_ERROR', operation, cause }
        );
      }

      if (!available) {
        throw new TokenStorageError(
          'O armazenamento seguro do dispositivo está temporariamente indisponível.',
          { code: 'STORAGE_UNAVAILABLE', operation }
        );
      }
    }
  }

  async function getRefreshTokenInternal() {
    if (isWeb) {
      return memoryRefreshToken;
    }

    await assertNativeSecureStoreAvailable('read');

    try {
      const stored = await secureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
      if (stored === null || stored === undefined) {
        return null;
      }
      if (typeof stored !== 'string') {
        throw new TokenStorageError(
          'O armazenamento seguro retornou um formato inesperado para a credencial de sessão.',
          { code: 'STORAGE_CORRUPTED_VALUE', operation: 'read' }
        );
      }
      const trimmed = stored.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (cause) {
      if (cause instanceof TokenStorageError) {
        throw cause;
      }
      throw new TokenStorageError(
        'Não foi possível acessar o armazenamento seguro do dispositivo para verificar sua sessão.',
        { code: 'STORAGE_READ_ERROR', operation: 'read', cause }
      );
    }
  }

  async function setRefreshTokenInternal(refreshToken) {
    if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
      throw new Error('Refresh token inválido para armazenamento.');
    }
    const normalized = refreshToken.trim();
    if (isWeb) {
      memoryRefreshToken = normalized;
      return;
    }

    await assertNativeSecureStoreAvailable('write');

    const storeOptions =
      secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY !== undefined
        ? { keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
        : undefined;

    try {
      await secureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, normalized, storeOptions);
    } catch (cause) {
      if (cause instanceof TokenStorageError) {
        throw cause;
      }
      throw new TokenStorageError(
        'Não foi possível salvar a credencial de sessão no armazenamento seguro do dispositivo.',
        { code: 'STORAGE_WRITE_ERROR', operation: 'write', cause }
      );
    }
  }

  async function clearRefreshTokenInternal() {
    memoryRefreshToken = null;
    if (isWeb) {
      return;
    }

    await assertNativeSecureStoreAvailable('delete');

    try {
      await secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
    } catch (cause) {
      if (cause instanceof TokenStorageError) {
        throw cause;
      }
      throw new TokenStorageError(
        'Não foi possível remover a credencial de sessão do armazenamento seguro do dispositivo.',
        { code: 'STORAGE_DELETE_ERROR', operation: 'delete', cause }
      );
    }
  }

  return {
    isPersistent: !isWeb,
    platformOS,

    getRefreshToken() {
      return enqueue(() => getRefreshTokenInternal());
    },

    async readRefreshToken() {
      try {
        const token = await enqueue(() => getRefreshTokenInternal());
        if (token === null) {
          return { status: 'empty', token: null, error: null };
        }
        return { status: 'ok', token, error: null };
      } catch (error) {
        return { status: 'error', token: null, error };
      }
    },

    setRefreshToken(refreshToken) {
      return enqueue(() => setRefreshTokenInternal(refreshToken));
    },

    clearRefreshToken() {
      return enqueue(() => clearRefreshTokenInternal());
    },
  };
}

export const defaultTokenStorage = createTokenStorage();
