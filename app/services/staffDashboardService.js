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
  let revalidationRound = 0;
  let revalidationPending = new Set();
  let revalidationOk = new Set();
  let revalidationErrors = new Map();
  let stagedPatch = {};
  let orphanCheckedSignatures = new Set();

  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const isCurrent = (candidate = state.context) => same(state.context, candidate) && same(state.context, getContext());

  function resetRevalidation() {
    revalidationPending = new Set();
    revalidationOk = new Set();
    revalidationErrors = new Map();
    stagedPatch = {};
  }

  function computeOrphanSignature(st = state) {
    if (
      accessLocked
      || !st.context
      || st.stationStatus !== 'ready'
      || st.experienceStatus !== 'ready'
      || !Array.isArray(st.stations)
      || st.stations.length === 0
    ) {
      return null;
    }
    const knownIds = new Set((st.experiences ?? []).map((exp) => exp.id ?? exp.experienceId));
    const missingIds = [
      ...new Set(
        st.stations
          .filter((item) => !knownIds.has(item.experienceId))
          .map((item) => item.experienceId)
          .filter(Boolean),
      ),
    ].sort();
    if (missingIds.length === 0) return null;
    return `${st.context.eventId}:${st.context.epoch}:${st.context.revision}:${missingIds.join(',')}`;
  }

  function recordOrphanVerification(orphanSigAtStart, nextState = state) {
    const orphanSigAfter = computeOrphanSignature(nextState);
    if (!orphanSigAfter) {
      orphanCheckedSignatures.clear();
    } else if (orphanSigAtStart && orphanSigAtStart === orphanSigAfter) {
      orphanCheckedSignatures.add(orphanSigAfter);
    }
  }

  function setContext(context) {
    generation += 1; stationGeneration += 1; experienceGeneration += 1; entryGeneration += 1; queueGeneration += 1;
    silentStations = false; silentExperiences = false; silentQueue = false; silentEntry = false;
    accessLocked = false;
    lockedKind = 'denied';
    revalidationRound += 1;
    resetRevalidation();
    orphanCheckedSignatures.clear();
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
    revalidationRound += 1;
    resetRevalidation();
    orphanCheckedSignatures.clear();
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

  function settleRevalidationRound() {
    if (revalidationErrors.size === 0 && revalidationOk.size > 0) {
      const resolved = { ...stagedPatch };
      accessLocked = false;
      lockedKind = 'denied';
      resetRevalidation();
      const nextState = {
        ...state,
        ...resolved,
        accessStatus: 'granted',
        accessLocked: false,
      };
      if (!computeOrphanSignature(nextState)) {
        orphanCheckedSignatures.clear();
      }
      publish(nextState);
      return;
    }

    const patch = {
      accessStatus: lockedKind,
      accessLocked: true,
      stations: [],
      experiences: [],
      entry: null,
      experienceId: null,
      queueStatus: 'idle',
      queue: null,
      queueError: null,
    };
    if (revalidationOk.has('stations') || revalidationErrors.has('stations') || state.stationStatus === 'loading') {
      patch.stationStatus = 'error';
      patch.stationError = revalidationErrors.get('stations') ?? lockedKind;
    }
    if (revalidationOk.has('experiences') || revalidationErrors.has('experiences') || state.experienceStatus === 'loading') {
      patch.experienceStatus = 'error';
      patch.experienceError = revalidationErrors.get('experiences') ?? lockedKind;
    }
    if (revalidationOk.has('entry') || revalidationErrors.has('entry') || state.entryStatus === 'loading') {
      patch.entryStatus = 'error';
      patch.entryError = revalidationErrors.get('entry') ?? lockedKind;
    }
    resetRevalidation();
    publish({
      ...state,
      ...patch,
    });
  }

  function beginRevalidation(domain, loadingPatch) {
    if (!accessLocked) {
      publish({
        ...state,
        ...loadingPatch,
        accessStatus: state.accessStatus === 'unknown' ? 'revalidating' : state.accessStatus,
        accessLocked: false,
      });
      return revalidationRound;
    }
    if (revalidationPending.size === 0) {
      revalidationRound += 1;
      resetRevalidation();
    } else {
      revalidationOk.delete(domain);
      revalidationErrors.delete(domain);
    }
    revalidationPending.add(domain);
    const round = revalidationRound;
    publish({
      ...state,
      ...loadingPatch,
      accessStatus: 'revalidating',
      accessLocked: true,
    });
    return round;
  }

  function finishRevalidationSuccess(domain, round, successPatch) {
    if (!accessLocked) {
      publish({
        ...state,
        ...successPatch,
        accessStatus: 'granted',
        accessLocked: false,
      });
      return;
    }
    if (round !== revalidationRound) return;
    revalidationPending.delete(domain);
    revalidationOk.add(domain);
    Object.assign(stagedPatch, successPatch);
    if (revalidationPending.size > 0) {
      publish({ ...state, accessStatus: 'revalidating', accessLocked: true });
      return;
    }
    settleRevalidationRound();
  }

  function finishRevalidationError(domain, round, kind, errorPatch) {
    if (!accessLocked) {
      publish({ ...state, ...errorPatch });
      return;
    }
    if (round !== revalidationRound) return;
    revalidationPending.delete(domain);
    revalidationErrors.set(domain, kind);
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
    settleRevalidationRound();
  }

  async function refreshEntryControl() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++entryGeneration;
    silentEntry = false;
    const round = beginRevalidation('entry', { entryStatus: 'loading', entryError: null, entry: null });
    try {
      const entry = await fetchStaffEntrySummary(client, context.eventId);
      if (revision !== generation || request !== entryGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('entry', round, { entryStatus: 'ready', entry, entryError: null });
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== entryGeneration) return;
      finishRevalidationError('entry', round, kind, { entryStatus: 'error', entryError: kind, entry: null });
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
    orphanCheckedSignatures.clear();
    const orphanSigAtStart = computeOrphanSignature(state);
    const round = beginRevalidation('experiences', {
      experienceStatus: 'loading', experienceError: null, experiences: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
    });
    try {
      const { experiences } = await fetchStaffExperiences(client, context.eventId);
      if (revision !== generation || request !== experienceGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('experiences', round, { experienceStatus: 'ready', experiences, experienceError: null });
      if (!accessLocked) {
        recordOrphanVerification(orphanSigAtStart, state);
      }
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== experienceGeneration) return;
      finishRevalidationError('experiences', round, kind, { experienceStatus: 'error', experienceError: kind, experiences: [] });
    }
  }

  async function pollExperiences() {
    const canRetry = state.experienceStatus === 'error' && isRecoverableError(state.experienceError);
    if (silentExperiences || accessLocked || !isCurrent() || (state.experienceStatus !== 'ready' && !canRetry)) return false;
    const context = state.context, revision = generation, request = experienceGeneration;
    const hadReady = state.experienceStatus === 'ready';
    const orphanSigAtStart = computeOrphanSignature(state);
    silentExperiences = true;
    try {
      const { experiences } = await fetchStaffExperiences(client, context.eventId);
      if (revision === generation && request === experienceGeneration && isCurrent(context) && !accessLocked) {
        const nextState = { ...state, experienceStatus: 'ready', experiences, experienceError: null, accessStatus: 'granted', accessLocked: false };
        recordOrphanVerification(orphanSigAtStart, nextState);
        publish(nextState);
        return true;
      }
      return false;
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return false;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') {
        denied(kind);
        return false;
      }
      if (request !== experienceGeneration || accessLocked) return false;
      if (hadReady) publish({ ...state, experienceError: 'stale' });
      else publish({ ...state, experienceStatus: 'error', experienceError: kind, experiences: [] });
      return false;
    } finally {
      if (revision === generation && request === experienceGeneration) silentExperiences = false;
    }
  }

  function syncOrphanExperiences() {
    if (silentExperiences || accessLocked || !isCurrent() || state.experienceStatus === 'loading') {
      return Promise.resolve(false);
    }
    const sig = computeOrphanSignature(state);
    if (!sig) {
      orphanCheckedSignatures.clear();
      return Promise.resolve(false);
    }
    if (orphanCheckedSignatures.has(sig)) {
      return Promise.resolve(false);
    }
    if (state.experienceError === 'stale') {
      return Promise.resolve(false);
    }
    return pollExperiences();
  }

  async function refreshStations() {
    if (!isCurrent()) return;
    const context = state.context, revision = generation, request = ++stationGeneration;
    silentStations = false;
    queueGeneration += 1;
    silentQueue = false;
    const round = beginRevalidation('stations', {
      stationStatus: 'loading', stationError: null, stations: [],
      experienceId: null, queueStatus: 'idle', queue: null, queueError: null,
    });
    try {
      const { stations } = await fetchStaffStations(client, context.eventId);
      if (revision !== generation || request !== stationGeneration || !isCurrent(context)) return;
      finishRevalidationSuccess('stations', round, { stationStatus: 'ready', stations, stationError: null });
      if (!accessLocked && !computeOrphanSignature(state)) {
        orphanCheckedSignatures.clear();
      }
    } catch (error) {
      if (revision !== generation || !isCurrent(context)) return;
      const kind = errorKind(error);
      if (kind === 'denied' || kind === 'session') return denied(kind);
      if (request !== stationGeneration) return;
      finishRevalidationError('stations', round, kind, { stationStatus: 'error', stationError: kind, stations: [] });
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
      if (revision === generation && request === stationGeneration && isCurrent(context) && !accessLocked) {
        const nextState = { ...state, stationStatus: 'ready', stations, stationError: null, accessStatus: 'granted', accessLocked: false };
        if (!computeOrphanSignature(nextState)) {
          orphanCheckedSignatures.clear();
        }
        publish(nextState);
      }
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

  async function verifyEventAccessFromQueue(context, revision, experienceId, queueReq) {
    try {
      const { stations } = await fetchStaffStations(client, context.eventId);
      if (revision !== generation || !isCurrent(context) || accessLocked) return;
      const keepQueueBlocked = queueReq === queueGeneration && state.experienceId === experienceId;
      const nextState = {
        ...state,
        stationStatus: 'ready',
        stations,
        stationError: null,
        accessStatus: 'granted',
        accessLocked: false,
        ...(keepQueueBlocked ? { queueStatus: 'error', queue: null, queueError: 'denied' } : {}),
      };
      if (!computeOrphanSignature(nextState)) {
        orphanCheckedSignatures.clear();
      }
      publish(nextState);
    } catch (verifyError) {
      if (revision !== generation || !isCurrent(context)) return;
      const verifyKind = errorKind(verifyError);
      if (verifyKind === 'denied' || verifyKind === 'session') {
        denied(verifyKind);
        return;
      }
      if (!accessLocked && queueReq === queueGeneration && state.experienceId === experienceId) {
        publish({
          ...state,
          queueStatus: 'error',
          queue: null,
          queueError: 'denied',
          ...(state.stationStatus === 'ready' ? { stationError: 'stale' } : {}),
        });
      }
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
      if (kind === 'session') return denied('session');
      if (request !== queueGeneration || state.experienceId !== experienceId || accessLocked) return;
      if (error?.status === 403) return denied('denied');
      if (error?.status === 404) {
        publish({ ...state, queueStatus: 'error', queue: null, queueError: 'denied' });
        await verifyEventAccessFromQueue(context, revision, experienceId, request);
        return;
      }
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
      if (kind === 'session') return denied('session');
      if (request !== queueGeneration || state.experienceId !== experienceId || accessLocked) return;
      if (error?.status === 403) return denied('denied');
      if (error?.status === 404) {
        publish({ ...state, queueStatus: 'error', queue: null, queueError: 'denied' });
        await verifyEventAccessFromQueue(context, revision, experienceId, request);
        return;
      }
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
    if (isCurrent() && accessLocked) {
      revalidationRound += 1;
      resetRevalidation();
      orphanCheckedSignatures.clear();
    }
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
    syncOrphanExperiences,
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
