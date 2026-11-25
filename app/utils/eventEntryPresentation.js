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
  return describeQueueConfiguration({ externalQueueEnabled: enabled }, { eligible: true, blockingReasons: [] }).text;
}

/**
 * Configuração oficial da fila externa, adaptada à situação oficial do evento.
 * Nunca sugere que o ingresso é possível quando o servidor diz o contrário.
 * @param eligibility elegibilidade confirmada; `null` quando está sendo revalidada.
 */
export function describeQueueConfiguration(event, eligibility) {
  if (typeof event?.externalQueueEnabled !== 'boolean') return null;
  const queue = event.externalQueueEnabled;
  const title = queue ? 'Evento com fila de entrada' : 'Entrada direta na Arena';
  const reasons = Array.isArray(eligibility?.blockingReasons) ? eligibility.blockingReasons : [];
  let text;
  if (!eligibility) {
    text = queue
      ? 'Este evento usa fila de entrada: após o ingresso, você aguarda a liberação da equipe do evento.'
      : 'Este evento não usa fila de entrada: após o ingresso, a entrada na Arena é liberada em seguida.';
  } else if (eligibility.eligible) {
    return {
      title: queue ? 'Fila de entrada ativa' : title,
      text: queue
        ? 'Ao confirmar, você entra na fila de entrada e aguarda a liberação da equipe do evento.'
        : 'Ao confirmar, sua entrada na Arena é liberada logo em seguida.',
    };
  } else if (reasons.includes('EVENT_REGISTRATION_CLOSED')) {
    text = queue
      ? 'As entradas foram encerradas. Não é mais possível entrar na fila deste evento.'
      : 'As entradas foram encerradas. Não é mais possível entrar neste evento.';
  } else if (reasons.includes('EVENT_NOT_STARTED') || reasons.includes('EVENT_NOT_READY')) {
    text = queue
      ? 'Quando as entradas forem abertas, quem confirmar entra na fila de entrada e aguarda a liberação da equipe. Ainda não é possível ingressar.'
      : 'Este evento não usa fila de entrada. Quando as entradas forem abertas, a entrada na Arena é liberada logo após a confirmação. Ainda não é possível ingressar.';
  } else {
    text = queue
      ? 'Este evento usa fila de entrada: após um ingresso permitido, você aguarda a liberação da equipe do evento.'
      : 'Este evento não usa fila de entrada: após um ingresso permitido, a entrada na Arena é liberada em seguida.';
  }
  return { title, text };
}

/**
 * Aviso sobre a programação quando a situação oficial a contradiz (ex.: encerramento
 * administrativo antes do horário programado). O contrato não informa o horário efetivo.
 */
export function describeScheduleNotice(eligibility) {
  const reasons = Array.isArray(eligibility?.blockingReasons) ? eligibility.blockingReasons : [];
  if (eligibility && !eligibility.eligible && reasons.includes('EVENT_REGISTRATION_CLOSED')) {
    return 'As entradas já foram encerradas. Os horários abaixo são a programação original e não valem mais como prazo.';
  }
  return null;
}

/** Ações auxiliares oferecidas para bloqueios que o participante pode resolver. */
export function blockingAction(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  if (list.includes('PARTICIPATION_ALREADY_CURRENT')) return 'home';
  if (list.includes('PROFILE_INCOMPLETE')) return 'questionnaire';
  return null;
}
