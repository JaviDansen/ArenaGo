import { assertMutationSession, mutationTransaction, revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import { evaluateEventConfigurationReadiness } from "./event-availability";
import type { EventConfigurationReadinessInput } from "./event-availability";
import type { AbsentServiceBlock, AbsentServiceInput, AbsentServiceResult, RegisteredAbsence } from "./absent.types";

type EventReadinessRow = Omit<EventConfigurationReadinessInput, "startsAt" | "officialEndsAt" | "operationalDeadlineAt">
  & { startsAtMs: number; officialEndsAtMs: number; operationalDeadlineAtMs: number }
  & Record<string, unknown>;

export const ABSENT_SERVICE_OPERATION = "absent_service_session";
export function createAbsentServiceFingerprint(eventId: string, serviceSessionId: string): string {
  return createRequestFingerprint(ABSENT_SERVICE_OPERATION, { eventId, serviceSessionId });
}
export class AbsentServiceIntegrityError extends Error {
  constructor(detail: string) { super(`Integridade da ausência interna: ${detail}`); this.name = "AbsentServiceIntegrityError"; }
}
class AbsentRollback extends Error {
  constructor(readonly result: AbsentServiceBlock) { super(result.kind); }
}
function block(result: AbsentServiceBlock): never { throw new AbsentRollback(result); }
function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new AbsentServiceIntegrityError(detail);
}
function instant(ms: number): Date {
  ensure(typeof ms === "number" && Number.isFinite(ms), "instante PostgreSQL inválido.");
  const date = new Date(ms); ensure(Number.isFinite(date.getTime()), "instante fora do intervalo de Date."); return date;
}
function position(value: string): number {
  ensure(/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)), "posição inválida."); return Number(value);
}
function replay(payload: JsonValue | null, input: AbsentServiceInput, queueEntryId: string): RegisteredAbsence {
  ensure(payload && typeof payload === "object" && !Array.isArray(payload), "replay inválido.");
  const s = payload.serviceSession, q = payload.previousQueueEntry;
  ensure(s && typeof s === "object" && !Array.isArray(s) && s.id === input.serviceSessionId
    && s.status === "absent" && typeof s.resolvedAt === "string", "replay de atendimento inválido.");
  ensure(q && typeof q === "object" && !Array.isArray(q) && q.id === queueEntryId
    && q.status === "closed" && q.closeReason === "absent", "replay de entrada inválido.");
  const common = { serviceSession: { id: input.serviceSessionId, status: "absent" as const, resolvedAt: instant(Date.parse(s.resolvedAt)) },
    previousQueueEntry: { id: queueEntryId, status: "closed" as const, closeReason: "absent" as const } };
  if (payload.requeued === false) {
    ensure(payload.newQueueEntry === null, "replay sem reentrada incoerente.");
    return { ...common, requeued: false, newQueueEntry: null };
  }
  const n = payload.newQueueEntry;
  ensure(payload.requeued === true && n && typeof n === "object" && !Array.isArray(n)
    && typeof n.id === "string" && n.id !== queueEntryId && n.status === "waiting"
    && typeof n.queueOrder === "string" && /^[1-9]\d*$/.test(n.queueOrder)
    && typeof n.position === "number" && Number.isSafeInteger(n.position) && n.position > 0, "replay de reentrada inválido.");
  return { ...common, requeued: true, newQueueEntry: { id: n.id, status: "waiting", queueOrder: n.queueOrder, position: n.position } };
}

/** E07.6: ausência por ação explícita do Staff; nunca timeout/desconexão ou conclusão. */
@Injectable()
export class AbsentService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  /** Contrato interno E07; os controllers usam exclusivamente a entrada autenticada. */
  async absent(input: AbsentServiceInput): Promise<AbsentServiceResult> {
    return this.execute(input, null);
  }

  async absentAuthenticated(input: AbsentServiceInput, context: MutationSession): Promise<AbsentServiceResult> {
    assertMutationSession(context, input.staffUserId);
    return this.execute(input,  { ...context, staffEventId: input.eventId });
  }

  private async execute(input: AbsentServiceInput, context: MutationSession | null): Promise<AbsentServiceResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("Chave de idempotência ou expiração inválida.");
    }
    try {
      return await mutationTransaction(this.database, context, async (tx): Promise<AbsentServiceResult> => {
        const lookup = await tx.execute<{ experienceId: string; stationId: string; queueEntryId: string; participationId: string }>(sql`
          SELECT s.experience_id AS "experienceId", s.station_id AS "stationId",
            s.queue_entry_id AS "queueEntryId", q.participation_id AS "participationId"
          FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id
          WHERE s.id=${input.serviceSessionId} AND q.event_id=${input.eventId}`);
        const target = lookup.rows[0];
        const event = await tx.execute<EventReadinessRow>(sql`
          SELECT id, name, access_code_normalized AS "accessCodeNormalized", timezone,
            (EXTRACT(EPOCH FROM starts_at)*1000)::double precision AS "startsAtMs",
            (EXTRACT(EPOCH FROM official_ends_at)*1000)::double precision AS "officialEndsAtMs",
            (EXTRACT(EPOCH FROM operational_deadline_at)*1000)::double precision AS "operationalDeadlineAtMs",
            external_queue_enabled AS "externalQueueEnabled" FROM events WHERE id=${input.eventId} FOR SHARE`);
        if (!event.rows.length) block({ kind: "staff_event_forbidden" });
        let hasAvailableStation = false;
        if (target) {
          const experience = await tx.execute(sql`SELECT id FROM experiences
            WHERE id=${target.experienceId} AND event_id=${input.eventId} FOR UPDATE`);
          ensure(experience.rows.length === 1, "experiência do atendimento incoerente.");
          const station = await tx.execute(sql`SELECT id FROM stations
            WHERE id=${target.stationId} AND experience_id=${target.experienceId} FOR UPDATE`);
          ensure(station.rows.length === 1, "estação do atendimento incoerente.");
          // Testemunha C-14 da mesma experiência, antes da participação. Disponível pode estar ocupada.
          const witness = await tx.execute(sql`SELECT id FROM stations WHERE experience_id=${target.experienceId}
            AND availability='available' ORDER BY id LIMIT 1 FOR SHARE`);
          hasAvailableStation = witness.rows.length > 0;
        }
        const staff = await tx.execute(sql`SELECT r.id FROM users u JOIN user_roles r ON r.user_id=u.id
          WHERE u.id=${input.staffUserId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
            AND r.role='staff' AND r.event_id=${input.eventId} AND r.revoked_at IS NULL FOR SHARE OF u, r`);
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
          actorUserId: input.staffUserId, operation: ABSENT_SERVICE_OPERATION, idempotencyKey: input.idempotencyKey,
          requestHash: createAbsentServiceFingerprint(input.eventId, input.serviceSessionId), expiresAt: input.expiresAt,
        });
        if (context !== null) await revalidateMutationSession(tx, context);
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") return { kind: reservation.kind };
        if (reservation.kind === "replay") return { kind: "replay", ...replay(reservation.resultPayload, input, target.queueEntryId) };
        ensure(["pending", "completed", "absent", "canceled"].includes(session.rows[0].status), "estado do atendimento desconhecido.");
        if (session.rows[0].status !== "pending") block({ kind: "service_not_pending" });
        ensure(person.rows[0].status === "active" && person.rows[0].currentId === target.queueEntryId
          && entry.rows[0].status === "called", "pending sem participação ativa e entrada called corrente.");

        const resolved = await tx.execute<{ resolvedAtMs: number }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE service_sessions s SET status='absent', resolved_at=d.at, resolved_by_user_id=${input.staffUserId}
          FROM queue_entries q, participations p, events e, decision d
          WHERE s.id=${input.serviceSessionId} AND s.queue_entry_id=${target.queueEntryId}
            AND s.experience_id=${target.experienceId} AND s.station_id=${target.stationId} AND s.status='pending'
            AND q.id=s.queue_entry_id AND q.experience_id=s.experience_id AND q.event_id=${input.eventId} AND q.status='called'
            AND p.id=q.participation_id AND p.id=${target.participationId} AND p.event_id=q.event_id
            AND p.status='active' AND p.current_queue_entry_id=q.id AND e.id=q.event_id
            AND e.status <> 'closed' AND e.starts_at <= d.at AND d.at < e.operational_deadline_at
            AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
          RETURNING (EXTRACT(EPOCH FROM s.resolved_at)*1000)::double precision AS "resolvedAtMs"`);
        if (!resolved.rows.length) block({ kind: "event_operation_ended" });
        ensure(resolved.rows.length === 1, "ausência afetou múltiplos atendimentos.");
        const resolvedAt = instant(resolved.rows[0].resolvedAtMs);
        const closed = await tx.execute(sql`UPDATE queue_entries q SET status='closed', closed_at=s.resolved_at, close_reason='absent'
          FROM service_sessions s WHERE q.id=${target.queueEntryId} AND q.participation_id=${target.participationId}
            AND q.event_id=${input.eventId} AND q.experience_id=${target.experienceId} AND q.status='called'
            AND s.id=${input.serviceSessionId} AND s.queue_entry_id=q.id AND s.status='absent' RETURNING q.id`);
        ensure(closed.rows.length === 1, "entrada called não pôde ser encerrada.");

        // Mesmas condições de prontidão/capacidade da E07.1, com testemunhas protegidas.
        // Novo relógio no INSERT: cruzar o corte após resolver ausência nunca cria nova entrada.
        // SQL bruto do Drizzle retorna timestamptz como string, sem o decoder do schema.
        // Como na E07.2, ler epoch numérico e converter/validar explicitamente antes do helper.
        const eventRow = event.rows[0];
        const ready = evaluateEventConfigurationReadiness({ ...eventRow,
          startsAt: instant(eventRow.startsAtMs), officialEndsAt: instant(eventRow.officialEndsAtMs),
          operationalDeadlineAt: instant(eventRow.operationalDeadlineAtMs),
        }).ready && hasAvailableStation;
        const newId = randomUUID();
        const reentry = await tx.execute<{ queueOrder: string }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at), assigned AS (
            UPDATE experiences x SET last_queue_order=x.last_queue_order+1 FROM events e, decision d
            WHERE x.id=${target.experienceId} AND x.event_id=${input.eventId} AND e.id=x.event_id
              AND ${ready} AND x.queue_accepting_entries=true AND e.status NOT IN ('closing','closed')
              AND e.starts_at <= d.at AND d.at < e.official_ends_at
              AND (e.closure_requested_at IS NULL OR d.at < e.closure_requested_at)
              AND d.at < e.operational_deadline_at AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
            RETURNING x.last_queue_order, d.at
          )
          INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at)
          SELECT ${newId},${target.participationId},${input.eventId},${target.experienceId},a.last_queue_order,'waiting',a.at
          FROM assigned a RETURNING queue_order::text AS "queueOrder"`);
        ensure(reentry.rows.length <= 1, "reentrada afetou múltiplas entradas.");
        let newQueueEntry: Extract<RegisteredAbsence, { requeued: true }>["newQueueEntry"] | null = null;
        if (reentry.rows.length) {
          const order = reentry.rows[0].queueOrder;
          ensure(typeof order === "string" && /^[1-9]\d*$/.test(order), "ordem FIFO inválida.");
          const count = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM queue_entries
            WHERE experience_id=${target.experienceId} AND event_id=${input.eventId} AND status='waiting' AND queue_order <= ${order}::bigint`);
          ensure(count.rows.length === 1, "contagem de posição ausente.");
          newQueueEntry = { id: newId, status: "waiting", queueOrder: order, position: position(count.rows[0].count) };
        }
        const pointed = await tx.execute(sql`UPDATE participations SET current_queue_entry_id=${newQueueEntry?.id ?? null}
          WHERE id=${target.participationId} AND event_id=${input.eventId} AND status='active'
            AND current_queue_entry_id=${target.queueEntryId} RETURNING id`);
        ensure(pointed.rows.length === 1, "ponteiro não pôde ser atualizado.");
        const common = { serviceSession: { id: input.serviceSessionId, status: "absent" as const, resolvedAt },
          previousQueueEntry: { id: target.queueEntryId, status: "closed" as const, closeReason: "absent" as const } };
        const result: RegisteredAbsence = newQueueEntry ? { ...common, requeued: true, newQueueEntry }
          : { ...common, requeued: false, newQueueEntry: null };
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200, resultReference: input.serviceSessionId,
          resultPayload: { ...result, serviceSession: { ...result.serviceSession, resolvedAt: resolvedAt.toISOString() } } });
        return { kind: "absent", ...result };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof AbsentRollback) return error.result;
      throw error;
    }
  }
}
