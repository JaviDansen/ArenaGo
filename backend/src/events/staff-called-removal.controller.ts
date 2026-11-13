import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { SessionAuthGuard, type AuthenticatedRequest } from '../auth/session-auth.guard';
import { mutationSession } from '../auth/mutation-session';
import { StaffEntryNoStoreGuard } from '../participations/staff-entry.controller';
import { emptyOperationBody, validateOperationBody, validateOperationIdempotencyKey } from '../common/http/operation-validation';
import { serviceSessionParamsSchema, validateStaffParams } from './staff-operation.dto';
import { executeStaffOperation, rejectStaffOperation } from './staff-operation.problem';
import { StaffIdempotencyPolicy } from './staff-idempotency.policy';
import { CalledRemovalService } from './staff-called-removal.service';

@Controller('staff/events/:eventId/service-sessions/:serviceSessionId/remove')
@UseGuards(StaffEntryNoStoreGuard, SessionAuthGuard)
export class StaffCalledRemovalController {
  constructor(@Inject(CalledRemovalService) private readonly removal: CalledRemovalService,
    @Inject(StaffIdempotencyPolicy) private readonly policy: StaffIdempotencyPolicy) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(serviceSessionParamsSchema, params);
    validateOperationBody(emptyOperationBody, body, request, true);
    const result = await executeStaffOperation(() => this.removal.removeAuthenticated({ ...ids,
      staffUserId: principal.userId, idempotencyKey: validateOperationIdempotencyKey(request),
      expiresAt: this.policy.expiresAt() }, mutationSession(request, principal.userId)));
    if (result.kind === 'removed' || result.kind === 'replay') return {
      serviceSession: result.serviceSession, queueEntry: result.queueEntry, participation: result.participation,
    };
    return rejectStaffOperation(result.kind);
  }
}
