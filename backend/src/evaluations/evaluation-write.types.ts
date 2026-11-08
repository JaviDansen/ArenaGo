import type { OwnEvaluation } from "./evaluation-read.types";
import type { EditEvaluationBody, SubmitEvaluationBody } from "./evaluation-write.dto";

export interface EvaluationWriteIntent { userId: string; idempotencyKey: string; expiresAt: Date }
export type SubmitEvaluationInput = EvaluationWriteIntent & { participationId: string; payload: SubmitEvaluationBody };
export type EditEvaluationInput = EvaluationWriteIntent & { evaluationId: string; payload: EditEvaluationBody };
export type EvaluationWriteFailure = "access_denied" | "not_eligible" | "submission_expired" | "already_submitted"
  | "edit_window_closed" | "comment_already_added" | "request_conflict" | "in_progress";
export type EvaluationWriteResult = { kind: "created" | "updated" | "replay"; evaluation: OwnEvaluation } | { kind: EvaluationWriteFailure };
