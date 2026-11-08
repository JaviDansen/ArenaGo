import { assertMutationSession, mutationTransaction, revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import type { CompletedService, CompleteServiceBlock, CompleteServiceInput, CompleteServiceResult } from "./complete.types";

export const COMPLETE_SERVICE_OPERATION = "complete_service_session";

export function createCompleteServiceFingerprint(eventId: string, serviceSessionId: string): string {
  return createRequestFingerprint(COMPLETE_SERVICE_OPERATION, { eventId, serviceSessionId });
}
export class CompleteServiceIntegrityError extends Error {
  constructor(detail: string) { super(`Integridade da conclusão interna: ${detail}`); this.name = "CompleteServiceIntegrityError"; }
}
class CompleteRollback extends Error {
  constructor(readonly result: CompleteServiceBlock) { super(result.kind); }
}
function block(result: CompleteServiceBlock): never { throw new CompleteRollback(result); }
function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new CompleteServiceIntegrityError(detail);
}
function instant(ms: number): Date {
  ensure(typeof ms === "number" && Number.isFinite(ms), "instante PostgreSQL inválido.");
  const date = new Date(ms); ensure(Number.isFinite(date.getTime()), "instante fora do intervalo de Date."); return date;
}
function resultFor(id: string, resolvedAt: Date): CompletedService {
  return { serviceSession: { id, status: "completed", resolvedAt },
    queueEntry: { status: "closed", closeReason: "completed" },
    participation: { status: "active", currentQueueEntryId: null } };
}
function replay(payload: JsonValue | null, input: CompleteServiceInput): CompletedService {
  ensure(payload && typeof payload === "object" && !Array.isArray(payload), "replay inválido.");
  const s = payload.serviceSession, q = payload.queueEntry, p = payload.participation;
  ensure(s && typeof s === "object" && !Array.isArray(s) && s.id === input.serviceSessionId
    && s.status === "completed" && typeof s.resolvedAt === "string", "replay de atendimento inválido.");
  ensure(q && typeof q === "object" && !Array.isArray(q) && q.status === "closed" && q.closeReason === "completed"
    && p && typeof p === "object" && !Array.isArray(p) && p.status === "active" && p.currentQueueEntryId === null,
    "replay de entrada/participação inválido.");
  return resultFor(input.serviceSessionId, instant(Date.parse(s.resolvedAt)));
}

/** E07.5: resolve um pending explícito; não finaliza a participação nem cria próxima chamada. */
@Injectable()
export class CompleteService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  /** Contrato interno E07; os controllers usam exclusivamente a entrada autenticada. */
  async complete(input: CompleteServiceInput): Promise<CompleteServiceResult> {
    return this.execute(input, null);
  }

  async completeAuthenticated(input: CompleteServiceInput, context: MutationSession): Promise<CompleteServiceResult> {
    assertMutationSession(context, input.staffUserId);
    return this.execute(input,  { ...context, staffEventId: input.eventId });
  }

  private async execute(input: CompleteServiceInput, context: MutationSession | null): Promise<CompleteServiceResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("Chave de idempotência ou expiração inválida.");
    }
    try {
      return await mutationTransaction(this.database, context, async (tx): Promise<CompleteServiceResult> => {
        // Descoberta da sessão EXPLÍCITA, sem autorizar mutação ou escolher a sessão atual da pessoa.
        const lookup = await tx.execute<{ experienceId: string; stationId: string; queueEntryId: string; participationId: string }>(sql`
          SELECT s.experience_id AS "experienceId", s.station_id AS "stationId",
            s.queue_entry_id AS "queueEntryId", q.participation_id AS "participationId"
          FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id
          WHERE s.id=${input.serviceSessionId} AND q.event_id=${input.eventId}
        `);
        const target = lookup.rows[0];
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR SHARE`);
        if (!event.rows.length) block({ kind: "staff_event_forbidden" });
        if (target) {
          const experience = await tx.execute(sql`SELECT id FROM experiences
            WHERE id=${target.experienceId} AND event_id=${input.eventId} FOR UPDATE`);
          ensure(experience.rows.length === 1, "experiência do atendimento incoerente.");
          const station = await tx.execute(sql`SELECT id FROM stations
            WHERE id=${target.stationId} AND experience_id=${target.experienceId} FOR UPDATE`);
          ensure(station.rows.length === 1, "estação do atendimento incoerente.");
        }
        // Conta/concessão ficam protegidas até COMMIT. Admin isolado não satisfaz a consulta.
        const staff = await tx.execute(sql`SELECT r.id FROM users u JOIN user_roles r ON r.user_id=u.id
          WHERE u.id=${input.staffUserId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
            AND r.role='staff' AND r.event_id=${input.eventId} AND r.revoked_at IS NULL
          FOR SHARE OF u, r`);
        if (!staff.rows.length) {
          if (context !== null) await revalidateMutationSession(tx, context);
          block({ kind: "staff_event_forbidden" });
        }
        if (!target) block({ kind: "service_not_found" });
        const person = await tx.execute<{ status: string; currentId: string | null }>(sql`
          SELECT status, current_queue_entry_id AS "currentId" FROM participations
          WHERE id=${target.participationId} AND event_id=${input.eventId} FOR UPDATE`);
        ensure(person.rows.length === 1, "participação do atendimento incoerente.");
        const entry = await tx.execute<{ status: string }>(sql`SELECT status FROM queue_entries
          WHERE id=${target.queueEntryId} AND participation_id=${target.participationId}
            AND event_id=${input.eventId} AND experience_id=${target.experienceId} FOR UPDATE`);
        ensure(entry.rows.length === 1, "entrada mudou de vínculo após descoberta.");
        const session = await tx.execute<{ status: string }>(sql`SELECT status FROM service_sessions
          WHERE id=${input.serviceSessionId} AND queue_entry_id=${target.queueEntryId}
            AND experience_id=${target.experienceId} AND station_id=${target.stationId} FOR UPDATE`);
        ensure(session.rows.length === 1, "atendimento mudou de vínculo após descoberta.");

        const reservation = await reserveIdempotencyOperationWithTx(tx, {
          actorUserId: input.staffUserId, operation: COMPLETE_SERVICE_OPERATION, idempotencyKey: input.idempotencyKey,
          requestHash: createCompleteServiceFingerprint(input.eventId, input.serviceSessionId), expiresAt: input.expiresAt,
        });
        if (context !== null) await revalidateMutationSession(tx, context);
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") return { kind: reservation.kind };
        // Resposta histórica: não exigir ponteiro/estados atuais nem tocar atendimento posterior.
        if (reservation.kind === "replay") return { kind: "replay", ...replay(reservation.resultPayload, input) };
        ensure(["pending", "completed", "absent", "canceled"].includes(session.rows[0].status), "estado do atendimento desconhecido.");
        if (session.rows[0].status !== "pending") block({ kind: "service_not_pending" });
        ensure(person.rows[0].status === "active" && person.rows[0].currentId === target.queueEntryId
          && entry.rows[0].status === "called", "pending sem participação ativa e entrada called corrente.");

        // Corte no UPDATE decisivo, depois de TODAS as esperas; sem guardas de novas inscrições.
        const resolved = await tx.execute<{ resolvedAtMs: number }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE service_sessions s SET status='completed', resolved_at=d.at, resolved_by_user_id=${input.staffUserId}
          FROM queue_entries q, participations p, events e, decision d
          WHERE s.id=${input.serviceSessionId} AND s.queue_entry_id=${target.queueEntryId}
            AND s.experience_id=${target.experienceId} AND s.station_id=${target.stationId} AND s.status='pending'
            AND q.id=s.queue_entry_id AND q.experience_id=s.experience_id AND q.event_id=${input.eventId} AND q.status='called'
            AND p.id=q.participation_id AND p.id=${target.participationId} AND p.event_id=q.event_id
            AND p.status='active' AND p.current_queue_entry_id=q.id AND e.id=q.event_id
            AND e.status <> 'closed' AND e.starts_at <= d.at AND d.at < e.operational_deadline_at
            AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
          RETURNING (EXTRACT(EPOCH FROM s.resolved_at)*1000)::double precision AS "resolvedAtMs"
        `);
        if (!resolved.rows.length) block({ kind: "event_operation_ended" });
        ensure(resolved.rows.length === 1, "conclusão afetou múltiplos atendimentos.");
        const resolvedAt = instant(resolved.rows[0].resolvedAtMs);
        // Copia timestamptz no PostgreSQL para preservar os mesmos microssegundos nas duas linhas.
        const closed = await tx.execute(sql`UPDATE queue_entries q SET status='closed', closed_at=s.resolved_at, close_reason='completed'
          FROM service_sessions s WHERE q.id=${target.queueEntryId} AND q.participation_id=${target.participationId}
            AND q.event_id=${input.eventId} AND q.experience_id=${target.experienceId} AND q.status='called'
            AND s.id=${input.serviceSessionId} AND s.queue_entry_id=q.id AND s.status='completed' RETURNING q.id`);
        ensure(closed.rows.length === 1, "entrada called não pôde ser encerrada.");
        const cleared = await tx.execute(sql`UPDATE participations SET current_queue_entry_id=NULL
          WHERE id=${target.participationId} AND event_id=${input.eventId} AND status='active'
            AND current_queue_entry_id=${target.queueEntryId} RETURNING id`);
        ensure(cleared.rows.length === 1, "ponteiro não pôde ser liberado.");
        const result = resultFor(input.serviceSessionId, resolvedAt);
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200,
          resultReference: input.serviceSessionId,
          resultPayload: { ...result, serviceSession: { ...result.serviceSession, resolvedAt: resolvedAt.toISOString() } } });
        return { kind: "completed", ...result };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof CompleteRollback) return error.result;
      throw error;
    }
  }
}
