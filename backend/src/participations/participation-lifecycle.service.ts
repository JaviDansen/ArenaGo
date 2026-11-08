import { assertMutationSession, MutationSessionError, mutationTransaction, revalidateMutationSession, type MutationSession } from "../auth/mutation-session";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { effectiveEventDeadline } from "../events/event-closure.projection";
import { completedCount, eligibility, evaluationReadProjection, type EvaluationReadRow } from "../evaluations/evaluation-read.policy";
import { isPreciseInstant } from "../evaluations/evaluation-read.dto";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx, type JsonValue } from "./join-idempotency";
import { finishedParticipationView, participationView, type FinishedParticipationView, type ParticipationView } from "./participation-lifecycle.dto";
import { participationProjection, publicParticipation, type ParticipationProjectionRow } from "./participation-query.service";

export const CANCEL_PARTICIPATION_OPERATION = "cancel_external_participation";
export const FINISH_PARTICIPATION_OPERATION = "finish_arena_participation";
export const VOLUNTARY_QUEUE_REASON = "participation_voluntary_finish";
export interface LifecycleInput { userId: string; participationId: string; idempotencyKey: string; expiresAt: Date }
export type LifecycleFailure = "access_denied" | "not_waiting" | "not_active" | "event_ended" | "request_conflict" | "in_progress";
export type LifecycleResult = { kind: "changed" | "replay"; participation: ParticipationView | FinishedParticipationView }
  | { kind: LifecycleFailure; participation?: ParticipationView };
export function lifecycleFingerprint(mode: "cancel" | "finish", userId: string, participationId: string) {
  return createRequestFingerprint(mode==="cancel" ? CANCEL_PARTICIPATION_OPERATION : FINISH_PARTICIPATION_OPERATION,
    { version: 1, userId, participationId, payload: {} });
}
class LifecycleRollback extends Error { constructor(readonly result: LifecycleResult) { super(result.kind); } }
function block(kind: LifecycleFailure, participation?: ParticipationView): never { throw new LifecycleRollback({kind,...(participation?{participation}:{})}); }
function ensure(value: unknown): asserts value { if (!value) throw new Error("PARTICIPATION_LIFECYCLE_INTEGRITY"); }
interface Target extends Record<string,unknown> { eventId: string }
interface Current extends Record<string,unknown> { status: string; currentId: string | null }
interface Entry extends Record<string,unknown> { id: string; experienceId: string; status: string; sessionId: string | null; sessionStatus: string | null; stationId: string | null }

/** E08.12: sai de toda a participação; não substitui a desistência isolada C-15. */
@Injectable()
export class ParticipationLifecycleService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}
  cancel(input: LifecycleInput) { return this.write("cancel",input,null); }
  finish(input: LifecycleInput) { return this.write("finish",input,null); }
  cancelAuthenticated(input: LifecycleInput, context: MutationSession) {
    assertMutationSession(context, input.userId); return this.write("cancel",input,context);
  }
  finishAuthenticated(input: LifecycleInput, context: MutationSession) {
    assertMutationSession(context, input.userId); return this.write("finish",input,context);
  }
  private async state(tx: DatabaseTransactionExecutor, input: LifecycleInput, at?: string) {
    const rows=(await tx.execute<ParticipationProjectionRow>(participationProjection(input.userId,input.participationId,
      at?sql`${at}::timestamptz`:sql`clock_timestamp()`))).rows;
    ensure(rows.length===1); return publicParticipation(rows[0]);
  }
  private async write(mode: "cancel" | "finish", input: LifecycleInput, context: MutationSession | null): Promise<LifecycleResult> {
    try {
      ensure(input.idempotencyKey.trim() && input.idempotencyKey.length<=128 && Number.isFinite(input.expiresAt.getTime()));
      return await mutationTransaction(this.database, context, async tx => {
        const target=(await tx.execute<Target>(sql`SELECT event_id AS "eventId" FROM participations
          WHERE id=${input.participationId}::uuid AND user_id=${input.userId}::uuid`)).rows[0];
        if (!target) block("access_denied");
        const intent=await reserveIdempotencyOperationWithTx(tx,{actorUserId:input.userId,
          operation:mode==="cancel"?CANCEL_PARTICIPATION_OPERATION:FINISH_PARTICIPATION_OPERATION,idempotencyKey:input.idempotencyKey,
          requestHash:lifecycleFingerprint(mode,input.userId,input.participationId),expiresAt:input.expiresAt});
        if(intent.kind==="request_conflict"||intent.kind==="in_progress"){
          if (context !== null) await revalidateMutationSession(tx, context);
          block(intent.kind);
        }
        // Exclusivo no evento: a descoberta da fila fica estável inclusive contra troca de experiência.
        // Mesma ordem de E03/E08.8/E08.9; todo escritor operacional anterior usa FOR SHARE/UPDATE no evento.
        ensure((await tx.execute(sql`SELECT id FROM events WHERE id=${target.eventId}::uuid FOR UPDATE`)).rows.length===1);
        const entry=(await tx.execute<Entry>(sql`SELECT q.id,q.experience_id AS "experienceId",q.status,
          s.id AS "sessionId",s.status AS "sessionStatus",s.station_id AS "stationId"
          FROM participations p JOIN queue_entries q ON q.id=p.current_queue_entry_id AND q.participation_id=p.id AND q.event_id=p.event_id
          LEFT JOIN service_sessions s ON s.queue_entry_id=q.id AND s.experience_id=q.experience_id
          WHERE p.id=${input.participationId}::uuid AND p.user_id=${input.userId}::uuid AND p.event_id=${target.eventId}::uuid`)).rows[0];
        if(entry){
          ensure((await tx.execute(sql`SELECT id FROM experiences WHERE id=${entry.experienceId}::uuid AND event_id=${target.eventId}::uuid FOR UPDATE`)).rows.length===1);
          if(entry.stationId)ensure((await tx.execute(sql`SELECT id FROM stations WHERE id=${entry.stationId}::uuid AND experience_id=${entry.experienceId}::uuid FOR UPDATE`)).rows.length===1);
        }
        const person=(await tx.execute<Current>(sql`SELECT status,current_queue_entry_id AS "currentId" FROM participations
          WHERE id=${input.participationId}::uuid AND user_id=${input.userId}::uuid AND event_id=${target.eventId}::uuid FOR UPDATE`)).rows[0];
        if(!person)block("access_denied");
        if (context !== null) await revalidateMutationSession(tx, context);
        if(intent.kind==="replay"){
          const value=(mode==="finish"?finishedParticipationView:participationView).parse(intent.resultPayload && typeof intent.resultPayload==="object" && !Array.isArray(intent.resultPayload)?intent.resultPayload.participation:undefined);
          ensure(intent.httpStatus===200&&intent.resultReference===input.participationId&&value.id===input.participationId&&value.eventId===target.eventId
            &&value.status===(mode==="cancel"?"canceled":"finished")&&value.finishReason===(mode==="cancel"?"external_wait_withdrawal":"voluntary"));
          return {kind:"replay",participation:value};
        }
        if(person.status!==(mode==="cancel"?"waiting":"active"))block(mode==="cancel"?"not_waiting":"not_active",await this.state(tx,input));
        const open=(await tx.execute<{id:string}>(sql`SELECT id FROM queue_entries WHERE participation_id=${input.participationId}::uuid
          AND status IN ('waiting','called') ORDER BY id FOR UPDATE`)).rows;
        ensure(entry?person.currentId===entry.id&&open.length===1&&open[0].id===entry.id:person.currentId===null&&open.length===0);
        if(entry){
          ensure(mode==="finish"&&(entry.status==="waiting"||entry.status==="called"));
          const sessions=(await tx.execute(sql`SELECT id FROM service_sessions WHERE queue_entry_id=${entry.id}::uuid FOR UPDATE`)).rows;
          ensure(entry.status==="waiting"?sessions.length===0:entry.sessionStatus==="pending"&&entry.sessionId&&entry.stationId&&sessions.length===1);
        }
        // Um relógio, após todas as esperas, no próprio UPDATE decisivo. Nenhuma guarda de novo ingresso.
        const changed=(await tx.execute<{at:string}>(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE participations p SET status=${mode==="cancel"?"canceled":"finished"}::varchar(20),finished_at=d.at,
            finish_reason=${mode==="cancel"?"external_wait_withdrawal":"voluntary"}::varchar(40),current_queue_entry_id=NULL
          FROM events e,decision d WHERE p.id=${input.participationId}::uuid AND p.user_id=${input.userId}::uuid
            AND p.event_id=e.id AND e.id=${target.eventId}::uuid AND p.status=${mode==="cancel"?"waiting":"active"}::varchar(20)
            AND e.status<>'closed' AND d.at<${effectiveEventDeadline()}
            AND (NOT ${mode==="cancel"}::boolean OR e.closure_mode IS DISTINCT FROM 'controlled' OR e.closure_requested_at>d.at)
          RETURNING to_char(p.finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows;
        if(!changed.length)block("event_ended",await this.state(tx,input));
        ensure(changed.length===1);const row=changed[0];
        ensure(isPreciseInstant(row.at));
        if(entry){
          ensure((await tx.execute(sql`UPDATE queue_entries q SET status='closed',closed_at=p.finished_at,close_reason=${VOLUNTARY_QUEUE_REASON}
            FROM participations p WHERE q.id=${entry.id}::uuid AND q.participation_id=p.id AND p.id=${input.participationId}::uuid
              AND q.event_id=p.event_id AND q.experience_id=${entry.experienceId}::uuid AND q.status=${entry.status}::varchar(20) RETURNING q.id`)).rows.length===1);
          if(entry.sessionId)ensure((await tx.execute(sql`UPDATE service_sessions s SET status='canceled',resolved_at=p.finished_at,
            resolved_by_user_id=${input.userId}::uuid,cancel_reason=${VOLUNTARY_QUEUE_REASON}
            FROM participations p WHERE p.id=${input.participationId}::uuid AND s.id=${entry.sessionId}::uuid
              AND s.queue_entry_id=${entry.id}::uuid AND s.experience_id=${entry.experienceId}::uuid
              AND s.station_id=${entry.stationId}::uuid AND s.status='pending' RETURNING s.id`)).rows.length===1);
        }
        let participation: ParticipationView | FinishedParticipationView=await this.state(tx,input,row.at);
        if(mode==="finish"){
          const projection=evaluationReadProjection(sql`SELECT p.id,p.event_id,e.name AS event_name,p.status,p.joined_at,p.arena_entered_at,p.finished_at,p.finish_reason
            FROM participations p JOIN events e ON e.id=p.event_id WHERE p.id=${input.participationId}::uuid AND p.user_id=${input.userId}::uuid`,row.at);
          const facts=(await tx.execute<EvaluationReadRow>(projection)).rows;ensure(facts.length===1);const info=eligibility(facts[0]);
          participation={...participation,completedServicesCount:completedCount(facts[0].completedCount),evaluationEligibility:{eligible:info.eligible,hasSubmitted:info.submitted}};
        }
        await completeIdempotencyOperationWithTx(tx,intent.operationId,{httpStatus:200,resultReference:input.participationId,resultPayload:{participation} as unknown as JsonValue});
        return {kind:"changed",participation};
      },{isolationLevel:"read committed"});
    }catch(error){if(error instanceof MutationSessionError)throw error;if(error instanceof LifecycleRollback)return error.result;throw new Error("PARTICIPATION_LIFECYCLE_INTERNAL_ERROR",{cause:error});}
  }
}
