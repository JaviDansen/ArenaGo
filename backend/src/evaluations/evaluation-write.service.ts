import { assertMutationSession, MutationSessionError, mutationTransaction, revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx, type JsonValue } from "../participations/join-idempotency";
import { evaluationReadProjection, ownEvaluation, type EvaluationReadRow } from "./evaluation-read.policy";
import { isPreciseInstant } from "./evaluation-read.dto";
import { editEvaluationBody, evaluationWriteResponse, submitEvaluationBody } from "./evaluation-write.dto";
import { editStatement, submissionStatement, type EvaluationDecisionRow } from "./evaluation-write.policy";
import type { EditEvaluationInput, EvaluationWriteFailure, EvaluationWriteResult, SubmitEvaluationInput } from "./evaluation-write.types";

export const SUBMIT_EVALUATION_OPERATION = "submit_evaluation";
export const EDIT_EVALUATION_OPERATION = "edit_evaluation";
export function evaluationWriteFingerprint(operation: string, resourceId: string, payload: JsonValue): string {
  return createRequestFingerprint(operation, { version: 1, resourceId, payload });
}
class WriteRollback extends Error { constructor(readonly kind: EvaluationWriteFailure) { super(kind); } }
function block(kind: EvaluationWriteFailure): never { throw new WriteRollback(kind); }
function ensure(value: unknown): asserts value { if (!value) throw new Error("EVALUATION_WRITE_INTEGRITY"); }

@Injectable()
export class EvaluationWriteService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}
  private selection(userId: string, participationId: string) {
    return sql`SELECT p.id,p.event_id,e.name AS event_name,p.status,p.joined_at,p.arena_entered_at,p.finished_at,p.finish_reason
      FROM participations p JOIN events e ON e.id=p.event_id WHERE p.id=${participationId}::uuid AND p.user_id=${userId}::uuid`;
  }
  async submit(input: SubmitEvaluationInput): Promise<EvaluationWriteResult> { return this.write("submit", input, null); }
  async edit(input: EditEvaluationInput): Promise<EvaluationWriteResult> { return this.write("edit", input, null); }
  submitAuthenticated(input: SubmitEvaluationInput, context: MutationSession): Promise<EvaluationWriteResult> {
    assertMutationSession(context, input.userId); return this.write("submit", input, context);
  }
  editAuthenticated(input: EditEvaluationInput, context: MutationSession): Promise<EvaluationWriteResult> {
    assertMutationSession(context, input.userId); return this.write("edit", input, context);
  }
  private async write(mode: "submit" | "edit", input: SubmitEvaluationInput | EditEvaluationInput, context: MutationSession | null): Promise<EvaluationWriteResult> {
    try {
      const payload = mode === "submit" ? submitEvaluationBody.parse(input.payload) : editEvaluationBody.parse(input.payload);
      ensure(input.idempotencyKey.trim() && input.idempotencyKey.length <= 128 && Number.isFinite(input.expiresAt.getTime()));
      const evaluationId = "evaluationId" in input ? input.evaluationId : undefined;
      const resourceId = "participationId" in input ? input.participationId : input.evaluationId;
      return await mutationTransaction(this.database, context, async tx => {
        const lookup = mode === "submit" ? sql`SELECT id AS "participationId" FROM participations WHERE id=${resourceId}::uuid AND user_id=${input.userId}::uuid`
          : sql`SELECT p.id AS "participationId" FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE v.id=${resourceId}::uuid AND p.user_id=${input.userId}::uuid`;
        const found = (await tx.execute<{ participationId: string }>(lookup)).rows[0]; if (!found) block("access_denied");
        const participationId = found.participationId, operation = mode === "submit" ? SUBMIT_EVALUATION_OPERATION : EDIT_EVALUATION_OPERATION;
        const intent = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId, operation, idempotencyKey: input.idempotencyKey,
          requestHash: evaluationWriteFingerprint(operation, resourceId, payload as JsonValue), expiresAt: input.expiresAt });
        if (intent.kind === "request_conflict" || intent.kind === "in_progress") {
          if (context !== null) await revalidateMutationSession(tx, context);
          block(intent.kind);
        }
        const parent = await tx.execute(sql`SELECT id FROM participations WHERE id=${participationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
        if (parent.rows.length !== 1) block("access_denied");
        if (mode === "edit") {
          const locked = await tx.execute(sql`SELECT id FROM evaluations WHERE id=${evaluationId}::uuid AND participation_id=${participationId}::uuid FOR UPDATE`);
          if (locked.rows.length !== 1) block("access_denied");
        }
        if (context !== null) await revalidateMutationSession(tx, context);
        if (intent.kind === "replay") {
          const replay = evaluationWriteResponse.parse(intent.resultPayload);
          ensure(intent.httpStatus === (mode === "submit" ? 201 : 200) && replay.evaluation.participationId === participationId
            && intent.resultReference === replay.evaluation.id && (mode === "submit" || replay.evaluation.id === evaluationId));
          return { kind: "replay", evaluation: replay.evaluation };
        }
        const selection = this.selection(input.userId, participationId);
        const decision = (await tx.execute<EvaluationDecisionRow>(mode === "submit"
          ? submissionStatement(selection, randomUUID(), submitEvaluationBody.parse(payload))
          : editStatement(selection, evaluationId!, editEvaluationBody.parse(payload)))).rows;
        ensure(decision.length === 1 && isPreciseInstant(decision[0].decisionAt)); const row = decision[0];
        if (mode === "submit") {
          if (!row.eligible) block("not_eligible"); if (!row.submissionOpen) block("submission_expired");
          if (row.submitted) block("already_submitted"); ensure(row.pending && row.writtenId);
        } else {
          if (!row.allowed) {
            if (row.commentWindow && payload.rating === undefined && Object.hasOwn(payload, "comment") && payload.comment !== null && !row.addComment) block("comment_already_added");
            block("edit_window_closed");
          }
          ensure(row.changed ? row.writtenId === evaluationId : row.writtenId === null);
        }
        const evaluation = await this.response(tx, selection, row.decisionAt);
        ensure(mode === "submit" ? evaluation.id === row.writtenId : evaluation.id === evaluationId);
        await completeIdempotencyOperationWithTx(tx, intent.operationId, { httpStatus: mode === "submit" ? 201 : 200,
          resultReference: evaluation.id, resultPayload: { evaluation } as unknown as JsonValue });
        return { kind: mode === "submit" ? "created" : "updated", evaluation };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof MutationSessionError) throw error;
      if (error instanceof WriteRollback) return { kind: error.kind };
      // O filtro HTTP existente registra somente message; causa interna nunca vira resposta ou log.
      throw new Error("EVALUATION_WRITE_INTERNAL_ERROR", { cause: error });
    }
  }
  private async response(tx: DatabaseTransactionExecutor, selection: ReturnType<EvaluationWriteService["selection"]>, at: string) {
    const rows = (await tx.execute<EvaluationReadRow>(evaluationReadProjection(selection, at))).rows;
    ensure(rows.length === 1); const value = ownEvaluation(rows[0]); ensure(value); return value;
  }
}
