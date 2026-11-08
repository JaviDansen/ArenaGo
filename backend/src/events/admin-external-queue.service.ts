import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { ParticipationsService } from "../participations/participations.service";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../participations/join-idempotency";
import type { JsonValue } from "../participations/join-idempotency";
import { adminExternalQueueBody } from "./admin-external-queue.dto";
import type { AdminExternalQueueInput, AdminExternalQueueResult, AdminExternalQueueState } from "./admin-external-queue.types";
import { assertAdminSessionWithTx, authorizeGlobalAdminWithTx } from "./admin-operation-auth";

export const ADMIN_EXTERNAL_QUEUE_OPERATION = "admin_set_external_queue";
export function externalQueueFingerprint(eventId: string, enabled: boolean, reason: string): string {
  return createRequestFingerprint(ADMIN_EXTERNAL_QUEUE_OPERATION, { eventId, enabled, reason });
}
class ExternalQueueRollback extends Error {
  constructor(readonly result: AdminExternalQueueResult) { super(result.kind); }
}
function block(result: AdminExternalQueueResult): never { throw new ExternalQueueRollback(result); }
function replay(payload: JsonValue | null, input: AdminExternalQueueInput): AdminExternalQueueState {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || payload.eventId !== input.eventId || payload.externalQueueEnabled !== input.enabled
    || typeof payload.releasedCount !== "number" || !Number.isSafeInteger(payload.releasedCount) || payload.releasedCount < 0) {
    throw new Error("Resposta administrativa idempotente inválida.");
  }
  const state: AdminExternalQueueState = { eventId: input.eventId, externalQueueEnabled: input.enabled, releasedCount: payload.releasedCount };
  if (payload.changedAt !== undefined) {
    if (typeof payload.changedAt !== "string" || !Number.isFinite(Date.parse(payload.changedAt))) throw new Error("Instante administrativo de replay inválido.");
    state.changedAt = new Date(payload.changedAt);
  } else if (state.releasedCount !== 0) throw new Error("No-op administrativo com liberações inválidas.");
  return state;
}

/** E08.6: compõe a E05, auditoria e replay durável em uma única transação. */
@Injectable()
export class AdminExternalQueueService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    @Inject(ParticipationsService) private readonly participations: ParticipationsService,
  ) {}

  private async session(tx: DatabaseTransactionExecutor, input: AdminExternalQueueInput) {
    await assertAdminSessionWithTx(tx, input, block);
  }

  private async authorize(tx: DatabaseTransactionExecutor, input: AdminExternalQueueInput) {
    await authorizeGlobalAdminWithTx(tx, input, block);
  }

  async setExternalQueue(input: AdminExternalQueueInput): Promise<AdminExternalQueueResult> {
    const body = adminExternalQueueBody.parse({ enabled: input.enabled, reason: input.reason });
    input = { ...input, ...body };
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime())) throw new Error("Idempotência administrativa inválida.");
    try {
      return await this.database.transaction(async (tx): Promise<AdminExternalQueueResult> => {
        let before: boolean | undefined, reservationId: string | undefined;
        const result = await this.participations.setExternalQueueEnabledWithTx(tx, input.eventId, input.enabled, async current => {
          // E05 já obteve evento e, ao desligar, participações waiting antes desta autorização.
          // Inclusive no-op/replay e evento ausente exigem a autorização global atual.
          await this.authorize(tx, input);
          if (current === undefined) return;
          before = current;
          const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId,
            operation: ADMIN_EXTERNAL_QUEUE_OPERATION, idempotencyKey: input.idempotencyKey,
            requestHash: externalQueueFingerprint(input.eventId, input.enabled, input.reason), expiresAt: input.expiresAt });
          // Relógio novo após eventual espera no índice UNIQUE da reserva.
          await this.session(tx, input);
          if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") block({ kind: reservation.kind });
          if (reservation.kind === "replay") {
            if (reservation.httpStatus !== 200) throw new Error("Status administrativo de replay inválido.");
            block({ kind: "replay", ...replay(reservation.resultPayload, input) });
          }
          reservationId = reservation.operationId;
        });
        if (result.kind === "event_not_found") block({ kind: "resource_not_found" });
        if (result.kind === "blocked") {
          const closed = result.availability.eventExists && result.availability.missing.some(code =>
            ["EVENT_NOT_STARTED", "EVENT_ENTRY_CLOSED", "EVENT_ADMIN_CLOSING", "EVENT_CLOSED"].includes(code));
          block({ kind: closed ? "event_closed" : "event_unavailable" });
        }
        if (!reservationId || before === undefined) throw new Error("Reserva administrativa ausente.");
        await this.session(tx, input);
        if (!Number.isSafeInteger(result.releasedCount) || result.releasedCount < 0) throw new Error("Contagem administrativa inválida.");
        const state: AdminExternalQueueState = { eventId: result.eventId, externalQueueEnabled: result.externalQueueEnabled,
          releasedCount: result.releasedCount, ...(result.kind === "changed" ? { changedAt: result.changedAt } : {}) };
        if (result.kind === "changed") {
          const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
            SELECT ${randomUUID()},${input.userId},e.id,'user','event','external_queue_enabled_changed',${input.reason},
              jsonb_build_object('before',jsonb_build_object('externalQueueEnabled',${before}::boolean),
                'after',jsonb_build_object('externalQueueEnabled',e.external_queue_enabled),
                'releasedCount',${result.releasedCount}::bigint),e.updated_at
            FROM events e WHERE e.id=${input.eventId} RETURNING id`);
          if (audit.rows.length !== 1) throw new Error("Alteração da fila externa exige exatamente uma auditoria.");
        }
        await completeIdempotencyOperationWithTx(tx, reservationId, { httpStatus: 200, resultReference: input.eventId,
          resultPayload: { eventId: state.eventId, externalQueueEnabled: state.externalQueueEnabled, releasedCount: state.releasedCount,
            ...(state.changedAt ? { changedAt: state.changedAt.toISOString() } : {}) } });
        return { kind: "completed", ...state };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof ExternalQueueRollback) return error.result;
      throw error;
    }
  }
}
