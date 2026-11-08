import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";

export const adminExternalQueueParams = z.object({ eventId: operationUuid }).strict();
export const adminExternalQueueBody = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(500).refine(value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)),
}).strict();
