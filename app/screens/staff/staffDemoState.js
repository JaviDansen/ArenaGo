// Transições LOCAIS da demonstração Staff. Funções puras: recebem a sessão
// atual e devolvem { state, result } sem alterar o objeto recebido.
// Nenhuma função aqui envia requisição; a autoridade real será o backend.
import { STAFF_DEMO_ERROR_CODE, staffDemoEvents } from '../../data/staffDemoData';

const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(state, code, message) {
  return { state, result: { ok: false, code, message } };
}

function ok(state, code, message, extra = {}) {
  return { state, result: { ok: true, code, message, ...extra } };
}

export function normalizeStaffEventCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

// Resolve o código digitado na tela de acesso. Só aceita códigos que são
// propriedades próprias das fixtures (evita "toString", "__proto__" etc.).
export function resolveStaffDemoAccess(code) {
  const normalizedCode = normalizeStaffEventCode(code);

  if (normalizedCode === '') {
    return { ok: false, code: 'EMPTY', message: 'Informe o código do evento.' };
  }
  if (normalizedCode === STAFF_DEMO_ERROR_CODE) {
    return {
      ok: false,
      code: 'SIMULATED_ERROR',
      message: 'Falha simulada ao verificar o código. Nada foi consultado no servidor; tente novamente.',
    };
  }
  if (!hasOwn(staffDemoEvents, normalizedCode)) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Código não encontrado entre os eventos de demonstração.',
    };
  }
  return { ok: true, code: 'FOUND', eventCode: normalizedCode };
}

// Cria uma cópia mutável e isolada da fixture para a sessão de demonstração.
export function createStaffDemoSession(eventCode) {
  if (!hasOwn(staffDemoEvents, eventCode)) return null;
  return { ...copy(staffDemoEvents[eventCode]), absenceSequence: 0 };
}

export function findStation(state, stationId) {
  for (const experience of state?.experiences ?? []) {
    const station = experience.stations.find((item) => item.id === stationId);
    if (station) return { experience, station };
  }
  return null;
}

export function findExperience(state, experienceId) {
  return state?.experiences?.find((item) => item.id === experienceId) ?? null;
}

export function getExperienceSummary(experience) {
  const pendingCalls = experience.stations.filter((station) => station.call).length;
  const availableStations = experience.stations.filter((station) => station.available).length;
  return {
    queueSize: experience.queue.length,
    pendingCalls,
    availableStations,
    totalStations: experience.stations.length,
  };
}

// Motivo pelo qual a estação não pode chamar agora (null quando pode).
export function getCallBlocker(state, stationId) {
  const found = findStation(state, stationId);
  if (!found) return { code: 'STATION_NOT_FOUND', message: 'Estação não encontrada.' };
  if (!found.station.available) {
    return { code: 'STATION_UNAVAILABLE', message: 'Estação indisponível: não pode chamar participantes.' };
  }
  if (found.station.call) {
    return {
      code: 'CALL_PENDING',
      message: 'Resolva o chamado pendente (concluir ou ausente) antes de chamar o próximo.',
    };
  }
  if (found.experience.queue.length === 0) {
    return { code: 'QUEUE_EMPTY', message: 'Fila vazia: não há ninguém para chamar.' };
  }
  return null;
}

// A confirmação vale só para a entrada exibida no diálogo (entryId): repetir o
// mesmo callback não consome o participante seguinte.
export function confirmEntry(state, entryId) {
  const { entryQueue } = state;
  if (!entryQueue.active) {
    return fail(state, 'QUEUE_INACTIVE', 'A fila de acesso está desativada.');
  }
  if (entryQueue.waiting.length === 0) {
    return fail(state, 'QUEUE_EMPTY', 'Não há ninguém aguardando na fila de acesso.');
  }
  const [next, ...waiting] = entryQueue.waiting;
  if (typeof entryId !== 'string' || next.entryId !== entryId) {
    return fail(state, 'ENTRY_NOT_NEXT',
      'Esta confirmação já foi processada ou a fila mudou. Nada foi alterado.');
  }
  const nextState = {
    ...state,
    entryQueue: { ...entryQueue, waiting, insideCount: entryQueue.insideCount + 1 },
  };
  return ok(nextState, 'ENTRY_CONFIRMED',
    `Entrada de ${next.name} confirmada na simulação local.`, { participant: next });
}

export function disableEntryQueue(state) {
  const { entryQueue } = state;
  if (!entryQueue.active) {
    return fail(state, 'QUEUE_INACTIVE', 'A fila de acesso já está desativada.');
  }
  const released = entryQueue.waiting.length;
  const nextState = {
    ...state,
    entryQueue: {
      ...entryQueue,
      active: false,
      waiting: [],
      insideCount: entryQueue.insideCount + released,
    },
  };
  return ok(nextState, 'QUEUE_DISABLED',
    `Fila desativada na simulação: ${released} participante(s) liberado(s).`, { released });
}

// Reativar não recoloca na fila quem já foi liberado.
export function reactivateEntryQueue(state) {
  if (state.entryQueue.active) {
    return fail(state, 'QUEUE_ACTIVE', 'A fila de acesso já está ativa.');
  }
  return ok({ ...state, entryQueue: { ...state.entryQueue, active: true } }, 'QUEUE_REACTIVATED',
    'Fila reativada na simulação. Quem já foi liberado continua na Arena.');
}

function updateStation(state, stationId, update) {
  return {
    ...state,
    experiences: state.experiences.map((experience) => {
      if (!experience.stations.some((station) => station.id === stationId)) return experience;
      const changed = update(experience, experience.stations.find((station) => station.id === stationId));
      return {
        ...experience,
        ...changed.experience,
        stations: experience.stations.map((station) =>
          station.id === stationId ? { ...station, ...changed.station } : station),
      };
    }),
  };
}

// Chama o primeiro da fila da EXPERIÊNCIA (FIFO compartilhada entre estações).
export function callNext(state, stationId) {
  const blocker = getCallBlocker(state, stationId);
  if (blocker) return fail(state, blocker.code, blocker.message);

  const { experience } = findStation(state, stationId);
  const [next, ...queue] = experience.queue;
  const nextState = updateStation(state, stationId, () => ({
    experience: { queue },
    station: { call: next },
  }));
  return ok(nextState, 'CALLED', `${next.name} foi chamado(a) na simulação local.`,
    { participant: next });
}

export function completeCall(state, stationId) {
  const found = findStation(state, stationId);
  if (!found) return fail(state, 'STATION_NOT_FOUND', 'Estação não encontrada.');
  if (!found.station.call) return fail(state, 'NO_CALL', 'Esta estação não tem chamado pendente.');

  const participant = found.station.call;
  const nextState = updateStation(state, stationId, (experience) => ({
    experience: { completedCount: experience.completedCount + 1 },
    station: { call: null },
  }));
  return ok(nextState, 'COMPLETED',
    `Experiência de ${participant.name} concluída na simulação local.`, { participant });
}

// Ausência nunca conta como conclusão. Volta ao final da fila somente
// enquanto novas inscrições em fila estiverem permitidas (D05 / C-01).
export function markAbsent(state, stationId) {
  const found = findStation(state, stationId);
  if (!found) return fail(state, 'STATION_NOT_FOUND', 'Estação não encontrada.');
  if (!found.station.call) return fail(state, 'NO_CALL', 'Esta estação não tem chamado pendente.');

  const participant = found.station.call;
  const requeued = state.queueEntriesOpen === true;
  const absenceSequence = state.absenceSequence + 1;
  const newEntry = {
    entryId: `demo-absence-${absenceSequence}`,
    participantId: participant.participantId,
    name: participant.name,
  };
  const nextState = updateStation({ ...state, absenceSequence }, stationId, (experience) => ({
    experience: requeued ? { queue: [...experience.queue, newEntry] } : {},
    station: { call: null },
  }));
  const message = requeued
    ? `${participant.name} marcado(a) como ausente e movido(a) para o final da fila (simulação).`
    : `${participant.name} marcado(a) como ausente. Novas inscrições já foram encerradas, então não volta à fila (simulação).`;
  return ok(nextState, 'ABSENT', message, { participant, requeued });
}
