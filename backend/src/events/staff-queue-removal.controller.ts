import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { SessionAuthGuard, type AuthenticatedRequest } from '../auth/session-auth.guard';
import { StaffEntryNoStoreGuard } from '../participations/staff-entry.controller';
import { mutationSession } from '../auth/mutation-session';
import { emptyOperationBody, operationUuid, validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from '../common/http/operation-validation';
import { StaffIdempotencyPolicy } from './staff-idempotency.policy';
import { StaffQueueRemovalService } from './staff-queue-removal.service';

const paramsSchema = z.object({ eventId: operationUuid, experienceId: operationUuid, queueEntryId: operationUuid }).strict();

@Controller('staff/events/:eventId/experiences/:experienceId/queue-entries/:queueEntryId/remove')
@UseGuards(StaffEntryNoStoreGuard, SessionAuthGuard)
export class StaffQueueRemovalController {
  constructor(@Inject(StaffQueueRemovalService) private readonly removal: StaffQueueRemovalService,
    @Inject(StaffIdempotencyPolicy) private readonly policy: StaffIdempotencyPolicy) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(paramsSchema, params);
    validateOperationBody(emptyOperationBody, body, request, true);
    return this.removal.remove({ ...ids, ...mutationSession(request, principal.userId),
      idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() });
  }
}
