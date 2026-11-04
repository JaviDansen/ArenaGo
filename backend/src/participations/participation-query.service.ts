import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { automaticFinalizationReason, effectiveEventDeadline } from "../events/event-closure.projection";
import { participationView, type ParticipationView } from "./participation-lifecycle.dto";

/** Estado efetivo só de leitura. A finalização física continua sendo responsabilidade de E08.8/E08.9. */
export function participationProjection(userId: string, participationId?: string, at: SQL = sql`clock_timestamp()`): SQL {
  return sql`WITH observation AS MATERIALIZED (SELECT ${at} AS at), scoped AS MATERIALIZED (
    SELECT p.*,d.at,${effectiveEventDeadline()} AS deadline,
      COALESCE(p.status IN ('waiting','active') AND (e.status='closed' OR ${effectiveEventDeadline()}<=d.at
        OR (p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at)),false) AS ended,
      CASE WHEN e.closure_mode='immediate' AND e.status='closed' THEN 'admin_immediate'
        WHEN p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at THEN 'admin_controlled_external_wait_closed'
        ELSE ${automaticFinalizationReason()} END AS terminal_reason,
      CASE WHEN e.closure_mode='immediate' AND e.status='closed' THEN e.closure_requested_at
        WHEN p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at THEN e.closure_requested_at
        ELSE ${effectiveEventDeadline()} END AS terminal_at
    FROM participations p JOIN events e ON e.id=p.event_id CROSS JOIN observation d
    WHERE p.user_id=${userId}::uuid AND ${participationId ? sql`p.id=${participationId}::uuid` : sql`p.status IN ('waiting','active')`}
  ) SELECT id,event_id AS "eventId",CASE WHEN ended THEN 'finished' ELSE status END AS status,
    to_char(joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "joinedAt",
    to_char(arena_entered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "arenaEnteredAt",
    to_char((CASE WHEN ended THEN terminal_at ELSE finished_at END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "finishedAt",
    CASE WHEN ended THEN terminal_reason ELSE finish_reason END AS "finishReason",
    CASE WHEN status='waiting' AND NOT ended THEN (SELECT count(*)::text FROM participations q
      WHERE q.event_id=scoped.event_id AND q.status='waiting' AND q.external_queue_order<=scoped.external_queue_order) END AS position,
    to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt"
    FROM scoped`;
}
export interface ParticipationProjectionRow extends Record<string, unknown> {
  id: string; eventId: string; status: string; joinedAt: string; arenaEnteredAt: string | null;
  finishedAt: string | null; finishReason: string | null; position: string | null; observedAt: string;
}
export function publicParticipation(row: ParticipationProjectionRow): ParticipationView {
  if (row.status === "waiting" && (!row.position || !/^[1-9]\d*$/.test(row.position) || BigInt(row.position)>BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error("PARTICIPATION_POSITION_INTEGRITY");
  }
  const value = participationView.parse({ id: row.id, eventId: row.eventId, status: row.status, joinedAt: row.joinedAt,
    arenaEnteredAt: row.arenaEnteredAt, finishedAt: row.finishedAt, finishReason: row.finishReason,
    externalQueue: row.status === "waiting" ? { position: Number(row.position), observedAt: row.observedAt } : null });
  if ((value.status === "waiting" || value.status === "active") ? value.finishedAt !== null || value.finishReason !== null
    : value.finishedAt === null || value.finishReason === null) throw new Error("PARTICIPATION_TERMINAL_INTEGRITY");
  return value;
}
@Injectable()
export class ParticipationQueryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}
  private read(userId: string, participationId?: string) {
    return this.database.transaction(async tx => {
      const rows = (await tx.execute<ParticipationProjectionRow>(participationProjection(userId, participationId))).rows;
      if (rows.length>1) throw new Error("PARTICIPATION_CURRENT_INTEGRITY");
      const row=rows[0]; if (!row) return null;
      const value=publicParticipation(row);
      return !participationId && value.status!=="waiting" && value.status!=="active" ? null : value;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  current(userId: string) { return this.read(userId); }
  byId(userId: string, participationId: string) { return this.read(userId,participationId); }
}
