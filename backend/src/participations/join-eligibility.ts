import type { EventAvailabilityResult } from "../events/event-availability";

/** Motivos de domínio que impedem a elegibilidade informativa para ingresso. */
export type JoinEligibilityBlockingReason =
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_STARTED"
  | "EVENT_NOT_READY"
  | "EVENT_REGISTRATION_CLOSED"
  | "USER_NOT_FOUND"
  | "PROFILE_INCOMPLETE"
  | "PARTICIPATION_ALREADY_CURRENT";

/** Fatos lidos para combinar elegibilidade sem produzir efeitos no banco. */
export interface JoinEligibilityFacts {
  eventAvailability: EventAvailabilityResult;
  userExists: boolean;
  hasCompletedQuestionnaire: boolean;
  questionnaireVersionValid: boolean;
  hasSelectedGames: boolean;
  hasCurrentParticipation: boolean;
}

/** Resultado da verificação informativa de pré-requisitos para uma nova participação. */
export interface JoinEligibilityResult {
  eligible: boolean;
  eventExists: boolean;
  userExists: boolean;
  checks: {
    eventAcceptingNewEntries: boolean;
    hasCompletedQuestionnaire: boolean;
    questionnaireVersionValid: boolean;
    hasSelectedGames: boolean;
    hasNoCurrentParticipation: boolean;
  };
  blockingReasons: JoinEligibilityBlockingReason[];
}

/**
 * Combina as leituras de evento, perfil, jogos e participação corrente.
 *
 * @param facts Resultados obtidos pelos serviços e consultas de leitura.
 * @returns Indicadores e todos os motivos de bloqueio encontrados, sem prioridade HTTP.
 * @remarks Uma avaliação favorável não autentica o usuário nem garante ingresso; a futura
 * criação deve reler estes dados e gravar participação/snapshot atomicamente.
 */
export function combineJoinEligibility(facts: JoinEligibilityFacts): JoinEligibilityResult {
  const blockingReasons = new Set<JoinEligibilityBlockingReason>();
  const eventAvailability = facts.eventAvailability;
  const eventExists = eventAvailability.eventExists;
  let eventAcceptingNewEntries = false;

  if (!eventExists) {
    blockingReasons.add("EVENT_NOT_FOUND");
  } else {
    eventAcceptingNewEntries = eventAvailability.eventAcceptingNewEntries;
    if (!eventAvailability.ready) blockingReasons.add("EVENT_NOT_READY");

    if (!eventAvailability.withinEntryWindow) {
      if (eventAvailability.missing.includes("EVENT_NOT_STARTED")) {
        blockingReasons.add("EVENT_NOT_STARTED");
      }
      if (eventAvailability.missing.includes("EVENT_ENTRY_CLOSED")) {
        blockingReasons.add("EVENT_REGISTRATION_CLOSED");
      }
    }

    if (eventAvailability.missing.includes("EVENT_ADMIN_CLOSING")
      || eventAvailability.missing.includes("EVENT_CLOSED")) {
      blockingReasons.add("EVENT_REGISTRATION_CLOSED");
    }
  }

  const profileComplete = facts.hasCompletedQuestionnaire
    && facts.questionnaireVersionValid
    && facts.hasSelectedGames;
  if (!facts.userExists) blockingReasons.add("USER_NOT_FOUND");
  if (!profileComplete) blockingReasons.add("PROFILE_INCOMPLETE");
  if (facts.hasCurrentParticipation) {
    blockingReasons.add("PARTICIPATION_ALREADY_CURRENT");
  }

  return {
    eligible: blockingReasons.size === 0,
    eventExists,
    userExists: facts.userExists,
    checks: {
      eventAcceptingNewEntries,
      hasCompletedQuestionnaire: facts.hasCompletedQuestionnaire,
      questionnaireVersionValid: facts.questionnaireVersionValid,
      hasSelectedGames: facts.hasSelectedGames,
      hasNoCurrentParticipation: !facts.hasCurrentParticipation,
    },
    blockingReasons: [...blockingReasons],
  };
}
