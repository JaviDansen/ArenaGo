import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { ParticipationLifecycleService, lifecycleFingerprint, VOLUNTARY_QUEUE_REASON } from "../../src/participations/participation-lifecycle.service";
import { ParticipationQueryService, participationProjection, publicParticipation, type ParticipationProjectionRow } from "../../src/participations/participation-query.service";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,"0")}`;
const pid=id(1),uid=id(2),eventId=id(3),qid=id(4),xid=id(5),sid=id(6),stationId=id(7),at="2026-11-04T15:00:00.123456Z";
const input={userId:uid,participationId:pid,idempotencyKey:"opaque,key",expiresAt:new Date("2099-01-01")};
function projection(status="active"):ParticipationProjectionRow {
  return {id:pid,eventId,status,joinedAt:at,arenaEnteredAt:status==="waiting"?null:at,
    finishedAt:["finished","canceled"].includes(status)?at:null,finishReason:status==="finished"?"voluntary":status==="canceled"?"external_wait_withdrawal":null,
    position:status==="waiting"?"3":null,observedAt:at};
}
type Options={access?:boolean;owner?:boolean;status?:string;entry?:"waiting"|"called";intent?:"replay"|"conflict"|"in_progress";fail?:string;ended?:boolean;badReplay?:boolean;brokenPointer?:boolean;completed?:number};
function fixture(mode:"cancel"|"finish",options:Options={}){
  const queries:Array<{text:string;params:unknown[]}>=[];let changed=false;
  const terminal=mode==="cancel"?"canceled":"finished";
  const value={...publicParticipation(projection(terminal)),...(mode==="finish"?{completedServicesCount:options.completed??2,evaluationEligibility:{eligible:(options.completed??2)>0,hasSubmitted:false}}:{})};
  const entry=options.entry?{id:qid,experienceId:xid,status:options.entry,sessionId:options.entry==="called"?sid:null,sessionStatus:options.entry==="called"?"pending":null,stationId:options.entry==="called"?stationId:null}:undefined;
  const db=drizzle({async query(config:{text:string},params:unknown[]=[]){
    const text=config.text;queries.push({text,params});
    if(/^(begin|commit|rollback)/.test(text))return {rows:[]};
    if(text.startsWith('SELECT event_id AS'))return {rows:options.access===false?[]:[{eventId}]};
    if(text.includes('insert into "idempotency_operations"')){if(options.fail==="reserve")throw Error("PRIVATE");return {rows:options.intent?[]:[["intent"]]};}
    if(text.includes('from "idempotency_operations"'))return {rows:[["intent",options.intent==="conflict"?"different":lifecycleFingerprint(mode,uid,pid),options.intent==="in_progress"?"in_progress":"completed",200,pid,options.badReplay?{}:{participation:value}]]};
    if(text.startsWith('SELECT id FROM events'))return {rows:[{id:eventId}]};
    if(text.startsWith('SELECT q.id,q.experience_id'))return {rows:entry?[entry]:[]};
    if(text.startsWith('SELECT id FROM experiences')||text.startsWith('SELECT id FROM stations'))return {rows:[{id:"resource"}]};
    if(text.startsWith('SELECT status,current_queue_entry_id'))return {rows:options.owner===false?[]:[{status:options.status??(mode==="cancel"?"waiting":"active"),currentId:options.brokenPointer?qid:entry?qid:null}]};
    if(text.startsWith('SELECT id FROM queue_entries'))return {rows:entry?[{id:qid}]:[]};
    if(text.startsWith('SELECT id FROM service_sessions'))return {rows:entry?.sessionId?[{id:sid}]:[]};
    if(text.startsWith('WITH decision AS MATERIALIZED')){if(options.fail==="domain")throw Error("PRIVATE");changed=!options.ended;return {rows:changed?[{at}]:[]};}
    if(text.startsWith('UPDATE queue_entries')){if(options.fail==="queue")throw Error("PRIVATE");return {rows:[{id:qid}]};}
    if(text.startsWith('UPDATE service_sessions')){if(options.fail==="session")throw Error("PRIVATE");return {rows:[{id:sid}]};}
    if(text.startsWith('WITH observation')){if(options.fail==="response")throw Error("PRIVATE");return {rows:[{...projection(changed?terminal:options.ended?"finished":options.status??"active"),...(options.ended?{finishReason:"automatic_operational_deadline"}:{})}]};}
    if(text.startsWith('WITH scoped'))return {rows:[{participationId:pid,status:"finished",joinedAt:at,finishedAt:at,deadlineAt:at,completedCount:String(options.completed??2),eligible:(options.completed??2)>0,submitted:false,pending:true,reason:null}]};
    if(text.includes('update "idempotency_operations"')){if(options.fail==="complete")throw Error("PRIVATE");return {rows:[["intent",200,pid,{participation:value}]]};}
    throw Error('Unexpected SQL: '+text);
  }} as unknown as Client,{schema});
  return {service:new ParticipationLifecycleService(db),queries,value};
}
for(const mode of ["cancel","finish"]as const){
  test(`E08.12 ${mode} reserva, bloqueia evento/participação e conclui no mesmo READ COMMITTED`,async()=>{
    const f=fixture(mode),r=await f.service[mode](input);assert.deepEqual(r,{kind:"changed",participation:f.value});
    assert.equal(f.queries[0].text,'begin isolation level read committed');assert.equal(f.queries.at(-1)?.text,'commit');
    const reserve=f.queries.findIndex(q=>q.text.includes('insert into "idempotency_operations"')),event=f.queries.findIndex(q=>q.text.startsWith('SELECT id FROM events')),parent=f.queries.findIndex(q=>q.text.startsWith('SELECT status,current_queue_entry_id'));
    assert.ok(reserve>1&&event>reserve&&parent>event);
    const decisive=f.queries.find(q=>q.text.startsWith('WITH decision'))!;assert.equal((decisive.text.match(/clock_timestamp\(\)/g)||[]).length,1);
    assert.ok(decisive.text.includes('d.at<LEAST(e.operational_deadline_at,e.admin_deadline_at)'));
    assert.ok(f.queries.some(q=>q.text.includes('update "idempotency_operations"')));
  });
  test(`E08.12 ${mode} inexistência não reserva, titularidade atual é revalidada`,async()=>{
    const f=fixture(mode,{access:false});assert.deepEqual(await f.service[mode](input),{kind:"access_denied"});assert.equal(f.queries.some(q=>q.text.includes('idempotency_operations')),false);
    const lost=fixture(mode,{owner:false,intent:"replay"});assert.deepEqual(await lost.service[mode](input),{kind:"access_denied"});assert.equal(lost.queries.at(-1)?.text,'rollback');
  });
  for(const intent of ["replay","conflict","in_progress"]as const)test(`E08.12 ${mode} intenção ${intent} não repete mutações`,async()=>{
    const f=fixture(mode,{intent}),r=await f.service[mode](input);assert.equal(r.kind,intent==="conflict"?"request_conflict":intent);
    assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('UPDATE ')||q.text.includes('update "idempotency_operations"')),false);
    if(r.kind==="replay")assert.deepEqual(r.participation,f.value);
  });
  test(`E08.12 ${mode} replay corrompido reverte sem divulgar dados`,async()=>{
    const f=fixture(mode,{intent:"replay",badReplay:true});await assert.rejects(f.service[mode](input),{message:"PARTICIPATION_LIFECYCLE_INTERNAL_ERROR"});assert.equal(f.queries.at(-1)?.text,'rollback');
  });
  for(const fail of ["reserve","domain","response","complete"])test(`E08.12 ${mode} falha ${fail} reverte intenção e domínio`,async()=>{
    const f=fixture(mode,{fail});await assert.rejects(f.service[mode](input),{message:"PARTICIPATION_LIFECYCLE_INTERNAL_ERROR"});assert.equal(f.queries.at(-1)?.text,'rollback');
  });
  test(`E08.12 ${mode} estado concorrente e prazo vencido preservam estado efetivo`,async()=>{
    const f=fixture(mode,{status:mode==="cancel"?"active":"finished"}),r=await f.service[mode](input);assert.equal(r.kind,mode==="cancel"?"not_waiting":"not_active");assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')),false);
    const ended=fixture(mode,{ended:true}),denied=await ended.service[mode](input);assert.equal(denied.kind,"event_ended");assert.equal(denied.participation?.finishReason,"automatic_operational_deadline");assert.equal(ended.queries.at(-1)?.text,'rollback');
  });
}
for(const entry of ["waiting","called"]as const)test(`E08.12 saída resolve ${entry} preservando ordem e tempos PostgreSQL`,async()=>{
  const f=fixture("finish",{entry});assert.equal((await f.service.finish(input)).kind,"changed");
  const texts=f.queries.map(q=>q.text),experience=texts.findIndex(s=>s.startsWith('SELECT id FROM experiences')),station=texts.findIndex(s=>s.startsWith('SELECT id FROM stations')),person=texts.findIndex(s=>s.startsWith('SELECT status,current_queue_entry_id')),queue=texts.findIndex(s=>s.startsWith('SELECT id FROM queue_entries'));
  assert.ok(experience<person&&person<queue);if(entry==="called")assert.ok(experience<station&&station<person);
  const close=f.queries.find(q=>q.text.startsWith('UPDATE queue_entries'))!;assert.ok(close.text.includes('closed_at=p.finished_at'));assert.ok(close.params.includes(VOLUNTARY_QUEUE_REASON));
  assert.equal(texts.some(s=>s.startsWith('UPDATE service_sessions')),entry==="called");assert.equal(texts.some(s=>s.startsWith('UPDATE stations')),false);
  if(entry==="called")assert.ok(texts.find(s=>s.startsWith('UPDATE service_sessions'))!.includes("s.status='pending'"));
});
for(const fail of ["queue","session"]as const)test(`E08.12 falha após ${fail} faz rollback integral da saída`,async()=>{
  const f=fixture("finish",{entry:"called",fail});await assert.rejects(f.service.finish(input),{message:"PARTICIPATION_LIFECYCLE_INTERNAL_ERROR"});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.12 ponteiro divergente falha sem fabricar saída",async()=>{
  const f=fixture("finish",{brokenPointer:true});await assert.rejects(f.service.finish(input),{message:"PARTICIPATION_LIFECYCLE_INTERNAL_ERROR"});assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')),false);
});
test("E08.12 saída sem completed é permitida e não elegível",async()=>{
  const f=fixture("finish",{completed:0}),r=await f.service.finish(input);assert.equal(r.kind,"changed");assert.deepEqual(r.participation,f.value);assert.equal(f.queries.some(q=>q.text.startsWith('UPDATE queue_entries')||q.text.startsWith('UPDATE service_sessions')),false);
});
test("E08.12 fingerprint distingue ator, recurso e as duas intenções",()=>{
  const a=lifecycleFingerprint("cancel",uid,pid);assert.equal(a,lifecycleFingerprint("cancel",uid,pid));
  for(const b of [lifecycleFingerprint("finish",uid,pid),lifecycleFingerprint("cancel",id(9),pid),lifecycleFingerprint("cancel",uid,id(9))])assert.notEqual(a,b);
});
for(const status of ["waiting","active","finished","canceled"]as const)test(`E08.12 projeção pública ${status} valida posição e microssegundos`,()=>{
  const value=publicParticipation(projection(status));assert.equal(value.status,status);assert.equal(value.joinedAt,at);assert.equal(value.externalQueue?.position,status==="waiting"?3:undefined);
  assert.equal(Object.hasOwn(value,"userId"),false);
});
test("E08.12 posição inválida ou insegura não vira número impreciso",()=>{
  for(const position of [null,"0","-1","1.5","9007199254740992"])assert.throws(()=>publicParticipation({...projection("waiting"),position}));
  assert.throws(()=>publicParticipation({...projection("active"),finishedAt:at}));
});
test("E08.12 consulta reutiliza prazo/motivos E08.9 e faz projeção somente de leitura",()=>{
  const q=new PgDialect().sqlToQuery(participationProjection(uid));
  assert.ok(q.sql.includes('LEAST(e.operational_deadline_at,e.admin_deadline_at)<=d.at'));assert.ok(q.sql.includes("e.status='closed'"));
  assert.ok(q.params.includes("automatic_operational_deadline")&&q.params.includes("automatic_admin_deadline"));
  assert.equal(/FOR UPDATE|INSERT |UPDATE |DELETE /.test(q.sql),false);assert.equal((q.sql.match(/clock_timestamp\(\)/g)||[]).length,1);
});
for(const status of ["waiting","active","finished"]as const)test(`E08.12 current ${status} em snapshot readonly sem N+1`,async()=>{
  const queries:string[]=[];const db=drizzle({async query(config:{text:string}){queries.push(config.text);return {rows:config.text.startsWith('WITH observation')?[projection(status)]:[]};}}as unknown as Client,{schema});
  const service=new ParticipationQueryService(db),r=await service.current(uid);assert.equal(r?.status,status==="finished"?undefined:status);
  assert.equal(queries[0],'begin isolation level repeatable read read only');assert.equal(queries.length,3);assert.equal(queries.at(-1),'commit');
});
test("E08.12 consulta por ID não seleciona terceiros e ausência é null",async()=>{
  const queries:Array<{text:string;params:unknown[]}>=[];const db=drizzle({async query(config:{text:string},params:unknown[]){queries.push({text:config.text,params});return {rows:[]};}}as unknown as Client,{schema});
  assert.equal(await new ParticipationQueryService(db).byId(uid,pid),null);assert.ok(queries[1].params.includes(uid)&&queries[1].params.includes(pid));
});
