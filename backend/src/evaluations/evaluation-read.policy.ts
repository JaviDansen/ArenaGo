import { sql, type SQL } from "drizzle-orm";
import type { EvaluationEligibility, OwnEvaluation, ParticipationStatus, EligibilityReason } from "./evaluation-read.types";
import { isPreciseInstant } from "./evaluation-read.dto";

export const SYSTEM_FINALIZATION_REASONS = ["admin_immediate", "admin_controlled_external_wait_closed", "automatic_operational_deadline", "automatic_admin_deadline"] as const;

/** Todas as cinco projeções usam os mesmos fatos e comparações no PostgreSQL. */
export function evaluationReadProjection(selection: SQL, observedAt: string): SQL {
  return sql`WITH scoped AS MATERIALIZED (${selection}), facts AS (
    SELECT p.*,c.n::text AS completed_count,v.id AS evaluation_id,v.rating,v.comment,v.submitted_at,v.updated_at AS evaluation_updated_at,v.first_comment_at
    FROM scoped p LEFT JOIN evaluations v ON v.participation_id=p.id
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM queue_entries q JOIN service_sessions s ON s.queue_entry_id=q.id AND s.experience_id=q.experience_id
      WHERE q.participation_id=p.id AND q.event_id=p.event_id AND s.status='completed') c
  ), policy AS (
    SELECT f.*,status='finished' AND completed_count::bigint>0 AS eligible,evaluation_id IS NOT NULL AS submitted,
      CASE WHEN status='finished' THEN finished_at+interval '720 hours' END AS deadline,
      COALESCE(${observedAt}::timestamptz>=submitted_at AND ${observedAt}::timestamptz<=submitted_at+interval '168 hours',false) AS edit_full,
      COALESCE(${observedAt}::timestamptz>submitted_at+interval '168 hours' AND ${observedAt}::timestamptz<=submitted_at+interval '720 hours'
        AND first_comment_at IS NULL,false) AS add_comment
    FROM facts f
  ) SELECT id AS "participationId",event_id AS "eventId",event_name AS "eventName",status,
    to_char(joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "joinedAt",
    to_char(arena_entered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "arenaEnteredAt",
    to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "finishedAt",finish_reason AS "finishReason",
    completed_count AS "completedCount",eligible,submitted,
    COALESCE(eligible AND NOT submitted AND ${observedAt}::timestamptz<=deadline,false) AS pending,
    to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "deadlineAt",
    CASE WHEN status<>'finished' THEN 'NOT_FINISHED'
      WHEN completed_count::bigint=0 THEN CASE WHEN finish_reason='admin_controlled_external_wait_closed' THEN 'EXTERNAL_WAIT_CLOSED' ELSE 'NO_COMPLETED_SERVICE' END
      WHEN submitted THEN 'ALREADY_SUBMITTED' WHEN ${observedAt}::timestamptz>deadline THEN 'SUBMISSION_EXPIRED' END AS reason,
    evaluation_id AS "evaluationId",rating,comment,
    to_char(submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "submittedAt",
    to_char(evaluation_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
    to_char((submitted_at+interval '168 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "editableUntilAt",
    to_char((submitted_at+interval '720 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "commentAddUntilAt",
    edit_full AS "editFull",add_comment AS "addComment" FROM policy`;
}
export interface EvaluationReadRow extends Record<string, unknown> {
  participationId: string; eventId: string; eventName: string; status: ParticipationStatus;
  joinedAt: string; arenaEnteredAt: string | null; finishedAt: string | null; finishReason: string | null;
  completedCount: string; eligible: boolean; submitted: boolean; pending: boolean; deadlineAt: string | null; reason: EligibilityReason | null;
  evaluationId: string | null; rating: number | null; comment: string | null; submittedAt: string | null; updatedAt: string | null;
  editableUntilAt: string | null; commentAddUntilAt: string | null; editFull: boolean; addComment: boolean;
}
export function ensureRead(value: unknown): asserts value { if (!value) throw new Error("EVALUATION_READ_INTEGRITY"); }
export function completedCount(raw: string): number {
  ensureRead(typeof raw === "string" && /^(0|[1-9]\d*)$/.test(raw));
  const value = Number(raw); ensureRead(Number.isSafeInteger(value)); return value;
}
export function eligibility(row: EvaluationReadRow): EvaluationEligibility {
  ensureRead(["waiting", "active", "finished", "canceled"].includes(row.status) && isPreciseInstant(row.joinedAt));
  ensureRead(row.status !== "finished" || (isPreciseInstant(row.finishedAt) && isPreciseInstant(row.deadlineAt)));
  return { participationId: row.participationId, participationStatus: row.status, completedServicesCount: completedCount(row.completedCount),
    eligible: row.eligible, submitted: row.submitted, pending: row.pending, firstSubmissionDeadlineAt: row.deadlineAt, reason: row.reason };
}
export function ownEvaluation(row: EvaluationReadRow): OwnEvaluation | null {
  if (row.evaluationId === null) return null;
  ensureRead(Number.isInteger(row.rating) && row.rating! >= 1 && row.rating! <= 5 && (row.comment === null || typeof row.comment === "string")
    && isPreciseInstant(row.submittedAt) && isPreciseInstant(row.updatedAt) && isPreciseInstant(row.editableUntilAt) && isPreciseInstant(row.commentAddUntilAt));
  return { id: row.evaluationId, participationId: row.participationId, rating: row.rating!, comment: row.comment,
    submittedAt: row.submittedAt, updatedAt: row.updatedAt, editableUntilAt: row.editableUntilAt, commentAddUntilAt: row.commentAddUntilAt,
    permissions: { canEditRating: row.editFull, canEditComment: row.editFull || row.addComment, canAddFirstComment: row.addComment } };
}
