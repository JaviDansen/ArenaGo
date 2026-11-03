import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { CallNextService } from "./call-next.service";
import { CompleteService } from "./complete.service";
import { AbsentService } from "./absent.service";
import { StaffIdempotencyPolicy } from "./staff-idempotency.policy";
import { callNextParamsSchema, serviceSessionParamsSchema, validateStaffParams, validateStaffRequest } from "./staff-operation.dto";
import { executeStaffOperation, rejectStaffOperation } from "./staff-operation.problem";

@Controller("staff/events")
@RequireSessionAuth()
export class StaffOperationsController {
  constructor(
    @Inject(CallNextService) private readonly calling: CallNextService,
    @Inject(CompleteService) private readonly completion: CompleteService,
    @Inject(AbsentService) private readonly absence: AbsentService,
    @Inject(StaffIdempotencyPolicy) private readonly idempotency: StaffIdempotencyPolicy,
  ) {}

  @Post(":eventId/experiences/:experienceId/stations/:stationId/call-next")
  @HttpCode(HttpStatus.CREATED)
  async callNext(@CurrentUserId() staffUserId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(callNextParamsSchema, params);
    const idempotencyKey = validateStaffRequest(body, request);
    const result = await executeStaffOperation(() => this.calling.callNext({ ...ids, staffUserId, idempotencyKey, expiresAt: this.idempotency.expiresAt() }));
    if (result.kind === "created" || result.kind === "replay") return { serviceSession: result.serviceSession };
    return rejectStaffOperation(result.kind);
  }

  @Post(":eventId/service-sessions/:serviceSessionId/complete")
  @HttpCode(HttpStatus.OK)
  async complete(@CurrentUserId() staffUserId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(serviceSessionParamsSchema, params);
    const idempotencyKey = validateStaffRequest(body, request);
    const result = await executeStaffOperation(() => this.completion.complete({ ...ids, staffUserId, idempotencyKey, expiresAt: this.idempotency.expiresAt() }));
    if (result.kind === "completed" || result.kind === "replay") return { serviceSession: result.serviceSession, queueEntry: result.queueEntry, participation: result.participation };
    return rejectStaffOperation(result.kind);
  }

  @Post(":eventId/service-sessions/:serviceSessionId/absent")
  @HttpCode(HttpStatus.OK)
  async absent(@CurrentUserId() staffUserId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(serviceSessionParamsSchema, params);
    const idempotencyKey = validateStaffRequest(body, request);
    const result = await executeStaffOperation(() => this.absence.absent({ ...ids, staffUserId, idempotencyKey, expiresAt: this.idempotency.expiresAt() }));
    if (result.kind === "absent" || result.kind === "replay") return { serviceSession: result.serviceSession,
      previousQueueEntry: result.previousQueueEntry, requeued: result.requeued, newQueueEntry: result.newQueueEntry };
    return rejectStaffOperation(result.kind);
  }
}
