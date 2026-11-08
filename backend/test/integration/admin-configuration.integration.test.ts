import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { QueryConfig, QueryResult } from "pg";
import supertest from "supertest";
import * as schema from "../../src/database/schema";
import type { AdminConfigurationService } from "../../src/events/admin-configuration.service";
import { setup, cleanup, app, pool, database, admin, context, person, readyEntrant, admit, state, ordered, lockWait,
  close, controlled, patch, proposal, station, called, resolve, type Context } from "./event-closure-fixture";
import { problem } from "./evaluation-read-fixture";

type Actor={userId:string;sessionId:string;token:string};
type Kind="list"|"create_event"|"get_event"|"update_event"|"readiness"|"list_experiences"|"create_experience"|"update_experience"|"create_station"|"update_station";
const mutations=["create_event","update_event","create_experience","update_experience","create_station","update_station"]as const;
const allRoutes=["list","create_event","get_event","update_event","readiness","list_experiences","create_experience","update_experience","create_station","update_station"]as const;
const createdIds=new Set<string>(),createdCodes=new Set<string>();
let writes:AdminConfigurationService,makeWrites:(db:NodePgDatabase<typeof schema>)=>AdminConfigurationService;
let operations:typeof import("../../src/events/admin-configuration.service").CONFIGURATION_OPERATIONS;
let fingerprint:typeof import("../../src/events/admin-configuration.service").configurationFingerprint;
before(async()=>{
  process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS="60";await setup();
  const module=await import("../../src/events/admin-configuration.service");writes=app.get(module.AdminConfigurationService);makeWrites=db=>new module.AdminConfigurationService(db);operations=module.CONFIGURATION_OPERATIONS;fingerprint=module.configurationFingerprint;
});
after(async()=>{
  const errors:unknown[]=[];
  try{
    const client=await pool.connect();try{
      await client.query('BEGIN');
      const found=(await client.query('SELECT id FROM events WHERE access_code_normalized=ANY($1::text[])',[Array.from(createdCodes)])).rows;
      for(const row of found)createdIds.add(row.id);const ids=Array.from(createdIds);
      await client.query('DELETE FROM audit_logs WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM evaluations v USING participations p WHERE v.participation_id=p.id AND p.event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM participations WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM stations s USING experiences x WHERE s.experience_id=x.id AND x.event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM experiences WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM user_roles WHERE event_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM events WHERE id=ANY($1::uuid[])',[ids]);await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }catch(error){errors.push(error);}
  try{await cleanup();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Limpeza E08.13 falhou.');
});
function draft(overrides:Record<string,unknown>={}){
  const code=`E813-${randomUUID()}`.toUpperCase();createdCodes.add(code);
  return {name:'Evento E08.13',accessCode:code,timezone:'America/Sao_Paulo',startsAt:new Date(Date.now()+7200000).toISOString(),
    officialEndsAt:new Date(Date.now()+10800000).toISOString(),operationalDeadlineAt:new Date(Date.now()+12600000).toISOString(),externalQueueEnabled:true,...overrides};
}
function body(kind:Kind){return kind==='create_event'?draft():kind==='create_station'||kind==='update_station'?{label:'Estação E08.13'}:{name:'Configuração E08.13'};}
function request(kind:Kind,c:Context,actor:Actor=c.admin,payload:object=body(kind),key:string=randomUUID()){
  const base=`/api/v1/admin/events`,event=`${base}/${c.eventId}`,experience=`${event}/experiences/${c.experienceId}`,stationRoute=`${experience}/stations/${c.stationId}`;
  const route=kind==='list'||kind==='create_event'?base:kind==='get_event'||kind==='update_event'?event:kind==='readiness'?`${event}/readiness`:
    kind==='list_experiences'||kind==='create_experience'?`${event}/experiences`:kind==='update_experience'?experience:kind==='create_station'?`${experience}/stations`:stationRoute;
  const read=kind==='list'||kind==='get_event'||kind==='readiness'||kind==='list_experiences';
  const r=read?supertest(app.getHttpServer()).get(route):kind.startsWith('create_')?supertest(app.getHttpServer()).post(route):supertest(app.getHttpServer()).patch(route);
  r.set('Authorization',`Bearer ${actor.token}`);if(!read)r.set('Idempotency-Key',key).send(payload);return r;
}
async function create(actor:Actor,payload:object=draft(),key:string=randomUUID()){
  const r=await supertest(app.getHttpServer()).post('/api/v1/admin/events').set('Authorization',`Bearer ${actor.token}`).set('Idempotency-Key',key).send(payload);
  if(r.body.event?.id)createdIds.add(r.body.event.id);return r;
}
async function event(c:Context){return request('get_event',c);}
async function eventAudits(eventId:string){return (await pool.query('SELECT * FROM audit_logs WHERE event_id=$1 ORDER BY id',[eventId])).rows;}
async function actorIntents(actor:Actor,key?:string){return (await pool.query('SELECT * FROM idempotency_operations WHERE actor_user_id=$1 AND ($2::text IS NULL OR idempotency_key=$2::text) ORDER BY id',[actor.userId,key??null])).rows;}
async function ready(c:Context){const r=await request('readiness',c);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
async function assertUnchanged(c:Context,before:unknown){assert.deepEqual(await state(c),before);}

for(const kind of allRoutes)test(`E08.13 PostgreSQL ${kind} exige autenticação, Admin global e 2FA`,async()=>{
  const c=await context(),payload=body(kind),before=await state(c);
  problem(await request(kind,c,c.admin,payload).unset('Authorization'),401,'MISSING_ACCESS_TOKEN');
  problem(await request(kind,c,c.staff,payload),403,'ADMIN_REQUIRED');
  await pool.query('UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1',[c.admin.sessionId]);problem(await request(kind,c,c.admin,payload),401,'ADMIN_2FA_REQUIRED');
  await pool.query('UPDATE sessions SET admin_2fa_verified_at=clock_timestamp(),revoked_at=clock_timestamp(),revocation_reason=\'fixture\' WHERE id=$1',[c.admin.sessionId]);
  problem(await request(kind,c,c.admin,payload),401,'SESSION_REVOKED');await assertUnchanged(c,before);
});
for(const kind of allRoutes)test(`E08.13 PostgreSQL ${kind} respeita conta e concessão Admin atuais`,async()=>{
  const c=await context(),payload=body(kind);await pool.query('UPDATE users SET is_active=false WHERE id=$1',[c.admin.userId]);
  problem(await request(kind,c,c.admin,payload),401,'ACCOUNT_DEACTIVATED');await pool.query('UPDATE users SET is_active=true WHERE id=$1',[c.admin.userId]);
  await pool.query('UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1',[c.admin.roleId]);problem(await request(kind,c,c.admin,payload),403,'ADMIN_REQUIRED');
});
test('E08.13 PostgreSQL cadastro incompleto scheduled preserva defaults, código canônico e auditoria',async()=>{
  const actor=await admin(),payload=draft(),code=payload.accessCode,r=await create(actor,{...payload,accessCode:` ${code.toLowerCase()} `});assert.equal(r.status,201,JSON.stringify(r.body));
  const value=r.body.event;assert.equal(value.name,payload.name);assert.equal(value.accessCode,code);assert.equal(value.statusStored,'scheduled');assert.equal(value.effectivePhase,'scheduled');assert.equal(value.externalQueueEnabled,true);assert.equal(value.readiness.ready,false);assert.equal(value.acceptingNewParticipations,false);
  const row=(await pool.query('SELECT external_last_order::text AS counter,closure_mode,closure_requested_at,admin_deadline_at FROM events WHERE id=$1',[value.id])).rows[0];
  assert.deepEqual(row,{counter:'0',closure_mode:null,closure_requested_at:null,admin_deadline_at:null});assert.equal((await eventAudits(value.id)).length,1);assert.equal((await actorIntents(actor)).length,1);
  for(const field of ['startsAt','officialEndsAt','operationalDeadlineAt','createdAt','updatedAt'])assert.match(value[field],/\.\d{6}Z$/);
});
for(const [name,invalid]of [
  ['empty-name',{name:' '}],['unicode-code',{accessCode:'ARENA-ß'}],['short-code',{accessCode:'abc'}],['bad-timezone',{timezone:'Not/AZone'}],
  ['local-date',{startsAt:'2026-11-05T10:00:00'}],['invalid-date',{startsAt:'2026-02-30T10:00:00Z'}],['missing-queue',{externalQueueEnabled:undefined}],
  ['forged-status',{status:'open'}],['forged-id',{id:randomUUID()}],['forged-counter',{externalLastOrder:10}],
]as const)test(`E08.13 PostgreSQL cadastro rejeita ${name} sem evento/intenção`,async()=>{
  const actor=await admin(),payload=draft(invalid),before=await actorIntents(actor),r=await create(actor,payload);problem(r,400,'VALIDATION_ERROR');assert.deepEqual(await actorIntents(actor),before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM events WHERE access_code_normalized=$1',[payload.accessCode])).rows[0].n,0);
});
for(const type of ['reversed','deadline-before-end','margin-over-60']as const)test(`E08.13 PostgreSQL cadastro rejeita intervalo ${type}`,async()=>{
  const actor=await admin(),payload=draft(),end=Date.now()+10800000;
  if(type==='reversed')payload.startsAt=new Date(end+1).toISOString();
  if(type==='deadline-before-end')payload.operationalDeadlineAt=new Date(end-1000).toISOString();
  if(type==='margin-over-60')payload.operationalDeadlineAt=new Date(end+3601000).toISOString();
  problem(await create(actor,payload),400,'VALIDATION_ERROR');assert.equal((await actorIntents(actor)).length,0);
});
test('E08.13 PostgreSQL código único permanece reservado após encerramento',async()=>{
  const actor=await admin(),payload=draft(),a=await create(actor,payload);assert.equal(a.status,201);await pool.query("UPDATE events SET status='closed' WHERE id=$1",[a.body.event.id]);
  problem(await create(actor,{...payload,accessCode:payload.accessCode.toLowerCase()}),409,'ACCESS_CODE_ALREADY_USED');assert.equal((await actorIntents(actor)).length,1);
});
test('E08.13 PostgreSQL dois Admins e códigos concorrentes não criam duplicatas',async()=>{
  const a=await admin(),b=await admin(),payload=draft(),[one,two]=await ordered(()=>create(a,payload),()=>create(b,payload));assert.equal(one.status,201);problem(two,409,'ACCESS_CODE_ALREADY_USED');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM events WHERE access_code_normalized=$1',[payload.accessCode])).rows[0].n,1);
});
for(const kind of ['get_event','readiness','list_experiences','update_event','create_experience','update_experience','create_station','update_station']as const)test(`E08.13 PostgreSQL ${kind} valida UUID e recurso ausente`,async()=>{
  const c=await context();problem(await request(kind,{...c,eventId:'invalid'}),400,'VALIDATION_ERROR');problem(await request(kind,{...c,eventId:randomUUID()}),404,'RESOURCE_NOT_FOUND');
});
for(const kind of ['update_experience','create_station','update_station']as const)test(`E08.13 PostgreSQL ${kind} rejeita pertencimento de outro evento`,async()=>{
  const c=await context(),other=await context(),before=await state(c),foreign=await state(other);
  problem(await request(kind,{...c,experienceId:other.experienceId,stationId:other.stationId}),404,'RESOURCE_NOT_FOUND');await assertUnchanged(c,before);await assertUnchanged(other,foreign);
  if(kind==='update_station')problem(await request(kind,{...c,stationId:other.stationId}),404,'RESOURCE_NOT_FOUND');
});
for(const kind of mutations)test(`E08.13 PostgreSQL ${kind} exige chave e corpo estritos`,async()=>{
  const c=await context(),payload=body(kind),before=await state(c),intentsBefore=await actorIntents(c.admin);
  problem(await request(kind,c,c.admin,payload).unset('Idempotency-Key'),400,'VALIDATION_ERROR');problem(await request(kind,c,c.admin,{...payload,userId:c.admin.userId}),400,'VALIDATION_ERROR');
  problem(await request(kind,c,c.admin,payload,'x'.repeat(129)),400,'VALIDATION_ERROR');problem(await request(kind,c,c.admin,{...payload,reason:' '}),400,'VALIDATION_ERROR');
  await assertUnchanged(c,before);assert.deepEqual(await actorIntents(c.admin),intentsBefore);
});
for(const key of ['accessCode','officialEndsAt','operationalDeadlineAt','externalQueueEnabled','status','closureMode','closureRequestedAt','adminDeadlineAt','externalLastOrder','startsAt','timezone']as const)test(`E08.13 PostgreSQL PATCH genérico não altera ${key}`,async()=>{
  const c=await context(),before=await state(c);problem(await request('update_event',c,c.admin,{name:'Novo nome',[key]:'forged'}),400,'VALIDATION_ERROR');await assertUnchanged(c,before);
});
test('E08.13 PostgreSQL experiência e estação nascem com vínculos e contadores corretos',async()=>{
  const c=await context(),x=await request('create_experience',c,c.admin,{name:'Experiência nova'});assert.equal(x.status,201,JSON.stringify(x.body));assert.equal(x.body.experience.eventId,c.eventId);assert.equal(x.body.experience.lastQueueOrder,'0');assert.equal(x.body.experience.queueAcceptingEntries,true);
  const s=await request('create_station',{...c,experienceId:x.body.experience.id},c.admin,{label:'Estação nova'});assert.equal(s.status,201);assert.equal(s.body.station.experienceId,x.body.experience.id);assert.equal(s.body.station.availability,'available');assert.equal(s.body.station.pendingServiceSessionId,null);
  const read=await request('list_experiences',c);assert.equal(read.status,200);const item=read.body.items.find((value:{id:string})=>value.id===x.body.experience.id);assert.equal(item.stations[0].id,s.body.station.id);
});
for(const kind of ['create_experience','update_experience','create_station','update_station']as const)for(const field of ['eventId','experienceId','availability','queueAcceptingEntries','lastQueueOrder']as const)test(`E08.13 PostgreSQL ${kind} não aceita campo interno ${field}`,async()=>{
  const c=await context(),before=await state(c);problem(await request(kind,c,c.admin,{...body(kind),[field]:'forged'}),400,'VALIDATION_ERROR');await assertUnchanged(c,before);
});
for(const status of ['waiting','active','finished','canceled']as const)for(const kind of ['update_event','create_experience','update_experience','update_station']as const)test(`E08.13 PostgreSQL histórico ${status} bloqueia ${kind}`,async()=>{
  const c=await context();await person(c,status);const before=await state(c);problem(await request(kind,c),409,'EVENT_CONFIGURATION_LOCKED');await assertUnchanged(c,before);
});
for(const status of ['waiting','active','finished','canceled']as const)test(`E08.13 PostgreSQL adicionar estação após histórico ${status} preserva filas e serviços`,async()=>{
  const c=await context();await person(c,status);const before=await state(c),r=await request('create_station',c);assert.equal(r.status,201,JSON.stringify(r.body));
  const after=await state(c);assert.deepEqual(after.people,before.people);assert.deepEqual(after.queues,before.queues);assert.deepEqual(after.services,before.services);assert.deepEqual(after.experiences,before.experiences);assert.equal(after.stations.length,before.stations.length+1);
});
for(const kind of ['update_event','update_experience','update_station']as const)test(`E08.13 PostgreSQL ${kind} no-op após histórico não faz UPDATE nem auditoria`,async()=>{
  const c=await context();await person(c,'finished');const before=await state(c),payload=kind==='update_event'?{name:(await event(c)).body.event.name}:kind==='update_experience'?{name:(await pool.query('SELECT name FROM experiences WHERE id=$1',[c.experienceId])).rows[0].name}:{label:(await pool.query('SELECT label FROM stations WHERE id=$1',[c.stationId])).rows[0].label};
  const table=kind==='update_event'?'events':kind==='update_experience'?'experiences':'stations',id=kind==='update_event'?c.eventId:kind==='update_experience'?c.experienceId:c.stationId;
  const version=(await pool.query(`SELECT xmin::text AS version FROM ${table} WHERE id=$1`,[id])).rows[0].version;
  const key=randomUUID(),r=await request(kind,c,c.admin,payload,key);assert.equal(r.status,200,JSON.stringify(r.body));await assertUnchanged(c,before);assert.equal((await actorIntents(c.admin,key)).length,1);
  assert.equal((await pool.query(`SELECT xmin::text AS version FROM ${table} WHERE id=$1`,[id])).rows[0].version,version);
});
test('E08.13 PostgreSQL prontidão dinâmica válida não depende da conexão Staff e não grava estado',async()=>{
  const c=await context();await pool.query("UPDATE events SET status='scheduled' WHERE id=$1",[c.eventId]);
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[c.staff.sessionId]);const before=await state(c),r=await ready(c);
  assert.equal(r.ready,true);assert.deepEqual(r.missing,[]);assert.deepEqual(r.checks,{nameAndAccessCode:true,validScheduleAndTimezone:true,externalQueueConfigured:true,hasExperienceWithAvailableStation:true,hasVerifiedActiveStaff:true});
  assert.equal(r.effectivePhase,'open');assert.equal(r.statusStored,'scheduled');assert.equal(r.acceptingNewParticipations,true);assert.match(r.observedAt,/\.\d{6}Z$/);await assertUnchanged(c,before);
});
for(const defect of ['blank-name','invalid-code','invalid-timezone','unavailable-station','staff-inactive','staff-unverified','staff-revoked']as const)test(`E08.13 PostgreSQL prontidão identifica critério ${defect}`,async()=>{
  let c=await context();
  if(defect==='blank-name')await pool.query("UPDATE events SET name=' ' WHERE id=$1",[c.eventId]);
  if(defect==='invalid-code'){
    // Legado permitido pelo CHECK antigo, mas rejeitado por C-10. Não violar o trigger de imutabilidade por UPDATE.
    const eventId=randomUUID(),experienceId=randomUUID(),stationId=randomUUID(),code=`BAD__${randomUUID().toUpperCase()}`;createdIds.add(eventId);
    await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
      SELECT $1,name,$2,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at FROM events WHERE id=$3`,[eventId,code,c.eventId]);
    await pool.query(`INSERT INTO experiences(id,event_id,name,queue_accepting_entries,created_at,updated_at)
      SELECT $1,$2,name,queue_accepting_entries,created_at,updated_at FROM experiences WHERE id=$3`,[experienceId,eventId,c.experienceId]);
    await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
      SELECT $1,$2,label,availability,created_at,updated_at FROM stations WHERE id=$3`,[stationId,experienceId,c.stationId]);
    await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())",[randomUUID(),c.staff.userId,eventId]);
    c={...c,eventId,experienceId,stationId};
  }
  if(defect==='invalid-timezone')await pool.query("UPDATE events SET timezone='Invalid/Zone' WHERE id=$1",[c.eventId]);
  if(defect==='unavailable-station')assert.equal((await station(c)).status,200);
  if(defect==='staff-inactive')await pool.query('UPDATE users SET is_active=false WHERE id=$1',[c.staff.userId]);
  if(defect==='staff-unverified')await pool.query('UPDATE users SET email_verified_at=NULL WHERE id=$1',[c.staff.userId]);
  if(defect==='staff-revoked')await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='staff' AND event_id=$2",[c.staff.userId,c.eventId]);
  const before=await state(c),r=await ready(c);assert.equal(r.ready,false);assert.equal(r.acceptingNewParticipations,false);assert.equal(r.effectivePhase,'not_ready');assert.ok(r.missing.length>0);
  const key=defect==='blank-name'||defect==='invalid-code'?'nameAndAccessCode':defect==='invalid-timezone'?'validScheduleAndTimezone':defect==='unavailable-station'?'hasExperienceWithAvailableStation':'hasVerifiedActiveStaff';
  assert.equal(r.checks[key],false);
  if(defect==='invalid-code')for(const [criterion,satisfied]of Object.entries(r.checks))if(criterion!=='nameAndAccessCode')assert.equal(satisfied,true);
  await assertUnchanged(c,before);
});
test('E08.13 PostgreSQL fila externa false continua sendo configuração explícita válida',async()=>{
  const actor=await admin(),r=await create(actor,draft({externalQueueEnabled:false}));assert.equal(r.status,201);assert.equal(r.body.event.externalQueueEnabled,false);assert.equal(r.body.event.readiness.checks.externalQueueConfigured,true);
});
test('E08.13 PostgreSQL perda e recuperação de capacidade não fecha evento nem cancela pessoas',async()=>{
  const c=await context(),p=await person(c),before=(await state(c)).people;assert.equal((await station(c)).status,200);assert.equal((await ready(c)).ready,false);assert.deepEqual((await state(c)).people,before);
  const recovered=await supertest(app.getHttpServer()).patch(`/api/v1/staff/events/${c.eventId}/stations/${c.stationId}/availability`).set('Authorization',`Bearer ${c.admin.token}`).send({availability:'available'});assert.equal(recovered.status,200);
  assert.equal((await ready(c)).ready,true);assert.equal((await event(c)).body.event.statusStored,'open');assert.deepEqual((await state(c)).people,before);assert.equal((await pool.query('SELECT status FROM participations WHERE id=$1',[p.participationId])).rows[0].status,'active');
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp() WHERE id=$1",[c.eventId]);const expired=await ready(c);assert.equal(expired.ready,true);assert.equal(expired.effectivePhase,'closed');assert.equal(expired.acceptingNewParticipations,false);
});
test('E08.13 PostgreSQL listagem pagina deterministamente com cursor e filtros estritos',async()=>{
  const c=await context(),a=await create(c.admin),b=await create(c.admin);assert.equal(a.status,201);assert.equal(b.status,201);const sought=new Set([a.body.event.id,b.body.event.id]),seen=new Set<string>();let cursor:string|undefined;
  for(let page=0;page<500;page++){
    const r=await request('list',c).query({limit:'1',...(cursor?{cursor}:{})});assert.equal(r.status,200);assert.ok(r.body.items.length<=1);
    for(const item of r.body.items){assert.equal(seen.has(item.id),false);seen.add(item.id);sought.delete(item.id);}
    if(!r.body.nextCursor)break;assert.notEqual(r.body.nextCursor,cursor);cursor=r.body.nextCursor;
  }
  assert.equal(sought.size,0);
  const filtered=await request('list',c).query({limit:'50',phase:'scheduled',statusStored:'scheduled'});assert.equal(filtered.status,200);for(const item of filtered.body.items){assert.equal(item.effectivePhase,'scheduled');assert.equal(item.statusStored,'scheduled');}
  for(const query of [{limit:'0'},{limit:'51'},{cursor:'%%%'},{phase:'forged'},{statusStored:'forged'},{userId:c.admin.userId},{limit:['1','2']}])problem(await request('list',c).query(query),400,'VALIDATION_ERROR');
});
test('E08.13 PostgreSQL consultas não expõem pessoas/auditoria e mostram pending derivado',async()=>{
  const c=await context(),a=await called(c),before=await state(c);
  for(const kind of ['get_event','readiness','list_experiences','list']as const){const r=await request(kind,c);assert.equal(r.status,200);const serialized=JSON.stringify(r.body);for(const secret of [a.p.userId,c.staff.userId,c.admin.userId,'@example.test','fixture-private-hash','birthDate','passwordHash','sessionId'])assert.equal(serialized.includes(secret),false);}
  const list=await request('list_experiences',c),stationValue=list.body.items.find((x:{id:string})=>x.id===c.experienceId).stations.find((s:{id:string})=>s.id===c.stationId);assert.equal(stationValue.pendingServiceSessionId,a.session);assert.equal(stationValue.availability,'available');await assertUnchanged(c,before);
});
for(const kind of mutations)test(`E08.13 PostgreSQL ${kind} replay histórico após TTL não duplica objeto/auditoria`,async()=>{
  const c=await context(),payload=body(kind),key=randomUUID(),one=await request(kind,c,c.admin,payload,key);assert.equal(one.status,kind.startsWith('create_')?201:200,JSON.stringify(one.body));if(one.body.event?.id&&kind==='create_event')createdIds.add(one.body.event.id);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 hour' WHERE actor_user_id=$1 AND idempotency_key=$2",[c.admin.userId,key]);
  const eventId=kind==='create_event'?one.body.event.id:c.eventId,beforeAudits=await eventAudits(eventId),beforeIntents=await actorIntents(c.admin,key),before=await state(c),two=await request(kind,c,c.admin,payload,key);
  assert.equal(two.status,one.status);assert.deepEqual(two.body,one.body);assert.deepEqual(await eventAudits(eventId),beforeAudits);assert.deepEqual(await actorIntents(c.admin,key),beforeIntents);await assertUnchanged(c,before);
  const changed=kind==='create_station'||kind==='update_station'?{...payload,label:'Outra identificação'}:{...payload,name:'Outra identificação'};problem(await request(kind,c,c.admin,changed,key),409,'IDEMPOTENCY_KEY_REUSED');
});
test('E08.13 PostgreSQL Admins diferentes não compartilham chave e mesma chave não troca de recurso',async()=>{
  const c=await context(),other=await context(),actor=await admin(),key=randomUUID();assert.equal((await request('update_event',c,c.admin,{name:'Nome A'},key)).status,200);assert.equal((await request('update_event',c,actor,{name:'Nome B'},key)).status,200);
  problem(await request('update_event',other,c.admin,{name:'Nome A'},key),409,'IDEMPOTENCY_KEY_REUSED');assert.equal((await actorIntents(c.admin,key)).length,1);assert.equal((await actorIntents(actor,key)).length,1);
});
for(const kind of ['create_experience','update_event','update_experience','update_station']as const)for(const first of ['configuration','admission']as const)test(`E08.13 PostgreSQL ${kind} concorre com primeiro ingresso; vence ${first}`,async()=>{
  const c=await context(),entrant=await readyEntrant();
  if(first==='configuration'){const [one,two]=await ordered(()=>request(kind,c),()=>admit(c,entrant));assert.equal(one.status,kind==='create_experience'?201:200);assert.equal(two.kind,'created');}
  else{const [one,two]=await ordered(()=>admit(c,entrant),()=>request(kind,c));assert.equal(one.kind,'created');problem(two,409,'EVENT_CONFIGURATION_LOCKED');}
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM participations WHERE event_id=$1',[c.eventId])).rows[0].n,1);
});
for(const first of ['station','admission']as const)test(`E08.13 PostgreSQL adição de estação versus ingresso preserva estrutura, vence ${first}`,async()=>{
  const c=await context(),entrant=await readyEntrant();
  if(first==='station'){const [one,two]=await ordered(()=>request('create_station',c),()=>admit(c,entrant));assert.equal(one.status,201);assert.equal(two.kind,'created');}
  else{const [one,two]=await ordered(()=>admit(c,entrant),()=>request('create_station',c));assert.equal(one.kind,'created');assert.equal(two.status,201);}
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM stations WHERE experience_id=$1',[c.experienceId])).rows[0].n,2);
});
for(const first of ['schedule','name']as const)test(`E08.13 PostgreSQL edição genérica versus E08.7 não perde horários, vence ${first}`,async()=>{
  const c=await context(),schedule=await proposal(c),[one,two]=await ordered(()=>first==='schedule'?patch(c,schedule):request('update_event',c,c.admin,{name:'Nome concorrente'}),()=>first==='schedule'?request('update_event',c,c.admin,{name:'Nome concorrente'}):patch(c,schedule));assert.equal(one.status,200);assert.equal(two.status,200);
  const read=(await event(c)).body.event;assert.equal(read.name,'Nome concorrente');assert.equal(Date.parse(read.officialEndsAt),Date.parse(schedule.officialEndsAt));assert.equal(Date.parse(read.operationalDeadlineAt),Date.parse(schedule.operationalDeadlineAt));
});
for(const first of ['close','station']as const)test(`E08.13 PostgreSQL encerramento imediato versus configuração, vence ${first}`,async()=>{
  const c=await context(),[one,two]=await ordered(()=>first==='close'?close(c):request('create_station',c),()=>first==='close'?request('create_station',c):close(c));assert.equal(one.status,first==='close'?200:201);
  if(first==='close')problem(two,409,'EVENT_OPERATION_ENDED');else assert.equal(two.status,200);assert.equal((await event(c)).body.event.effectivePhase,'closed');
});
test('E08.13 PostgreSQL fechamento controlado permite adicionar estação antes do corte sem reabrir evento',async()=>{
  const c=await context(),p=await person(c);assert.equal((await close(c,await controlled())).status,200);const before=await state(c),r=await request('create_station',c);assert.equal(r.status,201);const read=(await event(c)).body.event;assert.equal(read.effectivePhase,'closing');assert.equal(read.acceptingNewParticipations,false);assert.deepEqual((await state(c)).people,before.people);assert.equal((await pool.query('SELECT status FROM participations WHERE id=$1',[p.participationId])).rows[0].status,'active');
});
test('E08.13 PostgreSQL job E08.9 vencido bloqueia configuração e preserva motivo automático',async()=>{
  const c=await context(),p=await person(c);await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp() WHERE id=$1",[c.eventId]);
  const job=app.get((await import('../../src/events/event-closure.service')).EventClosureService),[one,two]=await ordered(()=>job.regularizeEvent(c.eventId),()=>request('create_station',c));assert.equal(one.kind,'closed');problem(two,409,'EVENT_OPERATION_ENDED');assert.equal((await pool.query('SELECT finish_reason FROM participations WHERE id=$1',[p.participationId])).rows[0].finish_reason,'automatic_operational_deadline');
});
test('E08.13 PostgreSQL perda de capacidade E08.5 serializa novo ingresso sem encerrar participantes',async()=>{
  const c=await context(),existing=await person(c),entrant=await readyEntrant(),before=(await state(c)).people;
  const [disabled,admission]=await ordered(()=>station(c),()=>admit(c,entrant));assert.equal(disabled.status,200);assert.equal(admission.kind,'blocked');assert.deepEqual((await state(c)).people,before);
  assert.equal((await ready(c)).ready,false);assert.equal((await pool.query('SELECT status FROM participations WHERE id=$1',[existing.participationId])).rows[0].status,'active');
  const recovered=await supertest(app.getHttpServer()).patch(`/api/v1/staff/events/${c.eventId}/stations/${c.stationId}/availability`).set('Authorization',`Bearer ${c.admin.token}`).send({availability:'available'});assert.equal(recovered.status,200);
  assert.equal((await admit(c,entrant)).kind,'created');assert.equal((await event(c)).body.event.statusStored,'open');
});
for(const grant of [false,true])test(`E08.13 PostgreSQL concessão vigente grant=${grant} e ingresso usam ordem de evento compatível`,async()=>{
  const c=await context(),entrant=await readyEntrant();
  if(grant)await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='staff' AND event_id=$2",[c.staff.userId,c.eventId]);
  const change=()=>database.transaction(async tx=>{
    await tx.execute(sql`SELECT id FROM events WHERE id=${c.eventId}::uuid FOR UPDATE`);
    const changed=await tx.execute(sql`UPDATE user_roles SET revoked_at=${grant?sql`NULL`:sql`clock_timestamp()`}
      WHERE user_id=${c.staff.userId}::uuid AND event_id=${c.eventId}::uuid AND role='staff' RETURNING id`);assert.equal(changed.rows.length,1);return true;
  },{isolationLevel:'read committed'});
  const [one,two]=await ordered(change,()=>admit(c,entrant));assert.equal(one,true);assert.equal(two.kind,grant?'created':'blocked');assert.equal((await ready(c)).ready,grant);
});
for(const loss of ['role','session','account']as const)test(`E08.13 PostgreSQL autorização ${loss} perdida durante espera impede mutação`,async()=>{
  const c=await context(),before=await state(c),r=await lockWait(c,()=>request('update_event',c),async client=>{
    if(loss==='role')await client.query('UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1',[c.admin.roleId]);
    if(loss==='session')await client.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[c.admin.sessionId]);
    if(loss==='account')await client.query('UPDATE users SET is_active=false WHERE id=$1',[c.admin.userId]);
  });
  problem(r,loss==='role'?403:401,loss==='role'?'ADMIN_REQUIRED':loss==='session'?'SESSION_REVOKED':'ACCOUNT_DEACTIVATED');await assertUnchanged(c,before);
});
for(const kind of mutations)for(const phase of ['reserve','object','audit','complete']as const)test(`E08.13 PostgreSQL falha SQL real após ${kind}/${phase} reverte objeto, auditoria e intenção`,async()=>{
  const c=await context(),payload=body(kind),key=randomUUID(),before=await state(c),beforeIntents=await actorIntents(c.admin),client=await pool.connect();
  const table=kind.includes('experience')?'experiences':kind.includes('station')?'stations':'events',objectWrite=new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE)\\s+"?${table}"?\\b`,'i');
  const originalQuery=client.query.bind(client) as (config:string|QueryConfig,params?:unknown[])=>Promise<QueryResult>;let reached=false;
  const proxy=new Proxy(client,{get(target,property){if(property==='query')return async(config:string|QueryConfig,params?:unknown[])=>{
    const result=await originalQuery(config,params),text=typeof config==='string'?config:config.text;
    if(!reached&&((phase==='reserve'&&/insert into "idempotency_operations"/i.test(text))||(phase==='complete'&&/update "idempotency_operations"/i.test(text))
      ||(phase==='audit'&&/\bINSERT\s+INTO\s+"?audit_logs"?\b/i.test(text))||(phase==='object'&&objectWrite.test(text)))){
      assert.ok(result.rowCount===1||result.rows.length===1);
      if(phase==='object')assert.ok(result.rows[0]&&(result.rows[0].writtenId??result.rows[0].id));
      reached=true;await originalQuery('SELECT 1/0');assert.fail('A falha PostgreSQL deveria abortar a transação.');
    }return result;
  };return Reflect.get(target,property,target);}});
  const failing=makeWrites(drizzle(proxy,{schema})),original=writes.mutate.bind(writes);writes.mutate=input=>failing.mutate(input);
  try{
    problem(await request(kind,c,c.admin,payload,key),500,'INTERNAL_SERVER_ERROR');assert.equal(reached,true);await assertUnchanged(c,before);assert.deepEqual(await actorIntents(c.admin),beforeIntents);
    if(kind==='create_event')assert.equal((await pool.query('SELECT count(*)::int AS n FROM events WHERE access_code_normalized=$1',[(payload as {accessCode:string}).accessCode])).rows[0].n,0);
  }finally{writes.mutate=original;client.release();}
  const retry=await request(kind,c,c.admin,payload,key);assert.equal(retry.status,kind.startsWith('create_')?201:200,JSON.stringify(retry.body));if(kind==='create_event')createdIds.add(retry.body.event.id);
});
test('E08.13 PostgreSQL snapshot readiness é coerente durante alteração concorrente de disponibilidade',async()=>{
  const c=await context(),original=database.transaction.bind(database) as typeof database.transaction,dialect=new PgDialect();let readySignal!:()=>void,release!:()=>void,readerPid=0,writerPid=0;
  const availability=app.get((await import('../../src/events/station-availability.service')).StationAvailabilityService);assert.equal(Reflect.get(availability,'database'),database);
  const reached=new Promise<void>(yes=>{readySignal=yes;}),gate=new Promise<void>(yes=>{release=yes;});
  database.transaction=(callback,config)=>original(async tx=>{
    if(config?.isolationLevel==='read committed')writerPid=(await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    const execute=tx.execute.bind(tx);tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{
      const query=args[0],text=typeof query==='string'?query:dialect.sqlToQuery(query.getSQL()).sql,result=await execute(...args);
      if(config?.accessMode==='read only'&&text.includes('WITH observation')){readerPid=(await execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;readySignal();await gate;}return result;
    })as typeof tx.execute;return callback(tx);
  },config);
  const pending=request('readiness',c).then(r=>r);pending.catch(()=>undefined);
  try{await Promise.race([reached,pending.then(()=>{throw Error('Leitura não manteve snapshot.');})]);assert.equal((await station(c)).status,200);assert.ok(readerPid>0&&writerPid>0);assert.notEqual(readerPid,writerPid);
    release();const old=await pending;assert.equal(old.status,200);assert.equal(old.body.ready,true);database.transaction=original;assert.equal((await ready(c)).ready,false);
  }finally{database.transaction=original;release();await Promise.allSettled([pending]);}
});
test('E08.13 PostgreSQL configuração de outro evento não altera filas, serviços e avaliação existentes',async()=>{
  const c=await context(),other=await context(),a=await called(other);assert.equal((await resolve(other,a.session,'complete')).status,200);
  await pool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='voluntary' WHERE id=$1",[a.p.participationId]);
  await pool.query("INSERT INTO evaluations(id,participation_id,rating,submitted_at,updated_at) VALUES($1,$2,5,clock_timestamp(),clock_timestamp())",[randomUUID(),a.p.participationId]);
  const before=await state(other),evaluation=(await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[a.p.participationId])).rows[0].value;
  assert.equal((await request('update_event',c)).status,200);assert.equal((await request('create_experience',c)).status,201);assert.equal((await request('create_station',c)).status,201);
  await assertUnchanged(other,before);assert.deepEqual((await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[a.p.participationId])).rows[0].value,evaluation);
});
for(const kind of mutations)test(`E08.13 PostgreSQL ${kind} in_progress durável segue conflito sem reexecutar`,async()=>{
  const c=await context(),payload=body(kind),key=randomUUID(),input={operation:kind,payload,
    ...(kind==='create_event'?{}:{eventId:c.eventId}),...(kind==='update_experience'||kind==='create_station'||kind==='update_station'?{experienceId:c.experienceId}:{}),...(kind==='update_station'?{stationId:c.stationId}:{})};
  await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()-interval '1 hour')`,[randomUUID(),c.admin.userId,operations[kind],key,fingerprint(input)]);
  const before=await state(c),intentsBefore=await actorIntents(c.admin);problem(await request(kind,c,c.admin,payload,key),409,'IDEMPOTENCY_IN_PROGRESS');await assertUnchanged(c,before);assert.deepEqual(await actorIntents(c.admin),intentsBefore);
});
for(const kind of mutations)test(`E08.13 PostgreSQL ${kind} retry concorrente da mesma chave devolve uma resposta e auditoria`,async()=>{
  const c=await context(),payload=body(kind),key=randomUUID(),beforeAudits=(await eventAudits(c.eventId)).length;
  const [one,two]=await ordered(()=>request(kind,c,c.admin,payload,key),()=>request(kind,c,c.admin,payload,key));assert.equal(one.status,kind.startsWith('create_')?201:200);assert.equal(two.status,one.status);assert.deepEqual(two.body,one.body);
  const eventId=kind==='create_event'?one.body.event.id:c.eventId;if(kind==='create_event')createdIds.add(eventId);
  assert.equal((await eventAudits(eventId)).length,kind==='create_event'?1:beforeAudits+1);assert.equal((await actorIntents(c.admin,key)).length,1);
});
test('E08.13 PostgreSQL replay após fechamento exige autorização atual e não cria outra estação',async()=>{
  const c=await context(),key=randomUUID(),payload={label:'Estação histórica'},one=await request('create_station',c,c.admin,payload,key);assert.equal(one.status,201);
  assert.equal((await close(c)).status,200);const before=await state(c),intentBefore=await actorIntents(c.admin,key),two=await request('create_station',c,c.admin,payload,key);assert.equal(two.status,201);assert.deepEqual(two.body,one.body);await assertUnchanged(c,before);
  problem(await request('create_station',c,c.admin,payload),409,'EVENT_OPERATION_ENDED');await pool.query('UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1',[c.admin.roleId]);problem(await request('create_station',c,c.admin,payload,key),403,'ADMIN_REQUIRED');assert.deepEqual(await actorIntents(c.admin,key),intentBefore);
});
