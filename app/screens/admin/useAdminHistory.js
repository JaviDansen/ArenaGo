import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminReadError } from '../../services/adminEventsService';
import { adminReadOwner } from './useAdminEvents';

export default function useAdminHistory(navigation, read, paginated = false) {
  const auth = useAuth();
  const owner = adminReadOwner(auth), client = auth.httpClient;
  const scope = useMemo(() => ({}), [owner, client, navigation, read, paginated]);
  const live = useRef(null), control = useRef(null);
  live.current = { scope, auth };
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!owner || !read) return undefined;
    let mounted = true, generation = 0, busy = false;
    let data = null, cursor = null, loadedPages = 0, seen = new Set(), failedMore = false;
    const current = () => mounted && live.current.scope === scope &&
      adminReadOwner(live.current.auth) === owner && navigation.isFocused();
    const publish = patch => setSnapshot({ scope, data, nextCursor: cursor, ...patch });

    async function load(more = false) {
      if (!current() || busy || (more && !cursor)) return;
      busy = true;
      const ticket = generation;
      const valid = () => current() && ticket === generation;
      publish({ pending: data === null, refreshing: !more && data !== null, loadingMore: more });
      try {
        if (!paginated) {
          const result = await read(client);
          if (!valid()) return;
          data = result;
        } else {
          const items = new Map((more ? data : []).map(item => [item.id, item]));
          const cursors = new Set(more ? seen : []);
          let next = more ? cursor : null, pages = more ? loadedPages : 0;
          // Rebuild the pages already visible after focus or manual refresh so
          // returning from a summary can keep the scroll position.
          const requestedPages = more ? 1 : Math.max(1, loadedPages);
          for (let i = 0; i < requestedPages; i++) {
            const result = await read(client, next);
            if (!valid()) return;
            next = result.nextCursor;
            if (next && cursors.has(next)) throw new Error('Cursor repetido.');
            if (next) cursors.add(next);
            for (const item of result.items) items.set(item.id, item);
            pages++;
            if (!next) break;
          }
          data = [...items.values()];
          cursor = next;
          seen = cursors;
          loadedPages = pages;
        }
        failedMore = false;
        publish({});
      } catch (error) {
        if (!valid()) return;
        const unavailable = [401, 403, 404].includes(error?.status);
        if (unavailable) {
          data = null;
          cursor = null;
          loadedPages = 0;
          seen = new Set();
        }
        failedMore = more && !unavailable;
        publish({ error: adminReadError(error), stale: data !== null });
      } finally {
        busy = false;
        if (ticket !== generation && current()) void load();
      }
    }

    const offFocus = navigation.addListener('focus', () => { void load(); });
    const offBlur = navigation.addListener('blur', () => { generation++; });
    control.current = { scope, load, retry: () => load(failedMore) };
    void load();
    return () => {
      mounted = false;
      offFocus();
      offBlur();
      if (control.current?.scope === scope) control.current = null;
    };
  }, [scope, owner, client, navigation, read, paginated]);

  return {
    ...(owner && snapshot?.scope === scope ? snapshot : { pending: Boolean(owner && read) }),
    refresh: () => control.current?.scope === scope && control.current.load(),
    more: () => control.current?.scope === scope && control.current.load(true),
    retry: () => control.current?.scope === scope && control.current.retry(),
  };
}
