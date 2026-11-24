import { adminIdentifier } from '../../services/adminEventsService';
import { sendAdminEventOperation } from '../../services/adminEventOperationService';
import { bindAdminSession } from './adminStaffSession';

const messages = {
  ACCOUNT_DEACTIVATED: 'A conta administrativa foi desativada.',
  INVALID_SESSION: 'Sessão inválida. Entre novamente.',
  SESSION_REVOKED: 'Sessão revogada. Entre novamente.',
  SESSION_EXPIRED: 'Sessão expirada. Entre novamente.',
  ADMIN_REQUIRED: 'O acesso de Admin global é obrigatório.',
  ADMIN_2FA_REQUIRED: 'Confirme o segundo fator administrativo.',
  RESOURCE_NOT_FOUND: 'Evento não encontrado ou indisponível.',
  EVENT_ALREADY_CLOSED: 'O encerramento já foi iniciado ou o evento está encerrado.',
  EVENT_REGISTRATION_CLOSED: 'A janela para alterar a fila externa terminou.',
  EVENT_UNAVAILABLE: 'O evento não está disponível para esta operação.',
  CLOSURE_DEADLINE_INVALID: 'O prazo solicitado não está dentro dos limites atuais. Consulte o evento.',
  VALIDATION_ERROR: 'O servidor rejeitou os dados. Confira a justificativa e o prazo, quando aplicável.',
  IDEMPOTENCY_KEY_REUSED: 'A chave identifica outra operação. Confira o estado do evento com o responsável.',
  IDEMPOTENCY_IN_PROGRESS: 'A solicitação ainda está em processamento.',
};

export function operationError(error) {
  if (Object.hasOwn(messages, error?.code)) return messages[error.code];
  if ([401, 403].includes(error?.status)) return 'Sua sessão não permite esta operação. Entre novamente.';
  if (error?.status === 404) return messages.RESOURCE_NOT_FOUND;
  return 'Não foi possível obter uma resposta confiável. Confira a conexão e consulte o evento.';
}

export function bindOperationSession(manager, newKey, providerActive) {
  return bindAdminSession(manager, newKey, providerActive, createOperationSession, false);
}

function definitivelyRefused(request, error, recovery) {
  if (!recovery && !error?.outcomeUnknown) {
    if (error?.status === 400 && error.code === 'VALIDATION_ERROR') return true;
    if (error?.status === 404 && error.code === 'RESOURCE_NOT_FOUND') return true;
  }
  if (error?.status !== 409 || error.outcomeUnknown) return false;
  // Os conflitos de encerramento abaixo só ocorrem depois da procura por replay.
  if (request.kind === 'queue') {
    // A janela e a prontidão da fila podem voltar a admitir uma requisição atrasada.
    return !recovery && ['EVENT_REGISTRATION_CLOSED', 'EVENT_UNAVAILABLE'].includes(error.code);
  }
  return error.code === 'EVENT_ALREADY_CLOSED' ||
    (request.body.mode === 'controlled' && error.code === 'CLOSURE_DEADLINE_INVALID');
}

export function createOperationSession(client, newKey, isCurrent, { canSettle = isCurrent, revision, renew } = {}) {
  const events = new Map(), listeners = new Set();
  let denied = null;
  function publish(eventId, reload = false, outcome) {
    if (isCurrent()) listeners.forEach(listener => listener(eventId, reload, outcome));
  }
  function snapshot(eventId) {
    if (!isCurrent()) return {};
    return { ...events.get(eventId), denied };
  }
  async function send(eventId, intent, recovery) {
    if (!isCurrent() || denied) return;
    adminIdentifier(eventId);
    const previous = events.get(eventId)?.intent;
    if (recovery ? previous !== recovery || recovery.status !== 'unknown' : previous) return;
    const request = Object.freeze({
      eventId, kind: intent.kind, body: Object.freeze({ ...intent.body }),
      key: recovery?.key ?? newKey(), status: 'sending', timezone: intent.timezone,
    });
    const requestRevision = revision?.();
    events.set(eventId, { intent: request });
    publish(eventId);
    const current = () => canSettle() && !denied && events.get(eventId)?.intent === request;
    const track = (status, error) => {
      events.set(eventId, { intent: Object.freeze({ ...request, status }), error });
    };
    try {
      if (!current()) return;
      if (!isCurrent()) { track('unknown'); return; }
      const result = await sendAdminEventOperation(client, request);
      if (!current()) return;
      events.set(eventId, { receipt: { kind: request.kind, timezone: request.timezone, result } });
      publish(eventId, true, 'confirmed');
    } catch (error) {
      if (!current()) return;
      if (error?.status === 401 && error.code === 'ACCESS_TOKEN_EXPIRED') {
        track('unknown', 'A sessão precisa ser revalidada. O reenvio exige uma ação explícita.');
        publish(eventId);
        try { await renew?.(requestRevision); }
        catch { /* A autenticação apresenta a falha de renovação. */ }
        publish(eventId, true);
        return;
      }
      const message = operationError(error);
      if ([401, 403].includes(error?.status)) {
        denied = message;
        events.clear();
        publish(null);
        return;
      }
      if (error?.status === 409 && error.code === 'IDEMPOTENCY_KEY_REUSED' && !error.outcomeUnknown) {
        track('conflict', message);
      } else if (definitivelyRefused(request, error, recovery)) {
        events.set(eventId, { error: message });
      } else {
        track('unknown', message);
      }
      publish(eventId, true);
    }
  }
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start: (eventId, intent) => send(eventId, intent),
    retry: (eventId, record) => send(eventId, record, record),
  };
}
