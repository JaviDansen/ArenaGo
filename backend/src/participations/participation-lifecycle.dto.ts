import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { isPreciseInstant } from "../evaluations/evaluation-read.dto";

const instant = z.custom<string>(isPreciseInstant);
export const lifecycleParams = z.object({ participationId: operationUuid }).strict();
export const externalEntryCallView = z.object({
  callId: operationUuid,
  participationId: operationUuid,
  eventId: operationUuid,
  kind: z.literal("external_entry"),
  status: z.literal("pending"),
  calledAt: instant,
}).strict();
const participationBase = z.object({
  id: operationUuid, eventId: operationUuid,
  status: z.enum(["waiting", "active", "finished", "canceled"]),
  joinedAt: instant, arenaEnteredAt: instant.nullable(), finishedAt: instant.nullable(), finishReason: z.string().nullable(),
  externalQueue: z.object({ position: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), observedAt: instant }).strict().nullable(),
  externalEntryCall: externalEntryCallView.nullable().default(null),
}).strict();
function validateExternalEntryCallBinding(
  value: { id: string; eventId: string; status: string; externalEntryCall: z.infer<typeof externalEntryCallView> | null },
  ctx: z.RefinementCtx,
) {
  if (!value.externalEntryCall) return;
  if (
    value.status !== "waiting"
    || value.externalEntryCall.participationId !== value.id
    || value.externalEntryCall.eventId !== value.eventId
  ) {
    ctx.addIssue({ code: "custom", message: "Chamada externa inconsistente com a participação." });
  }
}
export const participationView = participationBase.superRefine(validateExternalEntryCallBinding);
export const finishedParticipationView = participationBase.extend({
  completedServicesCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  evaluationEligibility: z.object({ eligible: z.boolean(), hasSubmitted: z.boolean() }).strict(),
}).strict().superRefine(validateExternalEntryCallBinding);
export type ExternalEntryCallView = z.infer<typeof externalEntryCallView>;
export type ParticipationView = z.infer<typeof participationView>;
export type FinishedParticipationView = z.infer<typeof finishedParticipationView>;
