import { httpClient } from './httpClient';

const empty = () => ({ userId: null, epoch: null, status: 'idle', participation: null, returnState: null, returnStateVersion: 0, demoParticipation: null, error: null });

export function createParticipationStore({ client = httpClient, getIdentity }) {
  let state = empty();
  let generation = 0;
  let suspended = false;
  const presentedReturnEvaluations = new Set();
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener(state)); };
  const matches = (identity) => {
    const current = getIdentity();
    return Boolean(!suspended && identity && current && identity.userId === current.userId && identity.epoch === current.epoch &&
      state.userId === identity.userId && state.epoch === identity.epoch);
  };

  function setIdentity(identity) {
    generation += 1;
    presentedReturnEvaluations.clear();
    if (!identity) { publish(empty()); return; }
    publish({ ...empty(), ...identity, status: 'loading' });
  }

  function canPresentReturnEvaluation(returned, version = state.returnStateVersion) {
    return Boolean(matches(state) && state.status === 'ready' && !state.participation && !state.demoParticipation
      && version === generation && version === state.returnStateVersion
      && returned && returned === state.returnState && returned.recentFinalization
      && !presentedReturnEvaluations.has(returned.recentFinalization.participationId));
  }

  function claimReturnEvaluation(returned, version = state.returnStateVersion) {
    if (!canPresentReturnEvaluation(returned, version)) return false;
    // Consumir antes de navegar; refresh e remontagem não desfazem o adiamento.
    presentedReturnEvaluations.add(returned.recentFinalization.participationId);
    return true;
  }

  function suspend() {
    suspended = true;
    generation += 1;
    publish({ ...state, status: state.userId ? 'loading' : 'idle', returnState: null });
  }

  function resume() {
    suspended = false;
    presentedReturnEvaluations.clear();
    return refresh();
  }

  async function refresh() {
    const identity = state.userId === null ? null : { userId: state.userId, epoch: state.epoch };
    if (!matches(identity)) return;
    const requestGeneration = ++generation;
    publish({ ...state, status: 'loading', error: null, participation: null, returnState: null, demoParticipation: null });
    try {
      const [current, returned] = await Promise.all([
        client.get('/participations/current', { auth: true }),
        client.get('/participations/return-state', { auth: true }),
      ]);
      if (requestGeneration !== generation || !matches(identity)) return;
      const participation = current?.participation;
      if (!current || !Object.prototype.hasOwnProperty.call(current, 'participation') ||
          (participation !== null && (!participation || typeof participation.id !== 'string' ||
            typeof participation.eventId !== 'string' || !['waiting', 'active'].includes(participation.status) ||
            (participation.status === 'waiting' && (!Number.isSafeInteger(participation.externalQueue?.position) || participation.externalQueue.position < 1))))) {
        throw new Error('Resposta inválida de participação.');
      }
      if (!returned || !Array.isArray(returned.pendingEvaluationParticipationIds) ||
          !returned.pendingEvaluationParticipationIds.every((id) => typeof id === 'string') ||
          !Object.prototype.hasOwnProperty.call(returned, 'recentFinalization')) {
        throw new Error('Resposta inválida de estado de retorno.');
      }
      publish({ ...state, status: 'ready', participation, returnState: returned, returnStateVersion: requestGeneration, demoParticipation: null, error: null });
    } catch (error) {
      if (requestGeneration !== generation || !matches(identity)) return;
      publish({ ...state, status: 'error', participation: null, returnState: null, demoParticipation: null,
        error: error?.status === 401 || error?.status === 403 ? 'authorization' : error?.isNetworkError ? 'network' : 'unavailable' });
    }
  }

  function setDemoParticipation(update) {
    const identity = state.userId === null ? null : { userId: state.userId, epoch: state.epoch };
    if (!matches(identity) || state.status !== 'ready' || state.participation) return;
    const next = typeof update === 'function' ? update(state.demoParticipation) : update;
    publish({ ...state, demoParticipation: next ? { ...next, source: 'demo' } : null });
  }

  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity, refresh, setDemoParticipation, canPresentReturnEvaluation, claimReturnEvaluation, suspend, resume };
}
