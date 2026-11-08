import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { operationUuid, validateOperationBody, validateOperationIdempotencyKey } from "../common/http/operation-validation";
import { EventAccessCodeValidationError, normalizeEventAccessCode } from "../events/access-code";
import { ParticipantQueueIdempotencyPolicy } from "../events/participant-queue-idempotency.policy";
import { EventsService } from "../events/events.service";
import type { JoinEligibilityBlockingReason, JoinEligibilityResult } from "./join-eligibility";
import { ParticipationsService, type CreateParticipationResult } from "./participations.service";

const lookupBody = z.object({ accessCode: z.string() }).strict();
const joinBody = z.object({ eventId: operationUuid }).strict();

function problem(status: HttpStatus, code: string, detail: string): never {
  throw new ProblemException({
    status, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
    title: status === HttpStatus.NOT_FOUND ? "Evento não encontrado" : "Ingresso indisponível", detail,
  });
}

const priority: JoinEligibilityBlockingReason[] = [
  "EVENT_NOT_FOUND", "USER_NOT_FOUND", "USER_INACTIVE", "PARTICIPATION_ALREADY_CURRENT",
  "PROFILE_INCOMPLETE", "EVENT_NOT_STARTED", "EVENT_REGISTRATION_CLOSED", "EVENT_NOT_READY",
];

function blocked(eligibility: JoinEligibilityResult): never {
  const reason = priority.find(value => eligibility.blockingReasons.includes(value)) ?? "EVENT_NOT_READY";
  const status = reason === "EVENT_NOT_FOUND" ? HttpStatus.NOT_FOUND
    : reason === "USER_NOT_FOUND" ? HttpStatus.UNAUTHORIZED
    : reason === "USER_INACTIVE" ? HttpStatus.FORBIDDEN
    : reason === "PROFILE_INCOMPLETE" ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.CONFLICT;
  problem(status, reason, "Os requisitos atuais não permitem ingressar neste evento.");
}

function joinResponse(result: CreateParticipationResult): { participationId: string } {
  if (result.kind === "blocked") blocked(result.eligibility);
  if (result.kind === "request_conflict") problem(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "Esta chave já foi usada para outro ingresso.");
  if (result.kind === "in_progress") problem(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "A operação com esta chave ainda está em andamento.");
  if (result.kind === "replay" && (result.httpStatus !== HttpStatus.CREATED ||
    result.idempotencyResult === null || typeof result.idempotencyResult !== "object" ||
    Array.isArray(result.idempotencyResult) || result.idempotencyResult.participationId !== result.participationId)) {
    throw new Error("Resposta idempotente de ingresso inconsistente.");
  }
  if (!result.participationId) throw new Error("Ingresso concluído sem identificador de participação.");
  return { participationId: result.participationId };
}

@Controller()
@RequireSessionAuth()
export class ParticipantAdmissionController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ParticipationsService) private readonly participations: ParticipationsService,
    @Inject(ParticipantQueueIdempotencyPolicy) private readonly policy: ParticipantQueueIdempotencyPolicy,
  ) {}

  @Post("events/lookup")
  @HttpCode(HttpStatus.OK)
  async lookup(@CurrentUserId() userId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { accessCode } = validateOperationBody(lookupBody, body, request);
    let normalized: string;
    try { normalized = normalizeEventAccessCode(accessCode); }
    catch (error) {
      if (!(error instanceof EventAccessCodeValidationError)) throw error;
      problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", error.message);
    }
    const event = await this.events.findByAccessCode(normalized);
    if (!event) problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Evento não encontrado para este código.");
    const eligibility = await this.participations.evaluateJoinEligibility(userId, event.id, new Date());
    return {
      event: { id: event.id, name: event.name, timezone: event.timezone,
        startsAt: event.startsAt, officialEndsAt: event.officialEndsAt,
        operationalDeadlineAt: event.operationalDeadlineAt, externalQueueEnabled: event.externalQueueEnabled },
      eligibility: { eligible: eligibility.eligible, blockingReasons: eligibility.blockingReasons },
    };
  }

  @Post("participations")
  @HttpCode(HttpStatus.CREATED)
  async join(@CurrentUserId() userId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { eventId } = validateOperationBody(joinBody, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    const result = await this.participations.createParticipation({
      userId, eventId, idempotencyKey, expiresAt: this.policy.expiresAt(),
    });
    return joinResponse(result);
  }
}
