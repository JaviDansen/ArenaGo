import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { isPreciseInstant } from "../evaluations/evaluation-read.dto";

const instant = z.custom<string>(isPreciseInstant);
export const lifecycleParams = z.object({ participationId: operationUuid }).strict();
export const participationView = z.object({
  id: operationUuid, eventId: operationUuid,
  status: z.enum(["waiting", "active", "finished", "canceled"]),
  joinedAt: instant, arenaEnteredAt: instant.nullable(), finishedAt: instant.nullable(), finishReason: z.string().nullable(),
  externalQueue: z.object({ position: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), observedAt: instant }).strict().nullable(),
}).strict();
export const finishedParticipationView = participationView.extend({
  completedServicesCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  evaluationEligibility: z.object({ eligible: z.boolean(), hasSubmitted: z.boolean() }).strict(),
}).strict();
export type ParticipationView = z.infer<typeof participationView>;
export type FinishedParticipationView = z.infer<typeof finishedParticipationView>;
