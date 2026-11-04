import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { QueryConfig, QueryResult } from "pg";
import supertest from "supertest";
import * as schema from "../../src/database/schema";
import type { ParticipationLifecycleService } from "../../src/participations/participation-lifecycle.service";
import type { ParticipationProjectionRow } from "../../src/participations/participation-query.service";
import { setup, cleanup, app, pool, database, context, account, person, readyEntrant, admit, queued, called, join, call, resolve, withdraw,
  external, station, state, close, controlled, ordered, lockWait, waitPast } from "./event-closure-fixture";
import { participant, service, ownState, get, problem, expire, type Actor } from "./evaluation-read-fixture";

let writes:ParticipationLifecycleService,makeWrites:(db:NodePgDatabase<typeof schema>)=>ParticipationLifecycleService;
let participationProjection:typeof import("../../src/participations/participation-query.service").participationProjection;
let publicParticipation:typeof import("../../src/participations/participation-query.service").publicParticipation;
let fingerprint:typeof import("../../src/participations/participation-lifecycle.service").lifecycleFingerprint;
before(async()=>{
  process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS="60";await setup();
  const module=await import("../../src/participations/participation-lifecycle.service");writes=app.get(module.ParticipationLifecycleService);
  makeWrites=db=>new module.ParticipationLifecycleService(db);fingerprint=module.lifecycleFingerprint;
  const queries=await import("../../src/participations/participation-query.service");participationProjection=queries.participationProjection;publicParticipation=queries.publicParticipation;
});
after(cleanup);
type Person=Actor&{participationId:string};
const mutate=(mode:"cancel"|"finish",p:Person,key:string=randomUUID(),body?:object,actor:Actor=p)=>{
  const r=supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/${mode}`).set('Authorization',`Bearer ${actor.token}`).set('Idempotency-Key',key);
  return body===undefined?r:r.send(body);
};
const detail=(p:Person,actor:Actor=p)=>get(actor,`/participations/${p.participationId}`);
async function persisted(p:Person){return (await pool.query(`SELECT id,status,current_queue_entry_id,finish_reason,
  to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS finished FROM participations WHERE id=$1`,[p.participationId])).rows[0];}
async function intents(p:Person){return (await pool.query("SELECT * FROM idempotency_operations WHERE actor_user_id=$1 ORDER BY id",[p.userId])).rows;}
async function closure(){return app.get((await import("../../src/events/event-closure.service")).EventClosureService);}

test("E08.12 PostgreSQL current ausente é 200/null e não impede pending/return-state",async()=>{
  const c=await context(),actor=await account(),p=await participant(c,{actor});await service(c,p.participationId);const before=await ownState(c,p);
  assert.deepEqual((await get(actor,'/participations/current')).body,{participation:null});
  assert.equal((await get(actor,'/evaluations/pending')).body.items[0].participationId,p.participationId);
  assert.ok((await get(actor,'/participations/return-state')).body.pendingEvaluationParticipationIds.includes(p.participationId));
  assert.deepEqual(await ownState(c,p),before);
});
for(const status of ["waiting","active","finished","canceled"]as const)test(`E08.12 PostgreSQL detalhe ${status} preserva histórico, privacidade e microssegundos`,async()=>{
  const c=await context(),p=await person(c,status),before=await ownState(c,p),r=await detail(p);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.participation.id,p.participationId);assert.equal(r.body.participation.status,status);assert.match(r.body.participation.joinedAt,/\.\d{6}Z$/);
  if(status==='waiting')assert.equal(r.body.participation.externalQueue.position,1);else assert.equal(r.body.participation.externalQueue,null);
  if(status==='finished'||status==='canceled')assert.equal(r.body.participation.finishReason,'fixture_terminal');
  assert.equal(JSON.stringify(r.body).includes(p.userId),false);assert.equal(JSON.stringify(r.body).includes('@example.test'),false);assert.deepEqual(await ownState(c,p),before);
  const current=await get(p,'/participations/current');assert.equal(current.status,200);assert.equal(current.body.participation?.id,status==='waiting'||status==='active'?p.participationId:undefined);
});
test("E08.12 PostgreSQL posição externa deriva de ordens bigint e muda após cancelamento",async()=>{
  const c=await context(),a=await person(c,'waiting'),b=await person(c,'waiting'),p=await person(c,'waiting'),before=await persisted(p);
  assert.equal((await detail(p)).body.participation.externalQueue.position,3);assert.equal((await mutate('cancel',a)).status,200);
  assert.equal((await detail(p)).body.participation.externalQueue.position,2);assert.equal((await detail(b)).body.participation.externalQueue.position,1);
  assert.deepEqual(await persisted(p),before);
});
test("E08.12 PostgreSQL fila externa desligada libera a mesma participação e não recoloca ao reativar",async()=>{
  const c=await context(),p=await person(c,'waiting');assert.equal((await external(c)).status,200);
  const r=await get(p,'/participations/current');assert.equal(r.status,200);assert.equal(r.body.participation.status,'active');assert.equal(r.body.participation.id,p.participationId);assert.equal(r.body.participation.externalQueue,null);
  assert.equal((await supertest(app.getHttpServer()).patch(`/api/v1/admin/events/${c.eventId}/external-queue`).set('Authorization',`Bearer ${c.admin.token}`).set('Idempotency-Key',randomUUID()).send({enabled:true,reason:'Reativar fila externa'})).status,200);assert.equal((await detail(p)).body.participation.status,'active');
});
for(const kind of ["operational","administrative"]as const)for(const offset of [-1,0,1])test(`E08.12 PostgreSQL projeção ${kind} no corte ${offset} microssegundo sem escrita`,async()=>{
  const c=await context(),p=await person(c);
  if(kind==='operational')await expire(c);
  else await pool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp() WHERE id=$1`,[c.eventId]);
  const before=await ownState(c,p),at=sql`(SELECT LEAST(operational_deadline_at,admin_deadline_at)+${offset}::int*interval '1 microsecond' FROM events WHERE id=${c.eventId}::uuid)`;
  const rows=(await database.transaction(tx=>tx.execute<ParticipationProjectionRow>(participationProjection(p.userId,p.participationId,at)),{isolationLevel:'repeatable read',accessMode:'read only'})).rows;
  const result=publicParticipation(rows[0]);assert.equal(result.status,offset<0?'active':'finished');
  if(offset>=0)assert.equal(result.finishReason,kind==='operational'?'automatic_operational_deadline':'automatic_admin_deadline');
  assert.deepEqual(await ownState(c,p),before);assert.equal((await persisted(p)).status,'active');
});
for(const kind of ["operational","administrative"]as const)test(`E08.12 PostgreSQL current não finge atividade ${kind} antes do job; detalhe coincide após regularização`,async()=>{
  const c=await context(),p=await person(c);await service(c,p.participationId);
  if(kind==='operational')await expire(c);else await pool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp() WHERE id=$1`,[c.eventId]);
  const before=await ownState(c,p),r=await detail(p);assert.deepEqual((await get(p,'/participations/current')).body,{participation:null});assert.equal(r.body.participation.status,'finished');
  assert.notEqual(r.body.participation.finishReason,'voluntary');assert.deepEqual(await ownState(c,p),before);
  // Os GETs oficiais de avaliação continuam dependendo de finished persistido, não criam limpeza.
  assert.equal((await get(p,'/evaluations/pending')).body.items.length,0);assert.equal((await get(p,'/participations/return-state')).body.recentFinalization,null);
  assert.equal((await (await closure()).regularizeEvent(c.eventId)).kind,'closed');assert.deepEqual((await detail(p)).body,r.body);
  const pending=await get(p,'/evaluations/pending');assert.equal(pending.body.items[0].participationId,p.participationId);
  assert.equal((await get(p,'/participations/return-state')).body.recentFinalization.finishReason,r.body.participation.finishReason);
  const history=await get(p,'/participations/history');assert.equal(history.body.items[0].status,'finished');assert.equal(history.body.items[0].finishReason,r.body.participation.finishReason);
});
for(const mode of ["current","detail","cancel","finish"]as const)test(`E08.12 PostgreSQL ${mode} autenticação real, revogação e titularidade estrita`,async()=>{
  const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),other=await account();
  const request=()=>mode==='current'?get(p,'/participations/current'):mode==='detail'?detail(p):mutate(mode,p);
  problem(await request().unset('Authorization'),401,'MISSING_ACCESS_TOKEN');
  if(mode!=='current'){
    const a=mode==='detail'?await detail(p,other):await mutate(mode,p,randomUUID(),{},other),missing={...p,participationId:randomUUID()};
    const b=mode==='detail'?await detail(missing,other):await mutate(mode,missing,randomUUID(),{},other);problem(a,404,'RESOURCE_NOT_FOUND');assert.deepEqual(a.body,b.body);
  }else assert.deepEqual((await get(other,'/participations/current')).body,{participation:null});
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[p.sessionId]);
  problem(await request(),401,'SESSION_REVOKED');assert.equal((await intents(p)).length,0);
});
for(const role of ["staff","admin"]as const)test(`E08.12 PostgreSQL ${role} próprio sem acesso especial a terceiros`,async()=>{
  const c=await context(),actor=role==='admin'?c.admin:c.staff,p=await participant(c,{actor,status:'active'}),foreign=await person(c),before=await ownState(c,foreign);
  assert.equal((await detail(p)).status,200);problem(await detail(foreign,actor),404,'RESOURCE_NOT_FOUND');
  for(const mode of ["cancel","finish"]as const)problem(await mutate(mode,foreign,randomUUID(),{},actor),404,'RESOURCE_NOT_FOUND');
  if(role==='admin'){await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1",[actor.sessionId]);problem(await mutate('finish',p),401,'ADMIN_2FA_REQUIRED');await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1",[actor.sessionId]);}
  assert.equal((await mutate('finish',p)).status,200);assert.deepEqual(await ownState(c,foreign),before);
});
test("E08.12 PostgreSQL roteamento literal current/history/return-state permanece funcional",async()=>{
  const c=await context(),p=await person(c);for(const route of ['/participations/current','/participations/history','/participations/return-state'])assert.equal((await get(p,route)).status,200);
  problem(await get(p,'/participations/not-a-uuid'),400,'VALIDATION_ERROR');
});
for(const mode of ["cancel","finish"]as const){
  for(const body of [undefined,{}])test(`E08.12 PostgreSQL ${mode} corpo ${body===undefined?'ausente':'vazio'} encerra apenas o titular`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),other=await person(c,'waiting'),before=await ownState(c,other),r=await mutate(mode,p,randomUUID(),body);
    assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.participation.status,mode==='cancel'?'canceled':'finished');assert.equal(r.body.participation.finishReason,mode==='cancel'?'external_wait_withdrawal':'voluntary');
    assert.match(r.body.participation.finishedAt,/\.\d{6}Z$/);assert.equal((await persisted(p)).finished,r.body.participation.finishedAt);assert.equal((await persisted(p)).current_queue_entry_id,null);
    assert.equal((await intents(p)).length,1);assert.deepEqual(await ownState(c,other),before);
  });
  test(`E08.12 PostgreSQL ${mode} rejeita payload/chave/UUID inválidos sem efeitos`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),before=await ownState(c,p);
    for(const body of [{userId:p.userId},{status:'finished'},{reason:'forged'},[],{finishedAt:'forged'}])problem(await mutate(mode,p,randomUUID(),body),400,'VALIDATION_ERROR');
    problem(await mutate(mode,p).unset('Idempotency-Key'),400,'VALIDATION_ERROR');problem(await mutate(mode,{...p,participationId:'invalid'}),400,'VALIDATION_ERROR');assert.deepEqual(await ownState(c,p),before);
  });
  for(const status of ["waiting","active","finished","canceled"]as const)test(`E08.12 PostgreSQL ${mode} valida estado ${status} sob lock`,async()=>{
    const c=await context(),p=await person(c,status),before=await ownState(c,p),r=await mutate(mode,p);
    if(status===(mode==='cancel'?'waiting':'active'))assert.equal(r.status,200);else{problem(r,409,mode==='cancel'?'PARTICIPATION_NOT_WAITING':'PARTICIPATION_NOT_ACTIVE');assert.equal(r.body.participation.status,status);assert.deepEqual(await ownState(c,p),before);}
  });
  test(`E08.12 PostgreSQL ${mode} replay durável após TTL/prazo e nova chave não sobrescreve`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),key=randomUUID(),a=await mutate(mode,p,key);assert.equal(a.status,200);
    await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 hour' WHERE actor_user_id=$1",[p.userId]);await expire(c);
    const before=await ownState(c,p),r=await mutate(mode,p,key,{});assert.equal(r.status,200);assert.deepEqual(r.body,a.body);assert.deepEqual(await ownState(c,p),before);
    problem(await mutate(mode,p),409,mode==='cancel'?'PARTICIPATION_NOT_WAITING':'PARTICIPATION_NOT_ACTIVE');assert.deepEqual(await ownState(c,p),before);
  });
  for(const same of [false,true])test(`E08.12 PostgreSQL ${mode} concorrente chave ${same?'igual':'distinta'} tem uma única mutação`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),key=randomUUID();
    const [a,b]=await ordered(()=>mutate(mode,p,key),()=>mutate(mode,p,same?key:randomUUID()));assert.equal(a.status,200);
    if(same){assert.equal(b.status,200);assert.deepEqual(a.body,b.body);}else problem(b,409,mode==='cancel'?'PARTICIPATION_NOT_WAITING':'PARTICIPATION_NOT_ACTIVE');
    assert.equal((await intents(p)).length,1);assert.equal((await persisted(p)).finished,a.body.participation.finishedAt);
  });
  test(`E08.12 PostgreSQL ${mode} replay revalida dono atual sem divulgar resposta antiga`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),key=randomUUID();assert.equal((await mutate(mode,p,key)).status,200);const other=await account();
    await pool.query('UPDATE participations SET user_id=$2 WHERE id=$1',[p.participationId,other.userId]);const before=await intents(p);problem(await mutate(mode,p,key),404,'RESOURCE_NOT_FOUND');assert.deepEqual(await intents(p),before);
  });
  test(`E08.12 PostgreSQL ${mode} recusa encerramento lógico vencido sem limpeza ou intenção`,async()=>{
    const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active');await expire(c);const before=await ownState(c,p),r=await mutate(mode,p);
    problem(r,409,'EVENT_OPERATION_ENDED');assert.equal(r.body.participation.finishReason,'automatic_operational_deadline');assert.deepEqual(await ownState(c,p),before);
  });
}
for(const first of ["release","cancel"]as const)test(`E08.12 PostgreSQL cancelamento externo concorre com liberação; vence ${first}`,async()=>{
  const c=await context(),p=await person(c,'waiting');
  const [a,b]=await ordered(()=>first==='release'?external(c):mutate('cancel',p),()=>first==='release'?mutate('cancel',p):external(c));assert.equal(a.status,200);
  if(first==='release'){problem(b,409,'PARTICIPATION_NOT_WAITING');assert.equal(b.body.participation.status,'active');}else assert.equal(b.status,200);
  assert.equal((await persisted(p)).status,first==='release'?'active':'canceled');
});
for(const kind of ["idle","waiting","called"]as const)test(`E08.12 PostgreSQL saída ${kind} não fabrica ausência/conclusão e mantém FKs`,async()=>{
  const c=await context(),fixture=kind==='idle'?{p:await person(c),entry:undefined,session:undefined}:kind==='waiting'?{...await queued(c),session:undefined}:await called(c),p=fixture.p;
  const before=await state(c),r=await mutate('finish',p);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.participation.completedServicesCount,0);assert.equal(r.body.participation.evaluationEligibility.eligible,false);
  const after=await state(c);assert.equal(after.queues?.length??0,before.queues?.length??0);assert.equal(after.services?.length??0,before.services?.length??0);
  if(fixture.entry){const q=(await pool.query("SELECT status,close_reason,to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at FROM queue_entries WHERE id=$1",[fixture.entry])).rows[0];assert.equal(q.status,'closed');assert.equal(q.close_reason,'participation_voluntary_finish');assert.equal(q.at,r.body.participation.finishedAt);}
  if(fixture.session){const s=(await pool.query("SELECT status,cancel_reason,to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at FROM service_sessions WHERE id=$1",[fixture.session])).rows[0];assert.equal(s.status,'canceled');assert.equal(s.cancel_reason,'participation_voluntary_finish');assert.equal(s.at,r.body.participation.finishedAt);}
  assert.equal((await persisted(p)).current_queue_entry_id,null);assert.equal((await get(p,`/participations/${p.participationId}/evaluation-eligibility`)).body.eligible,false);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM participations p JOIN queue_entries q ON q.id=p.current_queue_entry_id WHERE p.id=$1`,[p.participationId])).rows[0].n,0);
});
test("E08.12 PostgreSQL saída cancela pending, conserva estação available e permite próxima chamada",async()=>{
  const c=await context(),a=await called(c),b=await queued(c),before=await state(c);
  const rejected=await station(c);problem(rejected,409,'STATION_HAS_PENDING_CALL');
  assert.equal(rejected.body.station.availability,'available');assert.equal(rejected.body.station.pendingServiceSessionId,a.session);
  assert.deepEqual(await state(c),before);

  const finished=await mutate('finish',a.p);assert.equal(finished.status,200,JSON.stringify(finished.body));
  const p=await persisted(a.p);assert.equal(p.status,'finished');assert.equal(p.finish_reason,'voluntary');assert.equal(p.current_queue_entry_id,null);assert.equal(p.finished,finished.body.participation.finishedAt);
  const resolved=(await pool.query(`SELECT q.status AS "entryStatus",q.close_reason,s.status AS "sessionStatus",s.cancel_reason,s.resolved_by_user_id,
    to_char(q.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "closedAt",
    to_char(s.resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "resolvedAt"
    FROM queue_entries q JOIN service_sessions s ON s.queue_entry_id=q.id WHERE q.id=$1 AND s.id=$2`,[a.entry,a.session])).rows[0];
  assert.deepEqual(resolved,{entryStatus:'closed',close_reason:'participation_voluntary_finish',sessionStatus:'canceled',cancel_reason:'participation_voluntary_finish',resolved_by_user_id:a.p.userId,closedAt:p.finished,resolvedAt:p.finished});
  assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0].availability,'available');

  const next=await call(c);assert.equal(next.status,201,JSON.stringify(next.body));assert.notEqual(next.body.serviceSession.id,a.session);
  const pending=(await pool.query(`SELECT s.status,q.participation_id FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id
    WHERE s.id=$1 AND s.station_id=$2`,[next.body.serviceSession.id,c.stationId])).rows[0];
  assert.deepEqual(pending,{status:'pending',participation_id:b.p.participationId});assert.equal((await persisted(b.p)).status,'active');
  assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0].availability,'available');
});
test("E08.12 PostgreSQL saída waiting conserva estação unavailable sem pending",async()=>{
  const c=await context(),a=await queued(c),b=await queued(c);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM service_sessions WHERE station_id=$1",[c.stationId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT status FROM queue_entries WHERE id=$1",[a.entry])).rows[0].status,'waiting');
  const disabled=await station(c);assert.equal(disabled.status,200,JSON.stringify(disabled.body));assert.equal(disabled.body.availability,'unavailable');assert.equal(disabled.body.pendingServiceSessionId,null);

  const finished=await mutate('finish',a.p);assert.equal(finished.status,200,JSON.stringify(finished.body));
  const p=await persisted(a.p);assert.equal(p.status,'finished');assert.equal(p.finish_reason,'voluntary');assert.equal(p.current_queue_entry_id,null);assert.equal(p.finished,finished.body.participation.finishedAt);
  const entry=(await pool.query(`SELECT status,close_reason,to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    FROM queue_entries WHERE id=$1`,[a.entry])).rows[0];
  assert.deepEqual(entry,{status:'closed',close_reason:'participation_voluntary_finish',at:p.finished});
  assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0].availability,'unavailable');
  problem(await call(c),409,'STATION_UNAVAILABLE');
  assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0].availability,'unavailable');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM service_sessions WHERE station_id=$1",[c.stationId])).rows[0].n,0);
  assert.equal((await persisted(b.p)).status,'active');assert.equal((await persisted(b.p)).current_queue_entry_id,b.entry);
  assert.equal((await pool.query("SELECT status FROM queue_entries WHERE id=$1",[b.entry])).rows[0].status,'waiting');
});
test("E08.12 PostgreSQL saída preserva completed, snapshot e integra histórico/pending/POST avaliação",async()=>{
  const c=await context(),a=await called(c);assert.equal((await resolve(c,a.session,'complete')).status,200);
  const old=(await pool.query('SELECT to_jsonb(s) AS value FROM service_sessions s WHERE id=$1',[a.session])).rows[0].value;
  const q=await join(c,a.p);assert.equal(q.kind,'created');const r=await mutate('finish',a.p);assert.equal(r.status,200);assert.equal(r.body.participation.completedServicesCount,1);assert.equal(r.body.participation.evaluationEligibility.eligible,true);
  assert.deepEqual((await pool.query('SELECT to_jsonb(s) AS value FROM service_sessions s WHERE id=$1',[a.session])).rows[0].value,old);
  const history=await get(a.p,'/participations/history');assert.equal(history.body.items.length,1);assert.equal(history.body.items[0].evaluation.pending,true);
  assert.equal((await get(a.p,'/evaluations/pending')).body.items[0].participationId,a.p.participationId);
  const post=await supertest(app.getHttpServer()).post(`/api/v1/participations/${a.p.participationId}/evaluation`).set('Authorization',`Bearer ${a.p.token}`).set('Idempotency-Key',randomUUID()).send({rating:5});assert.equal(post.status,201,JSON.stringify(post.body));
  assert.equal((await get(a.p,'/evaluations/pending')).body.items.length,0);
});
for(const action of ["complete","absent"]as const)for(const first of ["staff","finish"]as const)test(`E08.12 PostgreSQL saída versus ${action}; vence ${first}`,async()=>{
  const c=await context(),a=await called(c);
  const [one,two]=await ordered(()=>first==='staff'?resolve(c,a.session,action):mutate('finish',a.p),()=>first==='staff'?mutate('finish',a.p):resolve(c,a.session,action));assert.equal(one.status,200);
  if(first==='staff')assert.equal(two.status,200,JSON.stringify(two.body));else problem(two,409,'SERVICE_NOT_PENDING');
  const s=(await pool.query('SELECT status FROM service_sessions WHERE id=$1',[a.session])).rows[0];assert.equal(s.status,first==='staff'?(action==='complete'?'completed':'absent'):'canceled');
  const p=await persisted(a.p);assert.equal(p.status,'finished');assert.equal(p.finish_reason,'voluntary');assert.equal(p.current_queue_entry_id,null);
  assert.equal((await get(a.p,`/participations/${a.p.participationId}/evaluation-eligibility`)).body.eligible,first==='staff'&&action==='complete');
});
for(const first of ["call","finish"]as const)test(`E08.12 PostgreSQL saída versus chamada Staff; vence ${first}`,async()=>{
  const c=await context(),a=await queued(c);const [one,two]=await ordered(()=>first==='call'?call(c):mutate('finish',a.p),()=>first==='call'?mutate('finish',a.p):call(c));
  assert.equal(one.status,first==='call'?201:200);if(first==='call')assert.equal(two.status,200);else problem(two,409,'QUEUE_EMPTY');
  const sessions=(await pool.query('SELECT status FROM service_sessions WHERE queue_entry_id=$1',[a.entry])).rows;assert.equal(sessions.length,first==='call'?1:0);if(sessions.length)assert.equal(sessions[0].status,'canceled');
  assert.equal((await persisted(a.p)).status,'finished');
});
for(const first of ["withdraw","finish"]as const)test(`E08.12 PostgreSQL C-15 e saída completa são distintas; vence ${first}`,async()=>{
  const c=await context(),a=await called(c),[one,two]=await ordered(()=>first==='withdraw'?withdraw(c,a.p,a.entry):mutate('finish',a.p),()=>first==='withdraw'?mutate('finish',a.p):withdraw(c,a.p,a.entry));
  assert.equal(one.status,200);if(first==='withdraw')assert.equal(two.status,200);else problem(two,409,'PARTICIPATION_NOT_ACTIVE');
  const q=(await pool.query('SELECT close_reason FROM queue_entries WHERE id=$1',[a.entry])).rows[0];assert.equal(q.close_reason,first==='withdraw'?'participant_queue_withdrawal':'participation_voluntary_finish');assert.equal((await persisted(a.p)).finish_reason,'voluntary');
});
for(const mode of ["immediate","controlled"]as const)for(const first of ["admin","finish"]as const)test(`E08.12 PostgreSQL saída versus Admin ${mode}; vence ${first}`,async()=>{
  const c=await context(),a=await called(c),body=mode==='controlled'?await controlled():undefined;
  const [one,two]=await ordered(()=>first==='admin'?close(c,body):mutate('finish',a.p),()=>first==='admin'?mutate('finish',a.p):close(c,body));assert.equal(one.status,200);
  if(first==='admin'&&mode==='immediate'){problem(two,409,'PARTICIPATION_NOT_ACTIVE');assert.equal(two.body.participation.finishReason,'admin_immediate');}else assert.equal(two.status,200,JSON.stringify(two.body));
  assert.equal((await persisted(a.p)).finish_reason,first==='admin'&&mode==='immediate'?'admin_immediate':'voluntary');
});
test("E08.12 PostgreSQL job vence e saída não sobrescreve motivo automático",async()=>{
  const c=await context(),a=await called(c);await expire(c);const job=await closure();
  const [one,two]=await ordered(()=>job.regularizeEvent(c.eventId),()=>mutate('finish',a.p));assert.equal(one.kind,'closed');problem(two,409,'PARTICIPATION_NOT_ACTIVE');
  assert.equal(two.body.participation.finishReason,'automatic_operational_deadline');assert.equal((await intents(a.p)).filter(i=>i.operation==='finish_arena_participation').length,0);
});
test("E08.12 PostgreSQL saída vence antes do corte; job aguardando preserva motivo voluntário",async()=>{
  const c=await context(),a=await called(c),at=(await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '5 seconds' WHERE id=$1
    RETURNING to_char(operational_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[c.eventId])).rows[0].at,job=await closure();
  const [one,two]=await ordered(()=>mutate('finish',a.p),()=>job.regularizeEvent(c.eventId),pid=>waitPast(at,pid));assert.equal(one.status,200);assert.equal(two.kind,'closed');assert.equal((await persisted(a.p)).finish_reason,'voluntary');
});
for(const mode of ["cancel","finish"]as const)test(`E08.12 PostgreSQL ${mode} decide após espera que cruza prazo definitivo`,async()=>{
  const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active');
  const at=(await pool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '5 seconds' WHERE id=$1
    RETURNING to_char(operational_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[c.eventId])).rows[0].at;
  const before=await ownState(c,p),r=await lockWait(c,()=>mutate(mode,p),async(_client,pid)=>{await waitPast(at,pid);});problem(r,409,'EVENT_OPERATION_ENDED');assert.notEqual(r.body.participation.finishReason,'voluntary');assert.deepEqual(await ownState(c,p),before);
});
for(const mode of ["cancel","finish"]as const)test(`E08.12 PostgreSQL reentrada após ${mode} tem novo ID e snapshot próprio`,async()=>{
  const c=await context(),actor=await readyEntrant(),first=await admit(c,actor);assert.equal(first.kind,'created');if(first.kind!=='created')assert.fail();
  const p={...actor,participationId:first.participationId};if(mode==='finish')assert.equal((await external(c)).status,200);
  const snapshot=(await pool.query('SELECT to_jsonb(s) AS value FROM participation_profile_snapshots s WHERE participation_id=$1',[p.participationId])).rows[0].value;
  const key=randomUUID(),a=await mutate(mode,p,key);assert.equal(a.status,200);const next=await admit(c,actor);assert.equal(next.kind,'created');if(next.kind!=='created')assert.fail();assert.notEqual(next.participationId,p.participationId);
  assert.equal((await get(actor,'/participations/current')).body.participation.id,next.participationId);assert.deepEqual((await mutate(mode,p,key)).body,a.body);
  assert.equal((await get(actor,'/participations/history')).body.items.length,2);assert.deepEqual((await pool.query('SELECT to_jsonb(s) AS value FROM participation_profile_snapshots s WHERE participation_id=$1',[p.participationId])).rows[0].value,snapshot);
  problem(await mutate(mode,{...actor,participationId:next.participationId},key),409,'IDEMPOTENCY_KEY_REUSED');
});
test("E08.12 PostgreSQL namespaces cancel/finish e atores distintos não compartilham intenção",async()=>{
  const c=await context(),p=await person(c,'waiting'),other=await person(c,'waiting'),key=randomUUID();assert.equal((await mutate('cancel',p,key)).status,200);assert.equal((await mutate('cancel',other,key)).status,200);
  const next=await participant(c,{actor:p,status:'active'});assert.equal((await mutate('finish',next,key)).status,200);assert.equal((await intents(p)).length,2);
});
for(const mode of ["cancel","finish"]as const)test(`E08.12 PostgreSQL ${mode} intenção in_progress preexistente não executa domínio`,async()=>{
  const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active'),key=randomUUID();
  await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 minute')`,[randomUUID(),p.userId,mode==='cancel'?'cancel_external_participation':'finish_arena_participation',key,fingerprint(mode,p.userId,p.participationId)]);
  const before=await ownState(c,p);problem(await mutate(mode,p,key),409,'IDEMPOTENCY_IN_PROGRESS');assert.deepEqual(await ownState(c,p),before);
});
for(const mode of ["cancel","finish"]as const)for(const phase of ["reserve","participation","queue","session","complete"]as const){
  if(mode==='cancel'&&(phase==='queue'||phase==='session'))continue;
  test(`E08.12 PostgreSQL falha SQL após escrita real ${mode}/${phase} reverte tudo e aceita retry`,async()=>{
    const c=await context(),p=mode==='cancel'?await person(c,'waiting'):(await called(c)).p,key=randomUUID(),before=await ownState(c,p),client=await pool.connect();
    const originalQuery=client.query.bind(client) as (config:string|QueryConfig,params?:unknown[])=>Promise<QueryResult>;let reached=false;
    const proxy=new Proxy(client,{get(target,property){if(property==='query')return async(config:string|QueryConfig,params?:unknown[])=>{
      const result=await originalQuery(config,params),text=typeof config==='string'?config:config.text;
      if(!reached&&((phase==='reserve'&&text.includes('insert into "idempotency_operations"'))||(phase==='complete'&&text.includes('update "idempotency_operations"'))
        ||(phase==='participation'&&text.startsWith('WITH decision AS MATERIALIZED'))||(phase==='queue'&&text.startsWith('UPDATE queue_entries'))||(phase==='session'&&text.startsWith('UPDATE service_sessions')))){
        assert.equal(result.rows.length,1);reached=true;await originalQuery('SELECT 1/0');assert.fail('Falha SQL real deveria abortar a transação.');}return result;
    };return Reflect.get(target,property,target);}});
    const failing=makeWrites(drizzle(proxy,{schema})),original=writes[mode].bind(writes);writes[mode]=input=>failing[mode](input);
    try{problem(await mutate(mode,p,key),500,'INTERNAL_SERVER_ERROR');assert.equal(reached,true);assert.deepEqual(await ownState(c,p),before);}
    finally{writes[mode]=original;client.release();}
    assert.equal((await mutate(mode,p,key)).status,200);
  });
}
test("E08.12 PostgreSQL snapshot de posição permanece coerente durante cancelamento concorrente",async()=>{
  const c=await context(),a=await person(c,'waiting'),b=await person(c,'waiting'),p=await person(c,'waiting'),original=database.transaction.bind(database) as typeof database.transaction,dialect=new PgDialect();
  let ready!:()=>void,release!:()=>void,readerPid=0,writerPid=0;const reached=new Promise<void>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});
  database.transaction=(callback,config)=>original(async tx=>{
    if(config?.isolationLevel==='read committed')writerPid=(await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    const execute=tx.execute.bind(tx);tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{const q=args[0],text=typeof q==='string'?q:dialect.sqlToQuery(q.getSQL()).sql,result=await execute(...args);
      if(config?.accessMode==='read only'&&text.startsWith('WITH observation')){readerPid=(await execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;ready();await gate;}return result;}) as typeof tx.execute;return callback(tx);
  },config);
  const pending=detail(p).then(r=>r);pending.catch(()=>undefined);
  try{await Promise.race([reached,pending.then(()=>{throw Error('Leitura não reteve snapshot.');})]);assert.equal((await mutate('cancel',a)).status,200);assert.ok(readerPid>0&&writerPid>0);assert.notEqual(readerPid,writerPid);
    release();const r=await pending;assert.equal(r.body.participation.externalQueue.position,3);database.transaction=original;assert.equal((await detail(p)).body.participation.externalQueue.position,2);assert.equal((await detail(b)).body.participation.externalQueue.position,1);
  }finally{database.transaction=original;release();await Promise.allSettled([pending]);}
});
test("E08.12 PostgreSQL GETs não bloqueiam estação/participação e não criam efeitos",async()=>{
  const c=await context(),a=await called(c),client=await pool.connect(),before=await ownState(c,a.p);let pending:Promise<supertest.Response>|undefined;
  try{await client.query('BEGIN');await client.query('SELECT id FROM participations WHERE id=$1 FOR UPDATE',[a.p.participationId]);await client.query('SELECT id FROM stations WHERE id=$1 FOR UPDATE',[c.stationId]);
    pending=detail(a.p).then(r=>r);const r=await Promise.race([pending,new Promise<never>((_yes,no)=>setTimeout(()=>no(Error('GET aguardou lock exclusivo indevidamente.')),2000))]);assert.equal(r.status,200);
  }finally{await client.query('ROLLBACK');client.release();await Promise.allSettled([pending]);}
  assert.deepEqual(await ownState(c,a.p),before);
});
test("E08.12 PostgreSQL saída isola outra conta/evento e não altera concluídos alheios",async()=>{
  const c=await context(),a=await called(c),other=await context(),foreign=await called(other),before=await ownState(other,foreign.p);
  assert.equal((await mutate('finish',a.p)).status,200);assert.deepEqual(await ownState(other,foreign.p),before);
});
for(const mode of ["cancel","finish"]as const)test(`E08.12 PostgreSQL ${mode} continua permitido após corte de novos ingressos antes do prazo definitivo`,async()=>{
  const c=await context(),p=await person(c,mode==='cancel'?'waiting':'active');
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[c.eventId]);
  assert.equal((await mutate(mode,p)).status,200);
});
test("E08.12 PostgreSQL waiting residual de fechamento controlado é projetado como encerrado e não vira cancelamento voluntário",async()=>{
  const c=await context(),p=await person(c,'waiting');
  await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp(),admin_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[c.eventId]);
  const before=await ownState(c,p),r=await detail(p);assert.equal(r.body.participation.finishReason,'admin_controlled_external_wait_closed');assert.equal(r.body.participation.externalQueue,null);
  assert.deepEqual((await get(p,'/participations/current')).body,{participation:null});const canceled=await mutate('cancel',p);problem(canceled,409,'EVENT_OPERATION_ENDED');assert.equal(canceled.body.participation.finishReason,'admin_controlled_external_wait_closed');
  assert.deepEqual(await ownState(c,p),before);
});
