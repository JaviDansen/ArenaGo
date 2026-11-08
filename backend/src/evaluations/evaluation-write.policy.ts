import { sql, type SQL } from "drizzle-orm";
import { evaluationReadProjection, type EvaluationReadRow } from "./evaluation-read.policy";
import type { EditEvaluationBody, SubmitEvaluationBody } from "./evaluation-write.dto";

export interface EvaluationDecisionRow extends EvaluationReadRow {
  decisionAt: string; writtenId: string | null; allowed: boolean; changed: boolean; commentWindow: boolean; submissionOpen: boolean | null;
}
/** O relógio alternativo é interno, para verificar bordas SQL em testes; HTTP nunca o fornece. */
export function submissionStatement(selection: SQL, evaluationId: string, body: SubmitEvaluationBody, clock: SQL = sql`clock_timestamp()`): SQL {
  return sql`WITH decision AS MATERIALIZED (SELECT ${clock} AS at),
    facts AS MATERIALIZED (${evaluationReadProjection(selection, sql`(SELECT at FROM decision)`)}),
    written AS (INSERT INTO evaluations(id,participation_id,rating,comment,submitted_at,updated_at,first_comment_at)
      SELECT ${evaluationId}::uuid,f."participationId",${body.rating}::smallint,${body.comment}::text,d.at,d.at,
        CASE WHEN ${body.comment}::text IS NOT NULL THEN d.at END
      FROM facts f CROSS JOIN decision d WHERE f.eligible AND f.pending AND NOT f.submitted RETURNING id)
    SELECT f.*,w.id AS "writtenId",(d.at<=f."deadlineAt"::timestamptz) AS "submissionOpen",
      to_char(d.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "decisionAt"
    FROM facts f CROSS JOIN decision d LEFT JOIN written w ON true`;
}
export function editStatement(selection: SQL, evaluationId: string, body: EditEvaluationBody, clock: SQL = sql`clock_timestamp()`): SQL {
  const rating = body.rating !== undefined, comment = Object.hasOwn(body, "comment");
  return sql`WITH decision AS MATERIALIZED (SELECT ${clock} AS at),
    facts AS MATERIALIZED (${evaluationReadProjection(selection, sql`(SELECT at FROM decision)`)}),
    plan AS MATERIALIZED (SELECT f.*,v.id,
      CASE WHEN ${rating}::boolean THEN ${body.rating ?? null}::smallint ELSE v.rating END AS next_rating,
      CASE WHEN ${comment}::boolean THEN ${body.comment ?? null}::text ELSE v.comment END AS next_comment,
      (f."editFull" OR (f."addComment" AND NOT ${rating}::boolean AND ${comment}::boolean
        AND ${body.comment ?? null}::text IS NOT NULL AND v.comment IS NULL)) AS allowed,
      (d.at>f."editableUntilAt"::timestamptz AND d.at<=f."commentAddUntilAt"::timestamptz) AS "commentWindow"
      FROM facts f JOIN evaluations v ON v.id=${evaluationId}::uuid AND v.participation_id=f."participationId" CROSS JOIN decision d),
    changes AS MATERIALIZED (SELECT p.*,(v.rating IS DISTINCT FROM p.next_rating OR v.comment IS DISTINCT FROM p.next_comment) AS changed
      FROM plan p JOIN evaluations v ON v.id=p.id),
    written AS (UPDATE evaluations v SET rating=c.next_rating,comment=c.next_comment,updated_at=d.at,
      first_comment_at=COALESCE(v.first_comment_at,CASE WHEN ${comment}::boolean AND c.next_comment IS NOT NULL THEN d.at END)
      FROM changes c CROSS JOIN decision d WHERE v.id=c.id AND v.participation_id=c."participationId" AND c.allowed AND c.changed RETURNING v.id)
    SELECT c.*,w.id AS "writtenId",to_char(d.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "decisionAt"
    FROM changes c CROSS JOIN decision d LEFT JOIN written w ON true`;
}
