import { fetchStaffEntrySummary, fetchStaffExperiences, fetchStaffQueue, fetchStaffStations } from './staffOperationsService';

const same = (a, b) => Boolean(a && b && a.eventId === b.eventId && a.userId === b.userId &&
  a.epoch === b.epoch && a.revision === b.revision);
const empty = () => ({
  context: null,
  accessStatus: 'unknown',
  accessLocked: false,
  stationStatus: 'idle', stations: [], stationError: null,
  experienceStatus: 'idle', experiences: [], experienceError: null,
  entryStatus: 'idle', entry: null, entryError: null,
  experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
});
const errorKind = (error) => error?.status === 401 ? 'session' :
  (error?.status === 403 || error?.status === 404) ? 'denied' : error?.isNetworkError ? 'network' : 'unavailable';
const isRecoverableError = (kind) => kind === 'network' || kind === 'unavailable';

// O contexto é conferido novamente antes de publicar qualquer resultado.
export function createStaffDashboardStore({ client, getContext }) {
  let state = empty();
  let generation = 0;
  let stationGeneration = 0;
  let experienceGeneration = 0;
  let entryGeneration = 0;
  let queueGeneration = 0;
  let silentStations = false, silentExperiences = false, silentQueue = false, silentEntry = false;
  let accessLocked = false;
  let lockedKind = 'denied';
  let revalidationPending = new Set();
  let revalidationOk = new Set();
  let revalidationTransientError = false;
  let stagedPatch = {};

  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const isCurrent = (candidate = state.context) => same(state.context, candidate) && same(state.context, getContext());

  function resetRevalidation() {
    revalidationPending = new Set();
    revalidationOk = new Set();
    revalidationTransientError = false;
    stagedPatch = {};
  }

  function setContext(context) {
    generation += 1; stationGeneration += 1; experienceGeneration += 1; entryGeneration += 1; queueGeneration += 1;
    silentStations = false; silentExperiences = false; silentQueue = false; silentEntry = false;
    accessLocked = false;
    lockedKind = 'denied';
    resetRevalidation();
    publish(context ? {
      ...empty(),
      context,
      accessStatus: 'revalidating',
      accessLocked: false,
      stationStatus: 'loading',
      experienceStatus: 'loading',
      entryStatus: 'loading',
    } : empty());
  }

  function denied(kind = 'denied') {
    stationGeneration += 1; experienceGeneration += 1; entryGeneration += 1; queueGeneration += 1;
    silentStations = false; silentExperiences = false; silentQueue = false; silentEntry = false;
    accessLocked = true;
    lockedKind = kind === 'session' ? 'session' : 'denied';
    resetRevalidation();
    publish({
      ...state,
      accessStatus: lockedKind,
      accessLocked: true,
      stationStatus: 'error', stationError: lockedKind, stations: [],
      experienceStatus: 'error', experienceError: lockedKind, experiences: [],
      entryStatus: 'error', entryError: lockedKind, entry: null,
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
    });
  }

  function reportAccessDenied(kind = 'denied') {
    if (!isCurrent()) return;
    denied(kind);
  }

  function beginRevalidation(domain, loadingPatch) {
    if (!accessLocked) {
      publish({
        ...state,
        ...loadingPatch,
        accessStatus: state.accessStatus === 'unknown' ? 'revalidating' : state.accessStatus,
        accessLocked: false,
      });
      return;
    }
    if (revalidationPending.size === 0) {
      revalidationOk.clear();
      revalidationTransientError = false;
      stagedPatch = {};
    }
    revalidationPending.add(domain);
    publish({
      ...state,
      ...loadingPatch,
      accessStatus: 'revalidating',
      accessLocked: true,
    });
  }

  function finishRevalidationSuccess(domain, successPatch) {
    if (!accessLocked) {
      publish({
        ...state,
        ...successPatch,
        accessStatus: 'granted',
        accessLocked: false,
      });
      return;
    }
    revalidationPending.delete(domain);
    revalidationOk.add(domain);
    Object.assign(stagedPatch, successPatch);
    if (revalidationPending.size > 0) {
      publish({ ...state, accessStatus: 'revalidating', accessLocked: true });
      return;
    }
    if (revalidationTransientError || revalidationOk.size === 0) {
      resetRevalidation();
      publish({
        ...state,
        accessStatus: lockedKind,
        accessLocked: true,
        stations: [],
        experiences: [],
        entry: null,
        experienceId: null,
        queueStatus: 'idle',
        queue: null,
        queueError: null,
      });
      return;
    }
    const resolved = { ...stagedPatch };
    accessLocked = false;
    lockedKind = 'denied';
    resetRevalidation();
    publish({
      ...state,
      ...resolved,
      accessStatus: 'granted',
      accessLocked: false,
    });
  }

  function finishRevalidationError(domain, errorPatch) {
    if (!accessLocked) {
      publish({ ...state, ...errorPatch });
      return;
    }
    revalidationPending.delete(domain);
    revalidationTransientError = true;
    stagedPatch = {};
    if (revalidationPending.size > 0) {
      publish({
        ...state,
        ...errorPatch,
        accessStatus: 'revalidating',
        accessLocked: true,
      });
      return;
    }
    resetRevalidation();
    publish({
      ...state,
      ...errorPatch,
      accessStatus: lockedKind,
      accessLocked: true,
      stations: [],
      experiences: [],
      entry: null,
      experienceId: null,
      queueStatus: 'idle',
      queue: null,
      queueError: null,
    });
  }

  async function refreshEntryControl() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++entryGeneration;
    silentEntry = false;
    beginRevalidation('entry', { entryStatus: 'loading', entryError: null, entry: null });
    try {
      const entry = await fetchStaffEntrySummary(client, context.eventId);
      if (revision !== generation || request !== entryGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('entry', { entryStatus: 'ready', entry, entryError: null });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== entryGeneration) return;
      finishRevalidationError('entry', { entryStatus: 'error', entryError: kind, entry: null });
    }
  }

  async function pollEntryControl() {
    const canRetry = state.entryStatus === 'error' && isRecoverableError(state.entryError);
    if (silentEntry || accessLocked || !isCurrent() || (state.entryStatus !== 'ready' && !canRetry)) return;
    const context = state.context, revision = generation, request = entryGeneration;
    const hadReady = state.entryStatus === 'ready';
    silentEntry = true;
    try {
      const entry = await fetchStaffEntrySummary(client, context.eventId);
      if (revision === generation && request === entryGeneration && isCurrent(context) && !accessLocked) {
        publish({ ...state, entryStatus: 'ready', entry, entryError: null, accessStatus: 'granted', accessLocked: false });
      }
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== entryGeneration || accessLocked) return;
      if (hadReady) publish({ ...state, entryError: 'stale' });
      else publish({ ...state, entryStatus: 'error', entryError: kind, entry: null });
    } finally {
      if (revision === generation && request === entryGeneration) silentEntry = false;
    }
  }

  async function refreshExperiences() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++experienceGeneration;
    silentExperiences = false;
    queueGeneration += 1;
    silentQueue = false;
    beginRevalidation('experiences', {
      experienceStatus: 'loading', experienceError: null, experiences: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
    });
    try {
      const { experiences } = await fetchStaffExperiences(client, context.eventId);
      if (revision !== generation || request !== experienceGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('experiences', { experienceStatus: 'ready', experiences, experienceError: null });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== experienceGeneration) return;
      finishRevalidationError('experiences', { experienceStatus: 'error', experienceError: kind, experiences: [] });
    }
  }

  async function pollExperiences() {
    const canRetry = state.experienceStatus === 'error' && isRecoverableError(state.experienceError);
    if (silentExperiences || accessLocked || !isCurrent() || (state.experienceStatus !== 'ready' && !canRetry)) return;
    const context = state.context, revision = generation, request = experienceGeneration;
    const hadReady = state.experienceStatus === 'ready';
    silentExperiences = true;
    try {
      const { experiences } = await fetchStaffExperiences(client, context.eventId);
      if (revision === generation && request === experienceGeneration && isCurrent(context) && !accessLocked) {
        publish({ ...state, experienceStatus: 'ready', experiences, experienceError: null, accessStatus: 'granted', accessLocked: false });
      }
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== experienceGeneration || accessLocked) return;
      if (hadReady) publish({ ...state, experienceError: 'stale' });
      else publish({ ...state, experienceStatus: 'error', experienceError: kind, experiences: [] });
    } finally {
      if (revision === generation && request === experienceGeneration) silentExperiences = false;
    }
  }

  async function refreshStations() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++stationGeneration;
    silentStations = false;
    queueGeneration += 1;
    silentQueue = false;
    beginRevalidation('stations', {
      stationStatus: 'loading', stationError: null, stations: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
    });
    try {
      const { stations } = await fetchStaffStations(client, context.eventId);
      if (revision !== generation || request !== stationGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('stations', { stationStatus: 'ready', stations, stationError: null });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== stationGeneration) return;
      finishRevalidationError('stations', { stationStatus: 'error', stationError: kind, stations: [] });
    }
  }

  async function pollStations() {
    const canRetry = state.stationStatus === 'error' && isRecoverableError(state.stationError);
    if (silentStations || accessLocked || !isCurrent() || (state.stationStatus !== 'ready' && !canRetry)) return;
    const context = state.context, revision = generation, request = stationGeneration;
    const hadReady = state.stationStatus === 'ready';
    silentStations = true;
    try {
      const { stations } = await fetchStaffStations(client, context.eventId);
      if (revision === generation && request === stationGeneration && isCurrent(context) && !accessLocked)
        publish({ ...state, stationStatus: 'ready', stations, stationError: null, accessStatus: 'granted', accessLocked: false });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== stationGeneration || accessLocked) return;
      if (hadReady) publish({ ...state, stationError: 'stale' });
      else publish({ ...state, stationStatus: 'error', stationError: kind, stations: [] });
    } finally {
      if (revision === generation && request === stationGeneration) silentStations = false;
    }
  }

  async function refreshQueue(experienceId = state.experienceId) {
    if (!isCurrent() || accessLocked || state.stationStatus !== 'ready' ||
        !state.stations.some((station) => station.experienceId === experienceId)) return;
    const context = state.context, revision = generation, request = ++queueGeneration;
    silentQueue = false;
    publish({ ...state, experienceId, queueStatus: 'loading', queue: null, queueError: null });
    try {
      const queue = await fetchStaffQueue(client, context.eventId, experienceId);
      if (revision !== generation || request !== queueGeneration || !isCurrent(context) || accessLocked) return;
      publish({ ...state, queueStatus: 'ready', queue });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== queueGeneration || accessLocked) return;
      publish({ ...state, queueStatus: 'error', queue: null, queueError: kind });
    }
  }

  async function pollQueue(experienceId = state.experienceId) {
    if (silentQueue || accessLocked || !isCurrent() || state.queueStatus !== 'ready' || state.experienceId !== experienceId) return;
    const context = state.context, revision = generation, request = queueGeneration;
    silentQueue = true;
    try {
      const queue = await fetchStaffQueue(client, context.eventId, experienceId);
      if (revision === generation && request === queueGeneration && isCurrent(context) && state.experienceId === experienceId && !accessLocked)
        publish({ ...state, queue, queueError: null });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== queueGeneration || accessLocked) return;
      publish({ ...state, queueError: 'stale' });
    } finally {
      if (revision === generation && request === queueGeneration) silentQueue = false;
    }
  }

  function clearQueue() {
    queueGeneration += 1;
    silentQueue = false;
    if (isCurrent()) publish({ ...state, experienceId: null, queueStatus: 'idle', queue: null, queueError: null });
  }

  function refreshPanel() {
    return Promise.all([refreshStations(), refreshExperiences(), refreshEntryControl()]);
  }

  function revalidateOnReturn() {
    if (!isCurrent() || accessLocked) return Promise.resolve();
    const tasks = [];
    if (state.stationStatus === 'ready' || isRecoverableError(state.stationError)) tasks.push(pollStations());
    else if (state.stationStatus !== 'loading') tasks.push(refreshStations());
    if (state.experienceStatus === 'ready' || isRecoverableError(state.experienceError)) tasks.push(pollExperiences());
    else if (state.experienceStatus !== 'loading') tasks.push(refreshExperiences());
    if (state.entryStatus === 'ready' || isRecoverableError(state.entryError)) tasks.push(pollEntryControl());
    else if (state.entryStatus !== 'loading') tasks.push(refreshEntryControl());
    return Promise.all(tasks);
  }

  return {
    getSnapshot: () => state,
    isCurrent,
    isAccessLocked: () => accessLocked && isCurrent(),
    setContext,
    reportAccessDenied,
    refreshStations,
    refreshExperiences,
    refreshEntryControl,
    refreshPanel,
    revalidateOnReturn,
    refreshQueue,
    pollStations,
    pollExperiences,
    pollEntryControl,
    pollQueue,
    clearQueue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
