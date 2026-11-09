const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['scheduled', 'open', 'closing', 'closed']);

export function parseStaffEvents(body) {
  if (!body || !Array.isArray(body.events)) throw new Error('Resposta inválida de eventos Staff.');
  const ids = new Set();
  return body.events.map((event) => {
    if (!event || typeof event.id !== 'string' || !UUID.test(event.id) || ids.has(event.id.toLowerCase()) ||
        typeof event.name !== 'string' || !event.name.trim() || !STATUSES.has(event.status)) {
      throw new Error('Resposta inválida de eventos Staff.');
    }
    ids.add(event.id.toLowerCase());
    return { id: event.id, name: event.name, status: event.status };
  });
}

export async function fetchStaffEvents(client) {
  return parseStaffEvents(await client.get('/staff/events', { auth: true }));
}

const empty = () => ({ identity: null, status: 'idle', events: [], selected: null, error: null });
const sameIdentity = (a, b) => Boolean(a && b && a.userId === b.userId &&
  a.epoch === b.epoch && a.revision === b.revision);

// A identidade é consultada novamente antes de publicar cada resposta ou aceitar uma seleção.
export function createStaffEventsStore({ client, getIdentity }) {
  let state = empty();
  let generation = 0;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const isCurrent = (identity = state.identity) => sameIdentity(identity, state.identity) &&
    sameIdentity(identity, getIdentity());

  function setIdentity(identity) {
    generation += 1;
    publish(identity ? { ...empty(), identity, status: 'loading' } : empty());
  }

  async function refresh() {
    const identity = state.identity;
    if (!isCurrent(identity)) return;
    const requestGeneration = ++generation;
    publish({ ...state, status: 'loading', events: [], selected: null, error: null });
    try {
      const events = await fetchStaffEvents(client);
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      publish({ ...state, status: 'ready', events, selected: null, error: null });
    } catch (error) {
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      const kind = error?.status === 401 ? 'session' : error?.isNetworkError ? 'network' : 'unavailable';
      publish({ ...state, status: 'error', events: [], selected: null, error: kind });
    }
  }

  function select(eventId) {
    if (!isCurrent() || state.status !== 'ready') return false;
    const event = state.events.find((item) => item.id === eventId);
    if (!event) return false;
    publish({ ...state, selected: event });
    return true;
  }

  function clearSelection() {
    if (state.selected) publish({ ...state, selected: null });
  }

  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity, refresh, select, clearSelection, isCurrent };
}
