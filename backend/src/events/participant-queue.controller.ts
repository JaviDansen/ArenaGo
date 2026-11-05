import { mutationSession } from "../auth/mutation-session";
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { emptyOperationBody, validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { QueueEntryService } from "./queue-entry.service";
import { QueueStateService } from "./queue-state.service";
import { QueueWithdrawalService } from "./queue-withdrawal.service";
import { ParticipantQueueIdempotencyPolicy } from "./participant-queue-idempotency.policy";
import { participationQueueParamsSchema, queueJoinBodySchema, queueWithdrawalParamsSchema } from "./participant-queue.dto";
import { rejectParticipantQueueOperation } from "./participant-queue.problem";

@Controller("participations/:participationId")
@RequireSessionAuth()
export class ParticipantQueueController {
  constructor(
    @Inject(QueueEntryService) private readonly joining: QueueEntryService,
    @Inject(QueueStateService) private readonly state: QueueStateService,
    @Inject(QueueWithdrawalService) private readonly withdrawal: QueueWithdrawalService,
    @Inject(ParticipantQueueIdempotencyPolicy) private readonly idempotency: ParticipantQueueIdempotencyPolicy,
  ) {}

  @Post("queue-entries")
  @HttpCode(HttpStatus.CREATED)
  async join(@CurrentUserId() userId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(participationQueueParamsSchema, params);
    const input = validateOperationBody(queueJoinBodySchema, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    const result = await this.joining.joinExperienceQueueAuthenticated({ ...ids, ...input, userId, idempotencyKey, expiresAt: this.idempotency.expiresAt() }, mutationSession(request, userId));
    if (result.kind === "created" || result.kind === "replay") {
      return { queueEntryId: result.queueEntryId, participationId: result.participationId, experienceId: result.experienceId,
        status: result.status, queueOrder: result.queueOrder, enteredAt: result.enteredAt };
    }
    return rejectParticipantQueueOperation(result.kind);
  }

  @Get("queue")
  @HttpCode(HttpStatus.OK)
  async get(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { participationId } = validateOperationParams(participationQueueParamsSchema, params);
    const result = await this.state.getParticipationQueue(userId, participationId);
    if (result.kind === "ok") return { participationId: result.participationId, observedAt: result.observedAt, currentQueueEntry: result.currentQueueEntry };
    return rejectParticipantQueueOperation(result.kind);
  }

  @Post("queue-entries/:queueEntryId/withdraw")
  @HttpCode(HttpStatus.OK)
  async withdraw(@CurrentUserId() userId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(queueWithdrawalParamsSchema, params);
    validateOperationBody(emptyOperationBody, body, request, true);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    const result = await this.withdrawal.withdrawExperienceQueueAuthenticated({ ...ids, userId, idempotencyKey, expiresAt: this.idempotency.expiresAt() }, mutationSession(request, userId));
    if (result.kind === "withdrawn" || result.kind === "replay") {
      return { participationId: result.participationId, queueEntryId: result.queueEntryId, experienceId: result.experienceId,
        status: result.status, closedAt: result.closedAt, serviceSession: result.serviceSession };
    }
    return rejectParticipantQueueOperation(result.kind);
  }
}
