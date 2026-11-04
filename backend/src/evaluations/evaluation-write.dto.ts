import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { isPreciseInstant } from "./evaluation-read.dto";

export const EVALUATION_COMMENT_LIMIT = 2000;
const comment = z.string().superRefine((value, ctx) => {
  const characters = Array.from(value);
  if (characters.length > EVALUATION_COMMENT_LIMIT || value.includes("\0")
    || characters.some(c => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)) {
    ctx.addIssue({ code: "custom", message: "Comentário inválido ou acima do limite técnico." });
  }
}).transform(value => value.trim() === "" ? null : value).nullable();
export const submitEvaluationBody = z.object({ rating: z.number().int().min(1).max(5), comment: comment.optional() }).strict()
  .transform(value => ({ rating: value.rating, comment: value.comment ?? null }));
export const editEvaluationBody = z.object({ rating: z.number().int().min(1).max(5).optional(), comment: comment.optional() }).strict()
  .refine(value => value.rating !== undefined || value.comment !== undefined, "Informe nota ou comentário.")
  .transform(value => ({ ...(value.rating !== undefined ? { rating: value.rating } : {}),
    ...(value.comment !== undefined ? { comment: value.comment } : {}) }));
export type SubmitEvaluationBody = z.infer<typeof submitEvaluationBody>;
export type EditEvaluationBody = z.infer<typeof editEvaluationBody>;
export const writeEvaluationParams = z.object({ evaluationId: operationUuid }).strict();
const instant = z.custom<string>(isPreciseInstant);
/** Valida replay histórico sem expor payload interno corrompido. */
export const evaluationWriteResponse = z.object({ evaluation: z.object({
  id: operationUuid, participationId: operationUuid, rating: z.number().int().min(1).max(5), comment: z.string().nullable(),
  submittedAt: instant, updatedAt: instant, editableUntilAt: instant, commentAddUntilAt: instant,
  permissions: z.object({ canEditRating: z.boolean(), canEditComment: z.boolean(), canAddFirstComment: z.boolean() }).strict(),
}).strict() }).strict();
