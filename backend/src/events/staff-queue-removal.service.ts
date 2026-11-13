import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { revalidateMutationSession } from '../auth/mutation-session';
import { ProblemException } from '../common/errors/problem.exception';
import { DRIZZLE_DATABASE } from '../database/database.module';
import type { DatabaseTransactionExecutor } from '../database/database-executor';
import type * as schema from '../database/schema';
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from '../participations/join-idempotency';

export const STAFF_QUEUE_REMOVAL = 'staff_remove_waiting_queue_entry';
const resultSchema = z.object({ eventId: z.uuid(), experienceId: z.uuid(), queueEntry: z.object({
  id: z.uuid(), status: z.literal('closed'), closeReason: z.literal('staff_queue_removed'),
}), participation: z.object({ id: z.uuid(), status: z.literal('active'), currentQueueEntryId: z.null() }) });
type Input = { userId: string; sessionId: string; eventId: string; experienceId: string; queueEntryId: string;
  idempotencyKey: string; expiresAt: Date };

function refusal(status: HttpStatus, code: string): never {
  throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll('_', '-'),
    title: status === HttpStatus.NOT_FOUND ? 'Recurso não encontrado' : 'Conflito operacional',
    detail: status === HttpStatus.NOT_FOUND ? 'Recurso não encontrado.' : 'A entrada não pode ser removida no estado atual.' });
}
async function authorize(tx: DatabaseTransactionExecutor, userId: string, sessionId: string, eventId: string) {
  try { await revalidateMutationSession(tx, { userId, sessionId, staffEventId: eventId }); }
  catch (error) {
    if (error instanceof ProblemException && error.getStatus() === HttpStatus.FORBIDDEN)
      refusal(HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
    throw error;
  }
}

/** Remove apenas waiting da fila interna; nunca encerra a participação no evento. */
@Injectable()
export class StaffQueueRemovalService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async remove(input: Input) {
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime()))
      throw new Error('Intenção de remoção inválida.');
    return this.database.transaction(async tx => {
      const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR SHARE`);
      if (!event.rows.length) refusal(HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
      const experience = await tx.execute(sql`SELECT id FROM experiences
        WHERE id=${input.experienceId} AND event_id=${input.eventId} FOR UPDATE`);
      if (!experience.rows.length) refusal(HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
      const candidate = (await tx.execute<{ participationId: string }>(sql`SELECT participation_id AS "participationId"
        FROM queue_entries WHERE id=${input.queueEntryId} AND event_id=${input.eventId}
          AND experience_id=${input.experienceId}`)).rows[0];
      if (!candidate) refusal(HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
      const person = (await tx.execute<{ status: string; currentId: string | null }>(sql`
        SELECT status, current_queue_entry_id AS "currentId" FROM participations
        WHERE id=${candidate.participationId} AND event_id=${input.eventId} FOR UPDATE`)).rows[0];
      if (!person) throw new Error('Participação da fila ausente.');
      const entry = (await tx.execute<{ status: string }>(sql`SELECT status FROM queue_entries
        WHERE id=${input.queueEntryId} AND participation_id=${candidate.participationId}
          AND event_id=${input.eventId} AND experience_id=${input.experienceId} FOR UPDATE`)).rows[0];
      if (!entry) throw new Error('Entrada da fila ausente.');
      await authorize(tx, input.userId, input.sessionId, input.eventId);
      const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId,
        operation: STAFF_QUEUE_REMOVAL, idempotencyKey: input.idempotencyKey,
        requestHash: createRequestFingerprint(STAFF_QUEUE_REMOVAL, { eventId: input.eventId,
          experienceId: input.experienceId, queueEntryId: input.queueEntryId }), expiresAt: input.expiresAt });
      await authorize(tx, input.userId, input.sessionId, input.eventId);
      if (reservation.kind === 'request_conflict') refusal(HttpStatus.CONFLICT, 'IDEMPOTENCY_REQUEST_CONFLICT');
      if (reservation.kind === 'in_progress') refusal(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS');
      if (reservation.kind === 'replay') {
        const replay = resultSchema.parse(reservation.resultPayload);
        if (reservation.httpStatus !== 200 || replay.eventId !== input.eventId ||
            replay.experienceId !== input.experienceId || replay.queueEntry.id !== input.queueEntryId ||
            replay.participation.id !== candidate.participationId) throw new Error('Replay de remoção inválido.');
        return replay;
      }
      if (entry.status !== 'waiting' || person.status !== 'active' || person.currentId !== input.queueEntryId)
        refusal(HttpStatus.CONFLICT, 'QUEUE_ENTRY_NOT_WAITING');
      const prior = await tx.execute(sql`SELECT id FROM service_sessions WHERE queue_entry_id=${input.queueEntryId} FOR UPDATE`);
      if (prior.rows.length) throw new Error('Entrada waiting possui atendimento.');
      const closed = await tx.execute(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE queue_entries q SET status='closed', closed_at=d.at, close_reason='staff_queue_removed'
        FROM participations p, events e, decision d
        WHERE q.id=${input.queueEntryId} AND q.event_id=${input.eventId} AND q.experience_id=${input.experienceId}
          AND q.participation_id=${candidate.participationId} AND q.status='waiting'
          AND p.id=q.participation_id AND p.event_id=q.event_id AND p.status='active'
          AND p.current_queue_entry_id=q.id AND e.id=q.event_id AND e.status<>'closed'
          AND d.at<e.operational_deadline_at AND (e.admin_deadline_at IS NULL OR d.at<e.admin_deadline_at)
        RETURNING q.id`);
      if (!closed.rows.length) refusal(HttpStatus.CONFLICT, 'EVENT_OPERATION_ENDED');
      if (closed.rows.length !== 1) throw new Error('Remoção múltipla da fila.');
      const released = await tx.execute(sql`UPDATE participations SET current_queue_entry_id=NULL
        WHERE id=${candidate.participationId} AND event_id=${input.eventId} AND status='active'
          AND current_queue_entry_id=${input.queueEntryId} RETURNING id`);
      if (released.rows.length !== 1) throw new Error('Ponteiro da participação não liberado.');
      const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
        VALUES(${randomUUID()},${input.userId},${input.eventId},'user','event','staff_queue_entry_removed',
          'Remoção manual pelo Staff',jsonb_build_object('queueEntryId',${input.queueEntryId}::text),clock_timestamp()) RETURNING id`);
      if (audit.rows.length !== 1) throw new Error('Remoção exige auditoria.');
      const result = resultSchema.parse({ eventId: input.eventId, experienceId: input.experienceId,
        queueEntry: { id: input.queueEntryId, status: 'closed', closeReason: 'staff_queue_removed' },
        participation: { id: candidate.participationId, status: 'active', currentQueueEntryId: null } });
      await completeIdempotencyOperationWithTx(tx, reservation.operationId, { httpStatus: 200,
        resultReference: input.queueEntryId, resultPayload: result });
      await authorize(tx, input.userId, input.sessionId, input.eventId);
      return result;
    }, { isolationLevel: 'read committed' });
  }
}
