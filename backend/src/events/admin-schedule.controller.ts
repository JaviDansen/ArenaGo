import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Patch, Req } from "@nestjs/common";
import { CurrentUser, CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";
import { adminScheduleBody, adminScheduleParams } from "./admin-schedule.dto";
import { AdminScheduleService } from "./admin-schedule.service";

const failures = {
  resource_not_found: [404, "RESOURCE_NOT_FOUND", "Recurso não encontrado."],
  admin_required: [403, "ADMIN_REQUIRED", "Admin global autorizado é obrigatório."],
  account_inactive: [401, "ACCOUNT_DEACTIVATED", "Esta conta encontra-se desativada."],
  invalid_session: [401, "INVALID_SESSION", "Sessão inválida."],
  session_revoked: [401, "SESSION_REVOKED", "A sessão foi revogada."],
  session_expired: [401, "SESSION_EXPIRED", "A sessão expirou."],
  admin_2fa_required: [401, "ADMIN_2FA_REQUIRED", "Sessão administrativa exige segundo fator (TOTP)."],
  event_time_change_closed: [409, "EVENT_TIME_CHANGE_CLOSED", "A janela para alterar os horários do evento terminou."],
  invalid_schedule: [400, "VALIDATION_ERROR", "O horário oficial deve ser futuro e posterior ao início do evento."],
  request_conflict: [409, "IDEMPOTENCY_KEY_REUSED", "A chave de idempotência já identifica outra intenção."],
  in_progress: [409, "IDEMPOTENCY_IN_PROGRESS", "A intenção informada está em processamento."],
} as const;

@Controller("admin/events/:eventId/schedule")
@RequireSessionAuth()
export class AdminScheduleController {
  constructor(@Inject(AdminScheduleService) private readonly schedule: AdminScheduleService,
    @Inject(AdminIdempotencyPolicy) private readonly idempotency: AdminIdempotencyPolicy) {}

  @Patch()
  @HttpCode(HttpStatus.OK)
  async set(@CurrentUserId() userId: string, @CurrentUser("sessionId") sessionId: string,
    @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(adminScheduleParams, params);
    const change = validateOperationBody(adminScheduleBody, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    const result = await this.schedule.updateSchedule({ userId, sessionId, ...ids, ...change, idempotencyKey, expiresAt: this.idempotency.expiresAt() });
    if (result.kind === "completed" || result.kind === "replay") return { eventId: result.eventId,
      officialEndsAt: result.officialEndsAt, operationalDeadlineAt: result.operationalDeadlineAt,
      ...(result.changedAt ? { changedAt: result.changedAt } : {}) };
    const [status, code, detail] = failures[result.kind];
    throw new ProblemException({ status, code, detail, typeSlug: code.toLowerCase().replaceAll("_", "-"),
      title: status === 400 ? "Requisição inválida" : status === 401 ? "Autenticação obrigatória" : status === 403 ? "Acesso negado" : status === 404 ? "Recurso não encontrado" : "Conflito operacional" });
  }
}
