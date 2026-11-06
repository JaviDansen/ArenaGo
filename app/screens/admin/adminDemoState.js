// Regras e transições LOCAIS da demonstração Admin (ADM01). Funções puras:
// recebem o estado atual e devolvem { state, result } sem alterar o objeto
// recebido. Nada aqui envia requisição nem concede permissão Admin/TOTP; a
// autoridade real será o backend (§17.8–17.10 e §18 da arquitetura).
import {
  ADMIN_CODE_MAX_LENGTH,
  ADMIN_DEMO_CLOCK_START,
  ADMIN_MAX_CONTROLLED_MINUTES,
  ADMIN_MAX_MARGIN_MINUTES,
  ADMIN_NAME_MAX_LENGTH,
  ADMIN_PHASES,
  ADMIN_REASON_MIN_LENGTH,
  adminDemoEvents,
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
  return {
    clockNow: ADMIN_DEMO_CLOCK_START,
    events: copy(adminDemoEvents),
    sequence: 0,
  };
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
  return ok({ ...state, clockNow, events }, 'CLOCK_ADVANCED',
    `Relógio da demonstração avançado em ${minutes} min.`);
}

export function resetClock(state) {
  return ok({ ...state, clockNow: ADMIN_DEMO_CLOCK_START }, 'CLOCK_RESET',
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

// ─── Cortes, prontidão e fase efetiva (§2.3, §5, §18.4, C-05) ────────────

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

export function getReadiness(event) {
  const readiness = own(event, 'readiness') ?? {};
  const checks = {
    NAME_AND_ACCESS_CODE:
      typeof own(event, 'name') === 'string' && own(event, 'name').trim() !== ''
      && normalizeAccessCode(own(event, 'accessCode')) !== '',
    VALID_SCHEDULE_AND_TIMEZONE:
      findTimezone(own(event, 'timezone')) !== null
      && validateSchedule(own(event, 'startsAt'), own(event, 'officialEndsAt'),
        own(event, 'operationalDeadlineAt')).ok,
    EXTERNAL_QUEUE_CONFIGURED: typeof own(event, 'externalQueueEnabled') === 'boolean',
    EXPERIENCE_WITH_AVAILABLE_STATION: Number(own(readiness, 'experiencesWithAvailableStation')) > 0,
    VERIFIED_ACTIVE_STAFF: Number(own(readiness, 'verifiedActiveStaff')) > 0,
  };
  const missing = Object.keys(adminReadinessLabels).filter((key) => !checks[key]);
  return { ready: missing.length === 0, checks, missing };
}

// Fase efetiva: o status armazenado NÃO substitui relógio e prontidão.
// Abertura é automática (sem botão "Abrir Evento"): só a partir do início,
// estando pronto e antes do corte de novas entradas.
export function getEffectivePhase(event, now) {
  const nowMs = toMs(now);
  if (own(event, 'statusStored') === 'closed') return 'closed';
  if (nowMs >= toMs(getOperationalCutAt(event))) return 'closed';
  // Encerramento administrativo é irreversível: nem o relógio de teste
  // reiniciado para antes do pedido faz o evento voltar a aceitar entradas.
  if (own(event, 'closureMode')) return 'closing';
  if (nowMs >= toMs(getEntriesCutAt(event))) return 'closing';
  if (nowMs >= toMs(own(event, 'startsAt')) && getReadiness(event).ready) return 'open';
  return 'scheduled';
}

// Texto em português com o termo técnico entre parênteses: "Aberto (open)".
export function phaseText(phase) {
  return hasOwn(adminPhaseLabels, phase) ? `${adminPhaseLabels[phase]} (${phase})` : String(phase);
}

export function describeEvent(event, now) {
  const phase = getEffectivePhase(event, now);
  const readiness = getReadiness(event);
  const started = toMs(now) >= toMs(own(event, 'startsAt'));
  return {
    phase,
    statusStored: own(event, 'statusStored'),
    readiness,
    // Início alcançado, mas sem prontidão: continua sem aceitar participações.
    waitingReadiness: phase === 'scheduled' && started && !readiness.ready,
    acceptingNewParticipations: phase === 'open',
    entriesCutAt: getEntriesCutAt(event),
    operationalCutAt: getOperationalCutAt(event),
  };
}

export function getPanelSummary(state) {
  const counts = { total: 0, notReady: 0 };
  ADMIN_PHASES.forEach((phase) => { counts[phase] = 0; });
  (state?.events ?? []).forEach((event) => {
    const info = describeEvent(event, state.clockNow);
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
    .map((event) => ({ event, info: describeEvent(event, state.clockNow) }))
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

// Cadastra o evento no estado local: nasce "scheduled", sem experiências nem
// Staff, portanto NÃO pronto (§18.3).
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
    readiness: { experiencesWithAvailableStation: 0, verifiedActiveStaff: 0 },
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
    };
    message = `Encerramento controlado iniciado (simulado): novas entradas bloqueadas agora e ${finalizedExternal} espera(s) externa(s) finalizada(s) sem avaliação. Prazo para os atendimentos já existentes: ${minutes} min (filas internas não são modeladas nesta demonstração).`;
  }

  next.audit = [...event.audit, auditEntry(state, 'CLOSE', reason,
    { statusStored: event.statusStored, closureMode: event.closureMode, adminDeadlineAt: event.adminDeadlineAt },
    { statusStored: next.statusStored, closureMode: next.closureMode, adminDeadlineAt: next.adminDeadlineAt })];
  return ok(replaceEvent(state, next), 'EVENT_CLOSED', message);
}

export function minutesUntil(now, iso) {
  return minutesBetween(now, iso);
}
