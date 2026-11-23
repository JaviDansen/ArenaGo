import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminEventPanelError, getAdminEvent, getAdminEventReadiness } from '../../services/adminEventsService';
import { adminReadOwner } from './useAdminEvents';

export default function useAdminEventPanel(navigation, eventId, includeReadiness = true) {
  const auth = useAuth();
  const owner = adminReadOwner(auth);
  const client = auth.httpClient;
  const scope = useMemo(() => ({}), [owner, client, eventId, includeReadiness]);
  const live = useRef(scope);
  live.current = scope;
  const liveAuth = useRef(auth);
  liveAuth.current = auth;
  const control = useRef(null);
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!owner) return undefined;
    let subscribed = true;
    let request = null;
    const current = () => subscribed && live.current === scope && adminReadOwner(liveAuth.current) === owner && navigation.isFocused();
    async function refresh(manual = false, supersede = false) {
      if (!current() || (request && !supersede)) return;
      const ticket = {};
      request = ticket;
      setSnapshot({ scope, pending: true, refreshing: manual });
      const [detail, readiness] = await Promise.allSettled([
        getAdminEvent(client, eventId),
        includeReadiness ? getAdminEventReadiness(client, eventId) : null,
      ]);
      if (!current() || request !== ticket) return;
      request = null;
      const errors = [detail, readiness].filter(result => result.status === 'rejected').map(result => result.reason);
      // Denial in either request invalidates the entire view, including partial success.
      const blocked = errors.find(error => [401, 403].includes(error?.status)) ?? errors.find(error => error?.status === 404);
      if (blocked) {
        setSnapshot({ scope, blocked: adminEventPanelError(blocked) });
        return;
      }
      setSnapshot({ scope,
        event: detail.value,
        readiness: readiness.value,
        detailError: detail.status === 'rejected' ? adminEventPanelError(detail.reason) : null,
        readinessError: readiness.status === 'rejected' ? adminEventPanelError(readiness.reason) : null,
      });
    }
    const onFocus = () => { void refresh(); };
    const unsubscribeFocus = navigation.addListener('focus', onFocus);
    const unsubscribeBlur = navigation.addListener('blur', () => { request = null; });
    control.current = { scope, refresh };
    onFocus();
    return () => {
      subscribed = false;
      control.current = null;
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation, owner, client, eventId, includeReadiness, scope]);

  return {
    ...(owner && snapshot?.scope === scope ? snapshot : { pending: true }),
    refresh(manual = false, supersede = false) {
      if (control.current?.scope === scope) return control.current.refresh(manual, supersede);
    },
  };
}
