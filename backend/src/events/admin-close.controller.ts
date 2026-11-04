import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { CurrentUser, CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";
import { adminCloseBody, adminCloseParams } from "./admin-close.dto";
import { AdminCloseService } from "./admin-close.service";

const failures = {
  resource_not_found: [404, "RESOURCE_NOT_FOUND"], admin_required: [403, "ADMIN_REQUIRED"], account_inactive: [401, "ACCOUNT_DEACTIVATED"],
  invalid_session: [401, "INVALID_SESSION"], session_revoked: [401, "SESSION_REVOKED"], session_expired: [401, "SESSION_EXPIRED"], admin_2fa_required: [401, "ADMIN_2FA_REQUIRED"],
  event_already_closed: [409, "EVENT_ALREADY_CLOSED"], closure_deadline_invalid: [409, "CLOSURE_DEADLINE_INVALID"],
  request_conflict: [409, "IDEMPOTENCY_KEY_REUSED"], in_progress: [409, "IDEMPOTENCY_IN_PROGRESS"],
} as const;
@Controller("admin/events/:eventId/close")
@RequireSessionAuth()
export class AdminCloseController {
  constructor(@Inject(AdminCloseService) private readonly closure: AdminCloseService,
    @Inject(AdminIdempotencyPolicy) private readonly idempotency: AdminIdempotencyPolicy) {}
  @Post()
  @HttpCode(HttpStatus.OK)
  async close(@CurrentUserId() userId: string, @CurrentUser("sessionId") sessionId: string,
    @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(adminCloseParams, params), change = validateOperationBody(adminCloseBody, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    const result = await this.closure.closeEvent({ userId, sessionId, ...ids, ...change, idempotencyKey, expiresAt: this.idempotency.expiresAt() });
    if (result.kind === "completed" || result.kind === "replay") return { eventId: result.eventId, status: result.status, closureMode: result.closureMode,
      newEntriesClosedAt: result.newEntriesClosedAt, effectiveOperationalDeadlineAt: result.effectiveOperationalDeadlineAt, externalWaitingFinalized: result.externalWaitingFinalized };
    const [status, code] = failures[result.kind];
    throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
      title: status === 401 ? "Autenticação obrigatória" : status === 403 ? "Acesso negado" : status === 404 ? "Recurso não encontrado" : "Conflito operacional",
      detail: "Não foi possível efetivar o encerramento solicitado." });
  }
}
