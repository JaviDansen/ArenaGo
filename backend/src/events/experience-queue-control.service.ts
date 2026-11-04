import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx,createRequestFingerprint,reserveIdempotencyOperationWithTx,type JsonValue } from "../participations/join-idempotency";
import { effectiveEventDeadline } from "./event-closure.projection";
import { experienceQueueControlState,type ExperienceQueueControlState } from "./experience-queue-control.dto";

export const EXPERIENCE_QUEUE_CONTROL_OPERATION='set_experience_queue_acceptance';
export const EXPERIENCE_QUEUE_CONTROL_ACTION='experience_queue_acceptance_changed';
export interface ExperienceQueueControlInput {userId:string;sessionId:string;eventId:string;experienceId:string;acceptingEntries:boolean;idempotencyKey:string;expiresAt:Date}
export type ExperienceQueueControlFailure='access_denied'|'account_inactive'|'invalid_session'|'session_revoked'|'session_expired'|'admin_2fa_required'|'event_operation_ended'|'request_conflict'|'in_progress';
export type ExperienceQueueControlResult={kind:'changed'|'unchanged'|'replay';state:ExperienceQueueControlState}|{kind:ExperienceQueueControlFailure};
export function experienceQueueControlFingerprint(eventId:string,experienceId:string,acceptingEntries:boolean){
  return createRequestFingerprint(EXPERIENCE_QUEUE_CONTROL_OPERATION,{v:1,eventId,experienceId,acceptingEntries});
}
class ControlRollback extends Error {constructor(readonly kind:ExperienceQueueControlFailure){super(kind);}}
function block(kind:ExperienceQueueControlFailure):never{throw new ControlRollback(kind);}
function ensure(value:unknown):asserts value{if(!value)throw new Error('EXPERIENCE_QUEUE_CONTROL_INTEGRITY');}

/** Relógio SQL alternativo é somente para bordas de testes internos; HTTP não recebe tempo. */
export function queueAcceptanceStatement(input:ExperienceQueueControlInput,previous:boolean,admin:boolean,clock:SQL=sql`clock_timestamp()`):SQL{
  return sql`WITH decision AS MATERIALIZED (SELECT ${clock} AS at)
    UPDATE experiences x SET queue_accepting_entries=${input.acceptingEntries}::boolean,updated_at=d.at
    FROM events e,sessions a,decision d WHERE x.id=${input.experienceId}::uuid AND x.event_id=${input.eventId}::uuid AND e.id=x.event_id
      AND x.queue_accepting_entries=${previous}::boolean AND e.status<>'closed' AND d.at<${effectiveEventDeadline()}
      AND a.id=${input.sessionId}::uuid AND a.user_id=${input.userId}::uuid AND a.revoked_at IS NULL AND d.at<a.expires_at
      AND (NOT ${admin}::boolean OR a.admin_2fa_verified_at IS NOT NULL)
    RETURNING to_char(x.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "changedAt"`;
}
/** Configuração operacional: não altera estrutura, FIFO ou ocorrências dos participantes. */
@Injectable()
export class ExperienceQueueControlService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database:NodePgDatabase<typeof schema>){}
  private async session(tx:DatabaseTransactionExecutor,input:ExperienceQueueControlInput,admin:boolean){
    const auth=(await tx.execute<{revoked:boolean;expired:boolean;secondFactor:boolean}>(sql`SELECT revoked_at IS NOT NULL AS revoked,
      expires_at<=clock_timestamp() AS expired,admin_2fa_verified_at IS NOT NULL AS "secondFactor"
      FROM sessions WHERE id=${input.sessionId}::uuid AND user_id=${input.userId}::uuid`)).rows[0];
    if(!auth)block('invalid_session');if(auth.revoked)block('session_revoked');if(auth.expired)block('session_expired');if(admin&&!auth.secondFactor)block('admin_2fa_required');
  }
  async setAcceptance(input:ExperienceQueueControlInput):Promise<ExperienceQueueControlResult>{
    try{
      ensure(typeof input.acceptingEntries==='boolean'&&input.idempotencyKey.trim()&&input.idempotencyKey.length<=128
        &&[...input.idempotencyKey].every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127)&&Number.isFinite(input.expiresAt.getTime()));
      return await this.database.transaction(async tx=>{
        if(!(await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId}::uuid FOR UPDATE`)).rows.length)block('access_denied');
        const target=(await tx.execute<{accepting:boolean}>(sql`SELECT queue_accepting_entries AS accepting FROM experiences
          WHERE id=${input.experienceId}::uuid AND event_id=${input.eventId}::uuid FOR UPDATE`)).rows[0];
        if(!target)block('access_denied');ensure(typeof target.accepting==='boolean');
        // Mesmo protocolo de autorização dual da E08.5, sem ampliar as rotas exclusivamente Staff.
        const account=(await tx.execute<{active:boolean;verified:boolean}>(sql`SELECT is_active AS active,email_verified_at IS NOT NULL AS verified
          FROM users WHERE id=${input.userId}::uuid FOR SHARE`)).rows[0];if(!account?.active)block('account_inactive');
        const roles=(await tx.execute<{role:string}>(sql`SELECT role FROM user_roles WHERE user_id=${input.userId}::uuid AND revoked_at IS NULL
          AND ((role='staff' AND event_id=${input.eventId}::uuid) OR (role='admin' AND event_id IS NULL)) ORDER BY id FOR SHARE`)).rows;
        const admin=roles.some(r=>r.role==='admin');if(!admin&&!(account.verified&&roles.some(r=>r.role==='staff')))block('access_denied');
        if(!(await tx.execute(sql`SELECT id FROM sessions WHERE id=${input.sessionId}::uuid AND user_id=${input.userId}::uuid FOR SHARE`)).rows.length)block('invalid_session');
        await this.session(tx,input,admin);
        const intent=await reserveIdempotencyOperationWithTx(tx,{actorUserId:input.userId,operation:EXPERIENCE_QUEUE_CONTROL_OPERATION,
          idempotencyKey:input.idempotencyKey,requestHash:experienceQueueControlFingerprint(input.eventId,input.experienceId,input.acceptingEntries),expiresAt:input.expiresAt});
        await this.session(tx,input,admin);
        if(intent.kind==='request_conflict'||intent.kind==='in_progress')block(intent.kind);
        if(intent.kind==='replay'){
          const state=experienceQueueControlState.parse(intent.resultPayload);ensure(intent.httpStatus===200&&intent.resultReference===input.experienceId
            &&state.eventId===input.eventId&&state.experienceId===input.experienceId&&state.queueAcceptingEntries===input.acceptingEntries);
          await this.session(tx,input,admin);
          return {kind:'replay',state};
        }
        const state:ExperienceQueueControlState={eventId:input.eventId,experienceId:input.experienceId,queueAcceptingEntries:input.acceptingEntries};
        const changed=target.accepting!==input.acceptingEntries;
        if(changed){
          const rows=(await tx.execute<{changedAt:string}>(queueAcceptanceStatement(input,target.accepting,admin))).rows;
          // Sessão pode vencer na própria instrução; prioridade do erro de autenticação, com rollback.
          await this.session(tx,input,admin);if(!rows.length)block('event_operation_ended');ensure(rows.length===1);
          state.changedAt=rows[0].changedAt;experienceQueueControlState.parse(state);
          const audit=await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,metadata,occurred_at)
            SELECT ${randomUUID()}::uuid,${input.userId}::uuid,${input.eventId}::uuid,'user','experience',${EXPERIENCE_QUEUE_CONTROL_ACTION},
              jsonb_build_object('experienceId',x.id,'before',jsonb_build_object('queueAcceptingEntries',${target.accepting}::boolean),
                'after',jsonb_build_object('queueAcceptingEntries',${input.acceptingEntries}::boolean)),x.updated_at
            FROM experiences x WHERE x.id=${input.experienceId}::uuid AND x.event_id=${input.eventId}::uuid RETURNING id`);
          ensure(audit.rows.length===1);
        }
        await completeIdempotencyOperationWithTx(tx,intent.operationId,{httpStatus:200,resultReference:input.experienceId,resultPayload:state as unknown as JsonValue});
        await this.session(tx,input,admin);return {kind:changed?'changed':'unchanged',state};
      },{isolationLevel:'read committed'});
    }catch(error){if(error instanceof ControlRollback)return {kind:error.kind};throw new Error('EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR',{cause:error});}
  }
}
