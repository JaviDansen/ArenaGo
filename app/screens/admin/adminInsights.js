// ADM03: Histórico, Visão Geral e BI individual da demonstração Admin.
// Funções puras de LEITURA sobre a mesma sessão das ADM01–ADM02 (eventos,
// experiências, estações e contadores de participação). Nada aqui altera
// estado, envia requisição ou apresenta resultado real. D10: só agregados;
// populações abaixo do mínimo aparecem como "Dados insuficientes".
import { ADMIN_MIN_GROUP_SIZE, adminBiPeriods } from '../../data/adminDemoData';
import {
  adminFinalizedOf,
  describeEvent,
  getOperationalCutAt,
  listExperiences,
  listStations,
  normalizeAccessCode,
} from './adminDemoState';
import { addMinutes, toMs } from './adminTime';

const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);
const own = (object, key) => (hasOwn(object, key) ? object[key] : undefined);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const listOf = (state, key) => (Array.isArray(own(state, key)) ? state[key] : []);

export const ADMIN_CLOSURE_LABELS = Object.freeze({
  schedule: 'Encerrado no horário',
  immediate: 'Encerrado antecipadamente (imediato)',
  controlled: 'Encerrado antecipadamente (controlado)',
});

export const ADMIN_BI_STAGE_LABELS = Object.freeze({
  future: 'Evento futuro: ainda não começou e não tem participações.',
  waiting: 'Início alcançado, mas o evento ainda não abriu (prontidão pendente).',
  open: 'Evento em andamento: os números são parciais e mudam até o encerramento.',
  closing: 'Evento em encerramento: novas entradas bloqueadas; os números ainda podem mudar.',
  closed: 'Evento encerrado: números finais da demonstração.',
});

// ─── Período ──────────────────────────────────────────────────────────────

export function findPeriod(periodId) {
  return adminBiPeriods.find((period) => period.id === periodId) ?? adminBiPeriods[0];
}

// Janela que termina no relógio da demonstração e considera o INÍCIO do
// evento. "Todo o período" inclui também os eventos futuros.
export function isInPeriod(event, periodId, now) {
  const period = findPeriod(periodId);
  if (period.days === null) return true;
  const start = toMs(own(event, 'startsAt'));
  if (start === null) return false;
  return start <= toMs(now) && start >= toMs(addMinutes(now, -period.days * 24 * 60));
}

// ─── Encerramento ─────────────────────────────────────────────────────────

export function getClosureKind(event) {
  const mode = own(event, 'closureMode');
  return mode === 'immediate' || mode === 'controlled' ? mode : 'schedule';
}

// Justificativa do último encerramento administrativo registrado na sessão.
export function getClosureReason(event) {
  const audit = Array.isArray(own(event, 'audit')) ? event.audit : [];
  const entry = [...audit].reverse().find((item) => own(item, 'action') === 'CLOSE');
  return typeof own(entry, 'reason') === 'string' ? entry.reason : null;
}

// ─── Métricas ─────────────────────────────────────────────────────────────

// "4,3": média com uma casa decimal no formato brasileiro.
export function formatAverage(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '—';
}

// Contadores atuais do evento (fonte: "participants" da sessão). A parte
// finalizada pelo encerramento administrativo é separada: não é experiência
// concluída nem participação que avaliou.
export function getParticipationBreakdown(event) {
  const participants = own(event, 'participants');
  const finished = count(own(participants, 'finished'));
  const active = count(own(participants, 'active'));
  const externalWaiting = count(own(participants, 'externalWaiting'));
  const adminFinalized = Math.min(adminFinalizedOf(event), finished);
  return {
    registered: finished + active + externalWaiting,
    active,
    externalWaiting,
    finished,
    adminFinalized,
    finishedOutsideAdmin: finished - adminFinalized,
  };
}

// Nota vigente de UMA avaliação (D08): a revisão de instante mais recente.
export function currentScore(evaluation) {
  const revisions = Array.isArray(own(evaluation, 'revisions')) ? evaluation.revisions : [];
  let latest = null;
  revisions.forEach((revision) => {
    const score = own(revision, 'score');
    const at = toMs(own(revision, 'at'));
    if (!Number.isInteger(score) || score < 1 || score > 5 || at === null) return;
    if (!latest || at > latest.at) latest = { score, at };
  });
  return latest ? latest.score : null;
}

// Avaliações enviadas: cada id conta uma vez, com a nota vigente.
export function summarizeEvaluations(evaluations) {
  const seen = new Set();
  const counts = [0, 0, 0, 0, 0];
  (Array.isArray(evaluations) ? evaluations : []).forEach((evaluation) => {
    const id = own(evaluation, 'id');
    if (typeof id !== 'string' || seen.has(id)) return;
    const score = currentScore(evaluation);
    if (score === null) return;
    seen.add(id);
    counts[score - 1] += 1;
  });
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total < ADMIN_MIN_GROUP_SIZE) return { total, insufficient: true, average: null, distribution: null };
  const weighted = counts.reduce((sum, value, index) => sum + value * (index + 1), 0);
  return {
    total,
    insufficient: false,
    average: weighted / total,
    distribution: counts.map((value, index) => ({
      score: index + 1,
      count: value,
      percent: Math.round((value / total) * 100),
    })),
  };
}

// Junta amostras { sampleSize, averageMinutes } pela média ponderada. Sem
// população mínima: insuficiente (nunca zero como duração).
export function summarizeDuration(samples) {
  let sampleSize = 0;
  let totalMinutes = 0;
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const size = count(own(sample, 'sampleSize'));
    const average = own(sample, 'averageMinutes');
    if (size === 0 || typeof average !== 'number' || !Number.isFinite(average) || average <= 0) return;
    sampleSize += size;
    totalMinutes += size * average;
  });
  if (sampleSize < ADMIN_MIN_GROUP_SIZE) return { sampleSize, insufficient: true, averageMinutes: null };
  return { sampleSize, insufficient: false, averageMinutes: Math.round(totalMinutes / sampleSize) };
}

function completionOf(state, stationId) {
  return listOf(state, 'stationCompletions').find((item) => own(item, 'stationId') === stationId) ?? null;
}

// Utilização por experiência e estação: SOMENTE atendimentos registrados
// (stationCompletions). Fila e quantidade de estações não geram números.
export function getExperienceUsage(state, eventId) {
  return listExperiences(state, eventId).map((experience) => {
    const stations = listStations(state, experience.id).map((station) => {
      const row = completionOf(state, station.id);
      return { station, completed: count(own(row, 'completed')), absences: count(own(row, 'absences')) };
    });
    const completed = stations.reduce((sum, item) => sum + item.completed, 0);
    return {
      experience,
      completed,
      absences: stations.reduce((sum, item) => sum + item.absences, 0),
      stations: stations.map((item) => ({
        ...item,
        share: completed > 0 ? Math.round((item.completed / completed) * 100) : null,
      })),
    };
  }).sort((a, b) => b.completed - a.completed);
}

function evaluationsOf(state, eventIds) {
  return listOf(state, 'evaluations').filter((item) => eventIds.includes(own(item, 'eventId')));
}

function timeSamplesOf(state, eventIds, key) {
  return listOf(state, 'timeMetrics')
    .filter((item) => eventIds.includes(own(item, 'eventId')))
    .map((item) => own(item, key));
}

export function getBiStage(info, now, event) {
  if (info.phase === 'scheduled') return toMs(now) < toMs(own(event, 'startsAt')) ? 'future' : 'waiting';
  return info.phase;
}

// ─── BI individual ────────────────────────────────────────────────────────

export function getEventBi(state, eventId) {
  const event = (state?.events ?? []).find((item) => own(item, 'id') === eventId) ?? null;
  if (!event) return null;
  const info = describeEvent(event, state.clockNow, state);
  const usage = getExperienceUsage(state, event.id);
  const participations = getParticipationBreakdown(event);
  const evaluations = summarizeEvaluations(evaluationsOf(state, [event.id]));
  const completed = usage.reduce((sum, item) => sum + item.completed, 0);
  const stations = usage.flatMap((item) => item.stations);
  return {
    event,
    info,
    stage: getBiStage(info, state.clockNow, event),
    closureKind: getClosureKind(event),
    closedAt: info.phase === 'closed' ? getOperationalCutAt(event) : null,
    participations,
    usage,
    completions: {
      completed,
      absences: usage.reduce((sum, item) => sum + item.absences, 0),
      stations: stations.length,
      stationsWithCompletions: stations.filter((item) => item.completed > 0).length,
    },
    evaluations,
    time: {
      lastCompletion: summarizeDuration(timeSamplesOf(state, [event.id], 'lastCompletion')),
      voluntaryExit: summarizeDuration(timeSamplesOf(state, [event.id], 'voluntaryExit')),
    },
    // Nada a analisar ainda: nenhuma participação, atendimento ou avaliação.
    insufficient: participations.registered === 0 && completed === 0 && evaluations.total === 0,
  };
}

// ─── Histórico ────────────────────────────────────────────────────────────

// Eventos com fase efetiva "closed" pelo relógio de teste (inclui os
// encerrados durante a sessão), do encerramento mais recente ao mais antigo.
export function listHistory(state, { query = '', period = 'all' } = {}) {
  const term = typeof query === 'string' ? query.trim().toUpperCase() : '';
  return (state?.events ?? [])
    .map((event) => ({ event, info: describeEvent(event, state.clockNow, state) }))
    .filter(({ info }) => info.phase === 'closed')
    .filter(({ event }) => isInPeriod(event, period, state.clockNow))
    .filter(({ event }) => term === ''
      || String(own(event, 'name') ?? '').toUpperCase().includes(term)
      || normalizeAccessCode(own(event, 'accessCode')).includes(term))
    .map(({ event, info }) => ({
      event,
      info,
      closedAt: getOperationalCutAt(event),
      closureKind: getClosureKind(event),
      participations: getParticipationBreakdown(event),
    }))
    .sort((a, b) => toMs(b.closedAt) - toMs(a.closedAt));
}

// ─── Visão Geral ──────────────────────────────────────────────────────────

// Eventos do período, na ordem de início (para o seletor da Visão Geral).
export function listPeriodEvents(state, period = 'all') {
  return (state?.events ?? [])
    .filter((event) => isInPeriod(event, period, state.clockNow))
    .sort((a, b) => toMs(own(a, 'startsAt')) - toMs(own(b, 'startsAt')));
}

// Indicadores consolidados do período e da seleção (vazia = todos do período).
export function getOverview(state, { period = 'all', eventIds = [] } = {}) {
  const inPeriod = listPeriodEvents(state, period);
  const wanted = Array.isArray(eventIds) ? eventIds.filter((id) => typeof id === 'string') : [];
  const events = wanted.length === 0 ? inPeriod : inPeriod.filter((event) => wanted.includes(event.id));
  const ids = events.map((event) => event.id);

  const phases = { total: 0, scheduled: 0, open: 0, closing: 0, closed: 0, notReady: 0 };
  const participations = { registered: 0, active: 0, externalWaiting: 0, finished: 0, adminFinalized: 0, finishedOutsideAdmin: 0 };
  const completions = { completed: 0, absences: 0, stations: 0, stationsWithCompletions: 0 };
  const experiences = [];

  events.forEach((event) => {
    const bi = getEventBi(state, event.id);
    phases.total += 1;
    phases[bi.info.phase] += 1;
    if (bi.info.phase !== 'closed' && !bi.info.readiness.ready) phases.notReady += 1;
    Object.keys(participations).forEach((key) => { participations[key] += bi.participations[key]; });
    Object.keys(completions).forEach((key) => { completions[key] += bi.completions[key]; });
    bi.usage.filter((item) => item.completed > 0).forEach((item) => {
      experiences.push({ id: item.experience.id, name: item.experience.name, eventName: event.name, completed: item.completed });
    });
  });

  const evaluations = summarizeEvaluations(evaluationsOf(state, ids));
  return {
    period: findPeriod(period),
    events,
    selectedIds: wanted.length === 0 ? [] : ids,
    empty: events.length === 0,
    phases,
    participations,
    completions,
    topExperiences: experiences.sort((a, b) => b.completed - a.completed).slice(0, 5),
    evaluations,
    time: {
      lastCompletion: summarizeDuration(timeSamplesOf(state, ids, 'lastCompletion')),
      voluntaryExit: summarizeDuration(timeSamplesOf(state, ids, 'voluntaryExit')),
    },
    insufficient: events.length > 0 && completions.completed === 0 && evaluations.total === 0
      && participations.registered === 0,
  };
}
