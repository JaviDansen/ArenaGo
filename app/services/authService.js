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
 * - Serializar todas as operações de leitura, gravação e remoção de credenciais em fila assíncrona
 *   coordenada com `sessionEpoch` e estado desejado da geração atual, impedindo que um `refresh`
 *   em andamento deixe token residual após `logout()` ou que uma limpeza tardia apague credenciais
 *   de um `login()` posterior.
 * - Diferenciar explicitamente ausência de credencial (`empty`), credencial legível (`available`)
 *   e falha de leitura do `SecureStore` (`error` -> `sessionStatus: 'storage_error'`).
 * - Coordenar `refreshSession()` em modo single-flight (apenas 1 refresh simultâneo).
 * - Nunca reenviar automaticamente um refresh token cujo resultado de rede foi incerto (timeout).
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

  // Fila assíncrona FIFO para serializar leituras, gravações e limpezas no tokenStorage
  // sem risco de deadlock (nenhuma operação da fila invoca métodos de rede ou de sessão).
  let storageQueue = Promise.resolve();
  let desiredCredentialState = {
    epoch: 0,
    refreshToken: null,
  };

  let state = {
    user: null,
    isAuthenticated: false,
    isInitializing: true,
    sessionStatus: 'initializing',
    authNotice: null,
    networkError: null,
    storageError: null,
    adminChallenge: null,
    postAuthRoute: null,
    isPersistentStorage: Boolean(tokenStorage.isPersistent),
  };

  function enqueueStorageOp(task) {
    const run = storageQueue.then(task, task);
    storageQueue = run.catch(() => {});
    return run;
  }

  /**
   * Lê a credencial armazenada diferenciando explicitamente:
   * - `status: 'empty'` (nenhuma credencial armazenada)
   * - `status: 'available'` (credencial existente e legível)
   * - `status: 'error'` (falha ao consultar o armazenamento seguro)
   */
  async function readRefreshTokenState() {
    try {
      const stored = await enqueueStorageOp(async () => {
        if (typeof tokenStorage.getRefreshToken === 'function') {
          return await tokenStorage.getRefreshToken();
        }
        if (typeof tokenStorage.readRefreshToken === 'function') {
          const result = await tokenStorage.readRefreshToken();
          if (result?.status === 'error') {
            throw result.error || new Error('Falha ao consultar armazenamento seguro.');
          }
          return result?.token ?? null;
        }
        return null;
      });

      if (typeof stored === 'string' && stored.trim().length > 0) {
        return {
          status: 'available',
          token: stored.trim(),
          error: null,
        };
      }

      return {
        status: 'empty',
        token: null,
        error: null,
      };
    } catch (cause) {
      const storageError =
        cause instanceof ApiError
          ? cause
          : new ApiError({
              kind: 'storage',
              status: null,
              code: cause?.code || 'STORAGE_READ_ERROR',
              title: 'Falha ao acessar armazenamento seguro',
              detail:
                cause?.detail ||
                cause?.message ||
                'Não foi possível acessar o armazenamento seguro do dispositivo para verificar sua sessão.',
              cause,
            });
      storageError.isStorageError = true;
      return {
        status: 'error',
        token: null,
        error: storageError,
      };
    }
  }

  /**
   * Persiste um `refreshToken` vinculado a `targetEpoch` de forma serializada.
   * - Verifica `sessionEpoch` antes e depois do `await tokenStorage.setRefreshToken()`.
   * - Se `logout()` ou invalidação ocorrer durante a gravação (`desiredCredentialState.refreshToken === null`),
   *   remove imediatamente a credencial gravada para nunca deixar resíduo no `SecureStore`.
   * - Se um novo `login()` tiver ocorrido nesse intervalo (`desiredCredentialState.epoch > targetEpoch`
   *   com `refreshToken !== null`), preserva/reafirma a credencial da nova sessão sem apagá-la.
   */
  async function writeRefreshTokenForEpoch(refreshToken, targetEpoch) {
    if (sessionEpoch !== targetEpoch) {
      return false;
    }

    desiredCredentialState = {
      epoch: targetEpoch,
      refreshToken,
    };

    return enqueueStorageOp(async () => {
      if (sessionEpoch !== targetEpoch || desiredCredentialState.epoch !== targetEpoch) {
        return false;
      }

      await tokenStorage.setRefreshToken(refreshToken);

      if (sessionEpoch !== targetEpoch) {
        if (desiredCredentialState.refreshToken === null) {
          try {
            await tokenStorage.clearRefreshToken();
          } catch {
            // Ignora erro secundário de limpeza
          }
        } else if (
          desiredCredentialState.epoch > targetEpoch &&
          desiredCredentialState.refreshToken !== refreshToken
        ) {
          try {
            await tokenStorage.setRefreshToken(desiredCredentialState.refreshToken);
          } catch {
            // A operação enfileirada da nova sessão também garantirá a escrita
          }
        }
        return false;
      }

      return true;
    });
  }

  /**
   * Remove o `refreshToken` vinculado ao encerramento/invalidação em `targetEpoch`.
   * - Se uma sessão posterior (`desiredCredentialState.epoch > targetEpoch` com token válido)
   *   já tiver sido iniciada antes ou durante a limpeza, NÃO apaga (ou restaura) o token da sessão nova.
   */
  async function clearRefreshTokenForEpoch(targetEpoch) {
    if (targetEpoch >= desiredCredentialState.epoch) {
      desiredCredentialState = {
        epoch: targetEpoch,
        refreshToken: null,
      };
    }

    return enqueueStorageOp(async () => {
      if (
        desiredCredentialState.epoch > targetEpoch &&
        desiredCredentialState.refreshToken !== null
      ) {
        return false;
      }

      await tokenStorage.clearRefreshToken();

      if (
        desiredCredentialState.epoch > targetEpoch &&
        desiredCredentialState.refreshToken !== null
      ) {
        await tokenStorage.setRefreshToken(desiredCredentialState.refreshToken);
        return false;
      }

      return true;
    });
  }

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

  function getSessionEpoch() {
    return sessionEpoch;
  }

  async function handleSessionInvalidated(error, context = {}) {
    if (
      context?.requestEpoch !== undefined &&
      context.requestEpoch !== null &&
      context.requestEpoch !== sessionEpoch
    ) {
      return;
    }
    if (context?.targetEpoch !== undefined && context.targetEpoch !== sessionEpoch) {
      return;
    }

    sessionEpoch += 1;
    const invalidationEpoch = sessionEpoch;
    accessToken = null;
    inFlightRefreshPromise = null;

    try {
      await clearRefreshTokenForEpoch(invalidationEpoch);
    } catch {
      // Ignora erro de limpeza local
    }

    if (sessionEpoch !== invalidationEpoch) {
      return;
    }

    const nextStatus = error?.code === 'SESSION_EXPIRED' ? 'expired' : 'revoked';
    emitState({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      sessionStatus: nextStatus,
      authNotice: resolveInvalidationNotice(error),
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: null,
    });
  }

  /**
   * Renovação coordenada (single-flight) do par de tokens via POST /api/v1/auth/refresh.
   * Chamadas concorrentes dentro da mesma geração de sessão aguardam a mesma Promise.
   */
  function refreshSession() {
    if (inFlightRefreshPromise) {
      return inFlightRefreshPromise;
    }

    const epochAtStart = sessionEpoch;

    const currentRefreshPromise = (async () => {
      try {
        const storageRead = await readRefreshTokenState();

        if (sessionEpoch !== epochAtStart) {
          return null;
        }

        if (storageRead.status === 'error') {
          emitState({
            isInitializing: false,
            storageError: storageRead.error.detail,
            networkError: storageRead.error.detail,
            sessionStatus: state.isAuthenticated ? 'authenticated' : 'storage_error',
          });
          throw storageRead.error;
        }

        const storedRefreshToken = storageRead.token;

        if (
          (storedRefreshToken && uncertainRefreshTokens.has(storedRefreshToken)) ||
          (!storedRefreshToken && state.sessionStatus === 'uncertain_refresh')
        ) {
          if (storedRefreshToken) {
            try {
              await clearRefreshTokenForEpoch(epochAtStart);
            } catch {
              // Ignora erro secundário de limpeza
            }
          }
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'uncertain_refresh',
            authNotice:
              state.authNotice ||
              'A tentativa anterior de renovar a sessão falhou sem confirmação do servidor. Por segurança, faça login novamente.',
          });
          const uncertainError = new ApiError({
            kind: 'timeout',
            status: null,
            code: 'UNCERTAIN_REFRESH_OUTCOME',
            title: 'Renovação anterior inconclusiva',
            detail:
              'A tentativa anterior de renovar a sessão expirou ou falhou sem confirmação. Por segurança, faça login novamente.',
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
            await handleSessionInvalidated(missingError, { targetEpoch: epochAtStart });
          }
          throw missingError;
        }

        try {
          const response = await client.post(
            '/auth/refresh',
            { refreshToken: storedRefreshToken },
            {
              auth: false,
              retryOnUnauthorized: false,
              outcomeUnknownOnNetworkError: true,
            }
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

          const persisted = await writeRefreshTokenForEpoch(
            response.refreshToken,
            epochAtStart
          );

          // Se o logout (ou novo login) ocorreu durante a gravação assíncrona no SecureStore,
          // writeRefreshTokenForEpoch já reconciliou o armazenamento e retornou false:
          // jamais expor accessToken ou entregar resposta obsoleta às requisições que aguardavam.
          if (!persisted || sessionEpoch !== epochAtStart) {
            return null;
          }

          accessToken = response.accessToken;

          emitState({
            networkError: null,
            storageError: null,
          });

          return {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: response.expiresIn,
          };
        } catch (error) {
          if (sessionEpoch !== epochAtStart) {
            return null;
          }

          // Timeout ou qualquer falha de transporte durante POST /auth/refresh quando não é
          // possível provar que o servidor não recebeu a requisição:
          // O servidor pode já ter consumido/rotacionado o refresh token antigo.
          // NUNCA reenviar automaticamente esse refreshToken (evita falso positivo de reuso e revogação na K01).
          const isInconclusiveRefreshTransportError =
            Boolean(error?.isTimeout) ||
            Boolean(error?.outcomeUnknown) ||
            Boolean(error?.isNetworkError && error?.cause?.requestNotSent !== true);

          if (isInconclusiveRefreshTransportError) {
            if (error && typeof error === 'object') {
              error.outcomeUnknown = true;
            }
            uncertainRefreshTokens.add(storedRefreshToken);
            sessionEpoch += 1;
            const uncertainEpoch = sessionEpoch;
            accessToken = null;
            try {
              await clearRefreshTokenForEpoch(uncertainEpoch);
            } catch {
              // Ignora falha de limpeza
            }

            if (sessionEpoch === uncertainEpoch) {
              emitState({
                user: null,
                isAuthenticated: false,
                isInitializing: false,
                sessionStatus: 'uncertain_refresh',
                authNotice:
                  'A conexão falhou ou expirou durante a renovação da sessão e o resultado não pôde ser confirmado. Por segurança, faça login novamente.',
                networkError: error.detail,
                storageError: null,
                adminChallenge: null,
                postAuthRoute: null,
              });
            }
            throw error;
          }

          // Erro HTTP 401: refresh inválido, reutilizado, sessão revogada ou expirada após 30 dias.
          if (error?.status === 401) {
            await handleSessionInvalidated(error, { targetEpoch: epochAtStart });
            throw error;
          }

          // Falha de transporte apenas quando comprovadamente a requisição não chegou a ser enviada:
          if (error?.isNetworkError) {
            emitState({
              networkError: error.detail,
              storageError: null,
              sessionStatus: state.isAuthenticated ? 'authenticated' : 'network_error',
            });
          }

          throw error;
        }
      } finally {
        if (inFlightRefreshPromise === currentRefreshPromise) {
          inFlightRefreshPromise = null;
        }
      }
    })();

    inFlightRefreshPromise = currentRefreshPromise;
    return currentRefreshPromise;
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
      _requestEpoch: epochAtStart,
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

    // Proteção contra resposta obsoleta: não reverte questionário concluído
    if (state.user?.id === liveUser.id && state.user?.hasCompletedQuestionnaire === true) {
      liveUser.hasCompletedQuestionnaire = true;
    }

    emitState({
      user: liveUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      postAuthRoute: liveUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire',
      networkError: null,
      storageError: null,
    });

    return liveUser;
  }

  /**
   * Restaura a sessão ao abrir/reabrir o aplicativo de forma coordenada (single-flight).
   * 1. Verifica existência e legibilidade do refresh token armazenado.
   * 2. Se a leitura do `SecureStore` falhar, não apaga credenciais nem presume ausência de sessão:
   *    expõe estado recuperável `storage_error` permitindo nova tentativa.
   * 3. Renova o par de tokens via POST /api/v1/auth/refresh.
   * 4. Confirma os dados vivos da conta via GET /api/v1/auth/me.
   */
  function restoreSession() {
    if (inFlightRestorePromise) {
      return inFlightRestorePromise;
    }

    const epochAtStart = sessionEpoch;

    const currentRestorePromise = (async () => {
      try {
        emitState({
          isInitializing: true,
          networkError: null,
          storageError: null,
        });

        const storageRead = await readRefreshTokenState();

        if (sessionEpoch !== epochAtStart) {
          return { status: 'aborted', user: state.user };
        }

        if (storageRead.status === 'error') {
          accessToken = null;
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'storage_error',
            storageError: storageRead.error.detail,
            networkError: storageRead.error.detail,
            postAuthRoute: null,
          });
          return {
            status: 'storage_error',
            user: null,
            error: storageRead.error,
          };
        }

        const storedRefreshToken = storageRead.token;

        if (
          !storedRefreshToken &&
          !accessToken &&
          state.sessionStatus !== 'uncertain_refresh'
        ) {
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'unauthenticated',
            networkError: null,
            storageError: null,
            postAuthRoute: null,
          });
          return { status: 'unauthenticated', user: null };
        }

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

        const resolvedRoute = liveUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';

        emitState({
          user: liveUser,
          isAuthenticated: true,
          isInitializing: false,
          sessionStatus: 'authenticated',
          authNotice: null,
          networkError: null,
          storageError: null,
          adminChallenge: null,
          postAuthRoute: resolvedRoute,
        });

        return {
          status: 'authenticated',
          user: liveUser,
          nextRoute: resolvedRoute,
        };
      } catch (error) {
        if (
          sessionEpoch !== epochAtStart &&
          state.sessionStatus !== 'revoked' &&
          state.sessionStatus !== 'expired' &&
          state.sessionStatus !== 'uncertain_refresh'
        ) {
          return { status: 'aborted', user: state.user };
        }

        if (error?.isStorageError || error?.kind === 'storage') {
          accessToken = null;
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'storage_error',
            storageError: error.detail,
            networkError: error.detail,
          });
          return {
            status: 'storage_error',
            user: null,
            error,
          };
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
            storageError: null,
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
        if (inFlightRestorePromise === currentRestorePromise) {
          inFlightRestorePromise = null;
        }
      }
    })();

    inFlightRestorePromise = currentRestorePromise;
    return currentRestorePromise;
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
    inFlightRefreshPromise = null;
    inFlightRestorePromise = null;
    uncertainRefreshTokens.clear();

    const persisted = await writeRefreshTokenForEpoch(
      response.refreshToken,
      currentEpoch
    );

    if (!persisted || sessionEpoch !== currentEpoch) {
      return {
        status: 'aborted',
        user: null,
        nextRoute: null,
      };
    }

    accessToken = response.accessToken;

    let confirmedUser = registeredUser;
    emitState({
      user: confirmedUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      authNotice: null,
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: 'ProfileQuestionnaire',
    });

    // Confirmar sessão atual em /auth/me quando disponível, sem falhar o cadastro já persistido se /auth/me oscilar
    try {
      const meResponse = await client.get('/auth/me', {
        auth: true,
        retryOnUnauthorized: false,
        _retriedAfterRefresh: true,
        _requestEpoch: currentEpoch,
      });
      if (sessionEpoch === currentEpoch && meResponse?.id) {
        confirmedUser = sanitizePublicUser(meResponse);
        const resolvedRoute = confirmedUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';
        emitState({ user: confirmedUser, postAuthRoute: resolvedRoute });
      }
    } catch (meError) {
      if (meError?.status === 401 && sessionEpoch === currentEpoch) {
        await handleSessionInvalidated(meError, { targetEpoch: currentEpoch });
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
      const challengeEpoch = sessionEpoch;
      accessToken = null;
      inFlightRefreshPromise = null;
      inFlightRestorePromise = null;

      await clearRefreshTokenForEpoch(challengeEpoch);

      const challenge = {
        requires2FA: true,
        isTotpConfigured: Boolean(response.isTotpConfigured),
        message:
          typeof response.message === 'string' && response.message.trim().length > 0
            ? response.message
            : 'Esta conta administrativa exige confirmação de segundo fator (TOTP) para concluir o acesso.',
      };

      if (sessionEpoch === challengeEpoch) {
        emitState({
          user: null,
          isAuthenticated: false,
          isInitializing: false,
          sessionStatus: 'admin_2fa_required',
          authNotice: null,
          networkError: null,
          storageError: null,
          adminChallenge: challenge,
          postAuthRoute: null,
        });
      }

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
    inFlightRefreshPromise = null;
    inFlightRestorePromise = null;
    uncertainRefreshTokens.clear();

    const persisted = await writeRefreshTokenForEpoch(
      response.refreshToken,
      currentEpoch
    );

    if (!persisted || sessionEpoch !== currentEpoch) {
      return {
        status: 'aborted',
        user: null,
        nextRoute: null,
      };
    }

    accessToken = response.accessToken;

    let confirmedUser = loggedUser;
    const initialRoute = confirmedUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';
    emitState({
      user: confirmedUser,
      isAuthenticated: true,
      isInitializing: false,
      sessionStatus: 'authenticated',
      authNotice: null,
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: initialRoute,
    });

    // Confirmar dados atuais da conta em GET /auth/me
    try {
      const meResponse = await client.get('/auth/me', {
        auth: true,
        retryOnUnauthorized: false,
        _retriedAfterRefresh: true,
        _requestEpoch: currentEpoch,
      });
      if (sessionEpoch === currentEpoch && meResponse?.id) {
        confirmedUser = sanitizePublicUser(meResponse);
        const resolvedRoute = confirmedUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';
        emitState({ user: confirmedUser, postAuthRoute: resolvedRoute });
      }
    } catch (meError) {
      if (meError?.status === 401 && sessionEpoch === currentEpoch) {
        await handleSessionInvalidated(meError, { targetEpoch: currentEpoch });
        throw meError;
      }
    }

    const finalRoute = confirmedUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';
    return {
      status: 'authenticated',
      user: confirmedUser,
      nextRoute: finalRoute,
    };
  }

  /**
   * Logout real (POST /api/v1/auth/logout).
   * - Incrementa `sessionEpoch` imediatamente para impedir que requisições ou gravações antigas restaurem a sessão.
   * - Serializa a remoção do refresh token em `storageQueue` coordenada por `sessionEpoch`.
   * - Distingue revogação remota confirmada (`remoteRevoked: true`) de encerramento local sob falha de rede (`remoteRevoked: false`).
   */
  async function logout() {
    sessionEpoch += 1;
    const logoutEpoch = sessionEpoch;
    const tokenToRevoke = accessToken;
    accessToken = null;
    inFlightRefreshPromise = null;
    inFlightRestorePromise = null;

    emitState({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      sessionStatus: 'unauthenticated',
      authNotice: null,
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: null,
    });

    await clearRefreshTokenForEpoch(logoutEpoch);

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
        _requestEpoch: logoutEpoch,
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
      if (sessionEpoch === logoutEpoch) {
        emitState({
          authNotice: warning,
        });
      }

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
      storageError: null,
      adminChallenge: null,
    });
  }

  client.setAuthHandlers({
    getAccessToken,
    getSessionEpoch,
    onUnauthorized: async (ctx = {}) => {
      if (
        ctx.requestEpoch !== undefined &&
        ctx.requestEpoch !== null &&
        ctx.requestEpoch !== sessionEpoch
      ) {
        return null;
      }
      const epochBeforeRefresh = sessionEpoch;
      const refreshed = await refreshSession();
      if (sessionEpoch !== epochBeforeRefresh || !refreshed?.accessToken) {
        return null;
      }
      return refreshed.accessToken;
    },
    onSessionInvalidated: handleSessionInvalidated,
  });

  function markQuestionnaireCompleted() {
    emitState({
      user: state.user ? { ...state.user, hasCompletedQuestionnaire: true } : null,
      postAuthRoute: 'MainTabs',
    });
  }

  return {
    subscribe,
    getSnapshot,
    getAccessToken,
    getSessionEpoch,
    register,
    login,
    logout,
    refreshSession,
    restoreSession,
    fetchCurrentUser,
    markQuestionnaireCompleted,
    clearNotices,
    client,
    tokenStorage,
  };
}
