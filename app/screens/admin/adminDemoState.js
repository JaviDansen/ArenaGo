// Regras e transições LOCAIS da demonstração Admin (ADM01–ADM03). Funções
// puras: recebem o estado atual e devolvem { state, result } sem alterar o
// objeto recebido. Nada aqui envia requisição nem concede permissão
// Admin/TOTP/Staff real; a autoridade real será o backend (§16–§20 da
// arquitetura).
import {
  ADMIN_CODE_MAX_LENGTH,
  ADMIN_DEMO_CLOCK_START,
  ADMIN_EXPERIENCE_NAME_MAX_LENGTH,
  ADMIN_MAX_CONTROLLED_MINUTES,
  ADMIN_MAX_MARGIN_MINUTES,
  ADMIN_NAME_MAX_LENGTH,
  ADMIN_PHASES,
  ADMIN_REASON_MIN_LENGTH,
  ADMIN_STATION_LABEL_MAX_LENGTH,
  adminDemoAccounts,
  adminDemoEvents,
  adminDemoExperiences,
  adminDemoEvaluations,
  adminDemoServiceCalls,
  adminDemoStaffGrants,
  adminDemoStationCompletions,
  adminDemoStations,
  adminDemoTimeMetrics,
  adminPhaseLabels,
  adminReadinessLabels,
} from '../../data/adminDemoData';
import {
  addMinutes,
  earliest,
  findTimezone,
  localToInstant,
  minutesBetween,
  toMs,
} from './adminTime';

const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);

// Lê só propriedades PRÓPRIAS (nunca herdadas do protótipo).
const own = (object, key) => (hasOwn(object, key) ? object[key] : undefined);

// Participações finalizadas pelo encerramento administrativo (imediato ou
// controlado). Ficam fora de experiências concluídas e de avaliações (ADM03).
export function adminFinalizedOf(event) {
  const value = own(event, 'adminFinalized');
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(state, code, message, extra = {}) {
  return { state, result: { ok: false, code, message, ...extra } };
}

function ok(state, code, message, extra = {}) {
  return { state, result: { ok: true, code, message, ...extra } };
}

// ─── Sessão de demonstração ──────────────────────────────────────────────

export function createAdminDemoSession() {
  return latchOpenings({
    clockNow: ADMIN_DEMO_CLOCK_START,
    events: copy(adminDemoEvents),
    experiences: copy(adminDemoExperiences),
    stations: copy(adminDemoStations),
    serviceCalls: copy(adminDemoServiceCalls),
    accounts: copy(adminDemoAccounts),
    staffGrants: copy(adminDemoStaffGrants),
    stationCompletions: copy(adminDemoStationCompletions),
    evaluations: copy(adminDemoEvaluations),
    timeMetrics: copy(adminDemoTimeMetrics),
    sequence: 0,
  });
}

// Prazo do encerramento controlado alcançado: finaliza (simulado) as
// participações ainda abertas representadas nos contadores, preservando as já
// finalizadas. Idempotente: depois disso o status armazenado é "closed" e o
// evento não é processado de novo. Filas internas/chamadas não são modeladas.
function finalizeControlledDeadline(event, now) {
  if (own(event, 'closureMode') !== 'controlled' || own(event, 'statusStored') === 'closed') return event;
  const deadline = toMs(own(event, 'adminDeadlineAt'));
  if (deadline === null || toMs(now) < deadline) return event;
  const participants = { ...event.participants };
  const finalized = participants.externalWaiting + participants.active;
  participants.finished += finalized;
  participants.externalWaiting = 0;
  participants.active = 0;
  return {
    ...event,
    statusStored: 'closed',
    participants,
    controlledDeadlineFinalized: finalized,
    adminFinalized: adminFinalizedOf(event) + finalized,
    audit: [...event.audit, {
      action: 'CONTROLLED_DEADLINE',
      at: event.adminDeadlineAt,
      reason: `Prazo do encerramento controlado alcançado: ${finalized} participação(ões) aberta(s) finalizada(s) (simulado).`,
      before: { statusStored: event.statusStored },
      after: { statusStored: 'closed' },
    }],
  };
}

export function advanceClock(state, minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return fail(state, 'INVALID_CLOCK_STEP', 'Passo de relógio inválido.');
  }
  const clockNow = addMinutes(state.clockNow, minutes);
  const events = state.events.map((event) => finalizeControlledDeadline(event, clockNow));
  return ok(latchOpenings({ ...state, clockNow, events }, state.clockNow), 'CLOCK_ADVANCED',
    `Relógio da demonstração avançado em ${minutes} min.`);
}

// Reiniciar o relógio de teste desfaz apenas as aberturas AUTOMÁTICAS
// registradas depois do novo horário (elas ainda "não aconteceram"). Pedidos
// de encerramento administrativo continuam valendo (F05).
export function resetClock(state) {
  const clockNow = ADMIN_DEMO_CLOCK_START;
  const events = state.events.map((event) => {
    const openedAt = toMs(own(event, 'openedAt'));
    return openedAt !== null && openedAt > toMs(clockNow) ? { ...event, openedAt: null } : event;
  });
  return ok(latchOpenings({ ...state, clockNow, events }), 'CLOCK_RESET',
    'Relógio da demonstração voltou ao início.');
}

export function findEvent(state, eventId) {
  if (typeof eventId !== 'string') return null;
  return (state?.events ?? []).find((event) => hasOwn(event, 'id') && event.id === eventId) ?? null;
}

// ─── Código de ingresso (C-10 / §18.3) ───────────────────────────────────

// Normalização da demo: trim + maiúsculas. Não alega normalização Unicode
// perfeita nem garantia do servidor (§18.7).
export function normalizeAccessCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

// Código reservado por QUALQUER evento da demonstração, inclusive encerrado.
export function isAccessCodeTaken(events, code) {
  const normalized = normalizeAccessCode(code);
  if (!normalized) return false;
  return (events ?? []).some((event) => normalizeAccessCode(own(event, 'accessCode')) === normalized);
}

// ─── Estrutura do evento (ADM02): experiências, estações e Staff ──────────

// Experiências do evento, na ordem de cadastro. Nunca de outro evento.
export function listExperiences(state, eventId) {
  if (typeof eventId !== 'string') return [];
  return (state?.experiences ?? []).filter((experience) => own(experience, 'eventId') === eventId);
}

// Cadeia de pertencimento experiência → evento (§18.1): IDs de outro evento
// não são encontrados a partir deste.
export function findExperience(state, eventId, experienceId) {
  if (typeof experienceId !== 'string') return null;
  return listExperiences(state, eventId).find((experience) => own(experience, 'id') === experienceId) ?? null;
}

export function listStations(state, experienceId) {
  if (typeof experienceId !== 'string') return [];
  return (state?.stations ?? []).filter((station) => own(station, 'experienceId') === experienceId);
}

// Cadeia estação → experiência → evento.
export function findStation(state, eventId, experienceId, stationId) {
  if (typeof stationId !== 'string' || !findExperience(state, eventId, experienceId)) return null;
  return listStations(state, experienceId).find((station) => own(station, 'id') === stationId) ?? null;
}

// Chamada pendente (service_session "pending") da estação: é ela que ocupa a
// estação. Não existe campo de ocupação gravado na estação.
export function getPendingCall(state, stationId) {
  if (typeof stationId !== 'string') return null;
  return (state?.serviceCalls ?? []).find((call) => own(call, 'stationId') === stationId
    && own(call, 'status') === 'pending') ?? null;
}

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function findAccount(state, accountId) {
  if (typeof accountId !== 'string') return null;
  return (state?.accounts ?? []).find((account) => own(account, 'id') === accountId) ?? null;
}

export function findAccountByEmail(state, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (state?.accounts ?? []).find((account) => normalizeEmail(own(account, 'email')) === normalized) ?? null;
}

// Busca na lista de contas JÁ EXISTENTES (nada é criado por aqui).
export function searchAccounts(state, query) {
  const term = normalizeEmail(query);
  return (state?.accounts ?? []).filter((account) =>
    term === '' || normalizeEmail(own(account, 'email')).includes(term));
}

// Staff apto: conta ativa e e-mail verificado (§2.3 / C-05), sem exigir Staff online.
export function isAccountApt(account) {
  return own(account, 'active') === true && own(account, 'emailVerified') === true;
}

export function getAccountIssue(account) {
  if (!account) return 'Conta não encontrada';
  if (own(account, 'active') !== true) return 'Conta inativa';
  if (own(account, 'emailVerified') !== true) return 'E-mail não verificado';
  return null;
}

// Vínculos Staff vigentes (não revogados) DESTE evento.
export function listCurrentStaffGrants(state, eventId) {
  if (typeof eventId !== 'string') return [];
  return (state?.staffGrants ?? []).filter((grant) => own(grant, 'eventId') === eventId
    && own(grant, 'revokedAt') == null);
}

export function getEventStaff(state, eventId) {
  return listCurrentStaffGrants(state, eventId).map((grant) => {
    const account = findAccount(state, own(grant, 'accountId'));
    return { grant, account, email: own(account, 'email') ?? '—', apt: isAccountApt(account), issue: getAccountIssue(account) };
  });
}

// Resumo DERIVADO da estrutura cadastrada. É a fonte da prontidão: nenhum
// campo de prontidão é gravado no evento.
export function getStructureSummary(state, eventId) {
  const experiences = listExperiences(state, eventId);
  let stations = 0;
  let availableStations = 0;
  let experiencesWithAvailableStation = 0;
  experiences.forEach((experience) => {
    const stationsOfExperience = listStations(state, experience.id);
    const available = stationsOfExperience.filter((station) => station.availability === 'available').length;
    stations += stationsOfExperience.length;
    availableStations += available;
    if (available > 0) experiencesWithAvailableStation += 1;
  });
  const staff = getEventStaff(state, eventId);
  return {
    experiences: experiences.length,
    stations,
    availableStations,
    experiencesWithAvailableStation,
    currentGrants: staff.length,
    validStaff: staff.filter((item) => item.apt).length,
  };
}

// Marco C-13: qualquer participação histórica (espera externa, ativa,
// finalizada ou cancelada) trava as mudanças estruturais do evento.
export function hasParticipationHistory(event) {
  if (toMs(own(event, 'firstParticipationAt')) !== null) return true;
  const participants = own(event, 'participants');
  return ['externalWaiting', 'active', 'finished'].some((key) => Number(own(participants, key)) > 0);
}

// ─── Cortes, prontidão e fase efetiva (§2.3, §5, §18.4, C-05, C-14) ───────

// Corte de NOVAS entradas: min(horário oficial, pedido de encerramento Admin).
export function getEntriesCutAt(event) {
  return earliest(own(event, 'officialEndsAt'), own(event, 'closureRequestedAt'));
}

// Corte de chamadas/conclusões: min(limite operacional, prazo Admin).
export function getOperationalCutAt(event) {
  return earliest(own(event, 'operationalDeadlineAt'), own(event, 'adminDeadlineAt'));
}

export function validateSchedule(startsAt, officialEndsAt, operationalDeadlineAt) {
  const start = toMs(startsAt);
  const official = toMs(officialEndsAt);
  const operational = toMs(operationalDeadlineAt);
  if (start === null || official === null || operational === null) {
    return { ok: false, code: 'INVALID_INSTANT', message: 'Informe datas e horários válidos.' };
  }
  if (!(start < official)) {
    return {
      ok: false,
      code: 'END_NOT_AFTER_START',
      message: 'O encerramento oficial precisa ser depois do início.',
    };
  }
  if (operational < official) {
    return {
      ok: false,
      code: 'DEADLINE_BEFORE_OFFICIAL_END',
      message: 'O limite operacional não pode ser antes do encerramento oficial.',
    };
  }
  if (operational > official + ADMIN_MAX_MARGIN_MINUTES * 60 * 1000) {
    return {
      ok: false,
      code: 'DEADLINE_MARGIN_TOO_LONG',
      message: `O limite operacional pode ser no máximo ${ADMIN_MAX_MARGIN_MINUTES} minutos depois do encerramento oficial.`,
    };
  }
  return { ok: true };
}

// Prontidão de ABERTURA (C-05), calculada a partir das entidades da sessão
// (experiências, estações, contas e vínculos Staff). Sem a sessão não há
// estrutura cadastrada, portanto os critérios estruturais ficam pendentes.
export function getReadiness(event, session) {
  const structure = getStructureSummary(session, own(event, 'id'));
  const checks = {
    NAME_AND_ACCESS_CODE:
      typeof own(event, 'name') === 'string' && own(event, 'name').trim() !== ''
      && normalizeAccessCode(own(event, 'accessCode')) !== '',
    VALID_SCHEDULE_AND_TIMEZONE:
      findTimezone(own(event, 'timezone')) !== null
      && validateSchedule(own(event, 'startsAt'), own(event, 'officialEndsAt'),
        own(event, 'operationalDeadlineAt')).ok,
    EXTERNAL_QUEUE_CONFIGURED: typeof own(event, 'externalQueueEnabled') === 'boolean',
    EXPERIENCE_WITH_AVAILABLE_STATION: structure.experiencesWithAvailableStation > 0,
    VERIFIED_ACTIVE_STAFF: structure.validStaff > 0,
  };
  const missing = Object.keys(adminReadinessLabels).filter((key) => !checks[key]);
  return { ready: missing.length === 0, checks, missing, structure };
}

// O evento já abriu antes? Fixture com status "open" ou abertura automática
// registrada (openedAt) até o instante consultado.
function isOpenLatched(event, now) {
  if (own(event, 'statusStored') === 'open') return true;
  const openedAt = toMs(own(event, 'openedAt'));
  return openedAt !== null && toMs(now) >= openedAt;
}

// Fase efetiva: o status armazenado NÃO substitui relógio e prontidão.
// Abertura é automática (sem botão "Abrir Evento"): a partir do início,
// estando pronto e antes do corte de novas entradas. Depois de aberto, perder
// Staff/estação suspende novas entradas, mas o evento continua "open" (C-14).
export function getEffectivePhase(event, now, session) {
  const nowMs = toMs(now);
  if (own(event, 'statusStored') === 'closed') return 'closed';
  if (nowMs >= toMs(getOperationalCutAt(event))) return 'closed';
  // Encerramento administrativo é irreversível: nem o relógio de teste
  // reiniciado para antes do pedido faz o evento voltar a aceitar entradas.
  if (own(event, 'closureMode')) return 'closing';
  if (nowMs >= toMs(getEntriesCutAt(event))) return 'closing';
  if (nowMs < toMs(own(event, 'startsAt'))) return 'scheduled';
  if (isOpenLatched(event, now)) return 'open';
  return getReadiness(event, session).ready ? 'open' : 'scheduled';
}

// Abertura automática (C-05) materializada: quando a fase calculada passa a
// ser "open" pela primeira vez, registra openedAt (no início, se ele caiu
// dentro do intervalo do relógio, ou no instante da configuração que completou
// a prontidão). O status armazenado não é alterado.
function latchOpenings(state, fromClock = state.clockNow) {
  let changed = false;
  const events = state.events.map((event) => {
    if (isOpenLatched(event, state.clockNow)) return event;
    if (getEffectivePhase(event, state.clockNow, state) !== 'open') return event;
    changed = true;
    const openedAt = toMs(own(event, 'startsAt')) > toMs(fromClock) ? event.startsAt : fromClock;
    return { ...event, openedAt };
  });
  return changed ? { ...state, events } : state;
}

// Texto em português com o termo técnico entre parênteses: "Aberto (open)".
export function phaseText(phase) {
  return hasOwn(adminPhaseLabels, phase) ? `${adminPhaseLabels[phase]} (${phase})` : String(phase);
}

// O que falta para a capacidade operacional atual (C-14).
export function getCapacityGaps(readiness) {
  const gaps = [];
  if (!readiness.checks.VERIFIED_ACTIVE_STAFF) gaps.push('sem Staff apto no evento');
  if (!readiness.checks.EXPERIENCE_WITH_AVAILABLE_STATION) gaps.push('nenhuma estação disponível no evento');
  if (gaps.length === 0 && !readiness.ready) gaps.push('critérios de prontidão pendentes');
  return gaps;
}

// Três conceitos distintos: fase (phase), prontidão de abertura (readiness) e
// capacidade operacional atual (acceptingNewParticipations / capacitySuspended).
export function describeEvent(event, now, session) {
  const phase = getEffectivePhase(event, now, session);
  const readiness = getReadiness(event, session);
  const started = toMs(now) >= toMs(own(event, 'startsAt'));
  return {
    phase,
    statusStored: own(event, 'statusStored'),
    readiness,
    // Início alcançado, mas nunca abriu: continua sem aceitar participações.
    waitingReadiness: phase === 'scheduled' && started && !readiness.ready,
    // Aberto, mas sem Staff apto ou sem estação disponível agora (C-14).
    capacitySuspended: phase === 'open' && !readiness.ready,
    acceptingNewParticipations: phase === 'open' && readiness.ready,
    openedAt: own(event, 'openedAt') ?? null,
    hasParticipationHistory: hasParticipationHistory(event),
    entriesCutAt: getEntriesCutAt(event),
    operationalCutAt: getOperationalCutAt(event),
  };
}

// Motivo, em minúsculas, de o evento não aceitar novas entradas agora.
export function describeEntriesBlock(info) {
  if (info.phase === 'closed') return 'evento encerrado';
  if (info.phase === 'closing') return 'o corte de novas entradas já foi alcançado';
  if (info.phase === 'scheduled') {
    return info.waitingReadiness
      ? 'o evento ainda não abriu: faltam critérios de prontidão'
      : 'o evento ainda não começou';
  }
  if (info.capacitySuspended) return getCapacityGaps(info.readiness).join(' e ');
  return null;
}

export function getPanelSummary(state) {
  const counts = { total: 0, notReady: 0 };
  ADMIN_PHASES.forEach((phase) => { counts[phase] = 0; });
  (state?.events ?? []).forEach((event) => {
    const info = describeEvent(event, state.clockNow, state);
    counts.total += 1;
    counts[info.phase] += 1;
    if (info.phase !== 'closed' && !info.readiness.ready) counts.notReady += 1;
  });
  return counts;
}

// Lista do "Gerenciar Eventos": busca por nome/código e filtro por fase.
export function listEvents(state, { query = '', phase = 'all' } = {}) {
  const term = typeof query === 'string' ? query.trim().toUpperCase() : '';
  return (state?.events ?? [])
    .map((event) => ({ event, info: describeEvent(event, state.clockNow, state) }))
    .filter(({ event, info }) => (phase === 'all' ? true : info.phase === phase)
      && (term === ''
        || String(own(event, 'name') ?? '').toUpperCase().includes(term)
        || normalizeAccessCode(own(event, 'accessCode')).includes(term)))
    .sort((a, b) => toMs(own(a.event, 'startsAt')) - toMs(own(b.event, 'startsAt')));
}

// ─── Criar evento (§18.3) ────────────────────────────────────────────────

function parseMinutes(value, max) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,3}$/.test(text.trim())) return null;
  const minutes = Number(text.trim());
  return minutes <= max ? minutes : null;
}

function validReason(reason) {
  return typeof reason === 'string' && reason.trim().length >= ADMIN_REASON_MIN_LENGTH;
}

const REASON_MESSAGE = `Informe uma justificativa (mínimo de ${ADMIN_REASON_MIN_LENGTH} caracteres).`;

// Valida o rascunho do formulário e monta o corpo do contrato ilustrativo.
// Campos fora do DTO aprovado (local, tipo, descrição, catálogo) não existem aqui.
export function validateEventDraft(draft, events) {
  const errors = {};
  const name = own(draft, 'name');
  const accessCode = normalizeAccessCode(own(draft, 'accessCode'));
  const timezone = own(draft, 'timezone');
  const externalQueueEnabled = own(draft, 'externalQueueEnabled');
  const reason = own(draft, 'reason');

  if (typeof name !== 'string' || name.trim() === '') errors.name = 'Informe o nome do evento.';
  else if (name.trim().length > ADMIN_NAME_MAX_LENGTH) {
    errors.name = `O nome pode ter no máximo ${ADMIN_NAME_MAX_LENGTH} caracteres.`;
  }

  if (accessCode === '') errors.accessCode = 'Informe o código de ingresso.';
  else if (accessCode.length > ADMIN_CODE_MAX_LENGTH) {
    errors.accessCode = `O código pode ter no máximo ${ADMIN_CODE_MAX_LENGTH} caracteres.`;
  } else if (isAccessCodeTaken(events, accessCode)) {
    errors.accessCode = 'Este código já está reservado por outro evento da demonstração (inclusive encerrado). Códigos nunca são reutilizados.';
  }

  if (timezone === undefined || timezone === null || timezone === '') {
    errors.timezone = 'Escolha o fuso horário do evento.';
  } else if (!findTimezone(timezone)) {
    errors.timezone = 'Fuso horário IANA não reconhecido.';
  }

  if (typeof externalQueueEnabled !== 'boolean') {
    errors.externalQueueEnabled = 'Defina se a fila externa começa habilitada ou desabilitada.';
  }

  if (!validReason(reason)) errors.reason = REASON_MESSAGE;

  // Os três instantes são digitados no fuso do evento (sem o fuso do aparelho).
  const zone = findTimezone(timezone);
  const startsAt = zone ? localToInstant(own(draft, 'startDate'), own(draft, 'startTime'), timezone) : null;
  const officialEndsAt = zone
    ? localToInstant(own(draft, 'officialEndDate'), own(draft, 'officialEndTime'), timezone)
    : null;
  const operationalDeadlineAt = zone
    ? localToInstant(own(draft, 'operationalDeadlineDate'), own(draft, 'operationalDeadlineTime'), timezone)
    : null;

  if (zone && !startsAt) errors.startsAt = 'Data/hora de início inválida (use DD/MM/AAAA e HH:MM).';
  if (zone && !officialEndsAt) {
    errors.officialEndsAt = 'Data/hora de encerramento oficial inválida (use DD/MM/AAAA e HH:MM).';
  }
  if (zone && !operationalDeadlineAt) {
    errors.operationalDeadlineAt = 'Data/hora do limite operacional inválida (use DD/MM/AAAA e HH:MM).';
  }

  if (startsAt && officialEndsAt && operationalDeadlineAt) {
    const schedule = validateSchedule(startsAt, officialEndsAt, operationalDeadlineAt);
    if (!schedule.ok) {
      const field = schedule.code === 'END_NOT_AFTER_START' ? 'officialEndsAt' : 'operationalDeadlineAt';
      errors[field] = schedule.message;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, code: 'VALIDATION_ERROR', errors };
  }
  return {
    ok: true,
    payload: {
      name: name.trim(),
      accessCode,
      timezone,
      startsAt,
      officialEndsAt,
      operationalDeadlineAt,
      externalQueueEnabled,
      reason: reason.trim(),
    },
  };
}

// Cadastra o evento no estado local: nasce "scheduled", sem experiências,
// estações nem Staff, portanto NÃO pronto (§18.3). A prontidão é calculada.
export function createEvent(state, draft) {
  const validation = validateEventDraft(draft, state.events);
  if (!validation.ok) {
    const duplicate = hasOwn(validation.errors, 'accessCode')
      && /reservado/.test(validation.errors.accessCode);
    return fail(state, duplicate ? 'ACCESS_CODE_ALREADY_USED' : 'VALIDATION_ERROR',
      'Revise os campos destacados.', { errors: validation.errors });
  }
  const { payload } = validation;
  const sequence = state.sequence + 1;
  const event = {
    id: `demo-admin-novo-${sequence}`,
    name: payload.name,
    accessCode: payload.accessCode,
    timezone: payload.timezone,
    startsAt: payload.startsAt,
    officialEndsAt: payload.officialEndsAt,
    operationalDeadlineAt: payload.operationalDeadlineAt,
    statusStored: 'scheduled',
    externalQueueEnabled: payload.externalQueueEnabled,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    firstParticipationAt: null,
    participants: { externalWaiting: 0, active: 0, finished: 0 },
    audit: [{ action: 'CREATE', at: state.clockNow, reason: payload.reason }],
    createdInDemo: true,
  };
  return ok({ ...state, sequence, events: [...state.events, event] }, 'EVENT_CREATED',
    'Evento cadastrado na demonstração como "Agendado" e ainda não pronto.',
    { eventId: event.id });
}

function replaceEvent(state, nextEvent) {
  return { ...state, events: state.events.map((event) => (event.id === nextEvent.id ? nextEvent : event)) };
}

function auditEntry(state, action, reason, before, after) {
  return { action, at: state.clockNow, reason: reason.trim(), before, after };
}

// ─── Alterar horário oficial (§17.9, D07) ────────────────────────────────

export function getScheduleChangeAvailability(event, now) {
  if (!event) return { allowed: false, code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' };
  if (getEffectivePhase(event, now) === 'closed') {
    return { allowed: false, code: 'EVENT_ALREADY_CLOSED', message: 'Evento encerrado: horários não podem mudar e não há reabertura.' };
  }
  if (own(event, 'closureMode')) {
    return { allowed: false, code: 'EVENT_TIME_CHANGE_CLOSED', message: 'O evento está em encerramento administrativo: horários não podem mais mudar.' };
  }
  if (toMs(now) >= toMs(own(event, 'officialEndsAt'))) {
    return { allowed: false, code: 'EVENT_TIME_CHANGE_CLOSED', message: 'O horário oficial já foi alcançado: não é possível alterar horários nem reabrir o evento.' };
  }
  return { allowed: true };
}

// Muda encerramento oficial e limite operacional JUNTOS. Início e código não mudam.
export function changeSchedule(state, eventId, input) {
  const event = findEvent(state, eventId);
  const availability = getScheduleChangeAvailability(event, state.clockNow);
  if (!availability.allowed) return fail(state, availability.code, availability.message);

  const errors = {};
  const officialEndsAt = localToInstant(own(input, 'officialEndDate'), own(input, 'officialEndTime'), event.timezone);
  const operationalDeadlineAt = localToInstant(
    own(input, 'operationalDeadlineDate'), own(input, 'operationalDeadlineTime'), event.timezone);
  const reason = own(input, 'reason');
  if (!officialEndsAt) errors.officialEndsAt = 'Data/hora inválida (use DD/MM/AAAA e HH:MM).';
  if (!operationalDeadlineAt) errors.operationalDeadlineAt = 'Data/hora inválida (use DD/MM/AAAA e HH:MM).';
  if (!validReason(reason)) errors.reason = REASON_MESSAGE;

  if (officialEndsAt && toMs(officialEndsAt) <= toMs(state.clockNow)) {
    errors.officialEndsAt = 'O novo encerramento oficial precisa ser depois do horário atual da demonstração.';
  }
  if (officialEndsAt && operationalDeadlineAt && !errors.officialEndsAt) {
    const schedule = validateSchedule(event.startsAt, officialEndsAt, operationalDeadlineAt);
    if (!schedule.ok) {
      errors[schedule.code === 'END_NOT_AFTER_START' ? 'officialEndsAt' : 'operationalDeadlineAt'] = schedule.message;
    }
  }
  if (Object.keys(errors).length > 0) {
    return fail(state, 'VALIDATION_ERROR', 'Revise os campos destacados.', { errors });
  }
  if (officialEndsAt === event.officialEndsAt && operationalDeadlineAt === event.operationalDeadlineAt) {
    return fail(state, 'NO_CHANGE', 'Os horários informados são iguais aos atuais.');
  }

  const before = { officialEndsAt: event.officialEndsAt, operationalDeadlineAt: event.operationalDeadlineAt };
  const after = { officialEndsAt, operationalDeadlineAt };
  const next = {
    ...event,
    ...after,
    audit: [...event.audit, auditEntry(state, 'SCHEDULE', reason, before, after)],
  };
  return ok(replaceEvent(state, next), 'SCHEDULE_CHANGED', 'Horários atualizados na demonstração.');
}

// ─── Fila externa (§17.10) — distinta de novas inscrições ────────────────

export function getExternalQueueAvailability(event, now) {
  if (!event) return { allowed: false, code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' };
  const phase = getEffectivePhase(event, now);
  if (phase === 'closed' || phase === 'closing' || own(event, 'closureMode')) {
    return {
      allowed: false,
      code: 'EVENT_REGISTRATION_CLOSED',
      message: 'As novas entradas já foram encerradas: alternar a fila externa não reabre ingressos.',
    };
  }
  return { allowed: true };
}

export function setExternalQueue(state, eventId, input) {
  const event = findEvent(state, eventId);
  const availability = getExternalQueueAvailability(event, state.clockNow);
  if (!availability.allowed) return fail(state, availability.code, availability.message);
  const enabled = own(input, 'enabled');
  const reason = own(input, 'reason');
  if (typeof enabled !== 'boolean') return fail(state, 'VALIDATION_ERROR', 'Escolha habilitar ou desabilitar.');
  if (!validReason(reason)) return fail(state, 'VALIDATION_ERROR', REASON_MESSAGE, { errors: { reason: REASON_MESSAGE } });
  if (enabled === event.externalQueueEnabled) {
    return fail(state, 'NO_CHANGE', `A fila externa já está ${enabled ? 'habilitada' : 'desabilitada'}.`);
  }

  const participants = { ...event.participants };
  let released = 0;
  if (!enabled) {
    // Desligar libera quem aguardava na fila externa para "active".
    released = participants.externalWaiting;
    participants.active += released;
    participants.externalWaiting = 0;
  }
  const next = {
    ...event,
    externalQueueEnabled: enabled,
    participants,
    audit: [...event.audit, auditEntry(state, 'EXTERNAL_QUEUE', reason,
      { externalQueueEnabled: !enabled }, { externalQueueEnabled: enabled })],
  };
  const message = enabled
    ? 'Fila externa habilitada: vale só para as próximas entradas; quem já está ativo não volta a esperar.'
    : `Fila externa desabilitada: ${released} participante(s) em espera foram liberados (simulado).`;
  return ok(replaceEvent(state, next), 'EXTERNAL_QUEUE_CHANGED', message, { released });
}

// ─── Encerramento antecipado (§17.8, D09) ────────────────────────────────

export function getCloseAvailability(event, now) {
  if (!event) return { allowed: false, code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' };
  if (getEffectivePhase(event, now) === 'closed') {
    return { allowed: false, code: 'EVENT_ALREADY_CLOSED', message: 'Este evento já está encerrado.' };
  }
  const operationalCut = toMs(getOperationalCutAt(event));
  const maxControlledMinutes = Math.min(
    ADMIN_MAX_CONTROLLED_MINUTES,
    Math.floor((operationalCut - toMs(now)) / 60000),
  );
  const controlledBlocked = own(event, 'closureMode') === 'controlled'
    ? 'Já existe um encerramento controlado: alterar para outro controlado não está aprovado; só é possível antecipar para imediato.'
    : maxControlledMinutes < 1
      ? 'Não resta janela operacional válida: use o encerramento imediato.'
      : null;
  return { allowed: true, maxControlledMinutes: Math.max(0, maxControlledMinutes), controlledBlocked };
}

export function closeEvent(state, eventId, input) {
  const event = findEvent(state, eventId);
  const availability = getCloseAvailability(event, state.clockNow);
  if (!availability.allowed) return fail(state, availability.code, availability.message);
  const mode = own(input, 'mode');
  const reason = own(input, 'reason');
  if (mode !== 'immediate' && mode !== 'controlled') {
    return fail(state, 'VALIDATION_ERROR', 'Escolha o modo de encerramento.', { errors: { mode: 'Escolha o modo de encerramento.' } });
  }
  if (!validReason(reason)) return fail(state, 'VALIDATION_ERROR', REASON_MESSAGE, { errors: { reason: REASON_MESSAGE } });

  const now = state.clockNow;
  const participants = { ...event.participants };
  let next;
  let message;

  if (mode === 'immediate') {
    const finalized = participants.externalWaiting + participants.active;
    participants.finished += finalized;
    participants.externalWaiting = 0;
    participants.active = 0;
    next = {
      ...event,
      statusStored: 'closed',
      closureMode: 'immediate',
      closureRequestedAt: now,
      adminDeadlineAt: now,
      participants,
      adminFinalized: adminFinalizedOf(event) + finalized,
    };
    message = `Evento encerrado imediatamente (simulado): ${finalized} participação(ões) aberta(s) finalizada(s); conclusões preservadas. Filas internas e chamadas pendentes não são modeladas nesta demonstração: o cancelamento delas não foi simulado.`;
  } else {
    if (availability.controlledBlocked) {
      return fail(state, 'CLOSURE_DEADLINE_INVALID', availability.controlledBlocked);
    }
    const minutes = parseMinutes(own(input, 'controlledMinutes'), Number.MAX_SAFE_INTEGER);
    if (minutes === null || minutes < 1 || minutes > availability.maxControlledMinutes) {
      const limit = `Informe de 1 a ${availability.maxControlledMinutes} minuto(s) (máximo de ${ADMIN_MAX_CONTROLLED_MINUTES} min e nunca além do limite operacional autorizado).`;
      return fail(state, 'CLOSURE_DEADLINE_INVALID', limit, { errors: { controlledMinutes: limit } });
    }
    const finalizedExternal = participants.externalWaiting;
    participants.finished += finalizedExternal;
    participants.externalWaiting = 0;
    next = {
      ...event,
      statusStored: 'closing',
      closureMode: 'controlled',
      closureRequestedAt: now,
      adminDeadlineAt: addMinutes(now, minutes),
      participants,
      adminFinalized: adminFinalizedOf(event) + finalizedExternal,
    };
    message = `Encerramento controlado iniciado (simulado): novas entradas bloqueadas agora e ${finalizedExternal} espera(s) externa(s) finalizada(s) sem avaliação. Prazo para os atendimentos já existentes: ${minutes} min (filas internas não são modeladas nesta demonstração).`;
  }

  next.audit = [...event.audit, auditEntry(state, 'CLOSE', reason,
    { statusStored: event.statusStored, closureMode: event.closureMode, adminDeadlineAt: event.adminDeadlineAt },
    { statusStored: next.statusStored, closureMode: next.closureMode, adminDeadlineAt: next.adminDeadlineAt })];
  return ok(replaceEvent(state, next), 'EVENT_CLOSED', message);
}

// ─── ADM02: regras estruturais e operacionais (C-13, C-14, §20.1) ─────────

const ALLOWED = Object.freeze({ allowed: true });
const denied = (code, message) => ({ allowed: false, code, message });

export const ADMIN_STRUCTURE_ENDED_MESSAGE =
  'Evento encerrado definitivamente: a configuração não pode mais ser alterada e nenhuma operação reabre o evento.';
export const ADMIN_STRUCTURE_LOCKED_MESSAGE =
  'Este evento já teve participação (conta até mesmo uma espera externa ou uma participação já finalizada ou cancelada). Por isso não é mais possível criar experiências nem alterar nomes de experiências ou identificações de estações. Adicionar estações às experiências existentes continua permitido.';
export const ADMIN_PENDING_CALL_MESSAGE =
  'Esta estação tem uma chamada pendente: ela só pode ficar indisponível depois que a chamada for resolvida (concluída ou ausência) pela operação Staff. A resolução de chamadas não é simulada na Área Admin.';

// O que pode ser feito agora na estrutura do evento. Estruturais (criar e
// renomear) travam após a primeira participação histórica; operacionais
// (adicionar estação, disponibilidade, Staff) seguem até o encerramento.
export function getStructureRules(state, event, now = state?.clockNow) {
  const ended = getEffectivePhase(event, now, state) === 'closed';
  const history = hasParticipationHistory(event);
  const structural = ended
    ? denied('EVENT_OPERATION_ENDED', ADMIN_STRUCTURE_ENDED_MESSAGE)
    : history ? denied('EVENT_CONFIGURATION_LOCKED', ADMIN_STRUCTURE_LOCKED_MESSAGE) : ALLOWED;
  const operational = ended ? denied('EVENT_OPERATION_ENDED', ADMIN_STRUCTURE_ENDED_MESSAGE) : ALLOWED;
  return {
    ended,
    history,
    createExperience: structural,
    renameExperience: structural,
    renameStation: structural,
    addStation: operational,
    setAvailability: operational,
    grantStaff: operational,
    // Revogar por segurança nunca é impedido, nem sendo o último Staff (C-14).
    revokeStaff: ALLOWED,
  };
}

// Visão da estação: disponibilidade e ocupação são conceitos separados. Em
// evento encerrado, chamadas pendentes deixam de valer no corte definitivo.
export function describeStation(state, station, phase) {
  const pendingCall = phase === 'closed' ? null : getPendingCall(state, own(station, 'id'));
  return { station, available: own(station, 'availability') === 'available', pendingCall };
}

// Visão da experiência: uma fila única e as estações que a atendem. Novas
// entradas exigem evento aceitando participações E alguma estação desta
// experiência disponível (C-14 / §20.2).
export function describeExperience(state, event, experience, now = state?.clockNow) {
  const info = describeEvent(event, now, state);
  const stations = listStations(state, own(experience, 'id'))
    .map((station) => describeStation(state, station, info.phase));
  const stationsAvailable = stations.filter((item) => item.available).length;
  let entriesBlockedReason = null;
  if (!info.acceptingNewParticipations) {
    entriesBlockedReason = describeEntriesBlock(info);
  } else if (stationsAvailable === 0) {
    entriesBlockedReason = 'nenhuma estação desta experiência está disponível; quem já aguarda continua na fila';
  }
  return {
    stations,
    stationsTotal: stations.length,
    stationsAvailable,
    stationsOccupied: stations.filter((item) => item.pendingCall).length,
    queueWaiting: Number(own(own(experience, 'queue'), 'waiting')) || 0,
    acceptingNewEntries: entriesBlockedReason === null,
    entriesBlockedReason,
  };
}

const NOT_FOUND = {
  event: 'Evento não encontrado.',
  experience: 'Experiência não encontrada neste evento.',
  station: 'Estação não encontrada nesta experiência deste evento.',
  grant: 'Vínculo Staff não encontrado neste evento.',
};

// Nome de experiência ou identificação de estação: aparado, obrigatório, sem
// caracteres de controle e com tamanho máximo (em pontos de código).
function readStructuralText(input, key, max, what) {
  const raw = own(input, key);
  if (typeof raw !== 'string' || raw.trim() === '') return { error: `Informe ${what}.` };
  const text = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return { error: 'Não use quebras de linha nem caracteres de controle.' };
  if (Array.from(text).length > max) return { error: `Use no máximo ${max} caracteres.` };
  return { text };
}

// Registro local (não é a auditoria real, que será do backend).
function appendAudit(state, eventId, action, detail, before, after) {
  return {
    ...state,
    events: state.events.map((event) => (event.id === eventId
      ? { ...event, audit: [...event.audit, { action, at: state.clockNow, reason: null, detail, before, after }] }
      : event)),
  };
}

export function createExperience(state, eventId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const rule = getStructureRules(state, event).createExperience;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const name = readStructuralText(input, 'name', ADMIN_EXPERIENCE_NAME_MAX_LENGTH, 'o nome da experiência');
  if (name.error) return fail(state, 'VALIDATION_ERROR', name.error, { errors: { name: name.error } });

  const sequence = state.sequence + 1;
  const experience = { id: `demo-admin-exp-novo-${sequence}`, eventId: event.id, name: name.text, queue: { waiting: 0 } };
  const next = appendAudit({ ...state, sequence, experiences: [...state.experiences, experience] },
    event.id, 'EXPERIENCE_CREATE', name.text, null, { experienceId: experience.id, name: name.text });
  return ok(latchOpenings(next), 'EXPERIENCE_CREATED',
    `Experiência "${name.text}" criada com uma fila única, ainda sem estações.`, { experienceId: experience.id });
}

export function renameExperience(state, eventId, experienceId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const experience = findExperience(state, eventId, experienceId);
  if (!experience) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.experience);
  const rule = getStructureRules(state, event).renameExperience;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const name = readStructuralText(input, 'name', ADMIN_EXPERIENCE_NAME_MAX_LENGTH, 'o nome da experiência');
  if (name.error) return fail(state, 'VALIDATION_ERROR', name.error, { errors: { name: name.error } });
  if (name.text === experience.name) return fail(state, 'NO_CHANGE', 'O nome informado é igual ao atual.');

  const next = {
    ...state,
    experiences: state.experiences.map((item) => (item.id === experience.id ? { ...item, name: name.text } : item)),
  };
  return ok(appendAudit(next, event.id, 'EXPERIENCE_RENAME', `${experience.name} → ${name.text}`,
    { name: experience.name }, { name: name.text }),
  'EXPERIENCE_RENAMED', 'Nome da experiência atualizado. A fila e as estações continuam as mesmas.');
}

export function addStation(state, eventId, experienceId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const experience = findExperience(state, eventId, experienceId);
  if (!experience) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.experience);
  const rule = getStructureRules(state, event).addStation;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const label = readStructuralText(input, 'label', ADMIN_STATION_LABEL_MAX_LENGTH, 'a identificação da estação');
  if (label.error) return fail(state, 'VALIDATION_ERROR', label.error, { errors: { label: label.error } });

  const sequence = state.sequence + 1;
  // Nova estação nasce disponível, na MESMA experiência e na MESMA fila.
  const station = { id: `demo-admin-station-novo-${sequence}`, experienceId: experience.id, label: label.text, availability: 'available' };
  const next = appendAudit({ ...state, sequence, stations: [...state.stations, station] },
    event.id, 'STATION_CREATE', `${label.text} (${experience.name})`, null,
    { stationId: station.id, experienceId: experience.id, label: label.text });
  return ok(latchOpenings(next), 'STATION_CREATED',
    `Estação "${label.text}" adicionada a ${experience.name}: começa disponível e atende a mesma fila da experiência.`,
    { stationId: station.id });
}

export function renameStation(state, eventId, experienceId, stationId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const station = findStation(state, eventId, experienceId, stationId);
  if (!station) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.station);
  const rule = getStructureRules(state, event).renameStation;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const label = readStructuralText(input, 'label', ADMIN_STATION_LABEL_MAX_LENGTH, 'a identificação da estação');
  if (label.error) return fail(state, 'VALIDATION_ERROR', label.error, { errors: { label: label.error } });
  if (label.text === station.label) return fail(state, 'NO_CHANGE', 'A identificação informada é igual à atual.');

  const next = {
    ...state,
    stations: state.stations.map((item) => (item.id === station.id ? { ...item, label: label.text } : item)),
  };
  return ok(appendAudit(next, event.id, 'STATION_RENAME', `${station.label} → ${label.text}`,
    { label: station.label }, { label: label.text }),
  'STATION_RENAMED', 'Identificação da estação atualizada. Ela continua na mesma experiência e na mesma fila.');
}

// Comando OPERACIONAL (§16.7), separado da edição estrutural.
export function setStationAvailability(state, eventId, experienceId, stationId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const station = findStation(state, eventId, experienceId, stationId);
  if (!station) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.station);
  const rule = getStructureRules(state, event).setAvailability;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const availability = own(input, 'availability');
  if (availability !== 'available' && availability !== 'unavailable') {
    return fail(state, 'VALIDATION_ERROR', 'Escolha disponível ou indisponível.');
  }
  if (availability === station.availability) {
    return fail(state, 'NO_CHANGE', availability === 'available'
      ? 'A estação já está disponível.' : 'A estação já está indisponível.');
  }
  if (availability === 'unavailable' && getPendingCall(state, station.id)) {
    return fail(state, 'STATION_HAS_PENDING_CALL', ADMIN_PENDING_CALL_MESSAGE);
  }

  const next = {
    ...state,
    stations: state.stations.map((item) => (item.id === station.id ? { ...item, availability } : item)),
  };
  const message = availability === 'available'
    ? 'Estação disponível: volta a contar para a capacidade. Novas entradas só voltam se o evento ainda estiver antes do corte.'
    : 'Estação indisponível: não recebe novas chamadas. A fila da experiência e quem já aguarda continuam como estavam.';
  return ok(latchOpenings(appendAudit(next, event.id, 'STATION_AVAILABILITY',
    `${station.label}: ${availability === 'available' ? 'disponível' : 'indisponível'}`,
    { availability: station.availability }, { availability })),
  'STATION_AVAILABILITY_CHANGED', message);
}

// Concessão SIMULADA de Staff por evento, para conta já existente (D04).
export function grantStaff(state, eventId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const rule = getStructureRules(state, event).grantStaff;
  if (!rule.allowed) return fail(state, rule.code, rule.message);
  const email = normalizeEmail(own(input, 'email'));
  if (!email) {
    const message = 'Informe o e-mail de uma conta existente.';
    return fail(state, 'VALIDATION_ERROR', message, { errors: { email: message } });
  }
  const account = findAccountByEmail(state, email);
  if (!account) return fail(state, 'ACCOUNT_NOT_FOUND', 'Nenhuma conta existente usa este e-mail. Esta tela não cria contas.');
  if (own(account, 'active') !== true) return fail(state, 'ACCOUNT_INACTIVE', 'Conta inativa: não pode receber o vínculo Staff.');
  if (own(account, 'emailVerified') !== true) {
    return fail(state, 'EMAIL_NOT_VERIFIED', 'E-mail ainda não verificado: a concessão de Staff exige e-mail verificado.');
  }
  if (listCurrentStaffGrants(state, event.id).some((grant) => grant.accountId === account.id)) {
    return fail(state, 'STAFF_ALREADY_GRANTED', 'Esta conta já é Staff deste evento.');
  }

  const sequence = state.sequence + 1;
  const grant = { id: `demo-admin-grant-novo-${sequence}`, eventId: event.id, accountId: account.id, grantedAt: state.clockNow, revokedAt: null };
  const next = appendAudit({ ...state, sequence, staffGrants: [...state.staffGrants, grant] },
    event.id, 'STAFF_GRANT', account.email, null, { grantId: grant.id, accountId: account.id });
  return ok(latchOpenings(next), 'STAFF_GRANTED',
    `Staff concedido a ${account.email} somente neste evento (simulado: nenhum papel real foi alterado).`,
    { grantId: grant.id });
}

// Revogação SIMULADA: nunca impedida, nem para o último Staff (C-14). Não
// encerra o evento nem mexe em participações, filas ou chamadas.
export function revokeStaff(state, eventId, input) {
  const event = findEvent(state, eventId);
  if (!event) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.event);
  const grantId = own(input, 'grantId');
  const grant = typeof grantId === 'string'
    ? (state.staffGrants ?? []).find((item) => own(item, 'id') === grantId && own(item, 'eventId') === event.id)
    : null;
  if (!grant) return fail(state, 'RESOURCE_NOT_FOUND', NOT_FOUND.grant);
  if (own(grant, 'revokedAt') != null) return fail(state, 'NO_CHANGE', 'Este vínculo já foi revogado.');

  const account = findAccount(state, grant.accountId);
  const next = appendAudit({
    ...state,
    staffGrants: state.staffGrants.map((item) => (item.id === grant.id ? { ...item, revokedAt: state.clockNow } : item)),
  }, event.id, 'STAFF_REVOKE', own(account, 'email') ?? grant.accountId, { revokedAt: null }, { revokedAt: state.clockNow });
  const after = describeEvent(findEvent(next, event.id), next.clockNow, next);
  const message = after.capacitySuspended
    ? 'Vínculo revogado. Não há mais Staff apto: novas participações ficam suspensas, mas o evento continua aberto e nenhuma participação foi encerrada ou cancelada.'
    : 'Vínculo Staff revogado neste evento (simulado).';
  return ok(next, 'STAFF_REVOKED', message);
}

export function minutesUntil(now, iso) {
  return minutesBetween(now, iso);
}
