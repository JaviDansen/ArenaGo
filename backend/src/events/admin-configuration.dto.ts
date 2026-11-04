import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { isPreciseInstant } from "../evaluations/evaluation-read.dto";
import { normalizeEventAccessCode } from "./access-code";
import { normalizeScheduleInstant } from "./admin-schedule.dto";
import { adminExternalQueueBody } from "./admin-external-queue.dto";

export function configurationName(limit: number) {
  return z.string().trim().refine(value => {
    const chars=Array.from(value);
    return chars.length>0&&chars.length<=limit&&chars.every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127
      &&!(c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff));
  },"Identificação inválida.");
}
export const configurationTimezone=z.string().trim().min(1).max(80).refine(value=>{
  if(/^[+-]/.test(value))return false;
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}
},"Fuso IANA inválido.").transform(value=>new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone);
const instant=z.string().transform((value,ctx)=>{
  const normalized=normalizeScheduleInstant(value);
  if(!normalized){ctx.addIssue({code:'custom',message:'Instante absoluto com fuso explícito obrigatório.'});return z.NEVER;}return normalized;
});
const code=z.string().transform((value,ctx)=>{
  try{return normalizeEventAccessCode(value);}catch{ctx.addIssue({code:'custom',message:'Código de ingresso inválido.'});return z.NEVER;}
});
const reason=adminExternalQueueBody.shape.reason.optional();
export const createEventBody=z.object({name:configurationName(180),accessCode:code,timezone:configurationTimezone,
  startsAt:instant,officialEndsAt:instant,operationalDeadlineAt:instant,externalQueueEnabled:z.boolean(),reason}).strict()
  .refine(v=>Date.parse(v.startsAt)<Date.parse(v.officialEndsAt)&&Date.parse(v.operationalDeadlineAt)>=Date.parse(v.officialEndsAt)
    &&Date.parse(v.operationalDeadlineAt)-Date.parse(v.officialEndsAt)<=3_600_000,"Horários inválidos.");
export const updateEventBody=z.object({name:configurationName(180),reason}).strict();
export const experienceBody=z.object({name:configurationName(160),reason}).strict();
export const stationBody=z.object({label:configurationName(120),reason}).strict();
export const configurationBodies={create_event:createEventBody,update_event:updateEventBody,create_experience:experienceBody,
  update_experience:experienceBody,create_station:stationBody,update_station:stationBody};
export type ConfigOperation=keyof typeof configurationBodies;
export const configurationEventParams=z.object({eventId:operationUuid}).strict();
export const configurationExperienceParams=configurationEventParams.extend({experienceId:operationUuid}).strict();
export const configurationStationParams=configurationExperienceParams.extend({stationId:operationUuid}).strict();
export const effectivePhase=z.enum(['scheduled','not_ready','open','closing','closed']);
const cursorValue=z.object({v:z.literal(1),createdAt:z.custom<string>(isPreciseInstant),id:operationUuid}).strict();
export function encodeConfigurationCursor(createdAt:string,id:string){return Buffer.from(JSON.stringify(cursorValue.parse({v:1,createdAt,id}))).toString('base64url');}
function decodeCursor(value:string){
  try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(value))return;const raw=Buffer.from(value,'base64url');if(raw.toString('base64url')!==value)return;
    return cursorValue.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}catch{return;}
}
export const configurationQuery=z.object({limit:z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).optional().default(20),
  cursor:z.string().transform((value,ctx)=>{const cursor=decodeCursor(value);if(!cursor){ctx.addIssue({code:'custom',message:'Cursor inválido.'});return z.NEVER;}return cursor;}).optional(),
  phase:effectivePhase.optional(),statusStored:z.enum(['scheduled','open','closing','closed']).optional()}).strict();
export type ConfigurationPage=z.infer<typeof configurationQuery>;
const precise=z.custom<string>(isPreciseInstant);
const checks=z.object({nameAndAccessCode:z.boolean(),validScheduleAndTimezone:z.boolean(),externalQueueConfigured:z.boolean(),hasExperienceWithAvailableStation:z.boolean(),hasVerifiedActiveStaff:z.boolean()}).strict();
export const configurationEventViewSchema=z.object({id:operationUuid,name:z.string(),accessCode:z.string(),timezone:z.string(),startsAt:precise,officialEndsAt:precise,operationalDeadlineAt:precise,
  statusStored:z.enum(['scheduled','open','closing','closed']),closureMode:z.enum(['immediate','controlled']).nullable(),closureRequestedAt:precise.nullable(),adminDeadlineAt:precise.nullable(),
  externalQueueEnabled:z.boolean(),effectivePhase,readiness:z.object({ready:z.boolean(),missing:z.array(z.string()),checks}).strict(),acceptingNewParticipations:z.boolean(),createdAt:precise,updatedAt:precise}).strict();
export const configurationExperienceViewSchema=z.object({id:operationUuid,eventId:operationUuid,name:z.string(),queueAcceptingEntries:z.boolean(),lastQueueOrder:z.string().regex(/^(0|[1-9]\d*)$/),createdAt:precise,updatedAt:precise}).strict();
export const configurationStationViewSchema=z.object({id:operationUuid,experienceId:operationUuid,label:z.string(),availability:z.enum(['available','unavailable']),pendingServiceSessionId:operationUuid.nullable(),createdAt:precise,updatedAt:precise}).strict();
