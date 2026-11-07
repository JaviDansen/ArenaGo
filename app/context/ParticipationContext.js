import { createContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { createParticipationStore } from '../services/participationService';

export const ParticipationContext = createContext(null);

export function ParticipationProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createParticipationStore({
      client: { get: (...args) => authRef.current.httpClient.get(...args) },
      getIdentity: () => {
        const value = authRef.current;
        return value?.isAuthenticated && value.user?.id && typeof value.getSessionEpoch === 'function'
          ? { userId: value.user.id, epoch: value.getSessionEpoch() } : null;
      },
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const userId = auth?.isAuthenticated ? auth.user?.id : null;
  const epoch = userId && typeof auth.getSessionEpoch === 'function' ? auth.getSessionEpoch() : null;

  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    store.setIdentity(userId && epoch !== null ? { userId, epoch } : null);
    if (userId && epoch !== null) void store.refresh();
    return () => store.setIdentity(null);
  }, [store, userId, epoch]);

  const current = userId && snapshot.userId === userId && snapshot.epoch === epoch;
  const participation = current ? (snapshot.participation ? { ...snapshot.participation, source: 'server' } : snapshot.demoParticipation) : null;
  const value = {
    participation,
    returnState: current ? snapshot.returnState : null,
    status: current ? snapshot.status : userId ? 'loading' : 'idle',
    error: current ? snapshot.error : null,
    refreshParticipation: store.refresh,
    setParticipation: store.setDemoParticipation,
  };
  return <ParticipationContext.Provider value={value}>{children}</ParticipationContext.Provider>;
}
