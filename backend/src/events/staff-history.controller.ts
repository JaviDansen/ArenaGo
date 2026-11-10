import { Controller, Get, Header, HttpStatus, Inject, Injectable, Param, Req, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { SessionAuthGuard, type AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationIdempotencyKey } from "../common/http/operation-validation";
import { callNextParamsSchema, serviceSessionParamsSchema, validateStaffParams } from "./staff-operation.dto";
import { StaffHistoryService, type HistoricalScope } from "./staff-history.service";

@Injectable()
export class StaffHistoryNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader("Cache-Control", "no-store");
    return true;
  }
}

@Controller("staff/events")
@UseGuards(StaffHistoryNoStoreGuard, SessionAuthGuard)
export class StaffHistoryController {
  constructor(@Inject(StaffHistoryService) private readonly history: StaffHistoryService) {}

  @Get(":eventId/experiences/:experienceId/stations/:stationId/history/call-next")
  @Header("Cache-Control", "no-store")
  async call(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(callNextParamsSchema, params);
    return this.lookup(principal, request, { kind: "call-next", ...ids });
  }

  @Get(":eventId/service-sessions/:serviceSessionId/history/complete")
  @Header("Cache-Control", "no-store")
  async complete(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(serviceSessionParamsSchema, params);
    return this.lookup(principal, request, { kind: "complete", ...ids });
  }

  @Get(":eventId/service-sessions/:serviceSessionId/history/absent")
  @Header("Cache-Control", "no-store")
  async absent(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateStaffParams(serviceSessionParamsSchema, params);
    return this.lookup(principal, request, { kind: "absent", ...ids });
  }

  private async lookup(principal: AuthenticatedPrincipal, request: AuthenticatedRequest, scope: HistoricalScope) {
    const key = validateOperationIdempotencyKey(request);
    const result = await this.history.find(principal.userId, principal.sessionId, key, scope);
    if (result.kind === "session_invalid") throw new ProblemException({ typeSlug: "invalid-session", title: "Sessão inválida",
      status: HttpStatus.UNAUTHORIZED, code: "INVALID_SESSION", detail: "Sessão inválida ou expirada." });
    if (result.kind === "access_denied") throw new ProblemException({ typeSlug: "resource-not-found", title: "Recurso não encontrado",
      status: HttpStatus.NOT_FOUND, code: "RESOURCE_NOT_FOUND", detail: "Recurso não encontrado." });
    return result;
  }
}
