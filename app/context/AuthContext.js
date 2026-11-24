import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const adminBindings = useRef(new Map());
  const lifetime = useRef({ active: true });
  const isProviderActive = () => lifetime.current.active;
  useLayoutEffect(() => {
    const scope = lifetime.current;
    scope.active = true;
    const detach = manager.attachProvider?.(scope);
    return () => {
      scope.active = false;
      detach?.();
      // Strict Mode can immediately reattach this same provider.
      void Promise.resolve().then(() => {
        if (!scope.active) {
          adminBindings.current.forEach(binding => binding.sync());
          adminBindings.current.clear();
        }
      });
    };
  }, [manager]);
  function getAdminSession(kind, createBinding) {
    if (!isProviderActive()) return null;
    const bindings = adminBindings.current;
    if (!bindings.has(kind)) bindings.set(kind, createBinding(manager, isProviderActive));
    return bindings.get(kind).get();
  }

  const [snapshot, setSnapshot] = useState(() => manager.getSnapshot());

  useEffect(() => {
    const unsubscribe = manager.subscribe((nextState) => {
      if (!isProviderActive()) return;
      adminBindings.current.forEach(binding => binding.sync());
      setSnapshot(nextState);
    });
    if (autoRestore) {
      void manager.restoreSession();
    }
    return unsubscribe;
  }, [autoRestore, manager]);

  const contextValue = {
    user: snapshot.user,
    sessionId: snapshot.identityStatus === 'verified' ? snapshot.user?.sessionId ?? null : null,
    accessToken: manager.getAccessToken(),
    getAccessToken: manager.getAccessToken,
    getSessionEpoch: manager.getSessionEpoch,
    getIdentityRevision: manager.getIdentityRevision,
    isIdentityVerified: manager.isIdentityVerified,
    isAuthenticated: snapshot.isAuthenticated,
    isInitializing: snapshot.isInitializing,
    sessionStatus: snapshot.sessionStatus,
    identityStatus: snapshot.identityStatus,
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
    logout: manager.logout,
    refreshSession: manager.refreshSession,
    restoreSession: manager.restoreSession,
    fetchCurrentUser: manager.fetchCurrentUser,
    refreshUser: manager.fetchCurrentUser,
    markQuestionnaireCompleted: manager.markQuestionnaireCompleted,
    clearNotices: manager.clearNotices,
    httpClient: manager.client,
    getAdminStaffSession: createBinding => getAdminSession('staff', createBinding),
    getAdminOperationSession: createBinding => getAdminSession('operation', createBinding),
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = typeof useContext === 'function' ? useContext(AuthContext) : null;
  return context;
}
