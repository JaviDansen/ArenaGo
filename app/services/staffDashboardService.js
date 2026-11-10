import { fetchStaffExperiences, fetchStaffQueue, fetchStaffStations } from './staffOperationsService';

const same = (a, b) => Boolean(a && b && a.eventId === b.eventId && a.userId === b.userId &&
  a.epoch === b.epoch && a.revision === b.revision);
const empty = () => ({ context: null, stationStatus: 'idle', stations: [], stationError: null,
  experienceStatus: 'idle', experiences: [], experienceError: null,
  experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
const errorKind = (error) => error?.status === 401 ? 'session' :
  (error?.status === 403 || error?.status === 404) ? 'denied' : error?.isNetworkError ? 'network' : 'unavailable';

// O contexto é conferido novamente antes de publicar qualquer resultado.
export function createStaffDashboardStore({ client, getContext }) {
  let state = empty();
  let generation = 0;
  let stationGeneration = 0;
  let experienceGeneration = 0;
  let queueGeneration = 0;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const isCurrent = (candidate = state.context) => same(state.context, candidate) && same(state.context, getContext());
  function setContext(context) {
    generation += 1; stationGeneration += 1; experienceGeneration += 1; queueGeneration += 1;
    publish(context ? { ...empty(), context, stationStatus: 'loading', experienceStatus: 'loading' } : empty());
  }
  function denied(kind = 'denied') {
    stationGeneration += 1; experienceGeneration += 1; queueGeneration += 1;
    publish({ ...state, stationStatus: 'error', stationError: kind, stations: [],
      experienceStatus: 'error', experienceError: kind, experiences: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
  }
  async function refreshExperiences() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++experienceGeneration;
    queueGeneration += 1;
    publish({ ...state, experienceStatus: 'loading', experienceError: null, experiences: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
    try {
      const { experiences } = await fetchStaffExperiences(client, context.eventId);
      if (revision !== generation || request !== experienceGeneration || !isCurrent()) return;
      publish({ ...state, experienceStatus: 'ready', experiences });
    } catch (error) {
      if (revision !== generation || request !== experienceGeneration || !isCurrent()) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      publish({ ...state, experienceStatus: 'error', experienceError: kind, experiences: [] });
    }
  }
  async function refreshStations() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++stationGeneration;
    queueGeneration += 1;
    publish({ ...state, stationStatus: 'loading', stationError: null, stations: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
    try {
      const { stations } = await fetchStaffStations(client, context.eventId);
      if (revision !== generation || request !== stationGeneration || !isCurrent()) return;
      publish({ ...state, stationStatus: 'ready', stations });
    } catch (error) {
      if (revision !== generation || request !== stationGeneration || !isCurrent()) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      publish({ ...state, stationStatus: 'error', stationError: kind, stations: [] });
    }
  }
  async function refreshQueue(experienceId = state.experienceId) {
    if (!isCurrent() || state.stationStatus !== 'ready' ||
        !state.stations.some((station) => station.experienceId === experienceId)) return;
    const context = state.context, revision = generation, request = ++queueGeneration;
    publish({ ...state, experienceId, queueStatus: 'loading', queue: null, queueError: null });
    try {
      const queue = await fetchStaffQueue(client, context.eventId, experienceId);
      if (revision !== generation || request !== queueGeneration || !isCurrent()) return;
      publish({ ...state, queueStatus: 'ready', queue });
    } catch (error) {
      if (revision !== generation || request !== queueGeneration || !isCurrent()) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      publish({ ...state, queueStatus: 'error', queue: null, queueError: kind });
    }
  }
  function clearQueue() {
    queueGeneration += 1;
    if (isCurrent()) publish({ ...state, experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
  }
  return { getSnapshot: () => state, isCurrent, setContext, refreshStations, refreshExperiences, refreshQueue, clearQueue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
