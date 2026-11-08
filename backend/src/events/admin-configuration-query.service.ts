import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { configurationEventViewSchema,configurationExperienceViewSchema,configurationStationViewSchema,encodeConfigurationCursor,type ConfigurationPage } from "./admin-configuration.dto";
import { configurationEventView,configurationProjection,experienceSelection,readinessView,stationSelection,type ConfigurationRow } from "./admin-configuration.projection";
import { failConfiguration } from "./admin-configuration.problem";

export interface ConfigurationActor {userId:string;sessionId:string}
export async function authorizeConfigurationRead(tx:DatabaseTransactionExecutor,actor:ConfigurationActor){
  const row=(await tx.execute<{active:boolean;admin:boolean;valid:boolean;revoked:boolean;expired:boolean;secondFactor:boolean}>(sql`
    SELECT u.is_active AS active,EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='admin' AND r.event_id IS NULL AND r.revoked_at IS NULL) AS admin,
      s.id IS NOT NULL AS valid,s.revoked_at IS NOT NULL AS revoked,s.expires_at<=clock_timestamp() AS expired,s.admin_2fa_verified_at IS NOT NULL AS "secondFactor"
    FROM users u LEFT JOIN sessions s ON s.id=${actor.sessionId}::uuid AND s.user_id=u.id WHERE u.id=${actor.userId}::uuid`)).rows[0];
  if(!row?.active)failConfiguration('account_inactive');if(!row.admin)failConfiguration('admin_required');if(!row.valid)failConfiguration('invalid_session');
  if(row.revoked)failConfiguration('session_revoked');if(row.expired)failConfiguration('session_expired');if(!row.secondFactor)failConfiguration('admin_2fa_required');
}
@Injectable()
export class AdminConfigurationQueryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database:NodePgDatabase<typeof schema>){}
  private snapshot<T>(actor:ConfigurationActor,read:(tx:DatabaseTransactionExecutor)=>Promise<T>){return this.database.transaction(async tx=>{
    await authorizeConfigurationRead(tx,actor);return read(tx);
  },{isolationLevel:'repeatable read',accessMode:'read only'});}
  events(actor:ConfigurationActor,page:ConfigurationPage){return this.snapshot(actor,async tx=>{
    const after=page.cursor?sql`(e.created_at,e.id)<(${page.cursor.createdAt}::timestamptz,${page.cursor.id}::uuid)`:sql`true`;
    const query=configurationProjection(sql`${after} AND ${page.statusStored?sql`e.status=${page.statusStored}::varchar(20)`:sql`true`}`);
    const rows=(await tx.execute<ConfigurationRow>(sql`SELECT * FROM (${query}) p WHERE ${page.phase?sql`p."effectivePhase"=${page.phase}::text`:sql`true`}
      ORDER BY "createdAt" DESC,id DESC LIMIT ${page.limit+1}`)).rows,visible=rows.slice(0,page.limit),last=visible.at(-1);
    return {items:visible.map(r=>configurationEventViewSchema.parse(configurationEventView(r))),nextCursor:rows.length>page.limit&&last?encodeConfigurationCursor(last.createdAt,last.id):null};
  });}
  event(actor:ConfigurationActor,eventId:string){return this.snapshot(actor,async tx=>{
    const row=(await tx.execute<ConfigurationRow>(configurationProjection(sql`e.id=${eventId}::uuid`))).rows[0];if(!row)failConfiguration('resource_not_found');
    return {event:configurationEventViewSchema.parse(configurationEventView(row))};
  });}
  readiness(actor:ConfigurationActor,eventId:string){return this.snapshot(actor,async tx=>{
    const row=(await tx.execute<ConfigurationRow>(configurationProjection(sql`e.id=${eventId}::uuid`))).rows[0];if(!row)failConfiguration('resource_not_found');
    // Parse do DTO fechado também verifica instantes antes de formar a visão reduzida.
    configurationEventViewSchema.parse(configurationEventView(row));
    return {eventId:row.id,statusStored:row.statusStored,effectivePhase:row.effectivePhase,...readinessView(row),acceptingNewParticipations:row.acceptingNewParticipations,observedAt:row.observedAt};
  });}
  experiences(actor:ConfigurationActor,eventId:string){return this.snapshot(actor,async tx=>{
    if(!(await tx.execute(sql`SELECT id FROM events WHERE id=${eventId}::uuid`)).rows.length)failConfiguration('resource_not_found');
    const experiences=(await tx.execute(sql`${experienceSelection} WHERE event_id=${eventId}::uuid ORDER BY id`)).rows.map(r=>configurationExperienceViewSchema.parse(r));
    const stations=(await tx.execute(sql`${stationSelection} JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${eventId}::uuid ORDER BY s.id`)).rows.map(r=>configurationStationViewSchema.parse(r));
    const grouped=new Map<string,typeof stations>();for(const s of stations){const group=grouped.get(s.experienceId)??[];group.push(s);grouped.set(s.experienceId,group);}
    return {eventId,items:experiences.map(x=>({...x,stations:grouped.get(x.id)??[]}))};
  });}
}
