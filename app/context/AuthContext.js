import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAuthSessionManager } from '../services/authService';
import { httpClient as defaultHttpClient } from '../services/httpClient';
import { defaultTokenStorage } from '../services/tokenStorage';

let syncDevicePushToken = () => Promise.resolve(null);
let unregisterDevicePushToken = () => Promise.resolve(false);
let cancelPendingPushTokenSync = () => {};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const push = require('../services/devicePushService');
  if (push) {
    syncDevicePushToken = push.syncDevicePushToken ?? syncDevicePushToken;
    unregisterDevicePushToken = push.unregisterDevicePushToken ?? unregisterDevicePushToken;
    cancelPendingPushTokenSync = push.cancelPendingPushTokenSync ?? cancelPendingPushTokenSync;
  }
} catch {
  // Fallback seguro em ambientes de teste isolados
}

let resetQueueCallAlerts = () => {};
let setupQueueCallNotificationHandlers = () => Promise.resolve(null);
let setActiveQueueCallUser = () => Promise.resolve();
let clearActiveQueueCallUser = () => Promise.resolve();
let setQueueCallStateValidator = () => {};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vib = require('../services/queueCallVibrationService');
  if (vib) {
    resetQueueCallAlerts = vib.resetQueueCallAlerts ?? resetQueueCallAlerts;
    setupQueueCallNotificationHandlers =
      vib.setupQueueCallNotificationHandlers ?? setupQueueCallNotificationHandlers;
    setActiveQueueCallUser = vib.setActiveQueueCallUser ?? setActiveQueueCallUser;
    clearActiveQueueCallUser = vib.clearActiveQueueCallUser ?? clearActiveQueueCallUser;
    setQueueCallStateValidator = vib.setQueueCallStateValidator ?? setQueueCallStateValidator;
  }
} catch {
  // Fallback seguro em ambientes de teste isolados
}

export const AuthContext = createContext(null);

export function AuthProvider({
  children,
  client = defaultHttpClient,
  tokenStorage = defaultTokenStorage,
  sessionManager: externalManager = null,
  autoRestore = true,
}) {
  const managerRef = useRef(null);
  if (!managerRef.current) {
    managerRef.current =
      externalManager ??
      createAuthSessionManager({
        client,
        tokenStorage,
      });
  }
  const manager = managerRef.current;

  const [snapshot, setSnapshot] = useState(() => manager.getSnapshot());

  useEffect(() => {
    const unsubscribe = manager.subscribe((nextState) => {
      setSnapshot(nextState);
    });
    if (autoRestore) {
      void manager.restoreSession();
    }
    return unsubscribe;
  }, [autoRestore, manager]);

  // Inicializa manipulador silencioso e background task de notificações
  useEffect(() => {
    let subscription = null;
    void setupQueueCallNotificationHandlers().then((sub) => {
      subscription = sub;
    });
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  // Sincroniza o token de push e o isolamento de sessão por usuário autenticado
  useEffect(() => {
    const currentUserId = snapshot.user?.id;
    const currentEpoch =
      typeof manager.getSessionEpoch === 'function' ? manager.getSessionEpoch() : null;

    if (snapshot.isAuthenticated && currentUserId && manager.client) {
      const isCurrentSession = () => {
        const latest = manager.getSnapshot();
        const latestEpoch =
          typeof manager.getSessionEpoch === 'function' ? manager.getSessionEpoch() : null;
        return (
          Boolean(latest.isAuthenticated) &&
          latest.user?.id === currentUserId &&
          latestEpoch === currentEpoch
        );
      };

      void setActiveQueueCallUser(currentUserId, {
        shouldAbort: () => !isCurrentSession(),
      });

      setQueueCallStateValidator(async (payload) => {
        if (!payload?.participationId || typeof manager.client?.get !== 'function') {
          return 'unknown';
        }
        const token =
          typeof manager.getAccessToken === 'function' ? manager.getAccessToken() : null;
        if (!token) {
          return 'unknown';
        }
        try {
          const queueResponse = await manager.client.get(
            `/participations/${payload.participationId}/queue`,
            { auth: true }
          );
          const entry = queueResponse?.currentQueueEntry;
          if (
            !entry ||
            entry.status !== 'called' ||
            entry.serviceSession?.id !== payload.serviceSessionId ||
            entry.serviceSession?.status !== 'pending'
          ) {
            return 'ended';
          }
          return 'pending';
        } catch (err) {
          if (err?.status === 404 || err?.status === 403 || err?.status === 409) {
            return 'ended';
          }
          return 'unknown';
        }
      });

      void syncDevicePushToken(manager.client, {
        userId: currentUserId,
        accessToken:
          typeof manager.getAccessToken === 'function' ? manager.getAccessToken() : null,
        getSessionEpoch: manager.getSessionEpoch,
        isCurrent: isCurrentSession,
      });
    } else if (!snapshot.isInitializing && !snapshot.isAuthenticated) {
      cancelPendingPushTokenSync();
      setQueueCallStateValidator(null);
      void clearActiveQueueCallUser();
    }
  }, [snapshot.isAuthenticated, snapshot.isInitializing, snapshot.user?.id, manager]);

  const handleLogout = async () => {
    const logoutAccessToken =
      typeof manager.getAccessToken === 'function' ? manager.getAccessToken() : null;
    cancelPendingPushTokenSync();
    setQueueCallStateValidator(null);
    try {
      await unregisterDevicePushToken(manager.client, {
        accessToken: logoutAccessToken,
      });
    } catch {
      // Ignora erro de rede ao desvincular o token
    }
    resetQueueCallAlerts();
    return manager.logout();
  };

  const contextValue = {
    user: snapshot.user,
    accessToken: manager.getAccessToken(),
    getAccessToken: manager.getAccessToken,
    getSessionEpoch: manager.getSessionEpoch,
    isAuthenticated: snapshot.isAuthenticated,
    isInitializing: snapshot.isInitializing,
    sessionStatus: snapshot.sessionStatus,
    authNotice: snapshot.authNotice,
    networkError: snapshot.networkError,
    storageError: snapshot.storageError,
    adminChallenge: snapshot.adminChallenge,
    postAuthRoute: snapshot.postAuthRoute,
    isPersistentStorage: snapshot.isPersistentStorage,
    register: manager.register,
    login: manager.login,
    verifyAdminTwoFactor: manager.verifyAdminTwoFactor,
    cancelAdminTwoFactor: manager.cancelAdminTwoFactor,
    logout: handleLogout,
    refreshSession: manager.refreshSession,
    restoreSession: manager.restoreSession,
    fetchCurrentUser: manager.fetchCurrentUser,
    refreshUser: manager.fetchCurrentUser,
    markQuestionnaireCompleted: manager.markQuestionnaireCompleted,
    clearNotices: manager.clearNotices,
    httpClient: manager.client,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = typeof useContext === 'function' ? useContext(AuthContext) : null;
  return context;
}
