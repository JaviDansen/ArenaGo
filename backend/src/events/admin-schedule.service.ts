import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import { assertAdminSessionWithTx, authorizeGlobalAdminWithTx } from "./admin-operation-auth";
import { adminScheduleBody } from "./admin-schedule.dto";
import type { AdminScheduleInput, AdminScheduleResult, AdminScheduleState } from "./admin-schedule.types";

export const ADMIN_SCHEDULE_OPERATION = "admin_update_event_schedule";
export function scheduleFingerprint(eventId: string, officialEndsAt: string, operationalDeadlineAt: string, reason: string) {
  const body = adminScheduleBody.parse({ officialEndsAt, operationalDeadlineAt, reason });
  return createRequestFingerprint(ADMIN_SCHEDULE_OPERATION, { eventId, ...body });
}
class ScheduleRollback extends Error {
  constructor(readonly result: AdminScheduleResult) { super(result.kind); }
}
function block(result: AdminScheduleResult): never { throw new ScheduleRollback(result); }
function replay(payload: JsonValue | null, input: AdminScheduleInput): AdminScheduleState {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.eventId !== input.eventId
    || payload.officialEndsAt !== input.officialEndsAt || payload.operationalDeadlineAt !== input.operationalDeadlineAt) {
    throw new Error("Programação idempotente persistida inválida.");
  }
  const state: AdminScheduleState = { eventId: input.eventId, officialEndsAt: input.officialEndsAt, operationalDeadlineAt: input.operationalDeadlineAt };
  if (payload.changedAt !== undefined) {
    if (typeof payload.changedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(payload.changedAt)
      || !Number.isFinite(Date.parse(payload.changedAt))) throw new Error("Instante de replay inválido.");
    state.changedAt = payload.changedAt;
  }
  return state;
}

@Injectable()
export class AdminScheduleService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async updateSchedule(input: AdminScheduleInput): Promise<AdminScheduleResult> {
    input = { ...input, ...adminScheduleBody.parse(inputBody(input)) };
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128
      || [...input.idempotencyKey].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || !Number.isFinite(input.expiresAt.getTime())) throw new Error("Idempotência administrativa inválida.");
    try {
      return await this.database.transaction(async tx => {
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR UPDATE`);
        await authorizeGlobalAdminWithTx(tx, input, block);
        if (!event.rows.length) block({ kind: "resource_not_found" });
        const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId, operation: ADMIN_SCHEDULE_OPERATION,
          idempotencyKey: input.idempotencyKey, requestHash: scheduleFingerprint(input.eventId, input.officialEndsAt, input.operationalDeadlineAt, input.reason), expiresAt: input.expiresAt });
        await assertAdminSessionWithTx(tx, input, block);
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") block({ kind: reservation.kind });
        if (reservation.kind === "replay") {
          if (reservation.httpStatus !== 200) throw new Error("Status de replay inválido.");
          block({ kind: "replay", ...replay(reservation.resultPayload, input) });
        }
        // Comparação no PostgreSQL preserva inclusive microssegundos preexistentes.
        const current = await tx.execute<{ same: boolean }>(sql`SELECT
          official_ends_at=${input.officialEndsAt}::timestamptz AND operational_deadline_at=${input.operationalDeadlineAt}::timestamptz AS same
          FROM events WHERE id=${input.eventId}`);
        const state: AdminScheduleState = { eventId: input.eventId, officialEndsAt: input.officialEndsAt, operationalDeadlineAt: input.operationalDeadlineAt };
        if (!current.rows[0]) throw new Error("Evento bloqueado desapareceu.");
        if (!current.rows[0].same) {
          // Uma só decisão temporal para classificação e escrita condicionada, após TODAS as esperas.
          const decision = await tx.execute<{ outcome: string; changedAt: string | null; before: JsonValue }>(sql`
            WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at),
            previous AS MATERIALIZED (SELECT e.*, d.at,
              (e.status IN ('closing','closed') OR e.closure_requested_at IS NOT NULL OR e.closure_mode IS NOT NULL
                OR e.admin_deadline_at IS NOT NULL OR d.at >= e.official_ends_at) AS closed,
              (${input.officialEndsAt}::timestamptz <= e.starts_at OR ${input.officialEndsAt}::timestamptz <= d.at) AS invalid
              FROM events e CROSS JOIN decision d WHERE e.id=${input.eventId}),
            changed AS (UPDATE events e SET official_ends_at=${input.officialEndsAt}::timestamptz,
              operational_deadline_at=${input.operationalDeadlineAt}::timestamptz,updated_at=p.at
              FROM previous p, sessions a WHERE e.id=p.id AND NOT p.closed AND NOT p.invalid
                AND ${input.operationalDeadlineAt}::timestamptz >= ${input.officialEndsAt}::timestamptz
                AND ${input.operationalDeadlineAt}::timestamptz <= ${input.officialEndsAt}::timestamptz + interval '1 hour'
                AND a.id=${input.sessionId} AND a.user_id=${input.userId} AND a.revoked_at IS NULL
                AND a.admin_2fa_verified_at IS NOT NULL AND p.at < a.expires_at
              RETURNING e.id,e.updated_at)
            SELECT CASE WHEN p.closed THEN 'closed' WHEN p.invalid THEN 'invalid'
              WHEN c.id IS NULL THEN 'not_written' ELSE 'changed' END AS outcome,
              to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "changedAt",
              jsonb_build_object('officialEndsAt',p.official_ends_at,'operationalDeadlineAt',p.operational_deadline_at) AS before
            FROM previous p LEFT JOIN changed c ON c.id=p.id`);
          const row = decision.rows[0];
          // Inclui expiração durante a execução decisiva, revertendo até eventual UPDATE.
          await assertAdminSessionWithTx(tx, input, block);
          if (!row) throw new Error("Decisão de programação ausente.");
          if (row.outcome === "closed") block({ kind: "event_time_change_closed" });
          if (row.outcome === "invalid") block({ kind: "invalid_schedule" });
          if (row.outcome !== "changed" || !row.changedAt) throw new Error("Programação não foi atualizada.");
          state.changedAt = row.changedAt;
          const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
            SELECT ${randomUUID()},${input.userId},e.id,'user','event','event_schedule_changed',${input.reason},
              jsonb_build_object('before',${JSON.stringify(row.before)}::jsonb,'after',
                jsonb_build_object('officialEndsAt',e.official_ends_at,'operationalDeadlineAt',e.operational_deadline_at)),e.updated_at
            FROM events e WHERE e.id=${input.eventId} RETURNING id`);
          if (audit.rows.length !== 1) throw new Error("Alteração de programação exige exatamente uma auditoria.");
        }
        await assertAdminSessionWithTx(tx, input, block);
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200, resultReference: input.eventId,
          resultPayload: { ...state } });
        return { kind: "completed" as const, ...state };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof ScheduleRollback) return error.result;
      throw error;
    }
  }
}
function inputBody(input: AdminScheduleInput) {
  return { officialEndsAt: input.officialEndsAt, operationalDeadlineAt: input.operationalDeadlineAt, reason: input.reason };
}
