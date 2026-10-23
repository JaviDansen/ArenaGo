/**
 * Configuração centralizada da URL base da API do ArenaGo.
 *
 * Suporta:
 * - Desenvolvimento local (web / simulador): http://127.0.0.1:3000
 * - Emulador Android: http://10.0.2.2:3000 (via EXPO_PUBLIC_API_BASE_URL)
 * - Dispositivo físico no Expo Go: http://<IP_DA_MAQUINA_NA_REDE>:3000 (via EXPO_PUBLIC_API_BASE_URL)
 * - Ambientes futuros de homologação/produção (https://...)
 *
 * Garante sempre o prefixo /api/v1 sem duplicação e nunca expõe segredos do backend.
 */

export const API_PREFIX = '/api/v1';
export const DEFAULT_LOCAL_API_ORIGIN = 'http://127.0.0.1:3000';
export const DEFAULT_HTTP_TIMEOUT_MS = 15000;

function readEnvBaseUrl(env = typeof process !== 'undefined' ? process.env : undefined) {
  if (!env) return null;
  const candidate = env.EXPO_PUBLIC_API_BASE_URL || env.EXPO_PUBLIC_API_URL || '';
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function isLocalhostOrigin(urlString) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(urlString);
}

/**
 * Normaliza uma URL de origem/base para incluir exatamente um sufixo `/api/v1`
 * sem barra final excedente.
 *
 * @param {string} [overrideBaseUrl]
 * @param {Object} [options]
 * @param {Record<string, string>} [options.env]
 * @returns {string}
 */
export function resolveApiBaseUrl(overrideBaseUrl, options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : undefined);
  const raw =
    (typeof overrideBaseUrl === 'string' && overrideBaseUrl.trim().length > 0
      ? overrideBaseUrl.trim()
      : null) ||
    readEnvBaseUrl(env) ||
    DEFAULT_LOCAL_API_ORIGIN;

  if (!/^https?:\/\/[^/\s]+/i.test(raw)) {
    throw new Error(
      `URL base da API inválida ("${raw}"). Configure EXPO_PUBLIC_API_BASE_URL com http:// ou https://.`
    );
  }

  const nodeEnv = env?.NODE_ENV || 'development';
  if (nodeEnv === 'production' && raw.toLowerCase().startsWith('http://') && !isLocalhostOrigin(raw)) {
    throw new Error('Em produção, a URL da API deve utilizar HTTPS.');
  }

  const withoutTrailingSlashes = raw.replace(/\/+$/, '');
  if (withoutTrailingSlashes.endsWith(API_PREFIX)) {
    return withoutTrailingSlashes;
  }

  return `${withoutTrailingSlashes}${API_PREFIX}`;
}
