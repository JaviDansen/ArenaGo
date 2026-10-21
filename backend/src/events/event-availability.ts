import { EventAccessCodeValidationError, normalizeEventAccessCode } from "./access-code";
import type { EventOperationalCapacityResult } from "./event-operational-capacity";
import type { EventEntryWindowResult } from "./event-entry-window";

/** Campos persistidos usados para avaliar a configuração estática conforme C-05. */
export interface EventConfigurationReadinessInput {
  name: string;
  accessCodeNormalized: string;
  startsAt: Date;
  officialEndsAt: Date;
  operationalDeadlineAt: Date;
  timezone: string;
  externalQueueEnabled: boolean;
}

/** Identificadores estáveis dos requisitos que podem impedir prontidão ou novas entradas. */
export type EventAvailabilityMissingCode =
  | "EVENT_NAME_OR_ACCESS_CODE_INVALID"
  | "EVENT_SCHEDULE_INVALID"
  | "EVENT_TIMEZONE_INVALID"
  | "EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED"
  | "EVENT_HAS_NO_AVAILABLE_STATION"
  | "EVENT_HAS_NO_AUTHORIZED_STAFF"
  | "EVENT_NOT_STARTED"
  | "EVENT_ENTRY_CLOSED"
  | "EVENT_ADMIN_CLOSING"
  | "EVENT_CLOSED";

/** Resultado dos critérios estáticos de configuração da prontidão C-05. */
export interface EventConfigurationReadinessResult {
  ready: boolean;
  checks: {
    nameAndAccessCode: boolean;
    validScheduleAndTimezone: boolean;
    externalQueueConfigured: boolean;
  };
  missing: EventAvailabilityMissingCode[];
}

/** Tipos do resultado consolidado da consulta informativa de disponibilidade. */
export type EventAvailabilityResult =
  | { eventExists: false }
  | {
      eventExists: true;
      eventId: string;
      ready: boolean;
      withinEntryWindow: boolean;
      eventAcceptingNewEntries: boolean;
      checks: EventConfigurationReadinessResult["checks"] & EventOperationalCapacityResult;
      missing: EventAvailabilityMissingCode[];
      cutoffAt: Date;
    };

const MAX_OPERATIONAL_EXTENSION_MS = 60 * 60 * 1000;

function isValidIanaTimeZone(timezone: string): boolean {
  try {
    // Intl usa a base de fusos do runtime; a validação não depende do fuso local do processo.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Avalia nome/código, horários, fuso e configuração explícita da fila externa.
 *
 * @param event Campos de configuração persistidos do evento.
 * @returns Prontidão estática e códigos dos requisitos não atendidos.
 * @remarks Não consulta banco, capacidade operacional, janela corrente nem altera o evento.
 * `externalQueueEnabled` é booleano NOT NULL: `false` é uma escolha explícita válida, não
 * ausência de configuração. Código persistido inválido apenas falha no check; nunca é reescrito.
 */
export function evaluateEventConfigurationReadiness(
  event: EventConfigurationReadinessInput,
): EventConfigurationReadinessResult {
  const missing: EventAvailabilityMissingCode[] = [];
  let canonicalCodeIsValid = false;

  try {
    canonicalCodeIsValid = normalizeEventAccessCode(event.accessCodeNormalized) === event.accessCodeNormalized;
  } catch (error) {
    if (!(error instanceof EventAccessCodeValidationError)) throw error;
  }

  const nameAndAccessCode = event.name.trim().length > 0 && canonicalCodeIsValid;
  if (!nameAndAccessCode) missing.push("EVENT_NAME_OR_ACCESS_CODE_INVALID");

  const startMs = event.startsAt.getTime();
  const officialEndMs = event.officialEndsAt.getTime();
  const operationalDeadlineMs = event.operationalDeadlineAt.getTime();
  const validSchedule = Number.isFinite(startMs)
    && Number.isFinite(officialEndMs)
    && Number.isFinite(operationalDeadlineMs)
    && startMs < officialEndMs
    && operationalDeadlineMs >= officialEndMs
    && operationalDeadlineMs <= officialEndMs + MAX_OPERATIONAL_EXTENSION_MS;
  if (!validSchedule) missing.push("EVENT_SCHEDULE_INVALID");

  const validTimezone = isValidIanaTimeZone(event.timezone);
  if (!validTimezone) missing.push("EVENT_TIMEZONE_INVALID");

  const externalQueueConfigured = typeof event.externalQueueEnabled === "boolean";
  if (!externalQueueConfigured) missing.push("EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED");

  const checks = {
    nameAndAccessCode,
    validScheduleAndTimezone: validSchedule && validTimezone,
    externalQueueConfigured,
  };
  const ready = checks.nameAndAccessCode
    && checks.validScheduleAndTimezone
    && checks.externalQueueConfigured;

  return { ready, checks, missing };
}

/**
 * Combina configuração, capacidade, janela temporal e estado administrativo do evento.
 *
 * @param input Resultados calculados separadamente para um evento já carregado.
 * @returns Prontidão, horário, disponibilidade consolidada e critérios ausentes.
 * @remarks `scheduled` não bloqueia automaticamente: o evento pode estar apto ao atingir
 * o início sem tarefa agendada. `closing` e `closed` nunca reabrem novas entradas. O resultado
 * é observacional, não uma autorização transacional para uma participação específica.
 */
export function buildEventAvailabilityResult(input: {
  eventId: string;
  eventStatus: string;
  configuration: EventConfigurationReadinessResult;
  entryWindow: EventEntryWindowResult;
  operationalCapacity: EventOperationalCapacityResult;
}): EventAvailabilityResult {
  const missing = [...input.configuration.missing];
  const checks = {
    ...input.configuration.checks,
    ...input.operationalCapacity,
  };

  if (!input.operationalCapacity.hasAvailableStation) {
    missing.push("EVENT_HAS_NO_AVAILABLE_STATION");
  }
  if (!input.operationalCapacity.hasAuthorizedStaff) {
    missing.push("EVENT_HAS_NO_AUTHORIZED_STAFF");
  }
  if (input.entryWindow.blockReason) {
    missing.push(input.entryWindow.blockReason);
  }
  if (input.eventStatus === "closing") missing.push("EVENT_ADMIN_CLOSING");
  if (input.eventStatus === "closed") missing.push("EVENT_CLOSED");

  const ready = input.configuration.ready
    && input.operationalCapacity.hasAuthorizedStaff
    && input.operationalCapacity.hasAvailableStation;
  const hasAdministrativeClosure = input.eventStatus === "closing" || input.eventStatus === "closed";

  return {
    eventExists: true,
    eventId: input.eventId,
    ready,
    withinEntryWindow: input.entryWindow.withinEntryWindow,
    eventAcceptingNewEntries: ready
      && input.entryWindow.withinEntryWindow
      && !hasAdministrativeClosure,
    checks,
    missing,
    cutoffAt: new Date(input.entryWindow.cutoffAt.getTime()),
  };
}
