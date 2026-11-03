import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { emptyOperationBody, operationUuid, validateOperationBody, validateOperationIdempotencyKey } from "../common/http/operation-validation";

export { validateOperationParams as validateStaffParams } from "../common/http/operation-validation";
export const callNextParamsSchema = z.object({ eventId: operationUuid, experienceId: operationUuid, stationId: operationUuid }).strict();
export const serviceSessionParamsSchema = z.object({ eventId: operationUuid, serviceSessionId: operationUuid }).strict();

export function validateStaffRequest(body: unknown, request: Pick<AuthenticatedRequest, "headers" | "rawHeaders">): string {
  validateOperationBody(emptyOperationBody, body, request, true);
  return validateOperationIdempotencyKey(request);
}
