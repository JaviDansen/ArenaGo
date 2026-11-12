import { createContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { createParticipationStore } from '../services/participationService';
import { createEventAdmissionStore } from '../services/eventAdmissionService';

export const ParticipationContext = createContext(null);

export function ParticipationProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const getIdentity = () => {
    const value = authRef.current;
    return value?.isAuthenticated && value.user?.id && typeof value.getSessionEpoch === 'function'
      ? { userId: value.user.id, epoch: value.getSessionEpoch() } : null;
  };
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createParticipationStore({
      client: { get: (...args) => authRef.current.httpClient.get(...args) },
      getIdentity,
    });
  }
  const store = storeRef.current;
  const admissionRef = useRef(null);
  if (!admissionRef.current) {
    admissionRef.current = createEventAdmissionStore({
      client: { post: (...args) => authRef.current.httpClient.post(...args) },
      getIdentity,
      refreshParticipation: () => store.refresh(),
      getParticipationSnapshot: () => store.getSnapshot(),
    });
  }
  const admissionStore = admissionRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const [admissionSnapshot, setAdmissionSnapshot] = useState(admissionStore.getSnapshot());
  const userId = auth?.isAuthenticated ? auth.user?.id : null;
  const epoch = userId && typeof auth.getSessionEpoch === 'function' ? auth.getSessionEpoch() : null;

  useEffect(() => {
    const stopParticipation = store.subscribe(setSnapshot);
    const stopAdmission = admissionStore.subscribe(setAdmissionSnapshot);
    return () => { stopParticipation(); stopAdmission(); };
  }, [store, admissionStore]);
  useEffect(() => {
    const identity = userId && epoch !== null ? { userId, epoch } : null;
    store.setIdentity(identity);
    admissionStore.setIdentity(identity);
    if (userId && epoch !== null) void store.refresh();
    return () => { store.setIdentity(null); admissionStore.setIdentity(null); };
  }, [store, admissionStore, userId, epoch]);

  const current = userId && snapshot.userId === userId && snapshot.epoch === epoch;
  const participation = current ? (snapshot.participation ? { ...snapshot.participation, source: 'server' } : snapshot.demoParticipation) : null;
  const currentAdmission = userId && admissionSnapshot.userId === userId && admissionSnapshot.epoch === epoch;
  const value = {
    participation,
    returnState: current ? snapshot.returnState : null,
    status: current ? snapshot.status : userId ? 'loading' : 'idle',
    error: current ? snapshot.error : null,
    syncStale: current ? Boolean(snapshot.syncStale) : false,
    refreshParticipation: store.refresh,
    syncCurrentParticipation: store.syncCurrentSilent,
    setParticipation: store.setDemoParticipation,
    admission: currentAdmission ? admissionSnapshot : null,
    lookupEvent: admissionStore.lookup,
    confirmEventEntry: admissionStore.confirm,
    retryEntrySync: admissionStore.retrySync,
    isCurrentAdmission: admissionStore.isCurrent,
  };
  return <ParticipationContext.Provider value={value}>{children}</ParticipationContext.Provider>;
}
