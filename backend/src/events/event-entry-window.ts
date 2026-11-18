import { toEpochMicros, type EventInstant } from "./event-instant";

/** Instantes de um evento relevantes para avaliar a janela temporal de ingresso. */
export interface EventEntryWindowTimes<T extends EventInstant = Date> {
  startsAt: T;
  officialEndsAt: T;
  closureRequestedAt: T | null;
  /** Limite de operações residuais; não prolonga a janela de novos ingressos. */
  operationalDeadlineAt: T;
  /** Prazo administrativo residual; não prolonga a janela de novos ingressos. */
  adminDeadlineAt: T | null;
}

/** Motivo pelo qual novas participações ainda não podem ser admitidas. */
export type EventEntryWindowBlockReason = "EVENT_NOT_STARTED" | "EVENT_ENTRY_CLOSED";

/** Resultado temporal; não representa prontidão nem autorização definitiva de ingresso. */
export interface EventEntryWindowResult {
  withinEntryWindow: boolean;
  blockReason: EventEntryWindowBlockReason | null;
  cutoffAt: Date;
}

/**
 * Avalia se um instante está dentro da janela temporal para admitir novos ingressos.
 *
 * @param event Horários do evento. `status` e condições operacionais não são avaliados.
 * @param at Instante absoluto usado como referência; deve vir do servidor chamador.
 * @returns Se o instante está na janela, o motivo de bloqueio ou o corte efetivo.
 * @remarks O início é inclusivo e o corte é exclusivo. O corte é o primeiro entre o
 * horário oficial e o fechamento Admin antecipado. O prazo operacional e o prazo Admin
 * tratam operações residuais e nunca estendem novas inscrições. Receber `at` explicitamente
 * mantém esta função pura e permite testes determinísticos, sem relógio oculto.
 */
export function evaluateEventEntryWindow(
  event: EventEntryWindowTimes<EventInstant>,
  at: EventInstant,
): EventEntryWindowResult {
  const start = toEpochMicros(event.startsAt);
  const officialEnd = toEpochMicros(event.officialEndsAt);
  const closure = event.closureRequestedAt === null ? null : toEpochMicros(event.closureRequestedAt);
  const cutoff = officialEnd !== null && closure !== null && closure < officialEnd ? closure : officialEnd;
  const observed = toEpochMicros(at);
  // A projeção Date faz parte do contrato. Toda comparação usa os valores exatos.
  const cutoffAt = new Date(cutoff === null ? Number.NaN : Number((cutoff < 0n ? cutoff - 999n : cutoff) / 1000n));

  if (observed !== null && start !== null && observed < start) {
    return {
      withinEntryWindow: false,
      blockReason: "EVENT_NOT_STARTED",
      cutoffAt,
    };
  }

  if (observed === null || start === null || cutoff === null || observed >= cutoff) {
    return {
      withinEntryWindow: false,
      blockReason: "EVENT_ENTRY_CLOSED",
      cutoffAt,
    };
  }

  return {
    withinEntryWindow: true,
    blockReason: null,
    cutoffAt,
  };
}
