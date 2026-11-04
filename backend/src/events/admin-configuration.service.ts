import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { completeIdempotencyOperationWithTx,createRequestFingerprint,reserveIdempotencyOperationWithTx,type JsonValue } from "../participations/join-idempotency";
import { configurationBodies,configurationEventViewSchema,configurationExperienceViewSchema,configurationStationViewSchema,type ConfigOperation } from "./admin-configuration.dto";
import { configurationEventView,configurationProjection,experienceSelection,stationSelection,type ConfigurationRow } from "./admin-configuration.projection";
import { assertAdminSessionWithTx,authorizeGlobalAdminWithTx } from "./admin-operation-auth";
import { AdminConfigurationError,failConfiguration } from "./admin-configuration.problem";
import { configurationMutation } from "./admin-configuration.mutation";

export const CONFIGURATION_OPERATIONS:Record<ConfigOperation,string>={create_event:'admin_create_event',update_event:'admin_update_event_metadata',create_experience:'admin_create_experience',update_experience:'admin_update_experience',create_station:'admin_create_station',update_station:'admin_update_station'};
export interface ConfigurationInput {operation:ConfigOperation;userId:string;sessionId:string;eventId?:string;experienceId?:string;stationId?:string;payload:unknown;idempotencyKey:string;expiresAt:Date}
export function configurationFingerprint(input:Pick<ConfigurationInput,'operation'|'eventId'|'experienceId'|'stationId'|'payload'>){
  const payload=configurationBodies[input.operation].parse(input.payload);
  return createRequestFingerprint(CONFIGURATION_OPERATIONS[input.operation],{v:1,eventId:input.eventId??null,experienceId:input.experienceId??null,stationId:input.stationId??null,...payload,reason:payload.reason??null});
}
function ensure(value:unknown):asserts value{if(!value)throw new Error('ADMIN_CONFIGURATION_INTEGRITY');}
function decodeBody(operation:ConfigOperation,payload:JsonValue|null){
  ensure(payload&&typeof payload==='object'&&!Array.isArray(payload));
  if(operation.endsWith('event')){ensure(Object.keys(payload).length===1);return {event:configurationEventViewSchema.parse(payload.event)};}
  if(operation.endsWith('experience')){ensure(Object.keys(payload).length===1);return {experience:configurationExperienceViewSchema.parse(payload.experience)};}
  ensure(Object.keys(payload).length===1);return {station:configurationStationViewSchema.parse(payload.station)};
}
@Injectable()
export class AdminConfigurationService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database:NodePgDatabase<typeof schema>){}
  async mutate(input:ConfigurationInput){
    try{
      const payload=configurationBodies[input.operation].parse(input.payload),body=payload as Record<string,string|boolean|undefined>,operation=CONFIGURATION_OPERATIONS[input.operation];
      ensure(input.idempotencyKey.trim()&&input.idempotencyKey.length<=128&&Number.isFinite(input.expiresAt.getTime()));
      const creating=input.operation.startsWith('create_'),entity=input.operation.split('_')[1],httpStatus=creating?201:200;
      return await this.database.transaction(async tx=>{
        // Ordem existente dos comandos Admin: evento -> experiência/estação -> conta/concessão/sessão.
        let eventId=input.eventId;let id=entity==='event'?eventId:entity==='experience'?input.experienceId:input.stationId;
        if(input.operation==='create_event'){eventId=randomUUID();id=eventId;}
        if(input.operation!=='create_event'){
          ensure(eventId);
          const event=(await tx.execute(sql`SELECT id FROM events WHERE id=${eventId}::uuid FOR UPDATE`)).rows[0];
          if(entity!=='event'&&input.experienceId){if(!(await tx.execute(sql`SELECT id FROM experiences WHERE id=${input.experienceId}::uuid AND event_id=${eventId}::uuid FOR UPDATE`)).rows.length) {
            await authorizeGlobalAdminWithTx(tx,input,r=>failConfiguration(r.kind));failConfiguration('resource_not_found');}}
          if(entity==='station'&&input.stationId){if(!(await tx.execute(sql`SELECT s.id FROM stations s JOIN experiences x ON x.id=s.experience_id WHERE s.id=${input.stationId}::uuid
            AND s.experience_id=${input.experienceId}::uuid AND x.event_id=${eventId}::uuid FOR UPDATE OF s`)).rows.length){await authorizeGlobalAdminWithTx(tx,input,r=>failConfiguration(r.kind));failConfiguration('resource_not_found');}}
          await authorizeGlobalAdminWithTx(tx,input,r=>failConfiguration(r.kind));if(!event)failConfiguration('resource_not_found');
        }else await authorizeGlobalAdminWithTx(tx,input,r=>failConfiguration(r.kind));
        const intent=await reserveIdempotencyOperationWithTx(tx,{actorUserId:input.userId,operation,idempotencyKey:input.idempotencyKey,requestHash:configurationFingerprint(input),expiresAt:input.expiresAt});
        await assertAdminSessionWithTx(tx,input,r=>failConfiguration(r.kind));
        if(intent.kind==='request_conflict'||intent.kind==='in_progress')failConfiguration(intent.kind);
        if(intent.kind==='replay'){
          const result=decodeBody(input.operation,intent.resultPayload);ensure(intent.httpStatus===httpStatus);
          const resource='event'in result?result.event:'experience'in result?result.experience:result.station;
          ensure(resource&&resource.id===intent.resultReference&&(creating||resource.id===id));
          if(result.experience)ensure(result.experience.eventId===eventId);
          if(result.station)ensure(result.station.experienceId===input.experienceId);
          return {kind:'replay' as const,body:result,httpStatus};
        }
        let changed=false,at:string|undefined,before:JsonValue=null;
        if(input.operation==='create_event'){
          const row=(await tx.execute<{id:string;at:string}>(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
            INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
            SELECT ${eventId}::uuid,${body.name}::varchar(180),${body.accessCode}::varchar(64),${body.timezone}::varchar(80),${body.startsAt}::timestamptz,${body.officialEndsAt}::timestamptz,
              ${body.operationalDeadlineAt}::timestamptz,'scheduled',${body.externalQueueEnabled}::boolean,0,d.at,d.at FROM decision d
            ON CONFLICT (access_code_normalized) DO NOTHING RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows[0];
          if(!row)failConfiguration('access_code_used');at=row.at;changed=true;
        }else{
          ensure(eventId);
          const previous=entity==='event'?(await tx.execute<{value:string}>(sql`SELECT name AS value FROM events WHERE id=${eventId}::uuid`)).rows[0]
            :!creating?entity==='experience'?(await tx.execute<{value:string}>(sql`SELECT name AS value FROM experiences WHERE id=${id}::uuid AND event_id=${eventId}::uuid`)).rows[0]
              :(await tx.execute<{value:string}>(sql`SELECT label AS value FROM stations WHERE id=${id}::uuid AND experience_id=${input.experienceId}::uuid`)).rows[0]:undefined;
          if(!creating)ensure(previous);
          const same=!creating&&previous!.value===(entity==='station'?body.label:body.name);
          if(!same){
            if(creating)id=randomUUID();else before={ [entity==='station'?'label':'name']:previous!.value };
            ensure(id);
            const rows=(await tx.execute<{ended:boolean;history:boolean;at:string;writtenId:string|null}>(configurationMutation(input.operation,eventId,id,input.experienceId,body))).rows;
            ensure(rows.length===1);const decision=rows[0];if(decision.ended)failConfiguration('event_ended');
            if(decision.history&&input.operation!=='create_station')failConfiguration('configuration_locked');
            ensure(decision.writtenId===id);at=decision.at;changed=true;
          }
        }
        ensure(eventId&&id);
        await assertAdminSessionWithTx(tx,input,r=>failConfiguration(r.kind));
        let result:ReturnType<typeof decodeBody>;
        if(entity==='event'){
          const row=(await tx.execute<ConfigurationRow>(configurationProjection(sql`e.id=${eventId}::uuid`,at?sql`${at}::timestamptz`:sql`clock_timestamp()`))).rows[0];ensure(row);
          result={event:configurationEventViewSchema.parse(configurationEventView(row))};
        }else if(entity==='experience')result={experience:configurationExperienceViewSchema.parse((await tx.execute(sql`${experienceSelection} WHERE id=${id}::uuid AND event_id=${eventId}::uuid`)).rows[0])};
        else result={station:configurationStationViewSchema.parse((await tx.execute(sql`${stationSelection} WHERE s.id=${id}::uuid AND s.experience_id=${input.experienceId}::uuid`)).rows[0])};
        if(changed){
          const after={ [entity==='station'?'label':'name']:entity==='station'?body.label!:body.name! };
          ensure((await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,reason,metadata,occurred_at)
            VALUES(${randomUUID()}::uuid,${input.userId}::uuid,${eventId}::uuid,'user','event',${operation}::varchar(80),${body.reason??null}::text,
              ${JSON.stringify({objectId:id,entity,before,after})}::jsonb,${at}::timestamptz) RETURNING id`)).rows.length===1);
        }
        await completeIdempotencyOperationWithTx(tx,intent.operationId,{httpStatus,resultReference:id,resultPayload:result as unknown as JsonValue});
        await assertAdminSessionWithTx(tx,input,r=>failConfiguration(r.kind));
        return {kind:creating?'created' as const:changed?'changed' as const:'unchanged' as const,body:result,httpStatus};
      },{isolationLevel:'read committed'});
    }catch(error){if(error instanceof AdminConfigurationError)throw error;throw new Error('ADMIN_CONFIGURATION_INTERNAL_ERROR',{cause:error});}
  }
}
