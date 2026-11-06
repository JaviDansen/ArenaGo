import { ProblemException } from "../common/errors/problem.exception";
import type { AdminAuthFailure } from "../events/admin-operation-auth";

export type AdminRoleManagementFailure = AdminAuthFailure | "actor_email_unverified" | "event_not_found"
  | "target_not_found" | "target_ineligible" | "role_already_granted" | "role_not_found"
  | "last_admin" | "request_conflict" | "in_progress";

export class AdminRoleManagementError extends Error {
  constructor(readonly kind: AdminRoleManagementFailure) { super(kind); }
}

export function failAdminRoleManagement(kind: AdminRoleManagementFailure): never {
  throw new AdminRoleManagementError(kind);
}

const errors: Record<AdminRoleManagementFailure, [number, string]> = {
  account_inactive: [401, "ACCOUNT_DEACTIVATED"],
  admin_required: [403, "ADMIN_REQUIRED"],
  invalid_session: [401, "INVALID_SESSION"],
  session_revoked: [401, "SESSION_REVOKED"],
  session_expired: [401, "SESSION_EXPIRED"],
  admin_2fa_required: [401, "ADMIN_2FA_REQUIRED"],
  actor_email_unverified: [403, "ADMIN_EMAIL_UNVERIFIED"],
  event_not_found: [404, "RESOURCE_NOT_FOUND"],
  target_not_found: [404, "RESOURCE_NOT_FOUND"],
  target_ineligible: [422, "ROLE_TARGET_INELIGIBLE"],
  role_already_granted: [409, "ROLE_ALREADY_GRANTED"],
  role_not_found: [404, "RESOURCE_NOT_FOUND"],
  last_admin: [409, "LAST_ADMIN_REQUIRED"],
  request_conflict: [409, "IDEMPOTENCY_KEY_REUSED"],
  in_progress: [409, "IDEMPOTENCY_IN_PROGRESS"],
};

export async function executeAdminRoleManagement<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof AdminRoleManagementError) {
      const [status, code] = errors[error.kind];
      throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
        title: status === 404 ? "Recurso não encontrado" : status === 401 ? "Autenticação obrigatória"
          : status === 403 ? "Acesso negado" : status === 422 ? "Destinatário não elegível" : "Conflito de permissões",
        detail: status === 404 ? "Recurso não encontrado." : "A operação de permissões não pode ser aplicada ao estado atual." });
    }
    throw new Error("ADMIN_ROLE_MANAGEMENT_INTERNAL_ERROR", { cause: error });
  }
}
