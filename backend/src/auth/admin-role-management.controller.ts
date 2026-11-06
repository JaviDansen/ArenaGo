import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { CurrentUser, CurrentUserId, RequireSessionAuth } from "./current-user.decorator";
import type { AuthenticatedRequest } from "./session-auth.guard";
import { validateOperationBody, validateOperationIdempotencyKey } from "../common/http/operation-validation";
import { AdminIdempotencyPolicy } from "../events/admin-idempotency.policy";
import { grantAdminRoleBody, revokeAdminRoleBody } from "./admin-role-management.dto";
import { executeAdminRoleManagement } from "./admin-role-management.problem";
import { AdminRoleManagementService } from "./admin-role-management.service";

@Controller("admin/roles")
@RequireSessionAuth()
export class AdminRoleManagementController {
  constructor(
    @Inject(AdminRoleManagementService) private readonly roles: AdminRoleManagementService,
    @Inject(AdminIdempotencyPolicy) private readonly idempotency: AdminIdempotencyPolicy,
  ) {}

  @Post("grant")
  @HttpCode(201)
  grant(@CurrentUserId() userId: string, @CurrentUser("sessionId") sessionId: string,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const payload = validateOperationBody(grantAdminRoleBody, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    return executeAdminRoleManagement(() => this.roles.grant({ userId, sessionId, body: payload, idempotencyKey,
      expiresAt: this.idempotency.expiresAt() }));
  }

  @Post("revoke")
  @HttpCode(200)
  revoke(@CurrentUserId() userId: string, @CurrentUser("sessionId") sessionId: string,
    @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const payload = validateOperationBody(revokeAdminRoleBody, body, request);
    const idempotencyKey = validateOperationIdempotencyKey(request);
    return executeAdminRoleManagement(() => this.roles.revoke({ userId, sessionId, grantId: payload.grantId,
      idempotencyKey, expiresAt: this.idempotency.expiresAt() }));
  }
}
