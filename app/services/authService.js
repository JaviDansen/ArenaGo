import { ApiError, createHttpClient, httpClient as defaultHttpClient } from './httpClient';
import { defaultTokenStorage } from './tokenStorage';

function resolveInvalidationNotice(error) {
  if (!error) {
    return 'Sua sessão foi encerrada. Faça login novamente para continuar.';
  }
  switch (error.code) {
    case 'SESSION_EXPIRED':
      return 'Sua sessão atingiu o limite máximo de 30 dias. Faça login novamente.';
    case 'SESSION_REVOKED':
      return 'Sua sessão foi encerrada (por exemplo, após um novo acesso em outro dispositivo). Faça login novamente.';
    case 'REFRESH_TOKEN_REUSED':
      return 'Detectamos tentativa de reutilização de credencial de sessão e encerramos o acesso por segurança. Faça login novamente.';
    case 'ACCOUNT_DEACTIVATED':
      return 'Esta conta está desativada. Entre em contato com a organização se precisar de suporte.';
    default:
      return 'Sua sessão expirou ou foi encerrada. Faça login novamente para continuar.';
  }
}

function sanitizePublicUser(rawInput) {
  const rawUser =
    rawInput && typeof rawInput === 'object' && rawInput.user && typeof rawInput.user === 'object'
      ? rawInput.user
      : rawInput;
  if (!rawUser || typeof rawUser !== 'object') {
    return null;
  }
  return {
    id: String(rawUser.id || ''),
    name: String(rawUser.name || ''),
    email: String(rawUser.email || ''),
    emailVerified: Boolean(rawUser.emailVerified),
    roles: Array.isArray(rawUser.roles) ? [...rawUser.roles] : ['participante'],
    hasCompletedQuestionnaire: Boolean(rawUser.hasCompletedQuestionnaire),
  };
}

/**
 * Cria o gerenciador de estado e operações de autenticação real (K02).
 *
 * Responsabilidades:
 * - Manter `accessToken` exclusivamente em memória.
 * - Persistir `refreshToken` via `tokenStorage` (`SecureStore` no mobile, memória na web).
 * - Coordenar `refreshSession()` em modo single-flight (apenas 1 refresh simultâneo).
 * - Nunca reenviar automaticamente um refresh token cujo resultado de rede foi incerto (timeout).
 * - Proteger contra condições de corrida pós-logout / pós-login por meio de `sessionEpoch`.
 * - Nunca tocar ou limpar `ParticipationContext`.
 *
 * @param {Object} [options]
 * @param {ReturnType<typeof createHttpClient>} [options.client]
 * @param {typeof defaultTokenStorage} [options.tokenStorage]
 * @param {(snapshot: Object) => void} [options.onStateChange]
 */
export function createAuthSessionManager(options = {}) {
  const client = options.client ?? options.httpClient ?? defaultHttpClient;
  const tokenStorage = options.tokenStorage ?? defaultTokenStorage;
  const listeners = new Set();
  if (typeof options.onStateChange === 'function') {
    listeners.add(options.onStateChange);
  }

  let sessionEpoch = 0;
  let accessToken = null;
  let inFlightRefreshPromise = null;
  let inFlightRestorePromise = null;
  const uncertainRefreshTokens = new Set();

  let state = {
    user: null,
    isAuthenticated: false,
    isInitializing: true,
    sessionStatus: 'initializing',
    authNotice: null,
    networkError: null,
    adminChallenge: null,
    postAuthRoute: null,
    isPersistentStorage: Boolean(tokenStorage.isPersistent),
  };

  function emitState(patch) {
    state = Object.freeze({
      ...state,
      ...patch,
    });
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return state;
  }

  function getAccessToken() {
    return accessToken;
  }

  async function handleSessionInvalidated(error) {
    sessionEpoch += 1;
    accessToken = null;
    inFlightRefreshPromise = null;
    try {
      await tokenStorage.clearRefreshToken();
    } catch {
      // Ignora erro de limpeza local
    }

    const nextStatus = error?.code === 'SESSION_EXPIRED' ? 'expired' : 'revoked';
    emitState({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      sessionStatus: nextStatus,
      authNotice: resolveInvalidationNotice(error),
      networkError: null,
      adminChallenge: null,
      postAuthRoute: null,
    });
  }

  /**
   * Renovação coordenada (single-flight) do par de tokens via POST /api/v1/auth/refresh.
   * Chamadas concorrentes aguardam a mesma Promise.
   */
  function refreshSession() {
    if (inFlightRefreshPromise) {
      return inFlightRefreshPromise;
    }

    const epochAtStart = sessionEpoch;

    inFlightRefreshPromise = (async () => {
      const storedRefreshToken = await tokenStorage.getRefreshToken();

      if (
        (storedRefreshToken && uncertainRefreshTokens.has(storedRefreshToken)) ||
        (!storedRefreshToken && state.sessionStatus === 'uncertain_refresh')
      ) {
        const uncertainError = new ApiError({
          kind: 'timeout',
          status: null,
          code: 'UNCERTAIN_REFRESH_OUTCOME',
          title: 'Renovação anterior inconclusiva',
          detail:
            'A tentativa anterior de renovar a sessão expirou sem confirmação. Por segurança, faça login novamente.',
          outcomeUnknown: true,
        });
        throw uncertainError;
      }

      if (!storedRefreshToken) {
        const missingError = new ApiError({
          kind: 'http',
          status: 401,
          code: 'MISSING_REFRESH_TOKEN',
          title: 'Sessão não encontrada',
          detail: 'Nenhuma credencial de renovação disponível. Faça login novamente.',
        });
        if (sessionEpoch === epochAtStart) {
          await handleSessionInvalidated(missingError);
        }
        throw missingError;
      }

      try {
        const response = await client.post(
          '/auth/refresh',
          { refreshToken: storedRefreshToken },
          { auth: false, retryOnUnauthorized: false }
        );

        // Se houve logout ou novo login enquanto o refresh estava em trânsito, descarta a resposta antiga.
        if (sessionEpoch !== epochAtStart) {
          return null;
        }

        if (
          !response ||
          typeof response.accessToken !== 'string' ||
          typeof response.refreshToken !== 'string'
        ) {
          throw new ApiError({
            kind: 'http',
            status: 500,
            code: 'INVALID_REFRESH_RESPONSE',
            title: 'Resposta inválida do servidor',
            detail: 'Não foi possível validar os novos tokens de sessão.',
          });
        }

        accessToken = response.accessToken;
        await tokenStorage.setRefreshToken(response.refreshToken);

        emitState({
          networkError: null,
        });

        return {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresIn: response.expiresIn,
        };
      } catch (error) {
        if (sessionEpoch !== epochAtStart) {
          throw error;
        }

        // Timeout ou queda após envio do refresh: o servidor pode já ter consumido o token antigo.
        // NUNCA reenviar automaticamente esse refreshToken (evita falso positivo de reuso / loop).
        if (error?.isTimeout || error?.outcomeUnknown) {
          uncertainRefreshTokens.add(storedRefreshToken);
          sessionEpoch += 1;
          accessToken = null;
          try {
            await tokenStorage.clearRefreshToken();
          } catch {
            // Ignora falha de limpeza
          }

          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'uncertain_refresh',
            authNotice:
              'A conexão expirou durante a renovação da sessão e o resultado não pôde ser confirmado. Por segurança, faça login novamente.',
            networkError: error.detail,
            adminChallenge: null,
            postAuthRoute: null,
          });
          throw error;
        }

        // Erro HTTP 401: refresh inválido, reutilizado, sessão revogada ou expirada após 30 dias.
        if (error?.status === 401) {
          await handleSessionInvalidated(error);
          throw error;
        }

        // Falha temporária de conectividade (dispositivo sem rede antes de consumir o token):
        // Não apagar a sessão nem confundir com revogação confirmada.
        if (error?.isNetworkError) {
          emitState({
            networkError: error.detail,
            sessionStatus: state.isAuthenticated ? 'authenticated' : 'network_error',
          });
        }

        throw error;
      } finally {
        inFlightRefreshPromise = null;
      }
    })();

    return inFlightRefreshPromise;
  }

  /**
   * Consulta GET /api/v1/auth/me confirmando a sessão ativa e dados vivos no PostgreSQL.
   */
  async function fetchCurrentUser(options = {}) {
    const epochAtStart = sessionEpoch;
    const meResponse = await client.get('/auth/me', {
      auth: true,
      retryOnUnauthorized: options.retryOnUnauthorized ?? true,
      _retriedAfterRefresh: Boolean(options._retriedAfterRefresh),
    });

    if (sessionEpoch !== epochAtStart) {
      return null;
    }

    const liveUser = sanitizePublicUser(meResponse);
    if (!liveUser || !liveUser.id) {
      throw new ApiError({
        kind: 'http',
        status: 500,
        code: 'INVALID_ME_RESPONSE',
        title: 'Resposta inválida',
        detail: 'Não foi possível validar os dados da conta autenticada.',
      });
    }

    emitState({
      user: liveUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      networkError: null,
    });

    return liveUser;
  }

  /**
   * Restaura a sessão ao abrir/reabrir o aplicativo de forma coordenada (single-flight).
   * 1. Verifica existência de refresh token armazenado.
   * 2. Renova o par de tokens via POST /auth/refresh.
   * 3. Confirma os dados vivos da conta via GET /auth/me.
   */
  function restoreSession() {
    if (inFlightRestorePromise) {
      return inFlightRestorePromise;
    }

    const epochAtStart = sessionEpoch;

    inFlightRestorePromise = (async () => {
      emitState({
        isInitializing: true,
        networkError: null,
      });

      let storedRefreshToken = null;
      try {
        storedRefreshToken = await tokenStorage.getRefreshToken();
      } catch {
        storedRefreshToken = null;
      }

      if (sessionEpoch !== epochAtStart) {
        return { status: 'aborted', user: state.user };
      }

      if (!storedRefreshToken && !accessToken) {
        emitState({
          user: null,
          isAuthenticated: false,
          isInitializing: false,
          sessionStatus: 'unauthenticated',
          networkError: null,
          postAuthRoute: null,
        });
        return { status: 'unauthenticated', user: null };
      }

      try {
        if (!accessToken) {
          const refreshed = await refreshSession();
          if (sessionEpoch !== epochAtStart || !refreshed) {
            return { status: 'aborted', user: state.user };
          }
        }

        const liveUser = await fetchCurrentUser({
          retryOnUnauthorized: false,
          _retriedAfterRefresh: true,
        });

        if (sessionEpoch !== epochAtStart || !liveUser) {
          return { status: 'aborted', user: state.user };
        }

        emitState({
          user: liveUser,
          isAuthenticated: true,
          isInitializing: false,
          sessionStatus: 'authenticated',
          authNotice: null,
          networkError: null,
          adminChallenge: null,
          postAuthRoute: 'MainTabs',
        });

        return {
          status: 'authenticated',
          user: liveUser,
          nextRoute: 'MainTabs',
        };
      } catch (error) {
        if (sessionEpoch !== epochAtStart && state.sessionStatus !== 'revoked' && state.sessionStatus !== 'expired' && state.sessionStatus !== 'uncertain_refresh') {
          return { status: 'aborted', user: state.user };
        }

        // Se foi falha temporária de rede (sem confirmação de 401 ou timeout incerto),
        // encerra o estado de inicialização mantendo a distinção de erro de rede.
        if (error?.isNetworkError && !error?.isTimeout && !error?.outcomeUnknown) {
          accessToken = null;
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'network_error',
            networkError: error.detail,
          });
          return {
            status: 'network_error',
            user: null,
            error,
          };
        }

        emitState({
          isInitializing: false,
        });

        return {
          status: state.sessionStatus,
          user: null,
          error,
        };
      } finally {
        inFlightRestorePromise = null;
      }
    })();

    return inFlightRestorePromise;
  }

  /**
   * Cadastro real (POST /api/v1/auth/register).
   * Envia estritamente { name, email, password } — jamais envia confirmPassword.
   */
  async function register(input) {
    const payload = {
      name: typeof input?.name === 'string' ? input.name.trim() : '',
      email: typeof input?.email === 'string' ? input.email.trim() : '',
      password: typeof input?.password === 'string' ? input.password : '',
    };

    const response = await client.post('/auth/register', payload, {
      auth: false,
      retryOnUnauthorized: false,
    });

    const registeredUser = sanitizePublicUser(response?.user);
    if (
      !registeredUser ||
      typeof response?.accessToken !== 'string' ||
      typeof response?.refreshToken !== 'string'
    ) {
      throw new ApiError({
        kind: 'http',
        status: 500,
        code: 'INVALID_REGISTER_RESPONSE',
        title: 'Resposta inválida no cadastro',
        detail: 'O servidor retornou uma resposta incompleta ao criar a conta.',
      });
    }

    sessionEpoch += 1;
    const currentEpoch = sessionEpoch;
    accessToken = response.accessToken;
    uncertainRefreshTokens.clear();
    await tokenStorage.setRefreshToken(response.refreshToken);

    let confirmedUser = registeredUser;
    emitState({
      user: confirmedUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      authNotice: null,
      networkError: null,
      adminChallenge: null,
      postAuthRoute: 'ProfileQuestionnaire',
    });

    // Confirmar sessão atual em /auth/me quando disponível, sem falhar o cadastro já persistido se /auth/me oscilar
    try {
      const meResponse = await client.get('/auth/me', {
        auth: true,
        retryOnUnauthorized: false,
        _retriedAfterRefresh: true,
      });
      if (sessionEpoch === currentEpoch && meResponse?.id) {
        confirmedUser = sanitizePublicUser(meResponse);
        emitState({ user: confirmedUser });
      }
    } catch (meError) {
      if (meError?.status === 401 && sessionEpoch === currentEpoch) {
        await handleSessionInvalidated(meError);
        throw meError;
      }
    }

    return {
      status: 'authenticated',
      user: confirmedUser,
      nextRoute: 'ProfileQuestionnaire',
    };
  }

  /**
   * Login real (POST /api/v1/auth/login).
   * Envia estritamente { email, password }.
   * Trata tanto sessões de Participante/Staff quanto o desafio `requires2FA: true` de Admin.
   */
  async function login(input) {
    const payload = {
      email: typeof input?.email === 'string' ? input.email.trim() : '',
      password: typeof input?.password === 'string' ? input.password : '',
    };

    const response = await client.post('/auth/login', payload, {
      auth: false,
      retryOnUnauthorized: false,
    });

    // Caso Admin: backend retorna { requires2FA: true, isTotpConfigured, tempToken, message }.
    // NUNCA armazenar tempToken como accessToken ou refreshToken nem autenticar a sessão.
    if (response && response.requires2FA === true) {
      sessionEpoch += 1;
      accessToken = null;
      await tokenStorage.clearRefreshToken();

      const challenge = {
        requires2FA: true,
        isTotpConfigured: Boolean(response.isTotpConfigured),
        message:
          typeof response.message === 'string' && response.message.trim().length > 0
            ? response.message
            : 'Esta conta administrativa exige confirmação de segundo fator (TOTP) para concluir o acesso.',
      };

      emitState({
        user: null,
        isAuthenticated: false,
        isInitializing: false,
        sessionStatus: 'admin_2fa_required',
        authNotice: null,
        networkError: null,
        adminChallenge: challenge,
        postAuthRoute: null,
      });

      return {
        status: 'requires_2fa',
        ...challenge,
      };
    }

    const loggedUser = sanitizePublicUser(response?.user);
    if (
      !loggedUser ||
      typeof response?.accessToken !== 'string' ||
      typeof response?.refreshToken !== 'string'
    ) {
      throw new ApiError({
        kind: 'http',
        status: 500,
        code: 'INVALID_LOGIN_RESPONSE',
        title: 'Resposta inválida no login',
        detail: 'Não foi possível iniciar a sessão com a resposta recebida do servidor.',
      });
    }

    sessionEpoch += 1;
    const currentEpoch = sessionEpoch;
    accessToken = response.accessToken;
    uncertainRefreshTokens.clear();
    await tokenStorage.setRefreshToken(response.refreshToken);

    let confirmedUser = loggedUser;
    emitState({
      user: confirmedUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      authNotice: null,
      networkError: null,
      adminChallenge: null,
      postAuthRoute: 'MainTabs',
    });

    // Confirmar dados atuais da conta em GET /auth/me
    try {
      const meResponse = await client.get('/auth/me', {
        auth: true,
        retryOnUnauthorized: false,
        _retriedAfterRefresh: true,
      });
      if (sessionEpoch === currentEpoch && meResponse?.id) {
        confirmedUser = sanitizePublicUser(meResponse);
        emitState({ user: confirmedUser });
      }
    } catch (meError) {
      if (meError?.status === 401 && sessionEpoch === currentEpoch) {
        await handleSessionInvalidated(meError);
        throw meError;
      }
    }

    return {
      status: 'authenticated',
      user: confirmedUser,
      nextRoute: 'MainTabs',
    };
  }

  /**
   * Logout real (POST /api/v1/auth/logout).
   * - Incrementa `sessionEpoch` imediatamente para impedir que requisições antigas restaurem a sessão.
   * - Remove refresh token local e limpa access token da memória.
   * - Distingue revogação remota confirmada (`remoteRevoked: true`) de encerramento local sob falha de rede (`remoteRevoked: false`).
   */
  async function logout() {
    sessionEpoch += 1;
    const tokenToRevoke = accessToken;
    accessToken = null;
    inFlightRefreshPromise = null;

    await tokenStorage.clearRefreshToken();

    emitState({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      sessionStatus: 'unauthenticated',
      authNotice: null,
      networkError: null,
      adminChallenge: null,
      postAuthRoute: null,
    });

    if (!tokenToRevoke) {
      return {
        localLoggedOut: true,
        remoteRevoked: false,
        status: 'local_only_no_token',
        message: 'Sessão local encerrada.',
      };
    }

    try {
      const response = await client.post('/auth/logout', undefined, {
        auth: false,
        accessToken: tokenToRevoke,
        retryOnUnauthorized: false,
      });

      return {
        localLoggedOut: true,
        remoteRevoked: true,
        status: 'revoked_remotely',
        message: response?.message || 'Sessão encerrada com sucesso.',
      };
    } catch (error) {
      const warning =
        'Sua sessão foi encerrada neste dispositivo, mas não foi possível confirmar a revogação no servidor por falha de comunicação.';
      emitState({
        authNotice: warning,
      });

      return {
        localLoggedOut: true,
        remoteRevoked: false,
        status: 'local_only_network_failure',
        warning,
        error,
      };
    }
  }

  function clearNotices() {
    emitState({
      authNotice: null,
      networkError: null,
      adminChallenge: null,
    });
  }

  client.setAuthHandlers({
    getAccessToken,
    onUnauthorized: async () => {
      const refreshed = await refreshSession();
      return refreshed?.accessToken ?? null;
    },
    onSessionInvalidated: handleSessionInvalidated,
  });

  return {
    subscribe,
    getSnapshot,
    getAccessToken,
    register,
    login,
    logout,
    refreshSession,
    restoreSession,
    fetchCurrentUser,
    clearNotices,
    client,
    tokenStorage,
  };
}
