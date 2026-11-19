import { addEventExperience, addEventStation, renameExperience, renameStation,
  setStationAvailability } from '../../services/adminEventSetupService';

export const reviewStructureLabel = 'Revisar operações pendentes de experiências e estações';

// A pilha Admin mantém um único mapa por identidade verificada e cliente HTTP.
// O valor normalizado só compara tentativas no mesmo destino. Nunca identifica um recurso salvo.
export function structureIntentId({ eventId, kind, experienceId, stationId, value }) {
  return JSON.stringify([eventId, kind, experienceId ?? null, stationId ?? null, kind === 'availability' ? null : value]);
}

export function structureIntentsFor(store, eventId) {
  return store ? [...store.values()].filter(record => record.eventId === eventId) : [];
}

export function forgetStructureIntent(store, record) {
  if (store.get(record.id) !== record || record.flight) return false;
  store.delete(record.id);
  return true;
}

async function send(client, { eventId, kind, experienceId, stationId, value, key }) {
  switch (kind) {
    case 'addExperience': return addEventExperience(client, eventId, value, key);
    case 'addStation': return addEventStation(client, eventId, experienceId, value, key);
    case 'renameExperience': return renameExperience(client, eventId, experienceId, value, key);
    case 'renameStation': return renameStation(client, eventId, experienceId, stationId, value, key);
    case 'availability': return setStationAvailability(client, eventId, stationId, value);
    default: throw new Error('Operação inválida.');
  }
}

export function attemptStructureIntent(client, store, record) {
  if (record.flight || store.get(record.id) !== record) return null;
  const retrying = Boolean(record.attempts);
  record.attempts = (record.attempts ?? 0) + 1;
  record.error = null;
  // Reservar antes do transporte permite usar a mesma guarda em ambas as telas.
  let start;
  const request = new Promise(resolve => { start = resolve; });
  record.flight = request.then(result => {
    record.result = result;
    return result;
  }).catch(error => {
    record.error = { status: error?.status, code: error?.code, outcomeUnknown: error?.outcomeUnknown,
      isNetworkError: error?.isNetworkError };
    const uncertain = !error?.status || error.outcomeUnknown || error.status >= 500 || error.status === 408 ||
      error.code === 'IDEMPOTENCY_IN_PROGRESS';
    // Uma recusa ao repetir não esclarece o que aconteceu na primeira tentativa.
    if (!uncertain && (!retrying || error.code === 'IDEMPOTENCY_KEY_REUSED') && store.get(record.id) === record) {
      store.delete(record.id);
    }
    throw error;
  }).finally(() => { record.flight = null; });
  start(send(client, record));
  return record.flight;
}

export function matchesStructureIntent(items, record) {
  const group = items.find(item => item.id === record.experienceId);
  const station = group?.stations.find(item => item.id === record.stationId);
  switch (record.kind) {
    case 'availability': return station?.availability === record.value;
    case 'addExperience': return items.some(item => item.id === record.result?.id && item.name === record.value);
    case 'addStation': return Boolean(group?.stations.some(item => item.id === record.result?.id && item.label === record.value));
    case 'renameExperience': return group?.name === record.value;
    case 'renameStation': return station?.label === record.value;
    default: return false;
  }
}
