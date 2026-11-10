import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { CALL_NEXT_OPERATION, createCallNextFingerprint } from "./call-next.service";
import { COMPLETE_SERVICE_OPERATION, createCompleteServiceFingerprint } from "./complete.service";
import { ABSENT_SERVICE_OPERATION, createAbsentServiceFingerprint } from "./absent.service";

export type HistoricalScope =
  | { kind: "call-next"; eventId: string; experienceId: string; stationId: string }
  | { kind: "complete" | "absent"; eventId: string; serviceSessionId: string };

const uuid = z.uuid();
// Os serviços persistem Date.toISOString(): UTC, precisão de milissegundos e data real.
const instant = z.string().refine(value => {
  if (!/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
});
const queueOrder = z.string().refine(value => /^[1-9]\d*$/.test(value)
  && value.length <= 19 && BigInt(value) <= 9223372036854775807n);
const called = z.object({ serviceSession: z.object({ id: uuid, queueEntryId: uuid, experienceId: uuid,
  station: z.object({ id: uuid, label: z.string().trim().min(1) }), status: z.literal("pending"), calledAt: instant }) });
const completed = z.object({ serviceSession: z.object({ id: uuid, status: z.literal("completed"), resolvedAt: instant }),
  queueEntry: z.object({ status: z.literal("closed"), closeReason: z.literal("completed") }),
  participation: z.object({ status: z.literal("active"), currentQueueEntryId: z.null() }) });
const absent = z.object({ serviceSession: z.object({ id: uuid, status: z.literal("absent"), resolvedAt: instant }),
  previousQueueEntry: z.object({ id: uuid, status: z.literal("closed"), closeReason: z.literal("absent") }),
  requeued: z.boolean(), newQueueEntry: z.object({ id: uuid, status: z.literal("waiting"),
    queueOrder, position: z.number().int().positive().refine(Number.isSafeInteger) }).nullable() });

interface HistoryRow extends Record<string, unknown> {
  status: string; httpStatus: number | null; resultReference: string | null; resultPayload: unknown;
}
const unknownResult = { kind: "unknown", originSession: "unavailable", automaticReconciliation: false } as const;

/** Reconstrução limitada aos campos públicos conhecidos, sem expor JSON arbitrário persistido. */
function project(row: HistoryRow, scope: HistoricalScope): unknown | null {
  if (row.status !== "completed") return null;
  if (scope.kind === "call-next") {
    const parsed = called.safeParse(row.resultPayload);
    if (!parsed.success || row.httpStatus !== 201 || row.resultReference !== parsed.data.serviceSession.id ||
        parsed.data.serviceSession.experienceId !== scope.experienceId || parsed.data.serviceSession.station.id !== scope.stationId) return null;
    return parsed.data;
  }
  if (row.resultReference !== scope.serviceSessionId || row.httpStatus !== 200) return null;
  if (scope.kind === "complete") {
    const parsed = completed.safeParse(row.resultPayload);
    return parsed.success && parsed.data.serviceSession.id === scope.serviceSessionId ? parsed.data : null;
  }
  const parsed = absent.safeParse(row.resultPayload);
  if (!parsed.success || parsed.data.serviceSession.id !== scope.serviceSessionId) return null;
  const { requeued, newQueueEntry, previousQueueEntry } = parsed.data;
  if (requeued ? !newQueueEntry || newQueueEntry.id.toLowerCase() === previousQueueEntry.id.toLowerCase() : newQueueEntry !== null) return null;
  return parsed.data;
}

/** Leitura por ator, operação e fingerprint; não reserva, reenvia ou executa operações. */
@Injectable()
export class StaffHistoryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async find(userId: string, sessionId: string, key: string, scope: HistoricalScope) {
    const operation = scope.kind === "call-next" ? CALL_NEXT_OPERATION : scope.kind === "complete" ? COMPLETE_SERVICE_OPERATION : ABSENT_SERVICE_OPERATION;
    const fingerprint = scope.kind === "call-next" ? createCallNextFingerprint(scope.eventId, scope.experienceId, scope.stationId)
      : scope.kind === "complete" ? createCompleteServiceFingerprint(scope.eventId, scope.serviceSessionId)
        : createAbsentServiceFingerprint(scope.eventId, scope.serviceSessionId);
    return this.database.transaction(async tx => {
      const session = await tx.execute(sql`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=${sessionId} AND s.user_id=${userId} AND s.revoked_at IS NULL
          AND s.expires_at > statement_timestamp() AND u.is_active=true
          AND (s.admin_2fa_verified_at IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM user_roles a WHERE a.user_id=u.id AND a.role='admin' AND a.event_id IS NULL AND a.revoked_at IS NULL))`);
      if (!session.rows.length) return { kind: "session_invalid" } as const;
      const access = await tx.execute(sql`SELECT e.id FROM events e WHERE e.id=${scope.eventId} AND EXISTS (
        SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id
        WHERE u.id=${userId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
          AND r.role='staff' AND r.event_id=e.id AND r.revoked_at IS NULL)`);
      if (!access.rows.length) return { kind: "access_denied" } as const;
      const rows = await tx.execute<HistoryRow>(sql`SELECT status, http_status AS "httpStatus",
        result_reference AS "resultReference", result_payload AS "resultPayload"
        FROM idempotency_operations WHERE actor_user_id=${userId} AND operation=${operation}
          AND idempotency_key=${key} AND request_hash=${fingerprint} LIMIT 1`);
      const result = rows.rows[0] ? project(rows.rows[0], scope) : null;
      return result ? { kind: "recorded", originSession: "unavailable", automaticReconciliation: false, result } as const : unknownResult;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
