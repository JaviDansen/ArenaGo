import { resolveEventTime } from './adminScheduleForm';

const hour = 3_600_000;
export const operationClock = () => globalThis.performance?.now?.() ?? Date.now();

export function observedOperationNow(snapshot, tick = operationClock()) {
  return Date.parse(snapshot.view.observedAt) + Math.max(0, tick - snapshot.receivedAt);
}

export function allowedEventOperations(view, now) {
  const beforeCut = Number.isFinite(now) && now < Date.parse(view.officialEndsAt) &&
    now < Date.parse(view.operationalDeadlineAt);
  const fresh = beforeCut && view.closureMode === null && view.closureRequestedAt === null && view.adminDeadlineAt === null;
  return {
    queue: fresh && view.canSetExternalQueue && view.effectivePhase === 'open',
    close: fresh && view.canClose && ['scheduled', 'not_ready', 'open'].includes(view.effectivePhase),
  };
}

export function prepareEventOperation(snapshot, draft, now) {
  const allowed = allowedEventOperations(snapshot, now);
  const reason = draft.reason.trim();
  if (!reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new Error('Informe uma justificativa válida de até 500 caracteres.');
  }
  if (draft.kind === 'queue' && allowed.queue && draft.enabled === !snapshot.externalQueueEnabled) {
    return { kind: 'queue', body: { enabled: draft.enabled, reason } };
  }
  if (draft.kind === 'close' && allowed.close) {
    if (draft.mode === 'immediate') return { kind: 'close', body: { mode: 'immediate', reason } };
    if (draft.mode === 'controlled') {
      const controlledUntilAt = resolveEventTime(draft.deadline, snapshot.timezone);
      const deadline = Date.parse(controlledUntilAt);
      if (deadline <= now || deadline > now + hour || deadline > Date.parse(snapshot.operationalDeadlineAt)) {
        throw new Error('Escolha um prazo futuro, de até uma hora, dentro do limite operacional do evento.');
      }
      return { kind: 'close', body: { mode: 'controlled', reason, controlledUntilAt } };
    }
  }
  throw new Error('A operação já não está disponível. Atualize o evento.');
}
