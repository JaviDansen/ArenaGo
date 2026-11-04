export type ParticipationStatus = "waiting" | "active" | "finished" | "canceled";
export type EligibilityReason = "NOT_FINISHED" | "NO_COMPLETED_SERVICE" | "EXTERNAL_WAIT_CLOSED" | "ALREADY_SUBMITTED" | "SUBMISSION_EXPIRED";
export interface EvaluationEligibility {
  participationId: string;
  participationStatus: ParticipationStatus;
  completedServicesCount: number;
  eligible: boolean;
  submitted: boolean;
  pending: boolean;
  firstSubmissionDeadlineAt: string | null;
  reason: EligibilityReason | null;
}
export interface PendingEvaluation {
  participationId: string;
  event: { id: string; name: string };
  finishedAt: string;
  firstSubmissionDeadlineAt: string;
  completedServicesCount: number;
}
export interface OwnEvaluation {
  id: string; participationId: string; rating: number; comment: string | null;
  submittedAt: string; updatedAt: string; editableUntilAt: string; commentAddUntilAt: string;
  permissions: { canEditRating: boolean; canEditComment: boolean; canAddFirstComment: boolean };
}
export interface ParticipationHistoryItem {
  participationId: string; event: { id: string; name: string }; status: ParticipationStatus;
  joinedAt: string; arenaEnteredAt: string | null; finishedAt: string | null; finishReason: string | null;
  completedServicesCount: number;
  evaluation: Pick<EvaluationEligibility, "eligible" | "submitted" | "pending">;
}
export interface ParticipationReturnState {
  recentFinalization: { participationId: string; eventId: string; finishReason: string; finishedAt: string } | null;
  pendingEvaluationParticipationIds: string[];
}
