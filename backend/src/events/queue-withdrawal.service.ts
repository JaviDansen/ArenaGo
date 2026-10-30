import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import type { QueueWithdrawalBlock, WithdrawExperienceQueueInput, WithdrawExperienceQueueResult, WithdrawnExperienceQueue } from "./queue-withdrawal.types";

export const QUEUE_WITHDRAWAL_OPERATION = "withdraw_experience_queue";
/** Código técnico interno, ainda não um catálogo público de motivos. Cabe em varchar(40). */
export const QUEUE_WITHDRAWAL_REASON = "participant_queue_withdrawal";

export function createQueueWithdrawalFingerprint(participationId: string, queueEntryId: string): string {
  return createRequestFingerprint(QUEUE_WITHDRAWAL_OPERATION, { participationId, queueEntryId });
}

export class QueueWithdrawalIntegrityError extends Error {
  constructor(detail: string) { super(`Integridade da desistência interna: ${detail}`); this.name = "QueueWithdrawalIntegrityError"; }
}
class WithdrawalRollback extends Error {
  constructor(readonly result: QueueWithdrawalBlock) { super(result.kind); }
}
function block(result: QueueWithdrawalBlock): never { throw new WithdrawalRollback(result); }
function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new QueueWithdrawalIntegrityError(detail);
}
function instant(ms: number): Date {
  ensure(typeof ms === "number" && Number.isFinite(ms), "instante PostgreSQL inválido.");
  const date = new Date(ms); ensure(Number.isFinite(date.getTime()), "instante fora do intervalo de Date."); return date;
}

interface SessionRow extends Record<string, unknown> {
  id: string; status: string; experienceId: string; stationId: string;
}
function replay(payload: JsonValue | null, input: WithdrawExperienceQueueInput): WithdrawnExperienceQueue {
  ensure(payload && typeof payload === "object" && !Array.isArray(payload), "replay inválido.");
  ensure(payload.participationId === input.participationId && payload.queueEntryId === input.queueEntryId
    && typeof payload.experienceId === "string" && payload.status === "closed"
    && typeof payload.closedAt === "string", "replay de outra intenção ou incompleto.");
  let serviceSession: WithdrawnExperienceQueue["serviceSession"] = null;
  if (payload.serviceSession !== null) {
    const s = payload.serviceSession;
    ensure(s && typeof s === "object" && !Array.isArray(s) && typeof s.id === "string"
      && s.status === "canceled" && typeof s.resolvedAt === "string", "replay de atendimento inválido.");
    serviceSession = { id: s.id, status: "canceled", resolvedAt: instant(Date.parse(s.resolvedAt)) };
  }
  return { participationId: input.participationId, queueEntryId: input.queueEntryId, experienceId: payload.experienceId,
    status: "closed", closedAt: instant(Date.parse(payload.closedAt)), serviceSession };
}

/** E07.3: abandona uma tentativa específica, sem sair da Arena nem produzir atendimento. */
@Injectable()
export class QueueWithdrawalService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async withdrawExperienceQueue(input: WithdrawExperienceQueueInput): Promise<WithdrawExperienceQueueResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("Chave de idempotência ou expiração inválida.");
    }
    try {
      return await this.database.transaction(async (tx): Promise<WithdrawExperienceQueueResult> => {
        // Descoberta não bloqueante da tentativa EXPLÍCITA, com titularidade já filtrada.
        const lookup = await tx.execute<{ eventId: string; experienceId: string; queueEntryId: string }>(sql`
          SELECT p.event_id AS "eventId", q.experience_id AS "experienceId", q.id AS "queueEntryId"
          FROM participations p JOIN queue_entries q ON q.participation_id=p.id AND q.event_id=p.event_id
          WHERE p.id=${input.participationId} AND p.user_id=${input.userId} AND q.id=${input.queueEntryId}
        `);
        const target = lookup.rows[0]; if (!target) block({ kind: "access_denied" });
        const event = await tx.execute<{ status: string }>(sql`SELECT status FROM events WHERE id=${target.eventId} FOR SHARE`);
        ensure(event.rows.length === 1, "evento da tentativa ausente.");
        ensure(["scheduled", "open", "closing", "closed"].includes(event.rows[0].status), "estado do evento desconhecido.");
        const experience = await tx.execute(sql`SELECT id FROM experiences
          WHERE id=${target.experienceId} AND event_id=${target.eventId} FOR UPDATE`);
        ensure(experience.rows.length === 1, "experiência da tentativa incoerente.");

        // Re-resolver DEPOIS de esperar pela experiência: uma chamada pode ter vencido.
        const discovery = await tx.execute<{ status: string; sessionId: string | null; stationId: string | null; sessionExperienceId: string | null }>(sql`
          SELECT q.status, s.id AS "sessionId", s.station_id AS "stationId", s.experience_id AS "sessionExperienceId"
          FROM queue_entries q LEFT JOIN service_sessions s ON s.queue_entry_id=q.id
          WHERE q.id=${input.queueEntryId} AND q.participation_id=${input.participationId}
            AND q.event_id=${target.eventId} AND q.experience_id=${target.experienceId}
        `);
        ensure(discovery.rows.length === 1, "tentativa mudou de vínculo após a descoberta.");
        const discovered = discovery.rows[0];
        if (discovered.status === "called" && discovered.sessionId !== null) {
          ensure(discovered.sessionExperienceId === target.experienceId && discovered.stationId !== null, "atendimento de outra experiência.");
          const station = await tx.execute(sql`SELECT id FROM stations
            WHERE id=${discovered.stationId} AND experience_id=${target.experienceId} FOR UPDATE`);
          ensure(station.rows.length === 1, "estação do atendimento incoerente.");
        }
        const participation = await tx.execute<{ status: string; currentId: string | null }>(sql`
          SELECT status, current_queue_entry_id AS "currentId" FROM participations
          WHERE id=${input.participationId} AND user_id=${input.userId} AND event_id=${target.eventId} FOR UPDATE
        `);
        const owned = participation.rows[0]; if (!owned) block({ kind: "access_denied" });
        ensure(["waiting", "active", "finished", "canceled"].includes(owned.status), "estado da participação desconhecido.");
        const entry = await tx.execute<{ status: string }>(sql`SELECT status FROM queue_entries
          WHERE id=${input.queueEntryId} AND participation_id=${input.participationId}
            AND event_id=${target.eventId} AND experience_id=${target.experienceId} FOR UPDATE`);
        ensure(entry.rows.length === 1 && entry.rows[0].status === discovered.status, "tentativa mudou fora do protocolo de locks.");
        const sessions = await tx.execute<SessionRow>(sql`SELECT id, status, experience_id AS "experienceId", station_id AS "stationId"
          FROM service_sessions WHERE queue_entry_id=${input.queueEntryId} FOR UPDATE`);
        ensure(sessions.rows.length <= 1, "múltiplos atendimentos para uma entrada.");
        const session = sessions.rows[0];
        ensure((session?.id ?? null) === discovered.sessionId, "atendimento mudou fora do protocolo de locks.");
        if (session) ensure(session.experienceId === target.experienceId && session.stationId === discovered.stationId,
          "vínculos do atendimento mudaram após os locks.");

        const reservation = await reserveIdempotencyOperationWithTx(tx, {
          actorUserId: input.userId, operation: QUEUE_WITHDRAWAL_OPERATION, idempotencyKey: input.idempotencyKey,
          requestHash: createQueueWithdrawalFingerprint(input.participationId, input.queueEntryId), expiresAt: input.expiresAt,
        });
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") return { kind: reservation.kind };
        if (reservation.kind === "replay") return { kind: "replay", ...replay(reservation.resultPayload, input) };
        if (owned.status !== "active") block({ kind: "participation_not_active" });
        if (entry.rows[0].status === "closed") block({ kind: "entry_not_current" });
        ensure(entry.rows[0].status === "waiting" || entry.rows[0].status === "called", "estado da entrada desconhecido.");
        ensure(owned.currentId === target.queueEntryId, "ponteiro não identifica a tentativa corrente.");
        if (entry.rows[0].status === "waiting") ensure(!session, "entrada waiting já possui atendimento.");
        else ensure(session?.status === "pending" && discovered.stationId !== null, "entrada called sem pending válido.");

        // Nenhuma guarda de novas inscrições: fila pausada/capacidade/corte oficial não
        // impedem saída residual. O relógio no próprio UPDATE observa TODAS as esperas.
        const closed = await tx.execute<{ closedAtMs: number }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE queue_entries q SET status='closed', closed_at=d.at, close_reason=${QUEUE_WITHDRAWAL_REASON}
          FROM participations p, events e, decision d
          WHERE q.id=${input.queueEntryId} AND q.participation_id=${input.participationId}
            AND q.event_id=${target.eventId} AND q.experience_id=${target.experienceId}
            AND q.status IN ('waiting','called') AND p.id=q.participation_id AND p.user_id=${input.userId}
            AND p.event_id=e.id AND q.event_id=e.id AND p.status='active' AND p.current_queue_entry_id=q.id
            AND e.status <> 'closed' AND d.at < e.operational_deadline_at
            AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
          RETURNING (EXTRACT(EPOCH FROM d.at)*1000)::double precision AS "closedAtMs"
        `);
        if (!closed.rows.length) block({ kind: "event_ended" });
        ensure(closed.rows.length === 1, "encerramento afetou múltiplas entradas.");
        const closedAt = instant(closed.rows[0].closedAtMs);
        let canceled: WithdrawnExperienceQueue["serviceSession"] = null;
        if (session) {
          // Copiar o timestamptz do banco, sem truncar microssegundos via Date entre writes.
          const updated = await tx.execute(sql`UPDATE service_sessions s SET status='canceled',
            resolved_at=q.closed_at, resolved_by_user_id=${input.userId}, cancel_reason=${QUEUE_WITHDRAWAL_REASON}
            FROM queue_entries q WHERE s.id=${session.id} AND s.queue_entry_id=q.id AND q.id=${input.queueEntryId}
              AND s.experience_id=${target.experienceId} AND s.station_id=${session.stationId} AND s.status='pending'
            RETURNING s.id`);
          ensure(updated.rows.length === 1, "pending não pôde ser cancelado.");
          canceled = { id: session.id, status: "canceled", resolvedAt: closedAt };
        }
        const cleared = await tx.execute(sql`UPDATE participations SET current_queue_entry_id=NULL
          WHERE id=${input.participationId} AND user_id=${input.userId} AND event_id=${target.eventId}
            AND status='active' AND current_queue_entry_id=${input.queueEntryId} RETURNING id`);
        ensure(cleared.rows.length === 1, "ponteiro não pôde ser liberado.");
        const result: WithdrawnExperienceQueue = { participationId: input.participationId, queueEntryId: input.queueEntryId,
          experienceId: target.experienceId, status: "closed", closedAt, serviceSession: canceled };
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200,
          resultReference: input.queueEntryId, resultPayload: { ...result, closedAt: closedAt.toISOString(),
            serviceSession: canceled ? { ...canceled, resolvedAt: canceled.resolvedAt.toISOString() } : null } });
        return { kind: "withdrawn", ...result };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof WithdrawalRollback) return error.result;
      throw error;
    }
  }
}
