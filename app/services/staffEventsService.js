const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['scheduled', 'open', 'closing', 'closed']);
const PHASES = new Set(['scheduled', 'open', 'closing', 'closed', 'not_ready']);

export function parseStaffEvents(body) {
  if (!body || !Array.isArray(body.events)) throw new Error('Resposta inválida de eventos Staff.');
  const ids = new Set();
  return body.events.map((event) => {
    if (!event || typeof event.id !== 'string' || !UUID.test(event.id) || ids.has(event.id.toLowerCase()) ||
        typeof event.name !== 'string' || !event.name.trim() || !STATUSES.has(event.status) ||
        (event.effectivePhase !== undefined && !PHASES.has(event.effectivePhase))) {
      throw new Error('Resposta inválida de eventos Staff.');
    }
    ids.add(event.id.toLowerCase());
    return { id: event.id, name: event.name, status: event.status,
      ...(event.effectivePhase === undefined ? {} : { effectivePhase: event.effectivePhase }) };
  });
}

export async function fetchStaffEvents(client) {
  return parseStaffEvents(await client.get('/staff/events', { auth: true }));
}

const empty = () => ({ identity: null, status: 'idle', events: [], selected: null, error: null });
const sameIdentity = (a, b) => Boolean(a && b && a.userId === b.userId &&
  a.epoch === b.epoch && a.revision === b.revision);
const eventsErrorKind = (error) => (
  error?.status === 401
    ? 'session'
    : error?.status === 403
      ? 'denied'
      : (error?.isNetworkError || error?.isTimeout)
        ? 'network'
        : 'unavailable'
);
const isRecoverableEventsError = (kind) => kind === 'network' || kind === 'unavailable';

// A identidade é consultada novamente antes de publicar cada resposta ou aceitar uma seleção.
export function createStaffEventsStore({ client, getIdentity }) {
  let state = empty();
  let generation = 0;
  let silentFlight = false;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const isCurrent = (identity = state.identity) => sameIdentity(identity, state.identity) &&
    sameIdentity(identity, getIdentity());

  function setIdentity(identity) {
    generation += 1;
    silentFlight = false;
    publish(identity ? { ...empty(), identity, status: 'loading' } : empty());
  }

  async function refresh() {
    const identity = state.identity;
    if (!isCurrent(identity)) return;
    const requestGeneration = ++generation;
    silentFlight = false;
    publish({ ...state, status: 'loading', events: [], selected: null, error: null });
    try {
      const events = await fetchStaffEvents(client);
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      publish({ ...state, status: 'ready', events, selected: null, error: null });
    } catch (error) {
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      const kind = eventsErrorKind(error);
      publish({ ...state, status: 'error', events: [], selected: null, error: kind });
    }
  }

  async function refreshSilent() {
    const canRetry = state.status === 'error' && isRecoverableEventsError(state.error);
    if (silentFlight || !isCurrent() || (state.status !== 'ready' && !canRetry)) return;
    const identity = state.identity, requestGeneration = generation, wasReady = state.status === 'ready';
    silentFlight = true;
    try {
      const events = await fetchStaffEvents(client);
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      const selected = state.selected ? events.find(item => item.id === state.selected.id) ?? null : null;
      publish({ ...state, status: 'ready', events, selected, error: null });
    } catch (error) {
      if (requestGeneration !== generation || !isCurrent(identity)) return;
      const kind = eventsErrorKind(error);
      if (kind === 'session' || kind === 'denied') {
        publish({ ...state, events: [], selected: null, status: 'error', error: kind });
      } else if (wasReady) {
        publish({ ...state, error: 'stale' });
      } else {
        publish({ ...state, status: 'error', events: [], selected: null, error: kind });
      }
    } finally {
      if (requestGeneration === generation) silentFlight = false;
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
    setIdentity, refresh, refreshSilent, select, clearSelection, isCurrent };
}
