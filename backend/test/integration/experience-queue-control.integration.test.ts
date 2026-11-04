import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,before,test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle,type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { QueryConfig,QueryResult } from "pg";
import supertest from "supertest";
import * as schema from "../../src/database/schema";
import type { ExperienceQueueControlService,ExperienceQueueControlInput } from "../../src/events/experience-queue-control.service";
import { setup,cleanup,app,pool,database,context,person,queued,called,join,call,resolve,withdraw,station,state,close,controlled,ordered,blocked,lockWait,waitPast,type Context } from "./event-closure-fixture";
import { problem,expire } from "./evaluation-read-fixture";

type Actor={userId:string;sessionId:string;token:string};
let service:ExperienceQueueControlService,makeService:(db:NodePgDatabase<typeof schema>)=>ExperienceQueueControlService;
let fingerprint:typeof import('../../src/events/experience-queue-control.service').experienceQueueControlFingerprint;
let statement:typeof import('../../src/events/experience-queue-control.service').queueAcceptanceStatement;
let operation:string,action:string;
before(async()=>{process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS='60';await setup();const module=await import('../../src/events/experience-queue-control.service');
  service=app.get(module.ExperienceQueueControlService);makeService=db=>new module.ExperienceQueueControlService(db);fingerprint=module.experienceQueueControlFingerprint;
  statement=module.queueAcceptanceStatement;operation=module.EXPERIENCE_QUEUE_CONTROL_OPERATION;action=module.EXPERIENCE_QUEUE_CONTROL_ACTION;
});
after(cleanup);
const path=(c:Context)=>`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/queue`;
const control=(c:Context,acceptingEntries=false,actor:Actor=c.staff,key:string=randomUUID())=>supertest(app.getHttpServer()).patch(path(c)).set('Authorization',`Bearer ${actor.token}`).set('Idempotency-Key',key).send({acceptingEntries});
const get=(actor:Actor,route:string)=>supertest(app.getHttpServer()).get(`/api/v1${route}`).set('Authorization',`Bearer ${actor.token}`);
const finish=(p:Actor&{participationId:string})=>supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/finish`).set('Authorization',`Bearer ${p.token}`).set('Idempotency-Key',randomUUID()).send({});
async function current(c:Context){return (await pool.query(`SELECT queue_accepting_entries AS accepting,last_queue_order::text AS counter,xmin::text AS version,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM experiences WHERE id=$1`,[c.experienceId])).rows[0];}
async function audits(c:Context){return (await pool.query(`SELECT actor_user_id,category,action,metadata,
  to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM audit_logs WHERE event_id=$1 AND action=$2 ORDER BY occurred_at,id`,[c.eventId,action])).rows;}
async function intents(c:Context){return (await pool.query('SELECT to_jsonb(i) AS value FROM idempotency_operations i WHERE actor_user_id=ANY($1::uuid[]) AND operation=$2 ORDER BY id',[[c.staff.userId,c.admin.userId],operation])).rows;}
async function snapshot(c:Context){return {domain:await state(c),intents:await intents(c)};}
function preserve(before:Awaited<ReturnType<typeof state>>,after:Awaited<ReturnType<typeof state>>,experienceId:string){
  const normalized=(value:Awaited<ReturnType<typeof state>>)=>({...value,experiences:(value.experiences??[]).map((x:Record<string,unknown>)=>{
    const row={...x};if(x.id===experienceId){delete row.queue_accepting_entries;delete row.updated_at;}return row;
  }),audits:(value.audits??[]).filter((a:{action:string})=>a.action!==action)});
  assert.deepEqual(normalized(after),normalized(before));
}
async function secondExperience(c:Context):Promise<Context>{
  const x=await supertest(app.getHttpServer()).post(`/api/v1/admin/events/${c.eventId}/experiences`).set('Authorization',`Bearer ${c.admin.token}`).set('Idempotency-Key',randomUUID()).send({name:'Outra experiência E08.14'});assert.equal(x.status,201,JSON.stringify(x.body));
  const s=await supertest(app.getHttpServer()).post(`/api/v1/admin/events/${c.eventId}/experiences/${x.body.experience.id}/stations`).set('Authorization',`Bearer ${c.admin.token}`).set('Idempotency-Key',randomUUID()).send({label:'Outra estação'});assert.equal(s.status,201,JSON.stringify(s.body));
  return {...c,experienceId:x.body.experience.id,stationId:s.body.station.id};
}
// Retém a primeira transação após o lock do evento, inclusive se ela for negar/rollback.
async function atEventLock<A,B>(first:()=>PromiseLike<A>,second:()=>PromiseLike<B>):Promise<[A,B]>{
  const original=database.transaction.bind(database) as typeof database.transaction,dialect=new PgDialect();let ready!:(pid:number)=>void,release!:()=>void;
  const reached=new Promise<number>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});let held=false,a:Promise<A>|undefined,b:Promise<B>|undefined;
  database.transaction=(callback,config)=>original(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{
    const query=args[0],text=typeof query==='string'?query:dialect.sqlToQuery(query.getSQL()).sql,result=await execute(...args);
    if(!held&&/FROM events/i.test(text)&&/FOR (SHARE|UPDATE)/i.test(text)){held=true;ready((await execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);await gate;}return result;
  })as typeof tx.execute;return callback(tx);},config);
  try{a=Promise.resolve(first());a.catch(()=>undefined);const pid=await Promise.race([reached,a.then(()=>{throw Error('Primeiro lock não foi retido.');})]);database.transaction=original;
    b=Promise.resolve(second());b.catch(()=>undefined);await blocked(pid);release();return await Promise.all([a,b]);
  }finally{database.transaction=original;release();await Promise.allSettled([a,b]);}
}

for(const actor of ['staff','admin']as const)for(const accepting of [false,true])test(`E08.14 PostgreSQL ${actor} define ${accepting} sem modificar operação existente`,async()=>{
  const c=await context(),other=await secondExperience(c),a=await called(c);await queued(c);await queued(other);
  if(accepting)assert.equal((await control(c,false,c.admin)).status,200);const before=await state(c),counter=(await current(c)).counter,r=await control(c,accepting,c[actor]);
  assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{eventId:c.eventId,experienceId:c.experienceId,queueAcceptingEntries:accepting,changedAt:r.body.changedAt});assert.match(r.body.changedAt,/\.\d{6}Z$/);
  assert.equal((await current(c)).at,r.body.changedAt);assert.equal((await current(c)).counter,counter);assert.equal((await current(other)).accepting,true);preserve(before,await state(c),c.experienceId);
  const history=await audits(c),audit=history.at(-1)!;assert.equal(audit.actor_user_id,c[actor].userId);assert.equal(audit.at,r.body.changedAt);assert.equal(audit.category,'experience');
  assert.deepEqual(audit.metadata,{experienceId:c.experienceId,before:{queueAcceptingEntries:!accepting},after:{queueAcceptingEntries:accepting}});
  assert.equal((await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0].status,'pending');
});
for(const defect of ['other-event','revoked-role','unverified','inactive','revoked-session','expired-session','admin-no-2fa','both-no-2fa','admin-revoked','participant']as const)
test(`E08.14 PostgreSQL autorização real ${defect} não altera fila`,async()=>{
  const c=await context();let actor:Actor=c.staff;
  if(defect==='other-event')actor=(await context()).staff;
  if(defect==='revoked-role')await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND event_id=$2 AND role='staff'",[actor.userId,c.eventId]);
  if(defect==='unverified')await pool.query('UPDATE users SET email_verified_at=NULL WHERE id=$1',[actor.userId]);
  if(defect==='inactive')await pool.query('UPDATE users SET is_active=false WHERE id=$1',[actor.userId]);
  if(defect==='revoked-session')await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[actor.sessionId]);
  if(defect==='expired-session')await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[actor.sessionId]);
  if(defect==='admin-no-2fa'||defect==='both-no-2fa'){actor=c.admin;if(defect==='both-no-2fa')await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())",[randomUUID(),actor.userId,c.eventId]);await pool.query('UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1',[actor.sessionId]);}
  if(defect==='admin-revoked'){actor=c.admin;await pool.query('UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1',[c.admin.roleId]);}
  if(defect==='participant')actor=await person(c);
  const before=await snapshot(c),r=await control(c,false,actor);
  const code=defect==='inactive'?'ACCOUNT_DEACTIVATED':defect==='revoked-session'?'SESSION_REVOKED':defect==='expired-session'?'SESSION_EXPIRED':defect.endsWith('no-2fa')?'ADMIN_2FA_REQUIRED':'RESOURCE_NOT_FOUND';
  problem(r,code==='RESOURCE_NOT_FOUND'?404:401,code);assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL exige Bearer e não confunde recurso ausente com experiência de outro evento',async()=>{
  const c=await context(),other=await context(),before=await snapshot(c);problem(await control(c).unset('Authorization'),401,'MISSING_ACCESS_TOKEN');
  const a=await control({...c,experienceId:other.experienceId}),b=await control({...c,experienceId:randomUUID()});problem(a,404,'RESOURCE_NOT_FOUND');assert.deepEqual(a.body,b.body);assert.deepEqual(await snapshot(c),before);
});
for(const field of ['eventId','experienceId']as const)test(`E08.14 PostgreSQL UUID ${field} inválido é 400`,async()=>{
  const c=await context(),before=await snapshot(c);problem(await control({...c,[field]:'invalid'}),400,'VALIDATION_ERROR');assert.deepEqual(await snapshot(c),before);
});
for(const body of [{},{acceptingEntries:null},{acceptingEntries:'false'},{acceptingEntries:0},{acceptingEntries:false,userId:'forged'},{acceptingEntries:false,reason:'forged'},[]])
test(`E08.14 PostgreSQL payload estrito ${JSON.stringify(body)} não gera intenção`,async()=>{
  const c=await context(),before=await snapshot(c);problem(await supertest(app.getHttpServer()).patch(path(c)).set('Authorization',`Bearer ${c.staff.token}`).set('Idempotency-Key',randomUUID()).send(body),400,'VALIDATION_ERROR');assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL chave obrigatória/única e JSON malformado mantêm estado',async()=>{
  const c=await context(),before=await snapshot(c);problem(await control(c).unset('Idempotency-Key'),400,'VALIDATION_ERROR');problem(await control(c,false,c.staff,'x'.repeat(129)),400,'VALIDATION_ERROR');
  problem(await control(c).set({'Idempotency-Key':['a','b']}),400,'VALIDATION_ERROR');problem(await supertest(app.getHttpServer()).patch(path(c)).set('Authorization',`Bearer ${c.staff.token}`).set('Idempotency-Key',randomUUID()).type('json').send('{bad'),400,'BAD_REQUEST');assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL Admin global não ganha chamadas/resoluções/leitura exclusivas Staff',async()=>{
  const c=await context(),a=await called(c);assert.equal((await control(c,false,c.admin)).status,200);problem(await get(c.admin,path(c).replace('/api/v1','')),404,'RESOURCE_NOT_FOUND');
  const routes=[`/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`,...['complete','absent'].map(action=>`/staff/events/${c.eventId}/service-sessions/${a.session}/${action}`)];
  for(const route of routes)problem(await supertest(app.getHttpServer()).post(`/api/v1${route}`).set('Authorization',`Bearer ${c.admin.token}`).set('Idempotency-Key',randomUUID()).send({}),403,'STAFF_EVENT_FORBIDDEN');
  assert.equal((await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0].status,'pending');
});
for(const status of ['waiting','active','finished','canceled']as const)test(`E08.14 PostgreSQL histórico ${status} não bloqueia configuração operacional`,async()=>{
  const c=await context();await person(c,status);const before=await state(c);assert.equal((await control(c)).status,200);preserve(before,await state(c),c.experienceId);
});
test('E08.14 PostgreSQL três GETs refletem flag sem alterar prontidão global ou FIFO',async()=>{
  const c=await context(),a=await queued(c),before=await state(c);assert.equal((await control(c)).status,200);
  const staff=await get(c.staff,path(c).replace('/api/v1',''));assert.equal(staff.status,200);assert.equal(staff.body.acceptingNewEntries,false);assert.equal(staff.body.canCallWaitingEntries,true);assert.equal(staff.body.waitingCount,1);assert.equal(staff.body.firstWaitingQueueEntryId,a.entry);
  const participant=await get(a.p,`/events/${c.eventId}/experiences`);assert.equal(participant.status,200);assert.equal(participant.body.experiences.find((x:{id:string})=>x.id===c.experienceId).acceptingNewQueueEntries,false);
  const admin=await get(c.admin,`/admin/events/${c.eventId}/experiences`);assert.equal(admin.status,200);assert.equal(admin.body.items.find((x:{id:string})=>x.id===c.experienceId).queueAcceptingEntries,false);
  assert.equal((await get(c.admin,`/admin/events/${c.eventId}/readiness`)).body.ready,true);preserve(before,await state(c),c.experienceId);
});
test('E08.14 PostgreSQL pausa impede ingresso e reabertura válida permite nova intenção sem reiniciar contador',async()=>{
  const c=await context(),p=await person(c),old=await current(c);assert.equal((await control(c)).status,200);assert.equal((await join(c,p)).kind,'queue_closed');assert.equal((await current(c)).counter,old.counter);
  assert.equal((await control(c,true)).status,200);const r=await join(c,p);assert.equal(r.kind,'created');if(r.kind!=='created')assert.fail();assert.equal(BigInt(r.queueOrder),BigInt(old.counter)+1n);
});
for(const condition of ['unavailable-station','no-staff','occupied-pointer']as const)test(`E08.14 PostgreSQL reabertura não supera ${condition}`,async()=>{
  const c=await context();if(condition==='unavailable-station')await secondExperience(c);const p=await person(c);if(condition==='occupied-pointer')assert.equal((await join(c,p)).kind,'created');
  assert.equal((await control(c)).status,200);
  if(condition==='unavailable-station')assert.equal((await station(c)).status,200);
  if(condition==='no-staff')await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND event_id=$2 AND role='staff'",[c.staff.userId,c.eventId]);
  assert.equal((await control(c,true,c.admin)).status,200);const expected=condition==='unavailable-station'?'experience_unavailable':condition==='no-staff'?'event_unavailable':'queue_occupied';assert.equal((await join(c,p)).kind,expected);
});
for(const role of ['staff','admin']as const)test(`E08.14 PostgreSQL ${role} configura antes do início sem abrir evento`,async()=>{
  const c=await context();await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '1 hour',official_ends_at=clock_timestamp()+interval '2 hours',operational_deadline_at=clock_timestamp()+interval '150 minutes' WHERE id=$1",[c.eventId]);
  assert.equal((await control(c,false,c[role])).status,200);assert.equal((await get(c.admin,`/admin/events/${c.eventId}/readiness`)).body.acceptingNewParticipations,false);
});
for(const phase of ['official','controlled']as const)test(`E08.14 PostgreSQL configuração residual ${phase} não reabre ingressos nem impede chamada existente`,async()=>{
  const c=await context(),a=await queued(c),p=await person(c);
  if(phase==='official')await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[c.eventId]);
  else assert.equal((await close(c,await controlled())).status,200);
  assert.equal((await control(c)).status,200);assert.equal((await control(c,true)).status,200);assert.equal((await join(c,p)).kind,'event_closed');
  const read=await get(c.staff,path(c).replace('/api/v1',''));assert.equal(read.body.acceptingNewEntries,false);assert.equal(read.body.canCallWaitingEntries,true);
  const called=await call(c);assert.equal(called.status,201,JSON.stringify(called.body));assert.equal((await pool.query('SELECT participation_id FROM queue_entries WHERE id=$1',[a.entry])).rows[0].participation_id,a.p.participationId);
});
for(const first of ['join','pause']as const)test(`E08.14 PostgreSQL pausa versus ingresso; vence ${first}`,async()=>{
  const c=await context(),p=await person(c);
  if(first==='join'){const [one,two]=await ordered(()=>join(c,p),()=>control(c));assert.equal(one.kind,'created');assert.equal(two.status,200);if(one.kind!=='created')assert.fail();
    const q=(await pool.query('SELECT status FROM queue_entries WHERE id=$1',[one.queueEntryId])).rows[0];assert.equal(q.status,'waiting');assert.equal((await pool.query('SELECT current_queue_entry_id AS id FROM participations WHERE id=$1',[p.participationId])).rows[0].id,one.queueEntryId);
  }else{const [one,two]=await ordered(()=>control(c),()=>join(c,p));assert.equal(one.status,200);assert.equal(two.kind,'queue_closed');assert.equal((await pool.query('SELECT count(*)::int AS n FROM queue_entries WHERE participation_id=$1',[p.participationId])).rows[0].n,0);}
});
for(const first of ['join','reopen']as const)test(`E08.14 PostgreSQL reabertura versus ingresso; primeiro ${first}`,async()=>{
  const c=await context(),p=await person(c);assert.equal((await control(c)).status,200);
  if(first==='join'){const [one,two]=await atEventLock(()=>join(c,p),()=>control(c,true));assert.equal(one.kind,'queue_closed');assert.equal(two.status,200);assert.equal((await join(c,p)).kind,'created');}
  else{const [one,two]=await ordered(()=>control(c,true),()=>join(c,p));assert.equal(one.status,200);assert.equal(two.kind,'created');}
});
for(const other of ['call','complete','absent','withdraw','finish','station','close']as const)for(const first of ['pause','other']as const)
test(`E08.14 PostgreSQL pausa versus ${other}; primeiro ${first}`,async()=>{
  const c=await context(),a=other==='call'||other==='station'?{...await queued(c),session:undefined}:await called(c);
  const execute=()=>other==='call'?call(c):other==='complete'||other==='absent'?resolve(c,a.session!,other):other==='withdraw'?withdraw(c,a.p,a.entry):other==='finish'?finish(a.p):other==='station'?station(c):close(c);
  const [one,two]=await ordered(()=>first==='pause'?control(c):execute(),()=>first==='pause'?execute():control(c));
  const paused=first==='pause'?one:two,operated=first==='pause'?two:one;
  assert.equal(operated.status,other==='call'?201:200,JSON.stringify(operated.body));
  if(other==='close'&&first==='other'){problem(paused,409,'EVENT_OPERATION_ENDED');assert.equal((await current(c)).accepting,true);}else{assert.equal(paused.status,200,JSON.stringify(paused.body));assert.equal((await current(c)).accepting,false);}
  if(other==='call')assert.equal((await pool.query('SELECT status FROM service_sessions WHERE queue_entry_id=$1',[a.entry])).rows[0].status,'pending');
  if(other==='complete')assert.equal((await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0].status,'completed');
  if(other==='absent'){
    assert.equal(operated.body.requeued,first==='other');const sessions=(await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0];assert.equal(sessions.status,'absent');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM queue_entries WHERE participation_id=$1 AND status='waiting'",[a.p.participationId])).rows[0].n,first==='other'?1:0);
  }
  if(other==='withdraw'||other==='finish')assert.equal((await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0].status,'canceled');
  if(other==='station')assert.equal((await pool.query('SELECT availability FROM stations WHERE id=$1',[c.stationId])).rows[0].availability,'unavailable');
});
for(const first of ['pause','reopen']as const)test(`E08.14 PostgreSQL dois operadores serializam ${first} e decisão oposta`,async()=>{
  const c=await context();if(first==='reopen')assert.equal((await control(c)).status,200);const before=(await audits(c)).length;
  const desired=first==='reopen',[one,two]=await ordered(()=>control(c,desired,c.staff),()=>control(c,!desired,c.admin));assert.equal(one.status,200);assert.equal(two.status,200);assert.equal((await current(c)).accepting,!desired);assert.equal((await audits(c)).length,before+2);
});
for(const same of [false,true])test(`E08.14 PostgreSQL retries concorrentes chave ${same?'igual':'distinta'} não duplicam UPDATE/auditoria`,async()=>{
  const c=await context(),key=randomUUID(),[one,two]=await ordered(()=>control(c,false,c.staff,key),()=>control(c,false,c.staff,same?key:randomUUID()));assert.equal(one.status,200);assert.equal(two.status,200);
  if(same)assert.deepEqual(one.body,two.body);else assert.deepEqual(two.body,{eventId:c.eventId,experienceId:c.experienceId,queueAcceptingEntries:false});
  assert.equal((await current(c)).at,one.body.changedAt);assert.equal((await audits(c)).length,1);assert.equal((await intents(c)).length,same?1:2);
});
test('E08.14 PostgreSQL retry antigo não desfaz reabertura e conflito mantém decisão posterior',async()=>{
  const c=await context(),other=await secondExperience(c),key=randomUUID(),old=await control(c,false,c.staff,key);assert.equal(old.status,200);
  assert.equal((await control(c,true,c.admin)).status,200);const before=await snapshot(c),version=await current(c),retry=await control(c,false,c.staff,key);assert.equal(retry.status,200);assert.deepEqual(retry.body,old.body);
  assert.deepEqual(await snapshot(c),before);assert.deepEqual(await current(c),version);problem(await control(c,true,c.staff,key),409,'IDEMPOTENCY_KEY_REUSED');problem(await control(other,false,c.staff,key),409,'IDEMPOTENCY_KEY_REUSED');assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL retry de no-op histórico também não reverte decisão posterior',async()=>{
  const c=await context(),key=randomUUID(),noop=await control(c,true,c.staff,key);assert.equal(noop.status,200);assert.equal(Object.hasOwn(noop.body,'changedAt'),false);
  assert.equal((await control(c,false,c.admin)).status,200);const before=await snapshot(c),version=await current(c);assert.deepEqual((await control(c,true,c.staff,key)).body,noop.body);assert.deepEqual(await snapshot(c),before);assert.deepEqual(await current(c),version);
});
test('E08.14 PostgreSQL mesmo texto de chave entre atores não compartilha intenção',async()=>{
  const c=await context(),key=randomUUID();assert.equal((await control(c,false,c.staff,key)).status,200);assert.equal((await control(c,true,c.admin,key)).status,200);assert.equal((await current(c)).accepting,true);assert.equal((await audits(c)).length,2);assert.equal((await intents(c)).length,2);
});
for(const desired of [false,true])test(`E08.14 PostgreSQL TTL vencido e fechamento preservam replay ${desired} e no-op sem timestamp`,async()=>{
  const c=await context();if(desired)assert.equal((await control(c)).status,200);const key=randomUUID(),first=await control(c,desired,c.staff,key);assert.equal(first.status,200);
  await pool.query('UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval \'1 hour\' WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3',[c.staff.userId,operation,key]);assert.equal((await close(c)).status,200);
  const before=await snapshot(c),version=await current(c),r=await control(c,desired,c.staff,key);assert.equal(r.status,200);assert.deepEqual(r.body,first.body);assert.deepEqual(await snapshot(c),before);assert.deepEqual(await current(c),version);
  const beforeAudits=await audits(c),noop=await control(c,desired);assert.equal(noop.status,200);assert.equal(Object.hasOwn(noop.body,'changedAt'),false);assert.deepEqual(await current(c),version);assert.deepEqual(await audits(c),beforeAudits);
  const snapshotAfterNoop=await snapshot(c);problem(await control(c,!desired),409,'EVENT_OPERATION_ENDED');assert.deepEqual(await snapshot(c),snapshotAfterNoop);
});
for(const actor of ['staff','admin']as const)test(`E08.14 PostgreSQL replay ${actor} exige autorização atual`,async()=>{
  const c=await context(),key=randomUUID();assert.equal((await control(c,false,c[actor],key)).status,200);
  await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role=$2 AND (event_id=$3 OR event_id IS NULL)",[c[actor].userId,actor,c.eventId]);const before=await snapshot(c);
  problem(await control(c,false,c[actor],key),404,'RESOURCE_NOT_FOUND');assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL intenção in_progress persistida não é reexecutada após TTL',async()=>{
  const c=await context(),key=randomUUID();await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()-interval '1 hour')`,[randomUUID(),c.staff.userId,operation,key,fingerprint(c.eventId,c.experienceId,false)]);
  const before=await snapshot(c);problem(await control(c,false,c.staff,key),409,'IDEMPOTENCY_IN_PROGRESS');assert.deepEqual(await snapshot(c),before);
});
for(const actor of ['staff','admin']as const)for(const first of ['revoke','control']as const)test(`E08.14 PostgreSQL revogação ${actor} versus alteração, primeiro ${first}`,async()=>{
  const c=await context(),revoke=()=>database.transaction(async tx=>{await tx.execute(sql`SELECT id FROM events WHERE id=${c.eventId}::uuid FOR UPDATE`);
    const rows=(await tx.execute(sql`UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=${c[actor].userId}::uuid AND role=${actor}::varchar(20)
      AND (event_id=${c.eventId}::uuid OR event_id IS NULL) RETURNING id`)).rows;assert.equal(rows.length,1);return true;},{isolationLevel:'read committed'});
  if(first==='revoke'){const [one,two]=await ordered(revoke,()=>control(c,false,c[actor]));assert.equal(one,true);problem(two,404,'RESOURCE_NOT_FOUND');assert.equal((await current(c)).accepting,true);}
  else{const [one,two]=await ordered(()=>control(c,false,c[actor]),revoke);assert.equal(one.status,200);assert.equal(two,true);assert.equal((await current(c)).accepting,false);problem(await control(c,true,c[actor]),404,'RESOURCE_NOT_FOUND');}
});
for(const loss of ['role','verified','inactive','revoked','expired']as const)test(`E08.14 PostgreSQL perda de ${loss} enquanto aguarda lock é revalidada`,async()=>{
  const c=await context(),before=await snapshot(c),r=await lockWait(c,()=>control(c),async client=>{
    if(loss==='role')await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND event_id=$2 AND role='staff'",[c.staff.userId,c.eventId]);
    if(loss==='verified')await client.query('UPDATE users SET email_verified_at=NULL WHERE id=$1',[c.staff.userId]);
    if(loss==='inactive')await client.query('UPDATE users SET is_active=false WHERE id=$1',[c.staff.userId]);
    if(loss==='revoked')await client.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[c.staff.sessionId]);
    if(loss==='expired')await client.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.staff.sessionId]);
  });const code=loss==='inactive'?'ACCOUNT_DEACTIVATED':loss==='revoked'?'SESSION_REVOKED':loss==='expired'?'SESSION_EXPIRED':'RESOURCE_NOT_FOUND';problem(r,code==='RESOURCE_NOT_FOUND'?404:401,code);assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL Admin perde confirmação 2FA durante espera e não altera experiência',async()=>{
  const c=await context(),before=await snapshot(c),r=await lockWait(c,()=>control(c,false,c.admin),async client=>{
    await client.query('UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1',[c.admin.sessionId]);
  });problem(r,401,'ADMIN_2FA_REQUIRED');assert.deepEqual(await snapshot(c),before);
});
for(const boundary of ['operational','administrative']as const)for(const offset of [-1,0,1])test(`E08.14 PostgreSQL UPDATE no corte ${boundary} ${offset} microssegundo`,async()=>{
  const c=await context();if(boundary==='operational')await expire(c);else await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp() WHERE id=$1",[c.eventId]);
  const input:ExperienceQueueControlInput={...c.staff,eventId:c.eventId,experienceId:c.experienceId,acceptingEntries:false,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+60000)},marker=new Error('ROLLBACK_BOUNDARY');const before=await current(c);
  try{await database.transaction(async tx=>{await tx.execute(sql`SELECT id FROM events WHERE id=${c.eventId}::uuid FOR UPDATE`);await tx.execute(sql`SELECT id FROM experiences WHERE id=${c.experienceId}::uuid FOR UPDATE`);
    const at=sql`(SELECT LEAST(operational_deadline_at,admin_deadline_at)+${offset}::int*interval '1 microsecond' FROM events WHERE id=${c.eventId}::uuid)`,rows=(await tx.execute<{changedAt:string}>(statement(input,true,false,at))).rows;
    assert.equal(rows.length,offset<0?1:0);if(rows.length){assert.match(rows[0].changedAt,/\.\d{6}Z$/);assert.equal((await tx.execute<{at:string}>(sql`SELECT to_char(${at} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows[0].at,rows[0].changedAt);}throw marker;
  },{isolationLevel:'read committed'});}catch(error){assert.equal(error,marker);}assert.deepEqual(await current(c),before);
});
test('E08.14 PostgreSQL corte definitivo atravessado enquanto aguarda evento não muda flag',async()=>{
  const c=await context(),at=(await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '5 seconds' WHERE id=$1
    RETURNING to_char(operational_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[c.eventId])).rows[0].at,before=await snapshot(c);
  const r=await lockWait(c,()=>control(c),async(_client,pid)=>{await waitPast(at,pid);});problem(r,409,'EVENT_OPERATION_ENDED');assert.deepEqual(await snapshot(c),before);
});
test('E08.14 PostgreSQL expiração durante espera na sessão não usa horário anterior ao lock',async()=>{
  const c=await context(),client=await pool.connect();const at=(await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '5 seconds' WHERE id=$1
    RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[c.staff.sessionId])).rows[0].at,before=await snapshot(c);let pending:Promise<supertest.Response>|undefined;
  try{await client.query('BEGIN');await client.query('SELECT id FROM sessions WHERE id=$1 FOR UPDATE',[c.staff.sessionId]);const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=control(c).then(r=>r);pending.catch(()=>undefined);await blocked(pid);await waitPast(at,pid);await client.query('COMMIT');problem(await pending,401,'SESSION_EXPIRED');
  }finally{await client.query('ROLLBACK');client.release();await Promise.allSettled([pending]);}assert.deepEqual(await snapshot(c),before);
});
for(const first of ['job','pause']as const)test(`E08.14 PostgreSQL pausa versus job automático, primeiro ${first}`,async()=>{
  const c=await context(),job=app.get((await import('../../src/events/event-closure.service')).EventClosureService);await called(c);
  if(first==='job'){await expire(c);const [one,two]=await ordered(()=>job.regularizeEvent(c.eventId),()=>control(c));assert.equal(one.kind,'closed');problem(two,409,'EVENT_OPERATION_ENDED');}
  else{const at=(await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '5 seconds' WHERE id=$1
    RETURNING to_char(operational_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[c.eventId])).rows[0].at;
    const [one,two]=await ordered(()=>control(c),()=>job.regularizeEvent(c.eventId),pid=>waitPast(at,pid));assert.equal(one.status,200);assert.equal(two.kind,'closed');assert.equal((await current(c)).accepting,false);}
});
for(const actor of ['staff','admin']as const)for(const phase of ['reserve','update','audit','complete']as const)test(`E08.14 PostgreSQL falha SQL real após ${phase} de ${actor} reverte e permite retry`,async()=>{
  const c=await context(),key=randomUUID(),before=await snapshot(c),client=await pool.connect(),native=client.query.bind(client) as (query:string|QueryConfig,params?:unknown[])=>Promise<QueryResult>;let reached=false;
  const proxy=new Proxy(client,{get(target,property){if(property==='query')return async(query:string|QueryConfig,params?:unknown[])=>{const result=await native(query,params),text=typeof query==='string'?query:query.text;
    if(!reached&&((phase==='reserve'&&text.includes('insert into "idempotency_operations"'))||(phase==='complete'&&text.includes('update "idempotency_operations"'))||(phase==='update'&&text.startsWith('WITH decision'))||(phase==='audit'&&text.startsWith('INSERT INTO audit_logs')))){
      assert.equal(result.rows.length,1);if(phase==='update')assert.match(result.rows[0].changedAt,/\.\d{6}Z$/);reached=true;await native('SELECT 1/0');assert.fail('A falha SQL deveria abortar.');}return result;
  };return Reflect.get(target,property,target);}}),failing=makeService(drizzle(proxy,{schema})),original=service.setAcceptance.bind(service);service.setAcceptance=input=>failing.setAcceptance(input);
  try{problem(await control(c,false,c[actor],key),500,'INTERNAL_SERVER_ERROR');assert.equal(reached,true);assert.deepEqual(await snapshot(c),before);}finally{service.setAcceptance=original;client.release();}
  assert.equal((await control(c,false,c[actor],key)).status,200);assert.equal((await audits(c)).length,1);
});
test('E08.14 PostgreSQL snapshot GET Staff mantém posição/chamada coerentes durante pausa',async()=>{
  const c=await context(),a=await queued(c),original=database.transaction.bind(database) as typeof database.transaction,dialect=new PgDialect();let ready!:()=>void,release!:()=>void,readerPid=0,writerPid=0;
  const reached=new Promise<void>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});database.transaction=(callback,config)=>original(async tx=>{
    if(config?.isolationLevel==='read committed')writerPid=(await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;const execute=tx.execute.bind(tx);
    tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{const query=args[0],text=typeof query==='string'?query:dialect.sqlToQuery(query.getSQL()).sql,result=await execute(...args);
      if(config?.accessMode==='read only'&&text.includes('WITH waiting AS')){readerPid=(await execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;ready();await gate;}return result;
    })as typeof tx.execute;return callback(tx);
  },config);const pending=get(c.staff,path(c).replace('/api/v1','')).then(r=>r);pending.catch(()=>undefined);
  try{await Promise.race([reached,pending.then(()=>{throw Error('Snapshot não foi mantido.');})]);assert.equal((await control(c)).status,200);assert.ok(readerPid>0&&writerPid>0);assert.notEqual(readerPid,writerPid);release();const old=await pending;assert.equal(old.body.acceptingNewEntries,true);assert.equal(old.body.canCallWaitingEntries,true);assert.equal(old.body.firstWaitingQueueEntryId,a.entry);
    database.transaction=original;const next=await get(c.staff,path(c).replace('/api/v1',''));assert.equal(next.body.acceptingNewEntries,false);assert.equal(next.body.canCallWaitingEntries,true);assert.equal(next.body.waitingCount,1);assert.equal(next.body.firstWaitingQueueEntryId,a.entry);
  }finally{database.transaction=original;release();await Promise.allSettled([pending]);}
});
test('E08.14 PostgreSQL avaliações próprias, outro evento e elegibilidade permanecem intactos',async()=>{
  const c=await context(),own=await called(c);assert.equal((await resolve(c,own.session,'complete')).status,200);assert.equal((await finish(own.p)).status,200);
  const submitted=await supertest(app.getHttpServer()).post(`/api/v1/participations/${own.p.participationId}/evaluation`).set('Authorization',`Bearer ${own.p.token}`).set('Idempotency-Key',randomUUID()).send({rating:5});assert.equal(submitted.status,201,JSON.stringify(submitted.body));
  const ownEvaluation=(await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[own.p.participationId])).rows[0].value;
  const eligibility=await get(own.p,`/participations/${own.p.participationId}/evaluation-eligibility`);assert.equal(eligibility.status,200);
  const other=await context(),a=await called(other);assert.equal((await resolve(other,a.session,'complete')).status,200);assert.equal((await finish(a.p)).status,200);
  await pool.query('INSERT INTO evaluations(id,participation_id,rating,submitted_at,updated_at) VALUES($1,$2,5,clock_timestamp(),clock_timestamp())',[randomUUID(),a.p.participationId]);
  const before=await snapshot(other),evaluation=(await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[a.p.participationId])).rows[0].value;
  assert.equal((await control(c)).status,200);assert.deepEqual(await snapshot(other),before);assert.deepEqual((await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[a.p.participationId])).rows[0].value,evaluation);
  assert.deepEqual((await pool.query('SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1',[own.p.participationId])).rows[0].value,ownEvaluation);
  const after=await get(own.p,`/participations/${own.p.participationId}/evaluation-eligibility`);assert.equal(after.status,200);assert.deepEqual(after.body,eligibility.body);
});
