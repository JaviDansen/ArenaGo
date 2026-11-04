import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { encodeHistoryCursor, isPreciseInstant, type HistoryPage } from "./evaluation-read.dto";
import { evaluationReadProjection, eligibility, ownEvaluation, ensureRead, SYSTEM_FINALIZATION_REASONS, type EvaluationReadRow } from "./evaluation-read.policy";
import type { PendingEvaluation, ParticipationHistoryItem, ParticipationReturnState } from "./evaluation-read.types";

@Injectable()
export class EvaluationReadService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  private async snapshot<T>(read: (tx: DatabaseTransactionExecutor, at: string) => Promise<T>): Promise<T> {
    return this.database.transaction(async tx => {
      const row = (await tx.execute<{ at: string }>(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows[0];
      ensureRead(row && isPreciseInstant(row.at)); return read(tx, row.at);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  private selection(userId: string, condition: SQL = sql`true`, tail: SQL = sql``): SQL {
    return sql`SELECT p.id,p.event_id,e.name AS event_name,p.status,p.joined_at,p.arena_entered_at,p.finished_at,p.finish_reason
      FROM participations p JOIN events e ON e.id=p.event_id WHERE p.user_id=${userId} AND ${condition} ${tail}`;
  }
  private async one(tx: DatabaseTransactionExecutor, at: string, userId: string, participationId: string) {
    const result = await tx.execute<EvaluationReadRow>(evaluationReadProjection(this.selection(userId, sql`p.id=${participationId}`), at));
    ensureRead(result.rows.length <= 1); return result.rows[0];
  }
  async getEligibility(userId: string, participationId: string) {
    return this.snapshot(async (tx, at) => { const row = await this.one(tx, at, userId, participationId); return row ? eligibility(row) : null; });
  }
  async getEvaluation(userId: string, participationId: string) {
    return this.snapshot(async (tx, at) => {
      const row = await this.one(tx, at, userId, participationId);
      return row ? { evaluation: ownEvaluation(row), eligibility: eligibility(row) } : null;
    });
  }
  private async pending(tx: DatabaseTransactionExecutor, at: string, userId: string): Promise<PendingEvaluation[]> {
    const query = evaluationReadProjection(this.selection(userId, sql`p.status='finished' AND p.finished_at+interval '720 hours'>=${at}::timestamptz
      AND NOT EXISTS(SELECT 1 FROM evaluations v WHERE v.participation_id=p.id)`), at);
    const result = await tx.execute<EvaluationReadRow>(sql`SELECT * FROM (${query}) projected WHERE pending ORDER BY "finishedAt" DESC,"participationId" DESC`);
    return result.rows.map(row => {
      const info = eligibility(row); ensureRead(info.pending && row.finishedAt !== null && info.firstSubmissionDeadlineAt !== null);
      return { participationId: row.participationId, event: { id: row.eventId, name: row.eventName }, finishedAt: row.finishedAt,
        firstSubmissionDeadlineAt: info.firstSubmissionDeadlineAt, completedServicesCount: info.completedServicesCount };
    });
  }
  async getPending(userId: string) { return this.snapshot(async (tx, at) => ({ items: await this.pending(tx, at, userId) })); }

  async getHistory(userId: string, page: HistoryPage) {
    return this.snapshot(async (tx, at) => {
      const cursor = page.cursor, after = cursor ? sql`(p.joined_at,p.id)<(${cursor.joinedAt}::timestamptz,${cursor.id}::uuid)` : sql`true`;
      const query = evaluationReadProjection(this.selection(userId, after, sql`ORDER BY p.joined_at DESC,p.id DESC LIMIT ${page.limit + 1}`), at);
      const rows = (await tx.execute<EvaluationReadRow>(sql`SELECT * FROM (${query}) projected ORDER BY "joinedAt" DESC,"participationId" DESC`)).rows;
      const visible = rows.slice(0, page.limit);
      const items: ParticipationHistoryItem[] = visible.map(row => {
        const info = eligibility(row);
        return { participationId: row.participationId, event: { id: row.eventId, name: row.eventName }, status: row.status,
          joinedAt: row.joinedAt, arenaEnteredAt: row.arenaEnteredAt, finishedAt: row.finishedAt, finishReason: row.finishReason,
          completedServicesCount: info.completedServicesCount, evaluation: { eligible: info.eligible, submitted: info.submitted, pending: info.pending } };
      });
      const last = visible.at(-1);
      return { items, nextCursor: rows.length > page.limit && last ? encodeHistoryCursor(last.joinedAt, last.participationId) : null };
    });
  }
  async getReturnState(userId: string): Promise<ParticipationReturnState> {
    return this.snapshot(async (tx, at) => {
      const pending = await this.pending(tx, at, userId);
      const row = (await tx.execute<{ participationId: string; eventId: string; finishReason: string; finishedAt: string }>(sql`
        SELECT id AS "participationId",event_id AS "eventId",finish_reason AS "finishReason",
          to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "finishedAt"
        FROM participations WHERE user_id=${userId} AND status='finished' AND finish_reason IN (${sql.join(SYSTEM_FINALIZATION_REASONS.map(reason => sql`${reason}`), sql`,`)})
        ORDER BY finished_at DESC,id DESC LIMIT 1`)).rows[0];
      if (row) ensureRead(isPreciseInstant(row.finishedAt));
      return { recentFinalization: row ? { participationId: row.participationId, eventId: row.eventId, finishReason: row.finishReason, finishedAt: row.finishedAt } : null,
        pendingEvaluationParticipationIds: pending.map(item => item.participationId) };
    });
  }
}
