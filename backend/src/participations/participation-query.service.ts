import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { AUTOMATIC_OPERATIONAL_REASON, automaticFinalizationReason, effectiveEventDeadline } from "../events/event-closure.projection";
import { participationView, type ParticipationView } from "./participation-lifecycle.dto";

/** Estado efetivo só de leitura. A finalização física continua sendo responsabilidade de E08.8/E08.9. */
export function participationProjection(userId: string, participationId?: string, at: SQL = sql`clock_timestamp()`): SQL {
  return sql`WITH observation AS MATERIALIZED (SELECT ${at} AS at), scoped AS MATERIALIZED (
    SELECT p.*,d.at,${effectiveEventDeadline()} AS deadline,
      e.external_queue_enabled AS event_external_queue_enabled,
      COALESCE(p.status IN ('waiting','active') AND (e.status='closed' OR ${effectiveEventDeadline()}<=d.at
        OR (p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at)),false) AS ended,
      CASE WHEN e.closure_mode='immediate' AND e.status='closed' AND e.operational_deadline_at>e.admin_deadline_at THEN 'admin_immediate'
        WHEN e.closure_mode='immediate' AND e.status='closed' THEN ${AUTOMATIC_OPERATIONAL_REASON}
        WHEN p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at THEN 'admin_controlled_external_wait_closed'
        ELSE ${automaticFinalizationReason()} END AS terminal_reason,
      CASE WHEN e.closure_mode='immediate' AND e.status='closed' THEN ${effectiveEventDeadline()}
        WHEN p.status='waiting' AND e.closure_mode='controlled' AND e.closure_requested_at<=d.at THEN e.closure_requested_at
        ELSE ${effectiveEventDeadline()} END AS terminal_at
    FROM participations p JOIN events e ON e.id=p.event_id CROSS JOIN observation d
    WHERE p.user_id=${userId}::uuid AND ${participationId ? sql`p.id=${participationId}::uuid` : sql`p.status IN ('waiting','active')`}
  ) SELECT scoped.id,scoped.event_id AS "eventId",CASE WHEN scoped.ended THEN 'finished' ELSE scoped.status END AS status,
    to_char(scoped.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "joinedAt",
    to_char(scoped.arena_entered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "arenaEnteredAt",
    to_char((CASE WHEN scoped.ended THEN scoped.terminal_at ELSE scoped.finished_at END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "finishedAt",
    CASE WHEN scoped.ended THEN scoped.terminal_reason ELSE scoped.finish_reason END AS "finishReason",
    CASE WHEN scoped.status='waiting' AND NOT scoped.ended THEN (SELECT count(*)::text FROM participations q
      WHERE q.event_id=scoped.event_id AND q.status='waiting' AND q.external_queue_order<=scoped.external_queue_order) END AS position,
    c.id AS "externalCallId",c.participation_id AS "externalCallParticipationId",c.event_id AS "externalCallEventId",
    c.status AS "externalCallStatus",
    CASE WHEN c.called_at IS NULL THEN NULL ELSE to_char(c.called_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "externalCallCalledAt",
    to_char(scoped.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt"
    FROM scoped LEFT JOIN external_entry_calls c
      ON c.participation_id=scoped.id AND c.event_id=scoped.event_id AND c.status='pending'
        AND scoped.status='waiting' AND NOT scoped.ended AND scoped.event_external_queue_enabled`;
}
export interface ParticipationProjectionRow extends Record<string, unknown> {
  id: string; eventId: string; status: string; joinedAt: string; arenaEnteredAt: string | null;
  finishedAt: string | null; finishReason: string | null; position: string | null; observedAt: string;
  externalCallId?: string | null; externalCallParticipationId?: string | null; externalCallEventId?: string | null;
  externalCallStatus?: string | null; externalCallCalledAt?: string | null;
}
export function publicParticipation(row: ParticipationProjectionRow): ParticipationView {
  if (row.status === "waiting" && (!row.position || !/^[1-9]\d*$/.test(row.position) || BigInt(row.position)>BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error("PARTICIPATION_POSITION_INTEGRITY");
  }
  const hasExternalCall = [row.externalCallId, row.externalCallCalledAt, row.externalCallStatus,
    row.externalCallParticipationId, row.externalCallEventId].some((item) => item !== undefined && item !== null);
  if (hasExternalCall && (row.status !== "waiting" || !row.externalCallId || !row.externalCallCalledAt ||
      (row.externalCallStatus !== undefined && row.externalCallStatus !== "pending") ||
      (row.externalCallParticipationId !== undefined && row.externalCallParticipationId !== row.id) ||
      (row.externalCallEventId !== undefined && row.externalCallEventId !== row.eventId))) {
    throw new Error("PARTICIPATION_EXTERNAL_CALL_INTEGRITY");
  }
  const value = participationView.parse({ id: row.id, eventId: row.eventId, status: row.status, joinedAt: row.joinedAt,
    arenaEnteredAt: row.arenaEnteredAt, finishedAt: row.finishedAt, finishReason: row.finishReason,
    externalQueue: row.status === "waiting" ? { position: Number(row.position), observedAt: row.observedAt } : null,
    externalEntryCall: hasExternalCall ? {
      callId: row.externalCallId,
      participationId: row.id,
      eventId: row.eventId,
      kind: "external_entry",
      status: "pending",
      calledAt: row.externalCallCalledAt,
    } : null });
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
