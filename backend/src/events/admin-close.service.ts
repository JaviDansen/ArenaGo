import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import { assertAdminSessionWithTx, authorizeGlobalAdminWithTx } from "./admin-operation-auth";
import { adminCloseBody, type AdminCloseBody } from "./admin-close.dto";
import type { AdminCloseInput, AdminCloseResult, AdminCloseState } from "./admin-close.types";

export const ADMIN_CLOSE_OPERATION = "admin_close_event";
export const ADMIN_IMMEDIATE_REASON = "admin_immediate";
export const ADMIN_CONTROLLED_EXTERNAL_REASON = "admin_controlled_external_wait_closed";
export function closeFingerprint(eventId: string, body: AdminCloseBody): string {
  return createRequestFingerprint(ADMIN_CLOSE_OPERATION, { eventId, ...adminCloseBody.parse(body) });
}
class CloseRollback extends Error { constructor(readonly result: AdminCloseResult) { super(result.kind); } }
function block(result: AdminCloseResult): never { throw new CloseRollback(result); }
function ensure(value: unknown, detail: string): asserts value { if (!value) throw new Error(`Integridade do encerramento: ${detail}`); }
function validInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) && Number.isFinite(Date.parse(value));
}
function replay(payload: JsonValue | null, input: AdminCloseInput): AdminCloseState {
  ensure(payload && typeof payload === "object" && !Array.isArray(payload), "replay não é objeto.");
  const { eventId, status, closureMode, newEntriesClosedAt, effectiveOperationalDeadlineAt, externalWaitingFinalized } = payload;
  ensure(eventId === input.eventId && closureMode === input.mode && status === (input.mode === "immediate" ? "closed" : "closing")
    && validInstant(newEntriesClosedAt) && validInstant(effectiveOperationalDeadlineAt)
    && typeof externalWaitingFinalized === "number" && Number.isSafeInteger(externalWaitingFinalized) && externalWaitingFinalized >= 0, "resposta de replay inválida.");
  ensure(input.mode === "immediate" ? effectiveOperationalDeadlineAt <= newEntriesClosedAt
    : Date.parse(effectiveOperationalDeadlineAt) === Date.parse(input.controlledUntilAt), "prazo de replay inválido.");
  return { eventId, status, closureMode, newEntriesClosedAt, effectiveOperationalDeadlineAt, externalWaitingFinalized };
}
type Person = { id: string; status: string; currentId: string | null };
type Entry = { id: string; personId: string; experienceId: string; status: string };
type Pending = { id: string; entryId: string; experienceId: string; stationId: string };

/** E08.8: nenhuma publicação parcial entre corte administrativo e efeitos de domínio. */
@Injectable()
export class AdminCloseService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  private async lockResources(tx: DatabaseTransactionExecutor, eventId: string) {
    const experiences = (await tx.execute<{ id: string }>(sql`SELECT id FROM experiences WHERE event_id=${eventId} ORDER BY id FOR UPDATE`)).rows;
    const stations = (await tx.execute<{ id: string; experienceId: string }>(sql`SELECT s.id,s.experience_id AS "experienceId" FROM stations s
      JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${eventId} ORDER BY s.id FOR UPDATE OF s`)).rows;
    const people = (await tx.execute<Person>(sql`SELECT id,status,current_queue_entry_id AS "currentId" FROM participations
      WHERE event_id=${eventId} ORDER BY id FOR UPDATE`)).rows;
    const entries = (await tx.execute<Entry>(sql`SELECT id,participation_id AS "personId",experience_id AS "experienceId",status FROM queue_entries
      WHERE event_id=${eventId} AND status IN ('waiting','called') ORDER BY id FOR UPDATE`)).rows;
    const pending = (await tx.execute<Pending>(sql`SELECT s.id,s.queue_entry_id AS "entryId",s.experience_id AS "experienceId",s.station_id AS "stationId"
      FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${eventId} AND s.status='pending' ORDER BY s.id FOR UPDATE OF s`)).rows;
    return { experiences, stations, people, entries, pending };
  }

  async closeEvent(input: AdminCloseInput): Promise<AdminCloseResult> {
    const body = adminCloseBody.parse({ mode: input.mode, reason: input.reason, ...(input.mode === "controlled" ? { controlledUntilAt: input.controlledUntilAt } : {}) });
    input = { ...input, ...body };
    ensure(input.idempotencyKey.trim() && input.idempotencyKey.length <= 128
      && [...input.idempotencyKey].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) && Number.isFinite(input.expiresAt.getTime()), "idempotência inválida.");
    try {
      return await this.database.transaction(async tx => {
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR UPDATE`);
        const resources = await this.lockResources(tx, input.eventId);
        await authorizeGlobalAdminWithTx(tx, input, block);
        if (!event.rows.length) block({ kind: "resource_not_found" });
        const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId, operation: ADMIN_CLOSE_OPERATION,
          idempotencyKey: input.idempotencyKey, requestHash: closeFingerprint(input.eventId, body), expiresAt: input.expiresAt });
        await assertAdminSessionWithTx(tx, input, block);
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") block({ kind: reservation.kind });
        if (reservation.kind === "replay") {
          ensure(reservation.httpStatus === 200, "status de replay inválido.");
          block({ kind: "replay", ...replay(reservation.resultPayload, input) });
        }
        // Revalidação cruzada após TODOS os locks. Nenhum estado incoerente vira limpeza parcial.
        const { people, entries, pending, experiences, stations } = resources;
        const persons = new Map(people.map(p => [p.id, p])), qs = new Map(entries.map(q => [q.id, q]));
        const xs = new Set(experiences.map(x => x.id)), ss = new Map(stations.map(s => [s.id, s.experienceId]));
        const calls = new Map(pending.map(s => [s.entryId, s]));
        ensure(calls.size === pending.length, "múltiplos pending para uma entrada.");
        for (const q of entries) { const p = persons.get(q.personId); ensure(p?.status === "active" && p.currentId === q.id && xs.has(q.experienceId), "entrada sem participação ativa/ponteiro/experiência.");
          ensure(q.status === "called" ? calls.has(q.id) : !calls.has(q.id), "entrada e chamada divergentes."); }
        for (const p of people) ensure(p.currentId === null || (p.status === "active" && qs.get(p.currentId)?.personId === p.id), "ponteiro corrente divergente.");
        for (const s of pending) { const q = qs.get(s.entryId); ensure(q?.status === "called" && q.experienceId === s.experienceId && ss.get(s.stationId) === s.experienceId, "pending sem vínculos correntes."); }

        const immediate = input.mode === "immediate", until = input.mode === "controlled" ? input.controlledUntilAt : null;
        const changed = await tx.execute<{ outcome: string; at: string | null; deadline: string | null; before: JsonValue }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at), previous AS MATERIALIZED (
            SELECT e.*,d.at,(e.status IN ('closing','closed') OR e.closure_requested_at IS NOT NULL OR e.closure_mode IS NOT NULL OR e.admin_deadline_at IS NOT NULL) AS closed,
              (NOT ${immediate}::boolean AND (${until}::timestamptz IS NULL OR ${until}::timestamptz <= d.at
                OR ${until}::timestamptz > d.at+interval '1 hour' OR ${until}::timestamptz > e.operational_deadline_at)) AS invalid
            FROM events e CROSS JOIN decision d WHERE e.id=${input.eventId}),
          changed AS (UPDATE events e SET status=${immediate ? "closed" : "closing"}::varchar(20),closure_mode=${input.mode}::varchar(20),
            closure_requested_at=p.at,admin_deadline_at=CASE WHEN ${immediate}::boolean THEN p.at ELSE ${until}::timestamptz END,updated_at=p.at
            FROM previous p,sessions a WHERE e.id=p.id AND NOT p.closed AND NOT p.invalid
              AND a.id=${input.sessionId} AND a.user_id=${input.userId} AND a.revoked_at IS NULL AND a.admin_2fa_verified_at IS NOT NULL AND p.at<a.expires_at
            RETURNING e.id,e.closure_requested_at,e.admin_deadline_at,e.operational_deadline_at)
          SELECT CASE WHEN p.closed THEN 'closed' WHEN p.invalid THEN 'invalid' WHEN c.id IS NULL THEN 'not_written' ELSE 'changed' END AS outcome,
            to_char(c.closure_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
            to_char(LEAST(c.operational_deadline_at,c.admin_deadline_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline,
            jsonb_build_object('status',p.status,'closureMode',p.closure_mode,'operationalDeadlineAt',p.operational_deadline_at,
              'effectiveOperationalDeadlineAt',LEAST(p.operational_deadline_at,p.admin_deadline_at)) AS before
          FROM previous p LEFT JOIN changed c ON c.id=p.id`);
        await assertAdminSessionWithTx(tx, input, block);
        const row = changed.rows[0]; ensure(row, "decisão ausente.");
        if (row.outcome === "closed") block({ kind: "event_already_closed" });
        if (row.outcome === "invalid") block({ kind: "closure_deadline_invalid" });
        ensure(row.outcome === "changed" && validInstant(row.at) && validInstant(row.deadline), "UPDATE de encerramento não efetivado.");
        if (immediate) {
          const canceled = await tx.execute(sql`UPDATE service_sessions s SET status='canceled',resolved_at=e.closure_requested_at,
            resolved_by_user_id=${input.userId},cancel_reason=${ADMIN_IMMEDIATE_REASON}
            FROM experiences x,events e WHERE s.experience_id=x.id AND x.event_id=e.id AND e.id=${input.eventId} AND s.status='pending' RETURNING s.id`);
          ensure(canceled.rows.length === pending.length, "contagem de pending cancelados divergente.");
          const closed = await tx.execute(sql`UPDATE queue_entries q SET status='closed',closed_at=e.closure_requested_at,close_reason=${ADMIN_IMMEDIATE_REASON}
            FROM events e WHERE q.event_id=e.id AND e.id=${input.eventId} AND q.status IN ('waiting','called') RETURNING q.id`);
          ensure(closed.rows.length === entries.length, "contagem de entradas encerradas divergente.");
        }
        const finalized = await tx.execute<{ previousStatus: string }>(sql`WITH targets AS MATERIALIZED (
            SELECT id,status FROM participations WHERE event_id=${input.eventId} AND (status='waiting' OR (${immediate}::boolean AND status='active')))
          UPDATE participations p SET status='finished',finished_at=e.closure_requested_at,
            finish_reason=${immediate ? ADMIN_IMMEDIATE_REASON : ADMIN_CONTROLLED_EXTERNAL_REASON},current_queue_entry_id=NULL
          FROM events e,targets t WHERE p.id=t.id AND p.event_id=e.id AND e.id=${input.eventId} RETURNING t.status AS "previousStatus"`);
        ensure(finalized.rows.length === people.filter(p => p.status === "waiting" || (immediate && p.status === "active")).length, "contagem de participações finalizadas divergente.");
        const externalWaitingFinalized = finalized.rows.filter(p => p.previousStatus === "waiting").length;
        const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
          SELECT ${randomUUID()},${input.userId},e.id,'user','event','event_admin_closed',${input.reason},
            jsonb_build_object('before',${JSON.stringify(row.before)}::jsonb,'after',jsonb_build_object('status',e.status,'closureMode',e.closure_mode,
              'newEntriesClosedAt',e.closure_requested_at,'effectiveOperationalDeadlineAt',LEAST(e.operational_deadline_at,e.admin_deadline_at)),
              'externalWaitingFinalized',${externalWaitingFinalized}::bigint),e.closure_requested_at
          FROM events e WHERE e.id=${input.eventId} RETURNING id`);
        ensure(audit.rows.length === 1, "encerramento exige exatamente uma auditoria.");
        await assertAdminSessionWithTx(tx, input, block);
        const state: AdminCloseState = { eventId: input.eventId, status: immediate ? "closed" : "closing", closureMode: input.mode,
          newEntriesClosedAt: row.at, effectiveOperationalDeadlineAt: row.deadline, externalWaitingFinalized };
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200, resultReference: input.eventId, resultPayload: { ...state } });
        await assertAdminSessionWithTx(tx, input, block);
        return { kind: "completed" as const, ...state };
      }, { isolationLevel: "read committed" });
    } catch (error) { if (error instanceof CloseRollback) return error.result; throw error; }
  }
}
