/**
 * Textos do evento encontrado a partir dos códigos estruturados do lookup.
 * A elegibilidade é sempre a do servidor; nada aqui usa o relógio do aparelho.
 */

// Mesma prioridade usada pelo backend ao recusar o ingresso.
const PRIORITY = [
  'EVENT_NOT_FOUND', 'USER_NOT_FOUND', 'USER_INACTIVE', 'PARTICIPATION_ALREADY_CURRENT',
  'PROFILE_INCOMPLETE', 'EVENT_NOT_STARTED', 'EVENT_REGISTRATION_CLOSED', 'EVENT_NOT_READY',
];

const REASONS = {
  EVENT_NOT_FOUND: 'Nenhum evento foi encontrado para esse código.',
  USER_NOT_FOUND: 'Não foi possível confirmar sua conta. Entre novamente.',
  USER_INACTIVE: 'Sua conta não está ativa para participar de eventos.',
  PARTICIPATION_ALREADY_CURRENT: 'Você já está participando de um evento. Volte ao início para continuar a participação atual.',
  PROFILE_INCOMPLETE: 'Complete o questionário de perfil antes de entrar no evento.',
  EVENT_NOT_STARTED: 'O evento ainda não começou. As entradas abrem no horário de início.',
  EVENT_REGISTRATION_CLOSED: 'As entradas neste evento foram encerradas.',
  EVENT_NOT_READY: 'O evento ainda não está pronto para receber participantes.',
};

const UNKNOWN_REASON = 'O evento não está disponível para entrada agora.';

export function sortBlockingReasons(reasons) {
  const list = Array.isArray(reasons) ? [...new Set(reasons)] : [];
  const rank = code => {
    const index = PRIORITY.indexOf(code);
    return index === -1 ? PRIORITY.length : index;
  };
  return list.sort((a, b) => rank(a) - rank(b));
}

export function describeBlockingReasons(reasons) {
  const messages = sortBlockingReasons(reasons).map(code => REASONS[code] ?? UNKNOWN_REASON);
  return [...new Set(messages.length ? messages : [UNKNOWN_REASON])];
}

/** Situação do evento para o participante, derivada só da elegibilidade do servidor. */
export function describeEventAvailability(eligibility) {
  if (eligibility?.eligible) {
    return { label: 'ENTRADAS ABERTAS', variant: 'success' };
  }
  const reasons = eligibility?.blockingReasons ?? [];
  if (reasons.includes('EVENT_NOT_STARTED')) return { label: 'AINDA NÃO INICIADO', variant: 'warning' };
  if (reasons.includes('EVENT_REGISTRATION_CLOSED')) return { label: 'ENTRADAS ENCERRADAS', variant: 'danger' };
  if (reasons.includes('EVENT_NOT_READY')) return { label: 'EM PREPARAÇÃO', variant: 'warning' };
  return { label: 'ENTRADA INDISPONÍVEL', variant: 'danger' };
}

export function describeExternalQueue(enabled) {
  return enabled
    ? 'Ao confirmar, você entra na fila de entrada e aguarda a liberação da equipe do evento.'
    : 'Ao confirmar, sua entrada na Arena é liberada logo em seguida.';
}

/** Ações auxiliares oferecidas para bloqueios que o participante pode resolver. */
export function blockingAction(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  if (list.includes('PARTICIPATION_ALREADY_CURRENT')) return 'home';
  if (list.includes('PROFILE_INCOMPLETE')) return 'questionnaire';
  return null;
}
