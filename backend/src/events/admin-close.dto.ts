import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { adminExternalQueueBody } from "./admin-external-queue.dto";
import { normalizeScheduleInstant } from "./admin-schedule.dto";

const reason = adminExternalQueueBody.shape.reason;
const instant = z.string().transform((value, ctx) => {
  const normalized = normalizeScheduleInstant(value);
  if (normalized === undefined) { ctx.addIssue({ code: "custom", message: "Informe instante ISO com fuso explícito e até três casas decimais." }); return z.NEVER; }
  return normalized;
});
export const adminCloseParams = z.object({ eventId: operationUuid }).strict();
export const adminCloseBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("immediate"), reason }).strict(),
  z.object({ mode: z.literal("controlled"), reason, controlledUntilAt: instant }).strict(),
]);
export type AdminCloseBody = z.infer<typeof adminCloseBody>;
