import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAuthSessionManager } from '../services/authService';
import { httpClient as defaultHttpClient } from '../services/httpClient';
import { defaultTokenStorage } from '../services/tokenStorage';

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

  const contextValue = {
    user: snapshot.user,
    accessToken: manager.getAccessToken(),
    getAccessToken: manager.getAccessToken,
    isAuthenticated: snapshot.isAuthenticated,
    isInitializing: snapshot.isInitializing,
    sessionStatus: snapshot.sessionStatus,
    authNotice: snapshot.authNotice,
    networkError: snapshot.networkError,
    adminChallenge: snapshot.adminChallenge,
    postAuthRoute: snapshot.postAuthRoute,
    isPersistentStorage: snapshot.isPersistentStorage,
    register: manager.register,
    login: manager.login,
    logout: manager.logout,
    refreshSession: manager.refreshSession,
    restoreSession: manager.restoreSession,
    fetchCurrentUser: manager.fetchCurrentUser,
    refreshUser: manager.fetchCurrentUser,
    clearNotices: manager.clearNotices,
    httpClient: manager.client,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = typeof useContext === 'function' ? useContext(AuthContext) : null;
  return context;
}
