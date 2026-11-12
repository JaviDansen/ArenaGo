import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Req, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { SessionAuthGuard, type AuthenticatedRequest } from "../auth/session-auth.guard";
import { mutationSession } from "../auth/mutation-session";
import { emptyOperationBody, operationUuid, validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { StaffIdempotencyPolicy } from "../events/staff-idempotency.policy";
import { StaffEntryService } from "./staff-entry.service";

import { StaffEntryCallService } from './staff-entry-call.service';

const eventParams = z.object({ eventId: operationUuid }).strict();
const confirmationParams = eventParams.extend({ participationId: operationUuid });
const toggleBody = z.object({ enabled: z.boolean() }).strict();
@Injectable()
export class StaffEntryNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader("Cache-Control", "no-store");
    return true;
  }
}
@Controller("staff/events/:eventId/entry-control")
@UseGuards(StaffEntryNoStoreGuard, SessionAuthGuard)
export class StaffEntryController {
  constructor(@Inject(StaffEntryService) private readonly entries: StaffEntryService,
    @Inject(StaffEntryCallService) private readonly calls: StaffEntryCallService,
    @Inject(StaffIdempotencyPolicy) private readonly policy: StaffIdempotencyPolicy) {}

  @Get()
  read(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown) {
    const ids = validateOperationParams(eventParams, params);
    return this.entries.read({ ...ids, userId: principal.userId, sessionId: principal.sessionId });
  }

  @Post("participants/:participationId/confirm")
  @HttpCode(200)
  async confirm(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(confirmationParams, params);
    validateOperationBody(emptyOperationBody, body, request, true);
    return this.entries.confirm({ ...ids, ...mutationSession(request, principal.userId),
      idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() });
  }

  @Post('call-next') @HttpCode(200)
  callNext(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(eventParams, params);
    validateOperationBody(emptyOperationBody, body, request, true);
    return this.calls.execute('call', { ...ids, ...mutationSession(request, principal.userId),
      idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() });
  }

  @Post('calls/:callId/:action') @HttpCode(200)
  resolve(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { action, ...ids } = validateOperationParams(eventParams.extend({ callId: operationUuid,
      action: z.enum(['confirm', 'absent', 'remove']) }), params);
    validateOperationBody(emptyOperationBody, body, request, true);
    return this.calls.execute(action, { ...ids, ...mutationSession(request, principal.userId),
      idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() });
  }

  @Patch()
  setEnabled(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(eventParams, params);
    const input = validateOperationBody(toggleBody, body, request);
    return this.entries.setEnabled({ ...ids, ...input, ...mutationSession(request, principal.userId),
      idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() });
  }
}
