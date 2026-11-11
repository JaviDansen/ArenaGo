import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { ProblemException } from "../common/errors/problem.exception";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { EventsService } from "../events/events.service";
import { ParticipationsService } from "./participations.service";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "./join-idempotency";

export const STAFF_ENTRY_CONFIRM = "staff_confirm_event_entry";
export const STAFF_ENTRY_TOGGLE = "staff_set_external_queue";
type Actor = MutationSession & { eventId: string };
type Intent = Actor & { idempotencyKey: string; expiresAt: Date };
const instant = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
export const entryConfirmation = z.object({ eventId: z.uuid(), participation: z.object({
  id: z.uuid(), status: z.literal("active"), arenaEnteredAt: instant,
}) });
export const entryToggle = z.object({ eventId: z.uuid(), externalQueueEnabled: z.boolean(),
  releasedCount: z.number().int().nonnegative().refine(Number.isSafeInteger), changedAt: instant.optional() })
  .refine(value => (!value.externalQueueEnabled || value.releasedCount === 0) &&
    (value.changedAt !== undefined || value.releasedCount === 0));
export function entryFingerprint(eventId: string, participationId: string) {
  return createRequestFingerprint(STAFF_ENTRY_CONFIRM, { eventId, participationId });
}
export function entryToggleFingerprint(eventId: string, enabled: boolean) {
  return createRequestFingerprint(STAFF_ENTRY_TOGGLE, { eventId, enabled });
}
function problem(status: HttpStatus, code: string, detail: string): never {
  throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
    title: status === 404 ? "Recurso não encontrado" : status === 401 ? "Sessão inválida" : "Operação indisponível", detail });
}
const denied = () => problem(404, "RESOURCE_NOT_FOUND", "Recurso não encontrado.");
class HistoricalReplay extends Error { constructor(readonly value: unknown) { super("replay"); } }

/** Entrada no evento; não altera queue_entries, experiências ou atendimentos. */
@Injectable()
export class StaffEntryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ParticipationsService) private readonly participations: ParticipationsService) {}

  private async authorize(tx: DatabaseTransactionExecutor, actor: Actor) {
    try { await revalidateMutationSession(tx, { ...actor, staffEventId: actor.eventId }); }
    catch (error) {
      if (error instanceof ProblemException && error.getStatus() === 403) return denied();
      throw error;
    }
  }

  async read(actor: Actor) {
    return this.database.transaction(async tx => {
      // Sem locks de escrita: identidade, concessão e lista pertencem ao mesmo snapshot.
      const session = await tx.execute(sql`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.revoked_at IS NULL
          AND s.expires_at > statement_timestamp() AND u.is_active=true
          AND (s.admin_2fa_verified_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM user_roles a
            WHERE a.user_id=u.id AND a.role='admin' AND a.event_id IS NULL AND a.revoked_at IS NULL))`);
      if (!session.rows.length) problem(401, "INVALID_SESSION", "Sessão inválida ou expirada.");
      const event = (await tx.execute<{ enabled: boolean; observedAt: string }>(sql`
        SELECT e.external_queue_enabled AS enabled, statement_timestamp() AS "observedAt" FROM events e
        WHERE e.id=${actor.eventId} AND EXISTS (SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id
          WHERE u.id=${actor.userId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
            AND r.role='staff' AND r.event_id=e.id AND r.revoked_at IS NULL)`)).rows[0];
      if (!event) return denied();
      const observedAt = new Date(event.observedAt);
      if (!Number.isFinite(observedAt.getTime()) || typeof event.enabled !== "boolean") throw new Error("Estado de entrada inválido.");
      const availability = await this.events.evaluateEventAvailabilityById(actor.eventId, observedAt, tx);
      const rows = (await tx.execute<{ participationId: string; displayName: string; position: string; order: string }>(sql`
        SELECT p.id AS "participationId", u.name AS "displayName", p.external_queue_order::text AS "order",
          row_number() OVER (ORDER BY p.external_queue_order, p.id)::text AS position
        FROM participations p JOIN users u ON u.id=p.user_id
        WHERE p.event_id=${actor.eventId} AND p.status='waiting'
        ORDER BY p.external_queue_order, p.id`)).rows;
      const waiting = rows.map(row => {
        if (!/^[1-9]\d*$/.test(row.order) || row.order.length > 19 || BigInt(row.order) > 9223372036854775807n ||
            !/^[1-9]\d*$/.test(row.position) || !Number.isSafeInteger(Number(row.position)) ||
            !z.uuid().safeParse(row.participationId).success || typeof row.displayName !== "string" || !row.displayName.trim())
          throw new Error("Fila externa inconsistente.");
        return { participationId: row.participationId, displayName: row.displayName, position: Number(row.position) };
      });
      return { eventId: actor.eventId, externalQueueEnabled: event.enabled, observedAt: observedAt.toISOString(),
        canManage: availability.eventExists && availability.eventAcceptingNewEntries,
        waitingCount: waiting.length, waiting };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  private async reserve(tx: DatabaseTransactionExecutor, input: Intent, operation: string, fingerprint: string) {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime()))
      throw new Error("Intenção de entrada inválida.");
    const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId, operation,
      idempotencyKey: input.idempotencyKey, requestHash: fingerprint, expiresAt: input.expiresAt });
    await this.authorize(tx, input); // inclusive depois de eventual espera na chave única
    if (reservation.kind === "request_conflict") problem(409, "IDEMPOTENCY_REQUEST_CONFLICT", "Chave vinculada a outra intenção.");
    if (reservation.kind === "in_progress") problem(409, "IDEMPOTENCY_IN_PROGRESS", "Intenção em processamento.");
    return reservation;
  }

  async confirm(input: Intent & { participationId: string }) {
    try {
      return await this.database.transaction(async tx => {
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR UPDATE`);
        // Mesma ordem de E05: evento -> participações -> conta/concessão/sessão.
        const first = event.rows.length ? (await tx.execute<{ id: string; order: string }>(sql`SELECT id, external_queue_order::text AS "order" FROM participations
          WHERE event_id=${input.eventId} AND status='waiting'
          ORDER BY external_queue_order, id LIMIT 1 FOR UPDATE`)).rows[0] : undefined;
        await this.authorize(tx, input);
        if (!event.rows.length) return denied();
        const reservation = await this.reserve(tx, input, STAFF_ENTRY_CONFIRM, entryFingerprint(input.eventId, input.participationId));
        if (reservation.kind === "replay") {
          const result = entryConfirmation.parse(reservation.resultPayload);
          if (reservation.httpStatus !== 200 || result.eventId !== input.eventId || result.participation.id !== input.participationId)
            throw new Error("Replay de entrada inválido.");
          throw new HistoricalReplay(result);
        }
        if (!first || first.id !== input.participationId) problem(409, "ENTRY_NOT_FIRST", "Atualize a fila e confirme somente o primeiro participante.");
        if (!/^[1-9]\d*$/.test(first.order) || first.order.length > 19 || BigInt(first.order) > 9223372036854775807n)
          throw new Error("Ordem externa inconsistente.");
        const clock = (await tx.execute<{ at: string }>(sql`SELECT clock_timestamp() AS at`)).rows[0];
        const availability = await this.events.evaluateEventAvailabilityById(input.eventId, new Date(clock.at), tx);
        if (!availability.eventExists || !availability.eventAcceptingNewEntries) problem(409, "EVENT_ENTRY_UNAVAILABLE", "O evento não permite entradas neste instante.");
        const changed = (await tx.execute<{ id: string; at: string }>(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE participations p SET status='active', arena_entered_at=d.at FROM events e, decision d
          WHERE p.id=${input.participationId} AND p.event_id=${input.eventId} AND p.status='waiting'
            AND p.current_queue_entry_id IS NULL AND e.id=p.event_id AND e.external_queue_enabled=true
            AND e.status NOT IN ('closing','closed') AND e.closure_requested_at IS NULL
            AND e.starts_at<=d.at AND d.at<e.official_ends_at AND d.at<e.operational_deadline_at
          RETURNING p.id, p.arena_entered_at AS at`)).rows[0];
        if (!changed) problem(409, "EVENT_ENTRY_UNAVAILABLE", "A entrada não pode ser confirmada no estado atual.");
        const result = entryConfirmation.parse({ eventId: input.eventId,
          participation: { id: changed.id, status: "active", arenaEnteredAt: new Date(changed.at).toISOString() } });
        const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
          VALUES(${randomUUID()},${input.userId},${input.eventId},'user','event','staff_entry_confirmed','Confirmação individual pelo Staff',
            jsonb_build_object('participationId',${input.participationId}::text),${result.participation.arenaEnteredAt}::timestamptz) RETURNING id`);
        if (audit.rows.length !== 1) throw new Error("Confirmação de entrada exige auditoria.");
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200,
          resultReference: input.participationId, resultPayload: result });
        await this.authorize(tx, input);
        return result;
      }, { isolationLevel: "read committed" });
    } catch (error) { if (error instanceof HistoricalReplay) return entryConfirmation.parse(error.value); throw error; }
  }

  async setEnabled(input: Intent & { enabled: boolean }) {
    if (typeof input.enabled !== "boolean") throw new Error("Estado de fila inválido.");
    try {
      return await this.database.transaction(async tx => {
        let operationId: string | undefined;
        const result = await this.participations.setExternalQueueEnabledWithTx(tx, input.eventId, input.enabled, async current => {
          await this.authorize(tx, input);
          if (current === undefined) return;
          const reservation = await this.reserve(tx, input, STAFF_ENTRY_TOGGLE, entryToggleFingerprint(input.eventId, input.enabled));
          if (reservation.kind === "replay") {
            const replay = entryToggle.parse(reservation.resultPayload);
            if (reservation.httpStatus !== 200 || replay.eventId !== input.eventId || replay.externalQueueEnabled !== input.enabled)
              throw new Error("Replay de alternância inválido.");
            throw new HistoricalReplay(replay);
          }
          operationId = reservation.operationId;
        });
        if (result.kind === "event_not_found") return denied();
        if (result.kind === "blocked") problem(409, "EVENT_ENTRY_UNAVAILABLE", "O evento não permite alterar a fila externa neste instante.");
        if (!operationId) throw new Error("Reserva Staff ausente.");
        const response = entryToggle.parse({ eventId: result.eventId, externalQueueEnabled: result.externalQueueEnabled,
          releasedCount: result.releasedCount, ...(result.kind === "changed" ? { changedAt: result.changedAt.toISOString() } : {}) });
        if (result.kind === "changed") {
          const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
            VALUES(${randomUUID()},${input.userId},${input.eventId},'user','event','staff_external_queue_changed','Alternância pelo Staff',
              jsonb_build_object('enabled',${input.enabled}::boolean,'releasedCount',${result.releasedCount}::bigint),${result.changedAt}) RETURNING id`);
          if (audit.rows.length !== 1) throw new Error("Alternância de entrada exige auditoria.");
        }
        await completeIdempotencyOperationWithTx(tx, operationId, { httpStatus: 200, resultReference: input.eventId, resultPayload: response });
        await this.authorize(tx, input);
        return response;
      }, { isolationLevel: "read committed" });
    } catch (error) { if (error instanceof HistoricalReplay) return entryToggle.parse(error.value); throw error; }
  }
}
