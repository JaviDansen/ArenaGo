import { ApiError, createHttpClient, httpClient as defaultHttpClient } from './httpClient';
import { defaultTokenStorage } from './tokenStorage';

// Gravado antes do POST: uma interrupção nunca deixa o token consumido no disco.
// O prefixo não pertence ao formato dos tokens opacos emitidos pelo backend.
const REFRESH_PENDING_MARKER = '!arenago-refresh-pending-v1';

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
  if (!rawUser || typeof rawUser !== 'object' || !Array.isArray(rawUser.roles) ||
      rawUser.roles.length === 0 ||
      !rawUser.roles.every((role) => ['admin', 'staff', 'participante'].includes(role))) {
    return null;
  }
  return {
    id: String(rawUser.id || ''),
    name: String(rawUser.name || ''),
    email: String(rawUser.email || ''),
    emailVerified: Boolean(rawUser.emailVerified),
    roles: [...rawUser.roles],
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
  let inFlightTwoFactorPromise = null;
  let identityRequestGeneration = 0;
  let identityRevision = 0;
  let pendingRotation = null;
  let privateAdminChallenge = null;
  let challengeTimer = null;
  const now = options.now ?? Date.now;
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
    identityStatus: 'unverified',
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
    if (patch.identityStatus && patch.identityStatus !== state.identityStatus &&
        patch.identityStatus !== 'verified') identityRevision += 1;
    if (patch.isAuthenticated === false && state.isAuthenticated) identityRevision += 1;
    if (patch.isInitializing === true && !state.isInitializing) identityRevision += 1;
    if (patch.user && state.user && (patch.user.id !== state.user.id ||
        [...(patch.user.roles || [])].sort().join('|') !== [...(state.user.roles || [])].sort().join('|'))) {
      identityRevision += 1;
    }
    state = Object.freeze({
      ...state,
      ...patch,
      ...(patch.isAuthenticated === false && !Object.prototype.hasOwnProperty.call(patch, 'identityStatus')
        ? { identityStatus: 'unverified' } : {}),
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

  function getIdentityRevision() { return identityRevision; }
  function isIdentityVerified() {
    return state.isAuthenticated && !state.isInitializing && state.identityStatus === 'verified';
  }

  function clearAdminChallenge({ resetFlight = true } = {}) {
    privateAdminChallenge = null;
    if (resetFlight) inFlightTwoFactorPromise = null;
    if (challengeTimer !== null) clearTimeout(challengeTimer);
    challengeTimer = null;
  }

  function cancelAdminTwoFactor(reason = 'cancelled') {
    if (!privateAdminChallenge && !state.adminChallenge &&
        !['authenticating', 'admin_2fa_verifying'].includes(state.sessionStatus)) return Promise.resolve();
    sessionEpoch += 1;
    pendingRotation = null;
    const cancellationEpoch = sessionEpoch;
    clearAdminChallenge();
    accessToken = null;
    emitState({ user: null, isAuthenticated: false, isInitializing: false,
      sessionStatus: 'unauthenticated', adminChallenge: null, postAuthRoute: null,
      authNotice: reason === 'expired' ? 'A verificação expirou. Entre novamente para obter outro desafio.' : null,
      networkError: null, storageError: null });
    // Atualiza imediatamente a intenção de armazenamento, inclusive se uma gravação estiver pausada.
    return clearRefreshTokenForEpoch(cancellationEpoch).catch(() => {
      if (sessionEpoch === cancellationEpoch) emitState({ sessionStatus: 'storage_error',
        storageError: 'Não foi possível limpar as credenciais locais. Tente encerrar a sessão novamente.' });
    });
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
    pendingRotation = null;
    const invalidationEpoch = sessionEpoch;
    clearAdminChallenge();
    accessToken = null;
    inFlightRefreshPromise = null;

    // Retira as rotas imediatamente; o armazenamento seguro pode demorar.
    const nextStatus = error?.code === 'SESSION_EXPIRED' ? 'expired' : 'revoked';
    emitState({
      user: null, isAuthenticated: false, isInitializing: false,
      sessionStatus: nextStatus, authNotice: resolveInvalidationNotice(error),
      networkError: null, storageError: null, adminChallenge: null, postAuthRoute: null,
    });

    try {
      await clearRefreshTokenForEpoch(invalidationEpoch);
    } catch {
      // Ignora erro de limpeza local
    }

    if (sessionEpoch !== invalidationEpoch) {
      return;
    }

  }

  /**
   * Renovação coordenada (single-flight) do par de tokens via POST /api/v1/auth/refresh.
   * Chamadas concorrentes dentro da mesma geração de sessão aguardam a mesma Promise.
   */
  function refreshSession() {
    if (privateAdminChallenge || state.adminChallenge || state.sessionStatus === 'authenticating') return Promise.resolve(null);
    if (inFlightRefreshPromise) {
      return inFlightRefreshPromise;
    }

    const epochAtStart = sessionEpoch;
    let refreshConfirmed = false;
    identityRequestGeneration += 1;
    emitState({ identityStatus: 'checking' });

    const currentRefreshPromise = (async () => {
      try {
        if (pendingRotation?.epoch === epochAtStart) {
          const pending = pendingRotation;
          try {
            const saved = await writeRefreshTokenForEpoch(pending.refreshToken, epochAtStart);
            if (!saved || sessionEpoch !== epochAtStart) return null;
          } catch (error) {
            if (sessionEpoch !== epochAtStart) return null;
            emitState({ identityStatus: 'error', isInitializing: false,
              sessionStatus: 'identity_error', storageError: 'Não foi possível salvar a sessão renovada.',
              networkError: 'Não foi possível salvar a sessão renovada. Tente novamente.' });
            throw error;
          }
          if (sessionEpoch !== epochAtStart) return null;
          accessToken = pending.accessToken;
          pendingRotation = null;
          const user = await fetchCurrentUser({ retryOnUnauthorized: false, fromRefresh: true });
          if (sessionEpoch !== epochAtStart || !user) return null;
          return { accessToken: pending.accessToken, refreshToken: pending.refreshToken,
            expiresIn: pending.expiresIn, user };
        }
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
          (storedRefreshToken && (storedRefreshToken === REFRESH_PENDING_MARKER || uncertainRefreshTokens.has(storedRefreshToken))) ||
          (!storedRefreshToken && state.sessionStatus === 'uncertain_refresh')
        ) {
          sessionEpoch += 1;
          const blockedEpoch = sessionEpoch;
          accessToken = null;
          pendingRotation = null;
          emitState({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            sessionStatus: 'uncertain_refresh',
            authNotice:
              state.authNotice ||
              'A tentativa anterior de renovar a sessão falhou sem confirmação do servidor. Por segurança, faça login novamente.',
          });
          if (storedRefreshToken) {
            try {
              await clearRefreshTokenForEpoch(blockedEpoch);
            } catch {
              // O marcador persistente continua impedindo o reenvio.
            }
          }
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

        // Sem esse registro prévio, um encerramento após o POST e antes da
        // gravação do novo token poderia reenviar o token já consumido.
        const marked = await writeRefreshTokenForEpoch(REFRESH_PENDING_MARKER, epochAtStart);
        if (!marked || sessionEpoch !== epochAtStart) return null;

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
            typeof response.accessToken !== 'string' || !response.accessToken.trim() ||
            typeof response.refreshToken !== 'string' || !response.refreshToken.trim() ||
            response.refreshToken === storedRefreshToken || response.refreshToken === REFRESH_PENDING_MARKER
          ) {
            throw new ApiError({
              kind: 'http',
              status: 500,
              code: 'INVALID_REFRESH_RESPONSE',
              title: 'Resposta inválida do servidor',
              detail: 'Não foi possível validar os novos tokens de sessão.',
            });
          }

          refreshConfirmed = true;
          pendingRotation = { epoch: epochAtStart, accessToken: response.accessToken,
            refreshToken: response.refreshToken, expiresIn: response.expiresIn };

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
          pendingRotation = null;

          // A resposta de refresh não contém papéis. Confirme-os com o novo token
          // antes de liberar a requisição que provocou a renovação.
          const liveUser = await fetchCurrentUser({ retryOnUnauthorized: false, fromRefresh: true });
          if (sessionEpoch !== epochAtStart || !liveUser) return null;

          return {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: response.expiresIn,
            user: liveUser,
          };
        } catch (error) {
          if (sessionEpoch !== epochAtStart) {
            return null;
          }
          // Falhas na leitura de identidade após a rotação confirmada não são
          // falhas incertas do POST e não devem apagar a credencial recém-gravada.
          if (refreshConfirmed) {
            if (pendingRotation?.epoch === epochAtStart) {
              emitState({ identityStatus: 'error', isInitializing: false, sessionStatus: 'identity_error',
                storageError: 'Não foi possível salvar a sessão renovada.',
                networkError: 'Não foi possível salvar a sessão renovada. Tente novamente.' });
            }
            throw error;
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

          // Somente uma falha comprovadamente anterior ao envio permite restaurar
          // o token original. Nos demais casos o marcador impede seu reuso.
          if (error?.isNetworkError && error?.cause?.requestNotSent === true) {
            await writeRefreshTokenForEpoch(storedRefreshToken, epochAtStart);
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
        if (sessionEpoch === epochAtStart && state.identityStatus === 'checking') {
          if (accessToken || state.isAuthenticated) {
            emitState({ identityStatus: 'error', isInitializing: false,
              sessionStatus: 'identity_error', networkError: 'Não foi possível confirmar sua sessão.' });
          } else {
            emitState({ identityStatus: 'unverified' });
          }
        }
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
    if (inFlightRefreshPromise && !options.fromRefresh) {
      const refreshed = await inFlightRefreshPromise;
      return sessionEpoch === epochAtStart && refreshed ? refreshed.user : null;
    }
    const requestGeneration = ++identityRequestGeneration;
    const isCurrent = () => sessionEpoch === epochAtStart && requestGeneration === identityRequestGeneration;
    try {
      // O retry de /me é coordenado aqui: o refresh faz sua própria consulta,
      // evitando dependência circular entre /me e a renovação single-flight.
      const meResponse = await client.get('/auth/me', {
        auth: true, retryOnUnauthorized: false, _requestEpoch: epochAtStart,
      });
      if (!isCurrent()) return null;
      const liveUser = sanitizePublicUser(meResponse);
      if (!liveUser?.id || (state.user?.id && state.user.id !== liveUser.id)) {
        throw new ApiError({ kind: 'http', status: 500, code: 'INVALID_ME_RESPONSE',
          title: 'Resposta inválida', detail: 'Não foi possível validar os dados da conta autenticada.' });
      }
      if (state.user?.id === liveUser.id && state.user?.hasCompletedQuestionnaire === true) {
        liveUser.hasCompletedQuestionnaire = true;
      }
      emitState({ user: liveUser, isAuthenticated: true, isInitializing: false,
        identityStatus: 'verified', sessionStatus: 'authenticated',
        postAuthRoute: liveUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire',
        networkError: null, storageError: null });
      return liveUser;
    } catch (error) {
      if (!isCurrent()) return null;
      if (error?.status === 401) {
        const terminal = ['SESSION_REVOKED', 'SESSION_EXPIRED', 'REFRESH_TOKEN_REUSED',
          'INVALID_REFRESH_TOKEN', 'ACCOUNT_DEACTIVATED'].includes(error.code);
        if (!terminal && options.retryOnUnauthorized !== false && !options._retriedAfterRefresh) {
          const refreshed = await refreshSession();
          return sessionEpoch === epochAtStart && refreshed ? refreshed.user : null;
        }
        await handleSessionInvalidated(error, { targetEpoch: epochAtStart });
        throw error;
      }
      emitState({ identityStatus: 'error', isInitializing: false, sessionStatus: 'identity_error',
        networkError: 'Não foi possível confirmar os dados da sessão. Tente novamente.' });
      throw error;
    }
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
    if (privateAdminChallenge || state.adminChallenge || state.sessionStatus === 'authenticating') {
      return Promise.resolve({ status: state.sessionStatus, user: null });
    }
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

        let liveUser;
        if (!accessToken || pendingRotation?.epoch === epochAtStart || storedRefreshToken === REFRESH_PENDING_MARKER) {
          const refreshed = await refreshSession();
          if (sessionEpoch !== epochAtStart || !refreshed) {
            const status = ['revoked', 'expired', 'uncertain_refresh'].includes(state.sessionStatus)
              ? state.sessionStatus : 'aborted';
            return { status, user: state.user };
          }
          liveUser = refreshed.user;
        } else {
          liveUser = await fetchCurrentUser();
        }

        if (sessionEpoch !== epochAtStart || !liveUser) {
          return { status: 'aborted', user: state.user };
        }

        const resolvedRoute = liveUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';

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

        if (state.identityStatus === 'error') {
          return { status: 'identity_error', user: null, error };
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
    if (privateAdminChallenge || state.adminChallenge || state.sessionStatus === 'authenticating') cancelAdminTwoFactor();
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
    pendingRotation = null;
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
      identityStatus: 'verified',
      authNotice: null,
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: 'ProfileQuestionnaire',
    });

    // A confirmação usa a mesma geração de todas as demais leituras de identidade.
    try {
      confirmedUser = (await fetchCurrentUser({ retryOnUnauthorized: false })) ?? state.user;
    } catch (meError) {
      if (meError?.status === 401) throw meError;
    }

    if (sessionEpoch !== currentEpoch) return { status: 'aborted', user: null, nextRoute: null };

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
    // Invalida a tentativa anterior antes de qualquer await, inclusive verificações 2FA em trânsito.
    sessionEpoch += 1;
    pendingRotation = null;
    const currentEpoch = sessionEpoch;
    const startedAt = now();
    clearAdminChallenge();
    accessToken = null;
    inFlightRefreshPromise = null;
    inFlightRestorePromise = null;
    emitState({ user: null, isAuthenticated: false, isInitializing: false,
      sessionStatus: 'authenticating', adminChallenge: null, postAuthRoute: null,
      authNotice: null, networkError: null, storageError: null });
    const payload = {
      email: typeof input?.email === 'string' ? input.email.trim() : '',
      password: typeof input?.password === 'string' ? input.password : '',
    };

    let response;
    try {
      await clearRefreshTokenForEpoch(currentEpoch);
      if (sessionEpoch !== currentEpoch) return { status: 'aborted' };
      response = await client.post('/auth/login', payload, {
        auth: false,
        retryOnUnauthorized: false,
      });
    } catch (error) {
      if (sessionEpoch !== currentEpoch) return { status: 'aborted' };
      emitState({ sessionStatus: 'unauthenticated' });
      throw error;
    }
    if (sessionEpoch !== currentEpoch) return { status: 'aborted' };

    // Caso Admin: backend retorna { requires2FA: true, isTotpConfigured, tempToken, message }.
    // NUNCA armazenar tempToken como accessToken ou refreshToken nem autenticar a sessão.
    if (response && response.requires2FA === true) {
      if (typeof response.tempToken !== 'string' || !response.tempToken.trim() ||
          response.tempToken.length > 2048 || typeof response.isTotpConfigured !== 'boolean') {
        emitState({ sessionStatus: 'unauthenticated' });
        throw new ApiError({ code: 'INVALID_LOGIN_RESPONSE',
          detail: 'O servidor não retornou um desafio válido. Entre novamente.' });
      }
      // O backend emite desafios de cinco minutos. A margem cobre o arredondamento do JWT;
      // o prazo começa antes da requisição, sem confiar em claims não verificadas no cliente.
      const expiresAt = startedAt + 299_000;
      if (now() >= expiresAt) {
        cancelAdminTwoFactor('expired');
        throw new ApiError({ code: 'ADMIN_2FA_CHALLENGE_EXPIRED', detail: 'A verificação expirou. Entre novamente.' });
      }
      privateAdminChallenge = { tempToken: response.tempToken, epoch: currentEpoch, expiresAt };

      const challenge = {
        requires2FA: true,
        isTotpConfigured: response.isTotpConfigured,
        expiresAt,
        message:
          typeof response.message === 'string' && response.message.trim().length > 0
            ? response.message
            : 'Esta conta administrativa exige confirmação de segundo fator (TOTP) para concluir o acesso.',
      };

      challengeTimer = setTimeout(() => {
        if (privateAdminChallenge?.epoch === currentEpoch) cancelAdminTwoFactor('expired');
      }, Math.max(0, expiresAt - now()));
      challengeTimer?.unref?.();
      if (sessionEpoch === currentEpoch) {
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

    return completeLogin(response, currentEpoch);
  }

  // Um único caminho publica sessões de senha (Participante/Staff) e de segundo fator (Admin).
  async function completeLogin(response, currentEpoch) {
    const loggedUser = sanitizePublicUser(response?.user);
    if (
      !loggedUser?.id ||
      typeof response?.accessToken !== 'string' ||
      !response.accessToken || typeof response?.refreshToken !== 'string' || !response.refreshToken
    ) {
      if (sessionEpoch === currentEpoch) emitState({ sessionStatus: 'unauthenticated' });
      throw new ApiError({
        kind: 'http',
        status: 500,
        code: 'INVALID_LOGIN_RESPONSE',
        title: 'Resposta inválida no login',
        detail: 'Não foi possível iniciar a sessão com a resposta recebida do servidor.',
      });
    }

    if (sessionEpoch !== currentEpoch) return { status: 'aborted', user: null, nextRoute: null };
    clearAdminChallenge({ resetFlight: false });
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
      identityStatus: 'verified',
      authNotice: null,
      networkError: null,
      storageError: null,
      adminChallenge: null,
      postAuthRoute: initialRoute,
    });

    // Confirmar dados atuais da conta em GET /auth/me
    try {
      confirmedUser = (await fetchCurrentUser({ retryOnUnauthorized: false })) ?? state.user;
    } catch (meError) {
      if (sessionEpoch !== currentEpoch) return { status: 'aborted', user: null, nextRoute: null };
      if (meError?.status === 401) throw meError;
    }

    if (sessionEpoch !== currentEpoch) return { status: 'aborted', user: null, nextRoute: null };
    if (!confirmedUser) return { status: 'aborted', user: null, nextRoute: null };
    const finalRoute = confirmedUser.hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire';
    return {
      status: 'authenticated',
      user: confirmedUser,
      nextRoute: finalRoute,
    };
  }

  function verifyAdminTwoFactor(code) {
    if (inFlightTwoFactorPromise) return inFlightTwoFactorPromise;
    const challenge = privateAdminChallenge;
    const epochAtStart = sessionEpoch;
    if (!challenge || challenge.epoch !== epochAtStart || now() >= challenge.expiresAt) {
      cancelAdminTwoFactor('expired');
      return Promise.reject(new ApiError({ code: 'ADMIN_2FA_CHALLENGE_EXPIRED',
        detail: 'A verificação expirou ou foi cancelada. Entre novamente.' }));
    }
    if (!state.adminChallenge?.isTotpConfigured) {
      return Promise.reject(new ApiError({ status: 409, code: 'ADMIN_TOTP_NOT_CONFIGURED',
        detail: 'Configure o TOTP pelo procedimento administrativo antes de entrar.' }));
    }
    if (typeof code !== 'string' || !/^(?:[0-9]{6}|[a-f0-9]{32})$/.test(code)) {
      return Promise.reject(new ApiError({ status: 400, code: 'VALIDATION_ERROR',
        detail: 'Informe um código TOTP de seis dígitos ou um código de recuperação válido.' }));
    }
    const pending = (async () => {
      emitState({ sessionStatus: 'admin_2fa_verifying' });
      try {
        const response = await client.post('/auth/2fa/verify', { tempToken: challenge.tempToken, code }, {
          auth: false, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true,
        });
        if (sessionEpoch !== epochAtStart || privateAdminChallenge !== challenge) return { status: 'aborted' };
        if (now() >= challenge.expiresAt) {
          cancelAdminTwoFactor('expired');
          return { status: 'aborted' };
        }
        // O servidor consumiu o desafio. A resposta passa pelo mesmo armazenamento e publicação do login.
        return await completeLogin(response, epochAtStart);
      } catch (error) {
        if (sessionEpoch !== epochAtStart) return { status: 'aborted' };
        const uncertain = error?.isNetworkError || error?.isTimeout || !Number.isInteger(error?.status) ||
          (error?.status >= 500 && error?.status !== 503) ||
          error?.code === 'INVALID_LOGIN_RESPONSE' || !privateAdminChallenge;
        if (uncertain || error?.status === 429 || now() >= challenge.expiresAt) {
          // Não repete automaticamente uma confirmação que pode ter consumido o desafio.
          const cleanup = cancelAdminTwoFactor(now() >= challenge.expiresAt ? 'expired' : 'cancelled');
          const cleanupEpoch = sessionEpoch;
          await cleanup;
          if (sessionEpoch !== cleanupEpoch) return { status: 'aborted' };
        } else if (error?.code === 'ADMIN_TOTP_NOT_CONFIGURED') {
          emitState({ sessionStatus: 'admin_2fa_required',
            adminChallenge: { ...state.adminChallenge, isTotpConfigured: false } });
        } else {
          emitState({ sessionStatus: 'admin_2fa_required' });
        }
        throw error;
      } finally {
        if (inFlightTwoFactorPromise === pending) inFlightTwoFactorPromise = null;
      }
    })();
    inFlightTwoFactorPromise = pending;
    return pending;
  }

  /**
   * Logout real (POST /api/v1/auth/logout).
   * - Incrementa `sessionEpoch` imediatamente para impedir que requisições ou gravações antigas restaurem a sessão.
   * - Serializa a remoção do refresh token em `storageQueue` coordenada por `sessionEpoch`.
   * - Distingue revogação remota confirmada (`remoteRevoked: true`) de encerramento local sob falha de rede (`remoteRevoked: false`).
   */
  async function logout() {
    sessionEpoch += 1;
    pendingRotation = null;
    const logoutEpoch = sessionEpoch;
    clearAdminChallenge();
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
    getIdentityRevision,
    isIdentityVerified,
    register,
    login,
    verifyAdminTwoFactor,
    cancelAdminTwoFactor,
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
