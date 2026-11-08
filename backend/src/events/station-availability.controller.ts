import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Patch, Req } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { operationUuid, validateOperationBody, validateOperationParams } from "../common/http/operation-validation";
import { StationAvailabilityService } from "./station-availability.service";

const paramsSchema = z.object({ eventId: operationUuid, stationId: operationUuid }).strict();
const bodySchema = z.object({ availability: z.enum(["available", "unavailable"]) }).strict();
const failures = {
  access_denied: [404, "RESOURCE_NOT_FOUND", "Recurso não encontrado."],
  account_inactive: [401, "ACCOUNT_DEACTIVATED", "Esta conta encontra-se desativada."],
  invalid_session: [401, "INVALID_SESSION", "Sessão inválida."],
  session_revoked: [401, "SESSION_REVOKED", "A sessão foi revogada."],
  session_expired: [401, "SESSION_EXPIRED", "A sessão expirou."],
  admin_2fa_required: [401, "ADMIN_2FA_REQUIRED", "Sessão administrativa exige verificação de segundo fator (TOTP)."],
  event_operation_ended: [409, "EVENT_OPERATION_ENDED", "O evento não permite esta operação neste instante."],
  station_has_pending_call: [409, "STATION_HAS_PENDING_CALL", "A estação possui chamada pendente."],
} as const;

@Controller("staff/events/:eventId/stations/:stationId/availability")
@RequireSessionAuth()
export class StationAvailabilityController {
  constructor(@Inject(StationAvailabilityService) private readonly stations: StationAvailabilityService) {}

  @Patch()
  @HttpCode(HttpStatus.OK)
  async set(@CurrentUserId() userId: string, @CurrentUser("sessionId") sessionId: string,
    @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const ids = validateOperationParams(paramsSchema, params);
    const desired = validateOperationBody(bodySchema, body, request);
    const result = await this.stations.setAvailability({ userId, sessionId, ...ids, ...desired });
    if (result.kind === "changed" || result.kind === "unchanged") return {
      stationId: result.stationId, availability: result.availability, pendingServiceSessionId: result.pendingServiceSessionId,
    };
    const [status, code, detail] = failures[result.kind];
    throw new ProblemException({ status, code, detail, typeSlug: code.toLowerCase().replaceAll("_", "-"),
      title: status === 404 ? "Recurso não encontrado" : status === 401 ? "Autenticação obrigatória" : "Conflito operacional",
      extensions: result.kind === "station_has_pending_call" ? { station: {
        stationId: result.stationId, availability: result.availability, pendingServiceSessionId: result.pendingServiceSessionId,
      } } : undefined });
  }
}
