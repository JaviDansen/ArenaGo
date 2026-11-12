import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { revalidateMutationSession, type MutationSession } from '../auth/mutation-session';
import { ProblemException } from '../common/errors/problem.exception';
import { DRIZZLE_DATABASE } from '../database/database.module';
import type * as schema from '../database/schema';
import { EventsService } from '../events/events.service';
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from './join-idempotency';

type Action = 'call' | 'confirm' | 'absent' | 'remove';
type Intent = MutationSession & { eventId: string; callId?: string; idempotencyKey: string; expiresAt: Date };
export const entryCallOperations = { call: 'staff_call_event_entry', confirm: 'staff_confirm_called_entry',
  absent: 'staff_absent_event_entry', remove: 'staff_remove_called_entry' } as const;
export const entryCallFingerprint = (action: Action, eventId: string, callId?: string) =>
  createRequestFingerprint(entryCallOperations[action], { eventId, ...(action === 'call' ? {} : { callId }) });
const instant = z.string().refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const order = z.string().regex(/^[1-9]\d*$/).refine(v => BigInt(v) <= 9223372036854775807n);
export const entryCallResult = z.object({ eventId: z.uuid(), call: z.object({ id: z.uuid(), participationId: z.uuid(),
  status: z.enum(['pending','confirmed','absent','removed']), calledAt: instant, resolvedAt: instant.nullable() }).strict(),
  participation: z.object({ id: z.uuid(), status: z.enum(['waiting','active','finished','canceled']),
    arenaEnteredAt: instant.nullable(), finishReason: z.string().nullable(), externalQueueOrder: order.nullable() }).strict(),
  requeued: z.boolean() }).strict().superRefine((v, ctx) => {
    const c = v.call, p = v.participation;
    if (c.participationId !== p.id || (c.status === 'pending') !== (c.resolvedAt === null) ||
      (c.resolvedAt !== null && Date.parse(c.resolvedAt)<Date.parse(c.calledAt)) ||
      (p.status !== 'active' && p.arenaEnteredAt !== null) ||
      (['waiting','active'].includes(p.status) && p.finishReason !== null) ||
      (c.status === 'pending' && p.status !== 'waiting') || (c.status === 'confirmed' && (p.status !== 'active' || !p.arenaEnteredAt)) ||
      (c.status === 'removed' && (p.status !== 'canceled' || p.finishReason !== 'staff_external_wait_removed')) ||
      (c.status === 'absent' && (v.requeued ? p.status !== 'waiting' || !p.externalQueueOrder
        : p.status !== 'finished' || p.finishReason !== 'external_absence_after_entry_cutoff')) ||
      (c.status !== 'absent' && v.requeued)) ctx.addIssue({ code: 'custom', message: 'Resultado externo inconsistente.' });
  });
function refuse(code: string, status: 400 | 401 | 404 | 409 = 409): never {
  throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll('_','-'),
    title: 'Controle de Entrada indisponível', detail: 'Atualize o Controle de Entrada e verifique sua autorização.' });
}
const ensure = (ok: unknown): void => { if (!ok) throw new Error('EXTERNAL_CALL_TRANSACTION_INTEGRITY'); };
const iso = (value: string | Date) => new Date(value).toISOString();
interface CallRow extends Record<string, unknown> { id: string; participationId: string; status: string; calledAt: string }
interface Person extends Record<string, unknown> { id: string; status: string; order: string }

@Injectable()
export class StaffEntryCallService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    @Inject(EventsService) private readonly events: EventsService) {}

  async execute(action: Action, input: Intent) {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128 || !Number.isFinite(input.expiresAt.getTime()) ||
      !z.uuid().safeParse(input.eventId).success || (action !== 'call' && !z.uuid().safeParse(input.callId).success)) refuse('VALIDATION_ERROR',400);
    return this.database.transaction(async tx => {
      const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR UPDATE`);
      // Todas as pessoas antes de chamadas/identidade: mesma ordem das liberações coletivas.
      const people = (await tx.execute<Person>(sql`SELECT id,status,external_queue_order::text AS "order"
        FROM participations WHERE event_id=${input.eventId} AND status='waiting' ORDER BY id FOR UPDATE`)).rows;
      const calls = (await tx.execute<CallRow>(sql`SELECT id,participation_id AS "participationId",status,called_at AS "calledAt"
        FROM external_entry_calls WHERE event_id=${input.eventId} AND (status='pending' OR id=${input.callId ?? null}::uuid)
        ORDER BY id FOR UPDATE`)).rows;
      const authorize = async () => {
        try { await revalidateMutationSession(tx, { ...input, staffEventId: input.eventId }); }
        catch (e) { if (e instanceof ProblemException && e.getStatus() === 403) refuse('RESOURCE_NOT_FOUND',404); throw e; }
      };
      await authorize();
      if (!event.rows.length) refuse('RESOURCE_NOT_FOUND',404);
      const reservation = await reserveIdempotencyOperationWithTx(tx, { actorUserId: input.userId, operation: entryCallOperations[action],
        idempotencyKey: input.idempotencyKey, requestHash: entryCallFingerprint(action,input.eventId,input.callId), expiresAt: input.expiresAt });
      await authorize();
      if (reservation.kind === 'request_conflict') refuse('IDEMPOTENCY_REQUEST_CONFLICT');
      if (reservation.kind === 'in_progress') refuse('IDEMPOTENCY_IN_PROGRESS');
      if (reservation.kind === 'replay') {
        const value = entryCallResult.parse(reservation.resultPayload);
        ensure(reservation.httpStatus === 200 && value.eventId === input.eventId && reservation.resultReference === value.call.id &&
          (action === 'call' ? value.call.status === 'pending' : value.call.id === input.callId &&
            value.call.status === ({ confirm: 'confirmed', absent: 'absent', remove: 'removed' } as const)[action]));
        await authorize(); return value;
      }
      let call: CallRow;
      if (action === 'call') {
        if (calls.some(c => c.status === 'pending')) refuse('ENTRY_CALL_PENDING');
        const clock = (await tx.execute<{ at: string }>(sql`SELECT clock_timestamp() AS at`)).rows[0];
        const availability = await this.events.evaluateEventAvailabilityById(input.eventId,new Date(clock.at),tx);
        if (!availability.eventExists || !availability.eventAcceptingNewEntries) refuse('EVENT_ENTRY_UNAVAILABLE');
        const first = [...people].sort((a,b) => BigInt(a.order) < BigInt(b.order) ? -1 : BigInt(a.order) > BigInt(b.order) ? 1 : a.id.localeCompare(b.id))[0];
        if (!first) refuse('ENTRY_QUEUE_EMPTY');
        order.parse(first.order);
        const created = await tx.execute<CallRow>(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status)
          SELECT ${randomUUID()},e.id,p.id,${input.userId},d.at,'pending' FROM events e,participations p,decision d
          WHERE e.id=${input.eventId} AND p.id=${first.id} AND p.event_id=e.id AND p.status='waiting'
            AND p.current_queue_entry_id IS NULL AND p.arena_entered_at IS NULL AND e.external_queue_enabled
            AND e.status NOT IN ('closing','closed') AND e.closure_requested_at IS NULL
            AND e.starts_at<=d.at AND d.at<e.official_ends_at AND d.at<e.operational_deadline_at
          RETURNING id,participation_id AS "participationId",status,called_at AS "calledAt"`);
        if (!created.rows.length) refuse('EVENT_ENTRY_UNAVAILABLE');
        ensure(created.rows.length === 1); call = created.rows[0];
      } else {
        const target = calls.find(c => c.id === input.callId);
        if (!target) refuse('RESOURCE_NOT_FOUND',404);
        if (target.status !== 'pending') refuse('ENTRY_CALL_NOT_PENDING');
        call = target;
        ensure(people.some(p => p.id === call.participationId));
        if (action === 'confirm') {
          const clock = (await tx.execute<{ at: string }>(sql`SELECT clock_timestamp() AS at`)).rows[0];
          const availability = await this.events.evaluateEventAvailabilityById(input.eventId,new Date(clock.at),tx);
          if (!availability.eventExists || !availability.eventAcceptingNewEntries) refuse('EVENT_ENTRY_UNAVAILABLE');
        }
      }
      let resolvedAt: string | null = null, requeued = false;
      const before = people.find(p => p.id === call.participationId)!;
      if (action !== 'call') {
        // Uma decisão temporal em SQL após todos os locks; nenhuma margem residual admite ingresso.
        const resolution = (await tx.execute<{ at: string; requeue: boolean; order: string | null }>(sql`
          WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at), changed AS (
            UPDATE external_entry_calls c SET status=${{confirm:'confirmed',absent:'absent',remove:'removed'}[action]},
              resolved_by_user_id=${input.userId},resolved_at=d.at,resolution_reason=${{confirm:'staff_entry_confirmed',absent:'staff_external_absent',remove:'staff_external_wait_removed'}[action]}
            FROM events e,decision d WHERE c.id=${call.id} AND c.event_id=e.id AND e.id=${input.eventId} AND c.status='pending'
              AND e.external_queue_enabled AND e.status NOT IN ('closing','closed') AND e.closure_requested_at IS NULL
              AND e.starts_at<=d.at AND d.at<e.operational_deadline_at AND (e.admin_deadline_at IS NULL OR d.at<e.admin_deadline_at)
              AND (NOT ${action === 'confirm'}::boolean OR d.at<e.official_ends_at)
            RETURNING c.resolved_at,e.official_ends_at), assigned AS (
            UPDATE events e SET external_last_order=e.external_last_order+1 FROM changed c
            WHERE e.id=${input.eventId} AND ${action === 'absent'}::boolean AND c.resolved_at<c.official_ends_at
              AND e.external_last_order<9223372036854775807
            RETURNING e.external_last_order::text AS "order")
          SELECT resolved_at AS at, resolved_at<official_ends_at AS requeue, (SELECT "order" FROM assigned) AS "order" FROM changed`)).rows[0];
        if (!resolution) refuse('EVENT_ENTRY_UNAVAILABLE');
        resolvedAt = iso(resolution.at); requeued = action === 'absent' && resolution.requeue;
        if (requeued) {
          ensure(resolution.order && order.safeParse(resolution.order).success);
          const changed = await tx.execute(sql`UPDATE participations SET external_queue_order=${resolution.order}::bigint
            WHERE id=${call.participationId} AND event_id=${input.eventId} AND status='waiting' RETURNING id`);
          ensure(changed.rows.length === 1);
        } else {
          const status = action === 'confirm' ? 'active' : action === 'remove' ? 'canceled' : 'finished';
          const reason = action === 'remove' ? 'staff_external_wait_removed' : action === 'absent' ? 'external_absence_after_entry_cutoff' : null;
          // Copiar timestamptz no banco evita perda de microssegundos na relação chamada/participação.
          const changed = await tx.execute(sql`UPDATE participations p SET status=${status},
            arena_entered_at=CASE WHEN ${action === 'confirm'}::boolean THEN c.resolved_at ELSE NULL END,
            finished_at=CASE WHEN ${action !== 'confirm'}::boolean THEN c.resolved_at ELSE NULL END,finish_reason=${reason}
            FROM external_entry_calls c WHERE p.id=c.participation_id AND p.event_id=c.event_id
              AND c.id=${call.id} AND p.status='waiting' AND p.current_queue_entry_id IS NULL RETURNING p.id`);
          ensure(changed.rows.length === 1);
        }
      }
      const person = (await tx.execute<{ id: string; status: string; arenaEnteredAt: string | null; finishReason: string | null; externalQueueOrder: string | null }>(sql`
        SELECT id,status,arena_entered_at AS "arenaEnteredAt",finish_reason AS "finishReason",external_queue_order::text AS "externalQueueOrder"
        FROM participations WHERE id=${call.participationId} AND event_id=${input.eventId}`)).rows[0];
      ensure(person);
      const result = entryCallResult.parse({ eventId: input.eventId, call: { id: call.id, participationId: call.participationId,
        status: action === 'call' ? 'pending' : {confirm:'confirmed',absent:'absent',remove:'removed'}[action],
        calledAt: iso(call.calledAt), resolvedAt }, participation: { ...person,
          arenaEnteredAt: person.arenaEnteredAt ? iso(person.arenaEnteredAt) : null }, requeued });
      const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,metadata,occurred_at)
        VALUES(${randomUUID()},${input.userId},${input.eventId},'user','event',${entryCallOperations[action]},
          ${JSON.stringify({callId:call.id,participationId:call.participationId,previousOrder:before.order,
            newOrder:person.externalQueueOrder,requeued})}::jsonb,clock_timestamp()) RETURNING id`);
      ensure(audit.rows.length === 1);
      await completeIdempotencyOperationWithTx(tx,reservation.operationId,{httpStatus:200,resultReference:call.id,resultPayload:result});
      await authorize(); return result;
    }, { isolationLevel: 'read committed' });
  }
}
