import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAuthSessionManager } from '../services/authService';
import { httpClient as defaultHttpClient } from '../services/httpClient';
import { defaultTokenStorage } from '../services/tokenStorage';

let syncDevicePushToken = () => Promise.resolve(null);
let unregisterDevicePushToken = () => Promise.resolve(false);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const push = require('../services/devicePushService');
  if (push) {
    syncDevicePushToken = push.syncDevicePushToken;
    unregisterDevicePushToken = push.unregisterDevicePushToken;
  }
} catch {
  // Fallback seguro em ambientes de teste isolados
}

let resetQueueCallAlerts = () => {};
let setupQueueCallNotificationHandlers = () => Promise.resolve(null);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vib = require('../services/queueCallVibrationService');
  if (vib) {
    resetQueueCallAlerts = vib.resetQueueCallAlerts;
    setupQueueCallNotificationHandlers = vib.setupQueueCallNotificationHandlers;
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

  // Sincroniza o token de push do aparelho quando autenticado
  useEffect(() => {
    if (snapshot.isAuthenticated && manager.client) {
      void syncDevicePushToken(manager.client);
    }
  }, [snapshot.isAuthenticated, manager.client]);

  const handleLogout = async () => {
    try {
      await unregisterDevicePushToken(manager.client);
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
