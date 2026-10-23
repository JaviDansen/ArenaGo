import { DEFAULT_HTTP_TIMEOUT_MS, resolveApiBaseUrl } from '../config/apiConfig';

const TERMINAL_SESSION_CODES = new Set([
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'REFRESH_TOKEN_REUSED',
  'INVALID_REFRESH_TOKEN',
  'ACCOUNT_DEACTIVATED',
]);

/**
 * Erro estruturado do cliente HTTP do ArenaGo.
 * Distingue claramente:
 * - Respostas HTTP do servidor (`kind === 'http'`, com `status`, `code`, `detail`, `invalidParams`, `fieldErrors`)
 * - Falhas de conectividade (`kind === 'network'`, `isNetworkError === true`)
 * - Timeouts de requisição (`kind === 'timeout'`, `isNetworkError === true`, `isTimeout === true`, `outcomeUnknown === true`)
 * - Falhas de leitura/escrita no armazenamento local (`kind === 'storage'`, `isStorageError === true`)
 */
export class ApiError extends Error {
  constructor({
    message,
    kind = 'http',
    status = null,
    code = null,
    title = null,
    detail = null,
    type = null,
    invalidParams = [],
    retryAfterSeconds = null,
    outcomeUnknown = false,
    rawBody = null,
    cause = undefined,
  }) {
    super(detail || message || 'Erro na comunicação com o servidor.');
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail || message || 'Erro na comunicação com o servidor.';
    this.type = type;
    this.invalidParams = Array.isArray(invalidParams) ? invalidParams : [];
    this.fieldErrors = buildFieldErrorsMap(this.invalidParams);
    this.retryAfterSeconds = retryAfterSeconds;
    this.isNetworkError = kind === 'network' || kind === 'timeout';
    this.isTimeout = kind === 'timeout';
    this.isHttpError = kind === 'http';
    this.isStorageError = kind === 'storage';
    this.outcomeUnknown = Boolean(outcomeUnknown);
    this.rawBody = rawBody;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function buildFieldErrorsMap(invalidParams) {
  const map = {};
  if (!Array.isArray(invalidParams)) {
    return map;
  }
  for (const item of invalidParams) {
    if (
      item &&
      typeof item.name === 'string' &&
      item.name.trim().length > 0 &&
      typeof item.reason === 'string' &&
      item.reason.trim().length > 0 &&
      !map[item.name]
    ) {
      map[item.name] = item.reason;
    }
  }
  return map;
}

function parseRetryAfterHeader(headers, bodyRetryAfter) {
  if (typeof bodyRetryAfter === 'number' && Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
    return Math.ceil(bodyRetryAfter);
  }
  const headerVal =
    headers && typeof headers.get === 'function'
      ? headers.get('retry-after') ?? headers.get('Retry-After')
      : null;
  if (headerVal !== null && headerVal !== undefined) {
    const parsed = Number(headerVal);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.ceil(parsed);
    }
  }
  return null;
}

function normalizePath(path) {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('O caminho (path) da requisição HTTP é obrigatório.');
  }
  const trimmed = path.trim();
  if (trimmed.startsWith('/api/v1/')) {
    return trimmed.slice('/api/v1'.length);
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

async function parseResponseBody(response) {
  if (response.status === 204) {
    return null;
  }
  if (typeof response.text === 'function') {
    const rawText = await response.text();
    if (!rawText || rawText.trim().length === 0) {
      return null;
    }
    try {
      return JSON.parse(rawText);
    } catch {
      return { detail: rawText };
    }
  }
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

export function isTerminalSessionError(error) {
  return Boolean(
    error &&
      error.kind === 'http' &&
      error.status === 401 &&
      typeof error.code === 'string' &&
      TERMINAL_SESSION_CODES.has(error.code)
  );
}

/**
 * Cria uma instância reutilizável do cliente HTTP para comunicação com o backend NestJS (/api/v1).
 *
 * @param {Object} [config]
 * @param {string} [config.baseUrl]
 * @param {number} [config.timeoutMs]
 * @param {Function} [config.fetchImpl]
 * @param {() => string | null} [config.getAccessToken]
 * @param {() => number | null} [config.getSessionEpoch]
 * @param {(ctx: { error: ApiError, path: string, method: string, requestEpoch: number | null, requestAccessToken: string | null }) => Promise<string | null>} [config.onUnauthorized]
 * @param {(error: ApiError, ctx?: { path: string, method: string, requestEpoch: number | null, requestAccessToken: string | null }) => void} [config.onSessionInvalidated]
 */
export function createHttpClient(config = {}) {
  let baseUrl = resolveApiBaseUrl(config.baseUrl, { env: config.env });
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);

  let authHandlers = {
    getAccessToken: config.getAccessToken ?? (() => null),
    getSessionEpoch: config.getSessionEpoch ?? (() => null),
    onUnauthorized: config.onUnauthorized ?? null,
    onSessionInvalidated: config.onSessionInvalidated ?? null,
  };

  function setAuthHandlers(nextHandlers = {}) {
    authHandlers = {
      ...authHandlers,
      ...nextHandlers,
    };
  }

  function setBaseUrl(nextBaseUrl, options) {
    baseUrl = resolveApiBaseUrl(nextBaseUrl, options);
    return baseUrl;
  }

  function getBaseUrl() {
    return baseUrl;
  }

  async function request(path, options = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Implementação global de fetch indisponível no ambiente.');
    }

    const method = (options.method || 'GET').toUpperCase();
    const normalizedPath = normalizePath(path);
    const url = `${baseUrl}${normalizedPath}`;
    const requiresAuth = Boolean(options.auth);
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

    const headers = {
      Accept: 'application/json, application/problem+json',
      ...(options.headers || {}),
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const requestEpoch =
      options._requestEpoch !== undefined
        ? options._requestEpoch
        : typeof authHandlers.getSessionEpoch === 'function'
        ? authHandlers.getSessionEpoch()
        : null;

    const explicitToken =
      typeof options.accessToken === 'string' && options.accessToken.trim().length > 0
        ? options.accessToken.trim()
        : null;
    const resolvedToken =
      explicitToken ?? (requiresAuth && authHandlers.getAccessToken ? authHandlers.getAccessToken() : null);

    if (requiresAuth && resolvedToken) {
      headers.Authorization = `Bearer ${resolvedToken}`;
    } else if (!requiresAuth && explicitToken) {
      headers.Authorization = `Bearer ${explicitToken}`;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let didTimeout = false;
    let timeoutId = null;

    if (controller && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, timeoutMs);
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller ? controller.signal : undefined,
      });
    } catch (networkErr) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      const isAbortTimeout =
        didTimeout ||
        networkErr?.name === 'AbortError' ||
        networkErr?.code === 'ETIMEDOUT' ||
        /timeout|timed out|aborted/i.test(String(networkErr?.message || ''));

      if (isAbortTimeout) {
        throw new ApiError({
          kind: 'timeout',
          status: null,
          code: 'REQUEST_TIMEOUT',
          title: 'Tempo limite excedido',
          detail:
            'O servidor demorou para responder e não foi possível confirmar o resultado da solicitação.',
          outcomeUnknown: method !== 'GET' && method !== 'HEAD',
          cause: networkErr,
        });
      }

      throw new ApiError({
        kind: 'network',
        status: null,
        code: 'NETWORK_ERROR',
        title: 'Falha de conexão',
        detail:
          'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.',
        outcomeUnknown: Boolean(networkErr?.outcomeUnknown),
        cause: networkErr,
      });
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }

    const parsedBody = await parseResponseBody(response);

    if (response.ok) {
      return parsedBody;
    }

    const status = response.status;
    const code =
      (parsedBody && typeof parsedBody.code === 'string' && parsedBody.code) ||
      `HTTP_${status}`;
    const title =
      (parsedBody && typeof parsedBody.title === 'string' && parsedBody.title) ||
      'Erro na solicitação';
    const detail =
      (parsedBody && typeof parsedBody.detail === 'string' && parsedBody.detail) ||
      (parsedBody && typeof parsedBody.message === 'string' && parsedBody.message) ||
      `A solicitação falhou com status HTTP ${status}.`;
    const invalidParams =
      parsedBody && Array.isArray(parsedBody.invalidParams) ? parsedBody.invalidParams : [];
    const retryAfterSeconds = parseRetryAfterHeader(
      response.headers,
      parsedBody?.retryAfterSeconds
    );

    const apiError = new ApiError({
      kind: 'http',
      status,
      code,
      title,
      detail,
      type: parsedBody?.type ?? null,
      invalidParams,
      retryAfterSeconds,
      rawBody: parsedBody,
    });

    // Intercepção de 401 em rotas autenticadas:
    // - Se o servidor confirmou revogação/expiração definitiva da sessão, notifica e não tenta refresh.
    // - Caso contrário, aciona o refresh single-flight e repete a requisição protegida no máximo 1 vez.
    if (status === 401 && requiresAuth && options.retryOnUnauthorized !== false) {
      const authContextInfo = {
        path: normalizedPath,
        method,
        requestEpoch,
        requestAccessToken: resolvedToken,
      };

      if (isTerminalSessionError(apiError)) {
        if (typeof authHandlers.onSessionInvalidated === 'function') {
          await authHandlers.onSessionInvalidated(apiError, authContextInfo);
        }
        throw apiError;
      }

      if (!options._retriedAfterRefresh && typeof authHandlers.onUnauthorized === 'function') {
        let refreshedAccessToken = null;
        try {
          refreshedAccessToken = await authHandlers.onUnauthorized({
            error: apiError,
            ...authContextInfo,
          });
        } catch (refreshError) {
          throw refreshError;
        }

        const currentEpochAfterRefresh =
          typeof authHandlers.getSessionEpoch === 'function'
            ? authHandlers.getSessionEpoch()
            : requestEpoch;

        if (
          typeof refreshedAccessToken === 'string' &&
          refreshedAccessToken.length > 0 &&
          (requestEpoch === null || currentEpochAfterRefresh === requestEpoch)
        ) {
          return request(normalizedPath, {
            ...options,
            accessToken: refreshedAccessToken,
            _retriedAfterRefresh: true,
            _requestEpoch: currentEpochAfterRefresh,
          });
        }
      }

      if (options._retriedAfterRefresh && typeof authHandlers.onSessionInvalidated === 'function') {
        await authHandlers.onSessionInvalidated(apiError, authContextInfo);
      }
    }

    throw apiError;
  }

  return {
    request,
    get(path, options = {}) {
      return request(path, { ...options, method: 'GET' });
    },
    post(path, body, options = {}) {
      return request(path, { ...options, method: 'POST', body });
    },
    put(path, body, options = {}) {
      return request(path, { ...options, method: 'PUT', body });
    },
    patch(path, body, options = {}) {
      return request(path, { ...options, method: 'PATCH', body });
    },
    delete(path, options = {}) {
      return request(path, { ...options, method: 'DELETE' });
    },
    setAuthHandlers,
    setBaseUrl,
    getBaseUrl,
  };
}

export const httpClient = createHttpClient();
