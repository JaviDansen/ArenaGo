import { z } from "zod";
import { normalizeEmail } from "./auth.dto";
import { operationUuid } from "../common/http/operation-validation";

const email = z.string().transform(normalizeEmail).refine(value =>
  value.length > 0 && value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
"Informe um e-mail válido de até 255 caracteres.");

export const grantAdminRoleBody = z.discriminatedUnion("role", [
  z.object({ role: z.literal("admin"), email, eventId: z.null().optional() }).strict(),
  z.object({ role: z.literal("staff"), email, eventId: operationUuid }).strict(),
]);

export const revokeAdminRoleBody = z.object({ grantId: operationUuid }).strict();

export const managedRoleView = z.object({
  id: operationUuid,
  userId: operationUuid,
  role: z.enum(["admin", "staff"]),
  eventId: operationUuid.nullable(),
  grantedAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const managedRoleResponse = z.object({ grant: managedRoleView }).strict();

export type GrantAdminRoleBody = z.infer<typeof grantAdminRoleBody>;
export type RevokeAdminRoleBody = z.infer<typeof revokeAdminRoleBody>;
