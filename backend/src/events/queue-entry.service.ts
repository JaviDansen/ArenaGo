import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import * as schema from "../database/schema";
import {
  completeIdempotencyOperationWithTx,
  createRequestFingerprint,
  reserveIdempotencyOperationWithTx,
} from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import { EventsService } from "./events.service";
import type { EventAvailabilityMissingCode, EventAvailabilityResult } from "./event-availability";
import type {
  JoinedExperienceQueueEntry, JoinExperienceQueueInput, JoinExperienceQueueResult, QueueEntryBlock,
} from "./queue-entry.types";

export const QUEUE_JOIN_OPERATION = "join_experience_queue";

export function createQueueJoinFingerprint(participationId: string, experienceId: string): string {
  return createRequestFingerprint(QUEUE_JOIN_OPERATION, { participationId, experienceId });
}

class QueueJoinRollback extends Error {
  constructor(readonly result: QueueEntryBlock) { super(result.kind); }
}

function block(result: QueueEntryBlock): never { throw new QueueJoinRollback(result); }

function requireAvailability(availability: EventAvailabilityResult): void {
  if (!availability.eventExists) block({ kind: "access_denied" });
  if (availability.eventAcceptingNewEntries) return;
  const closed: EventAvailabilityMissingCode[] = [
    "EVENT_NOT_STARTED", "EVENT_ENTRY_CLOSED", "EVENT_ADMIN_CLOSING", "EVENT_CLOSED",
  ];
  block({
    kind: availability.missing.some((code) => closed.includes(code)) ? "event_closed" : "event_unavailable",
    missing: availability.missing,
  });
}

function replayEntry(payload: JsonValue | null, input: JoinExperienceQueueInput): JoinedExperienceQueueEntry {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || typeof payload.queueEntryId !== "string" || payload.participationId !== input.participationId
    || payload.experienceId !== input.experienceId || payload.status !== "waiting"
    || typeof payload.queueOrder !== "string" || !/^[1-9]\d*$/.test(payload.queueOrder)
    || typeof payload.enteredAt !== "string" || !Number.isFinite(Date.parse(payload.enteredAt))) {
    throw new Error("Resultado idempotente de ingresso na fila inválido.");
  }
  return {
    queueEntryId: payload.queueEntryId, participationId: input.participationId,
    experienceId: input.experienceId, status: "waiting", queueOrder: payload.queueOrder,
    enteredAt: new Date(payload.enteredAt),
  };
}

/** E07.1: somente ingresso interno; não chama, encerra nem consulta posição dinâmica. */
@Injectable()
export class QueueEntryService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    private readonly eventsService: EventsService,
  ) {}

  async joinExperienceQueue(input: JoinExperienceQueueInput): Promise<JoinExperienceQueueResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128
      || !Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("Chave de idempotência ou expiração inválida.");
    }
    try {
      return await this.database.transaction(async (tx): Promise<JoinExperienceQueueResult> => {
        // Descoberta sem autorização de mutação; titularidade/evento são revalidados sob lock.
        const lookup = await tx.execute<{ eventId: string }>(sql`
          SELECT event_id AS "eventId" FROM participations
          WHERE id=${input.participationId} AND user_id=${input.userId}
        `);
        const eventId = lookup.rows[0]?.eventId;
        if (!eventId) block({ kind: "access_denied" });
        const event = await tx.execute(sql`SELECT id FROM events WHERE id=${eventId} FOR SHARE`);
        if (!event.rows.length) block({ kind: "access_denied" });

        const experience = await tx.execute<{ accepting: boolean }>(sql`
          SELECT queue_accepting_entries AS accepting FROM experiences
          WHERE id=${input.experienceId} AND event_id=${eventId} FOR UPDATE
        `);
        // Testemunha C-14: protege a estação disponível inclusive contra UPDATE direto.
        // A ordem adicional estação → participação é compatível com os futuros comandos Staff.
        const station = await tx.execute(sql`
          SELECT id FROM stations WHERE experience_id=${input.experienceId} AND availability='available'
            AND EXISTS (SELECT 1 FROM experiences WHERE id=${input.experienceId} AND event_id=${eventId})
          ORDER BY id LIMIT 1 FOR SHARE
        `);
        const participation = await tx.execute<{ status: string; currentId: string | null }>(sql`
          SELECT status, current_queue_entry_id AS "currentId" FROM participations
          WHERE id=${input.participationId} AND user_id=${input.userId} AND event_id=${eventId} FOR UPDATE
        `);
        const owned = participation.rows[0];
        if (!owned) block({ kind: "access_denied" });

        // Após os locks de domínio; namespace separado da criação de participação (E03).
        const reservation = await reserveIdempotencyOperationWithTx(tx, {
          actorUserId: input.userId, operation: QUEUE_JOIN_OPERATION,
          idempotencyKey: input.idempotencyKey,
          requestHash: createQueueJoinFingerprint(input.participationId, input.experienceId),
          expiresAt: input.expiresAt,
        });
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") {
          return { kind: reservation.kind };
        }
        // Replay é resposta histórica, inclusive se a entrada/participação já foi encerrada.
        if (reservation.kind === "replay") return { kind: "replay", ...replayEntry(reservation.resultPayload, input) };
        if (owned.status !== "active") block({ kind: "participation_not_active" });
        if (!experience.rows.length) block({ kind: "access_denied" });
        const current = await tx.execute(sql`
          SELECT id FROM queue_entries WHERE participation_id=${input.participationId}
          AND status IN ('waiting','called') FOR UPDATE
        `);
        if (owned.currentId || current.rows.length) block({ kind: "queue_occupied" });
        if (!experience.rows[0].accepting) block({ kind: "queue_closed" });

        // Compartilha locks de testemunhas de Staff (papel E conta) até COMMIT.
        // Escritores de capacidade devem obter events FOR UPDATE primeiro; revogação nunca
        // é negada por ser o último Staff. Sem escritor no backend E01–E06 para adaptar.
        const staff = await tx.execute(sql`
          SELECT r.id FROM user_roles r JOIN users u ON u.id=r.user_id
          WHERE r.event_id=${eventId} AND r.role='staff' AND r.revoked_at IS NULL
            AND u.is_active=true AND u.email_verified_at IS NOT NULL
          ORDER BY u.id, r.id LIMIT 1 FOR SHARE OF u, r
        `);
        const clock = await tx.execute<{ atMs: number }>(sql`
          SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "atMs"
        `);
        const atMs = clock.rows[0]?.atMs;
        if (!Number.isFinite(atMs) || !Number.isFinite(new Date(atMs).getTime())) {
          throw new Error("Relógio PostgreSQL inválido para ingresso na fila.");
        }
        requireAvailability(await this.eventsService.evaluateEventAvailabilityById(eventId, new Date(atMs), tx));
        if (!staff.rows.length) block({ kind: "event_unavailable", missing: ["EVENT_HAS_NO_AUTHORIZED_STAFF"] });
        if (!station.rows.length) block({ kind: "experience_unavailable" });

        // Instante único do DB no próprio UPDATE decisivo, após TODAS as esperas.
        const assigned = await tx.execute<{ queueOrder: string; enteredAtMs: number }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE experiences e SET last_queue_order=e.last_queue_order+1
          FROM events v, decision d
          WHERE e.id=${input.experienceId} AND e.event_id=${eventId} AND v.id=e.event_id
            AND e.queue_accepting_entries=true AND v.status NOT IN ('closing','closed')
            AND v.starts_at <= d.at AND d.at < v.official_ends_at
            AND (v.closure_requested_at IS NULL OR d.at < v.closure_requested_at)
          RETURNING e.last_queue_order::text AS "queueOrder",
            (EXTRACT(EPOCH FROM d.at) * 1000)::double precision AS "enteredAtMs"
        `);
        const order = assigned.rows[0];
        if (!order) block({ kind: "event_closed", missing: ["EVENT_ENTRY_CLOSED"] });
        const entry: JoinedExperienceQueueEntry = {
          queueEntryId: randomUUID(), participationId: input.participationId, experienceId: input.experienceId,
          status: "waiting", queueOrder: order.queueOrder, enteredAt: new Date(order.enteredAtMs),
        };
        await tx.insert(schema.queueEntries).values({
          id: entry.queueEntryId, participationId: input.participationId, eventId,
          experienceId: input.experienceId, queueOrder: BigInt(entry.queueOrder), status: "waiting",
          enteredAt: entry.enteredAt, closedAt: null, closeReason: null,
        });
        await tx.execute(sql`
          UPDATE participations SET current_queue_entry_id=${entry.queueEntryId}
          WHERE id=${input.participationId} AND user_id=${input.userId} AND event_id=${eventId}
        `);
        await completeIdempotencyOperationWithTx(tx, reservation.operationId, {
          httpStatus: 201, resultReference: entry.queueEntryId,
          resultPayload: { ...entry, enteredAt: entry.enteredAt.toISOString() },
        });
        return { kind: "created", ...entry };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof QueueJoinRollback) return error.result;
      throw error;
    }
  }
}
