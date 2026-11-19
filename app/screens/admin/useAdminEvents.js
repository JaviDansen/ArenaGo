import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { canAccessAdminArea } from '../../context/adminAccess';
import { createAdminEventsLoader } from '../../services/adminEventsService';

export function adminReadOwner(auth) {
  if (!canAccessAdminArea(auth)) return null;
  return `${auth.user.id}:${auth.user.sessionId}:${auth.getSessionEpoch?.()}:${auth.getIdentityRevision?.()}`;
}
export default function useAdminEvents(search, phase) {
  const auth = useAuth(), owner = adminReadOwner(auth);
  const live = useRef(auth); live.current = auth;
  const loader = useMemo(() => createAdminEventsLoader(auth.httpClient, {
    isCurrent: () => Boolean(owner && adminReadOwner(live.current) === owner),
  }), [auth.httpClient, owner]);
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    loader.activate();
    const unsubscribe = loader.subscribe(value => setSnapshot({ owner, loader, value }));
    return () => { unsubscribe(); loader.dispose(); };
  }, [loader, owner]);
  useEffect(() => { void loader.setFilters({ search, phase }); }, [loader, search, phase]);
  return { ...(snapshot?.loader === loader && snapshot.owner === owner && snapshot.value.queryKey === JSON.stringify({ search, phase }) ? snapshot.value :
    { items: [], nextCursor: null, status: 'loading', error: null }), loader };
}
