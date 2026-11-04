import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { experienceQueueControlBody,experienceQueueControlParams,experienceQueueControlState } from "../../src/events/experience-queue-control.dto";
import { ExperienceQueueControlService,experienceQueueControlFingerprint,queueAcceptanceStatement,EXPERIENCE_QUEUE_CONTROL_ACTION,type ExperienceQueueControlInput } from "../../src/events/experience-queue-control.service";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,'0')}`,eventId=id(1),experienceId=id(2),userId=id(3),sessionId=id(4),at='2026-11-04T15:00:00.123456Z';
const input:ExperienceQueueControlInput={eventId,experienceId,userId,sessionId,acceptingEntries:false,idempotencyKey:'opaque,key',expiresAt:new Date('2099-01-01')};
type Options={previous?:boolean;event?:boolean;experience?:boolean;active?:boolean;verified?:boolean;roles?:string[];session?:boolean;revoked?:boolean;expired?:boolean;secondFactor?:boolean;
  expireAt?:number;intent?:'replay'|'conflict'|'in_progress';badReplay?:boolean;ended?:boolean;fail?:string;count?:number};
function fixture(options:Options={}){
  const queries:Array<{text:string;params:unknown[]}>=[],state={eventId,experienceId,queueAcceptingEntries:false,changedAt:at};let sessionReads=0;
  const db=drizzle({async query(config:{text:string},params:unknown[]=[]){const text=config.text;queries.push({text,params});
    if(/^(begin|commit|rollback)/.test(text))return {rows:[]};
    if(text.startsWith('SELECT id FROM events'))return {rows:options.event===false?[]:[{id:eventId}]};
    if(text.startsWith('SELECT queue_accepting_entries'))return {rows:options.experience===false?[]:[{accepting:options.previous??true}]};
    if(text.startsWith('SELECT is_active'))return {rows:[{active:options.active??true,verified:options.verified??true}]};
    if(text.startsWith('SELECT role FROM user_roles'))return {rows:(options.roles??['staff']).map(role=>({role}))};
    if(text.startsWith('SELECT id FROM sessions'))return {rows:options.session===false?[]:[{id:sessionId}]};
    if(text.startsWith('SELECT revoked_at')){sessionReads++;return {rows:[{revoked:options.revoked??false,expired:options.expired??(options.expireAt!==undefined&&sessionReads>=options.expireAt),secondFactor:options.secondFactor??true}]};}
    if(text.includes('insert into "idempotency_operations"')){if(options.fail==='reserve')throw Error('PRIVATE');return {rows:options.intent?[]:[['intent']]};}
    if(text.includes('from "idempotency_operations"'))return {rows:[['intent',options.intent==='conflict'?'different':experienceQueueControlFingerprint(eventId,experienceId,false),options.intent==='in_progress'?'in_progress':'completed',200,experienceId,options.badReplay?{...state,userId}:state]]};
    if(text.startsWith('WITH decision')){if(options.fail==='update')throw Error('PRIVATE');return {rows:options.ended?[]:[{changedAt:at}]};}
    if(text.startsWith('INSERT INTO audit_logs')){if(options.fail==='audit')throw Error('PRIVATE');return {rows:options.count===0?[]:[{id:'audit'}]};}
    if(text.includes('update "idempotency_operations"')){if(options.fail==='complete')throw Error('PRIVATE');return {rows:[['intent',200,experienceId,options.previous===false?{eventId,experienceId,queueAcceptingEntries:false}:state]]};}
    throw Error('Unexpected SQL: '+text);
  }}as unknown as Client,{schema});return {service:new ExperienceQueueControlService(db),queries,state};
}
for(const acceptingEntries of [false,true])test(`E08.14 DTO booleano ${acceptingEntries} não aceita campos extras`,()=>{
  assert.deepEqual(experienceQueueControlBody.parse({acceptingEntries}),{acceptingEntries});assert.equal(experienceQueueControlBody.safeParse({acceptingEntries,userId}).success,false);
});
test('E08.14 DTO rejeita ausente/null/string/número e UUIDs inválidos',()=>{
  for(const body of [undefined,null,{},[],{acceptingEntries:null},{acceptingEntries:'false'},{acceptingEntries:0}])assert.equal(experienceQueueControlBody.safeParse(body).success,false);
  assert.equal(experienceQueueControlParams.safeParse({eventId:'x',experienceId}).success,false);
  assert.deepEqual(experienceQueueControlParams.parse({eventId:eventId.toUpperCase(),experienceId}),{eventId,experienceId});
});
test('E08.14 resposta fecha replay, mantém microssegundos e omite instante em no-op',()=>{
  assert.deepEqual(experienceQueueControlState.parse({eventId,experienceId,queueAcceptingEntries:true}),{eventId,experienceId,queueAcceptingEntries:true});
  assert.equal(experienceQueueControlState.safeParse({eventId,experienceId,queueAcceptingEntries:true,changedAt:'2026-11-04T15:00:00.123Z'}).success,false);
});
for(const roles of [['staff'],['admin'],['staff','admin']])test(`E08.14 autoriza ${roles.join('+')} com locks e transação atômica`,async()=>{
  const f=fixture({roles}),r=await f.service.setAcceptance(input);assert.deepEqual(r,{kind:'changed',state:f.state});assert.equal(f.queries[0].text,'begin isolation level read committed');assert.equal(f.queries.at(-1)?.text,'commit');
  const keys=['SELECT id FROM events','SELECT queue_accepting_entries','SELECT is_active','SELECT role FROM user_roles','SELECT id FROM sessions'];
  const positions=keys.map(key=>f.queries.findIndex(q=>q.text.startsWith(key)));assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.ok(f.queries.find(q=>q.text.startsWith('INSERT INTO audit_logs'))!.params.includes(EXPERIENCE_QUEUE_CONTROL_ACTION));
  const writes=f.queries.filter(q=>/^(WITH decision|INSERT INTO audit_logs)|update "idempotency_operations"/.test(q.text));assert.equal(writes.length,3);
});
for(const [options,kind]of [[{event:false},'access_denied'],[{experience:false},'access_denied'],[{active:false},'account_inactive'],[{roles:[]},'access_denied'],[{verified:false},'access_denied'],[{session:false},'invalid_session'],[{revoked:true},'session_revoked'],[{expired:true},'session_expired'],[{roles:['admin'],secondFactor:false},'admin_2fa_required'],[{roles:['staff','admin'],secondFactor:false},'admin_2fa_required']]as const)
test(`E08.14 autorização ${JSON.stringify(options)} nega ${kind} sem intenção ou UPDATE`,async()=>{
  const f=fixture({...options,roles:'roles'in options?[...options.roles]:undefined});assert.deepEqual(await f.service.setAcceptance(input),{kind});assert.equal(f.queries.some(q=>q.text.includes('idempotency_operations')||q.text.startsWith('WITH decision')),false);assert.equal(f.queries.at(-1)?.text,'rollback');
});
test('E08.14 Admin não depende de Staff ou e-mail verificado de Staff',async()=>{
  const f=fixture({roles:['admin'],verified:false});assert.equal((await f.service.setAcceptance(input)).kind,'changed');
});
for(const intent of ['replay','conflict','in_progress']as const)test(`E08.14 intenção ${intent} não repete efeito nem auditoria`,async()=>{
  const f=fixture({intent,previous:false}),r=await f.service.setAcceptance(input);assert.equal(r.kind,intent==='conflict'?'request_conflict':intent);
  assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('INSERT INTO audit_logs')||q.text.includes('update "idempotency_operations"')),false);
  if('state'in r)assert.deepEqual(r.state,f.state);
});
test('E08.14 no-op preserva updated_at, não audita e conclui somente a intenção',async()=>{
  const f=fixture({previous:false,ended:true}),r=await f.service.setAcceptance(input);assert.deepEqual(r,{kind:'unchanged',state:{eventId,experienceId,queueAcceptingEntries:false}});
  assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('INSERT INTO audit_logs')),false);assert.ok(f.queries.some(q=>q.text.includes('update "idempotency_operations"')));
});
for(const expireAt of [2,3,4])test(`E08.14 expiração na revalidação ${expireAt} reverte toda transação`,async()=>{
  const f=fixture({expireAt});assert.deepEqual(await f.service.setAcceptance(input),{kind:'session_expired'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test('E08.14 replay revalida expiração e rejeita payload histórico com campo privado',async()=>{
  const expired=fixture({intent:'replay',expireAt:3});assert.deepEqual(await expired.service.setAcceptance(input),{kind:'session_expired'});
  const bad=fixture({intent:'replay',badReplay:true});await assert.rejects(bad.service.setAcceptance(input),{message:'EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR'});assert.equal(bad.queries.at(-1)?.text,'rollback');
});
test('E08.14 corte definitivo não confirma a reserva',async()=>{
  const f=fixture({ended:true});assert.deepEqual(await f.service.setAcceptance(input),{kind:'event_operation_ended'});assert.equal(f.queries.at(-1)?.text,'rollback');assert.equal(f.queries.some(q=>q.text.startsWith('INSERT INTO audit_logs')),false);
});
for(const fail of ['reserve','update','audit','complete'])test(`E08.14 falha ${fail} reverte sem expor SQL`,async()=>{
  const f=fixture({fail});await assert.rejects(f.service.setAcceptance(input),{message:'EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test('E08.14 auditoria sem linha não comita efeito parcial',async()=>{
  const f=fixture({count:0});await assert.rejects(f.service.setAcceptance(input),{message:'EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test('E08.14 fingerprint distingue estado, evento e experiência, sem TTL na intenção',()=>{
  const a=experienceQueueControlFingerprint(eventId,experienceId,false);assert.equal(a,experienceQueueControlFingerprint(eventId,experienceId,false));
  for(const b of [experienceQueueControlFingerprint(eventId,experienceId,true),experienceQueueControlFingerprint(id(8),experienceId,false),experienceQueueControlFingerprint(eventId,id(8),false)])assert.notEqual(a,b);
});
test('E08.14 UPDATE usa relógio único e somente prazo definitivo, sem ingressos/estrutura',()=>{
  const q=new PgDialect().sqlToQuery(queueAcceptanceStatement(input,true,true));assert.equal((q.sql.match(/clock_timestamp\(\)/g)||[]).length,1);
  assert.ok(q.sql.includes('d.at<LEAST(e.operational_deadline_at,e.admin_deadline_at)'));assert.equal(/official_ends_at|starts_at|participations|queue_entries|service_sessions|stations|evaluations|last_queue_order/.test(q.sql),false);
  assert.ok(q.sql.includes('a.admin_2fa_verified_at IS NOT NULL'));assert.ok(q.sql.includes('a.expires_at'));assert.ok(q.sql.includes('queue_accepting_entries='));
});
test('E08.14 entrada interna inválida falha antes de abrir transação',async()=>{
  for(const extra of [{acceptingEntries:null},{idempotencyKey:''},{expiresAt:new Date(NaN)}]){const f=fixture();await assert.rejects(f.service.setAcceptance({...input,...extra}as ExperienceQueueControlInput),{message:'EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR'});assert.equal(f.queries.length,0);}
});
