import { assertMutationSession, mutationTransaction, revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import type { CalledNext, CallNextBlock, CallNextInput, CallNextResult } from "./call-next.types";

export const CALL_NEXT_OPERATION = "call_next";

export function createCallNextFingerprint(eventId: string, experienceId: string, stationId: string): string {
  return createRequestFingerprint(CALL_NEXT_OPERATION, { eventId, experienceId, stationId });
}

export class CallNextIntegrityError extends Error {
  constructor(detail: string) { super(`Integridade da chamada interna: ${detail}`); this.name = "CallNextIntegrityError"; }
}
class CallNextRollback extends Error {
  constructor(readonly result: CallNextBlock) { super(result.kind); }
}
function block(result: CallNextBlock): never { throw new CallNextRollback(result); }
function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new CallNextIntegrityError(detail);
}
function instant(ms: number): Date {
  ensure(typeof ms === "number" && Number.isFinite(ms), "instante PostgreSQL inválido.");
  const date = new Date(ms); ensure(Number.isFinite(date.getTime()), "instante fora do intervalo de Date."); return date;
}
function replay(payload: JsonValue | null, input: CallNextInput): CalledNext {
  ensure(payload && typeof payload === "object" && !Array.isArray(payload), "replay inválido.");
  const s = payload.serviceSession;
  ensure(s && typeof s === "object" && !Array.isArray(s)
    && typeof s.id === "string" && typeof s.queueEntryId === "string"
    && s.experienceId === input.experienceId && s.status === "pending"
    && typeof s.calledAt === "string", "replay de atendimento inválido.");
  const station = s.station;
  ensure(station && typeof station === "object" && !Array.isArray(station)
    && station.id === input.stationId && typeof station.label === "string", "replay de estação inválido.");
  return { serviceSession: { id: s.id, queueEntryId: s.queueEntryId, experienceId: input.experienceId,
    station: { id: input.stationId, label: station.label }, status: "pending", calledAt: instant(Date.parse(s.calledAt)) } };
}

/** E07.4: reserva o primeiro waiting na estação, sem resolver presença ou chamar automaticamente. */
@Injectable()
export class CallNextService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  /** Contrato interno E07; os controllers usam exclusivamente a entrada autenticada. */
  async callNext(input: CallNextInput): Promise<CallNextResult> {
    return this.execute(input, null);
  }

  async callNextAuthenticated(input: CallNextInput, context: MutationSession): Promise<CallNextResult> {
    assertMutationSession(context, input.staffUserId);
    return this.execute(input,  { ...context, staffEventId: input.eventId });
  }

  private async execute(input: CallNextInput, context: MutationSession | null): Promise<CallNextResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("Chave de idempotência ou expiração inválida.");
    }
    try {
      return await mutationTransaction(this.database, context, async (tx): Promise<CallNextResult> => {
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR SHARE`);
        if (!event.rows.length) block({ kind: "staff_event_forbidden" });
        const experience = await tx.execute(sql`SELECT id FROM experiences
          WHERE id=${input.experienceId} AND event_id=${input.eventId} FOR UPDATE`);
        if (!experience.rows.length) block({ kind: "staff_event_forbidden" });
        const station = await tx.execute<{ availability: string; label: string }>(sql`SELECT availability, label FROM stations
          WHERE id=${input.stationId} AND experience_id=${input.experienceId} FOR UPDATE`);
        if (!station.rows.length) block({ kind: "staff_event_forbidden" });
        // Mantém conta e concessão válidas até COMMIT, inclusive contra revogação direta.
        // Admin isolado nunca satisfaz esta consulta; não exige Staff online ou atribuído à estação.
        const staff = await tx.execute(sql`SELECT r.id FROM users u JOIN user_roles r ON r.user_id=u.id
          WHERE u.id=${input.staffUserId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
            AND r.role='staff' AND r.event_id=${input.eventId} AND r.revoked_at IS NULL
          FOR SHARE OF u, r`);
        if (!staff.rows.length) {
          if (context !== null) await revalidateMutationSession(tx, context);
          block({ kind: "staff_event_forbidden" });
        }

        // Reconhecer retry antes de exigir estação livre/fila/tempo atuais: resposta histórica.
        // Namespace próprio; nenhum outro comando adquire esta reserva antes do mutex da experiência.
        const reservation = await reserveIdempotencyOperationWithTx(tx, {
          actorUserId: input.staffUserId, operation: CALL_NEXT_OPERATION, idempotencyKey: input.idempotencyKey,
          requestHash: createCallNextFingerprint(input.eventId, input.experienceId, input.stationId), expiresAt: input.expiresAt,
        });
        if (context !== null) await revalidateMutationSession(tx, context);
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") return { kind: reservation.kind };
        if (reservation.kind === "replay") return { kind: "replay", ...replay(reservation.resultPayload, input) };

        const window = await tx.execute<{ operating: boolean }>(sql`SELECT
          status <> 'closed' AND starts_at <= clock_timestamp() AND clock_timestamp() < operational_deadline_at
          AND (admin_deadline_at IS NULL OR clock_timestamp() < admin_deadline_at) AS operating
          FROM events WHERE id=${input.eventId}`);
        if (!window.rows[0]?.operating) block({ kind: "event_operation_ended" });
        ensure(["available", "unavailable"].includes(station.rows[0].availability), "disponibilidade desconhecida.");
        if (station.rows[0].availability !== "available") block({ kind: "station_unavailable" });
        const pending = await tx.execute(sql`SELECT id FROM service_sessions WHERE station_id=${input.stationId} AND status='pending'`);
        if (pending.rows.length) block({ kind: "station_has_pending_call" });

        // Descoberta após o mutex. Não travar queue_entries antes da participação nem furar FIFO.
        const candidate = await tx.execute<{ id: string; participationId: string }>(sql`SELECT id, participation_id AS "participationId"
          FROM queue_entries WHERE experience_id=${input.experienceId} AND event_id=${input.eventId} AND status='waiting'
          ORDER BY queue_order, id LIMIT 1`);
        const first = candidate.rows[0]; if (!first) block({ kind: "queue_empty" });
        const person = await tx.execute<{ status: string; currentId: string | null }>(sql`SELECT status, current_queue_entry_id AS "currentId"
          FROM participations WHERE id=${first.participationId} AND event_id=${input.eventId} FOR UPDATE`);
        ensure(person.rows.length === 1 && person.rows[0].status === "active" && person.rows[0].currentId === first.id,
          "primeiro waiting sem participação ativa e ponteiro coerente.");
        const entry = await tx.execute(sql`SELECT id FROM queue_entries
          WHERE id=${first.id} AND participation_id=${first.participationId} AND event_id=${input.eventId}
            AND experience_id=${input.experienceId} AND status='waiting'
            AND id=(SELECT id FROM queue_entries WHERE experience_id=${input.experienceId}
              AND event_id=${input.eventId} AND status='waiting' ORDER BY queue_order, id LIMIT 1)
          FOR UPDATE`);
        ensure(entry.rows.length === 1, "primeiro waiting mudou fora do protocolo de locks.");
        const prior = await tx.execute(sql`SELECT id FROM service_sessions WHERE queue_entry_id=${first.id} FOR UPDATE`);
        ensure(prior.rows.length === 0, "entrada waiting já possui atendimento.");

        // Relógio avaliado no INSERT decisivo depois de TODAS as esperas, sem corte de novos ingressos.
        const sessionId = randomUUID();
        const inserted = await tx.execute<{ calledAtMs: number }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
          SELECT ${sessionId},q.id,q.experience_id,t.id,${input.staffUserId},d.at,'pending'
          FROM queue_entries q JOIN participations p ON p.id=q.participation_id AND p.event_id=q.event_id
          JOIN events e ON e.id=q.event_id JOIN stations t ON t.id=${input.stationId} AND t.experience_id=q.experience_id
          CROSS JOIN decision d
          WHERE q.id=${first.id} AND q.event_id=${input.eventId} AND q.experience_id=${input.experienceId}
            AND q.status='waiting' AND p.status='active' AND p.current_queue_entry_id=q.id AND t.availability='available'
            AND e.status <> 'closed' AND e.starts_at <= d.at AND d.at < e.operational_deadline_at
            AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
          RETURNING (EXTRACT(EPOCH FROM called_at)*1000)::double precision AS "calledAtMs"
        `);
        if (!inserted.rows.length) block({ kind: "event_operation_ended" });
        ensure(inserted.rows.length === 1, "chamada afetou múltiplos atendimentos.");
        const calledAt = instant(inserted.rows[0].calledAtMs);
        const called = await tx.execute(sql`UPDATE queue_entries SET status='called'
          WHERE id=${first.id} AND participation_id=${first.participationId} AND event_id=${input.eventId}
            AND experience_id=${input.experienceId} AND status='waiting' RETURNING id`);
        ensure(called.rows.length === 1, "waiting não pôde ser chamada.");
        const result: CalledNext = { serviceSession: { id: sessionId, queueEntryId: first.id, experienceId: input.experienceId,
          station: { id: input.stationId, label: station.rows[0].label }, status: "pending", calledAt } };
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 201,
          resultReference: sessionId, resultPayload: { serviceSession: { ...result.serviceSession, calledAt: calledAt.toISOString() } } });
        return { kind: "created", ...result };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof CallNextRollback) return error.result;
      throw error;
    }
  }
}
