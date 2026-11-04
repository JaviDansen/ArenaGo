import "reflect-metadata";
import assert from "node:assert/strict";
import { after,before,test } from "node:test";
import { Module,type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Pool } from "pg";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { DRIZZLE_DATABASE,POSTGRES_POOL } from "../../src/database/database.module";
import { EventsModule } from "../../src/events/events.module";
import { ExperienceQueueControlController } from "../../src/events/experience-queue-control.controller";
import { ExperienceQueueControlService,type ExperienceQueueControlResult,type ExperienceQueueControlFailure } from "../../src/events/experience-queue-control.service";
import { StaffIdempotencyPolicy } from "../../src/events/staff-idempotency.policy";
import { StaffQueriesController } from "../../src/events/staff-queries.controller";
import { StaffQueriesService } from "../../src/events/staff-queries.service";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,'0')}`,eventId=id(1),experienceId=id(2),userId=id(3),sessionId=id(4),at='2026-11-04T15:00:00.123456Z';
let result:ExperienceQueueControlResult,failure:Error|undefined;const calls:Record<string,unknown>[]=[];
@Module({controllers:[StaffQueriesController,ExperienceQueueControlController],providers:[SessionAuthGuard,StaffIdempotencyPolicy,
  {provide:AuthService,useValue:{async authenticateBearerToken(token:string){if(token==='no-2fa')throw new ProblemException({status:401,code:'ADMIN_2FA_REQUIRED',typeSlug:'admin-2fa-required',title:'2FA',detail:'Segundo fator obrigatório.'});
    if(!['staff','admin','both'].includes(token))throw new ProblemException({status:401,code:'SESSION_REVOKED',typeSlug:'session-revoked',title:'Sessão inválida',detail:'Sessão inválida.'});return {userId,sessionId,roles:token==='both'?['admin','staff']:[token]};}}},
  {provide:ExperienceQueueControlService,useValue:{setAcceptance:(input:Record<string,unknown>)=>{calls.push(input);if(failure)throw failure;return result;}}},
  {provide:StaffQueriesService,useValue:{getQueue:()=>({kind:'ok',eventId,experienceId,observedAt:at,waitingCount:2,acceptingNewEntries:false,canCallWaitingEntries:true,firstWaitingQueueEntryId:id(5)})}},
]})class HttpModule{}
let app:INestApplication;const route=`/api/v1/staff/events/${eventId}/experiences/${experienceId}/queue`;
before(async()=>{app=await NestFactory.create(HttpModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalFilters(new ProblemDetailsExceptionFilter());await app.listen(0,'127.0.0.1');});
after(async()=>{await app?.close();});
const request=(token='staff',url=route)=>supertest(app.getHttpServer()).patch(url).set('Authorization',`Bearer ${token}`).set('Idempotency-Key','opaque,key');
function reset(){calls.length=0;failure=undefined;result={kind:'changed',state:{eventId,experienceId,queueAcceptingEntries:false,changedAt:at}};}
function problem(r:supertest.Response,status:number,code:string){assert.equal(r.status,status);assert.equal(r.body.code,code);assert.match(r.headers['content-type'],/application\/problem\+json/);}
for(const token of ['staff','admin','both'])test(`E08.14 HTTP ${token} usa ator/sessão autenticados e responde estado preciso`,async()=>{
  reset();const start=Date.now(),r=await request(token).query({userId:id(99)}).send({acceptingEntries:false});assert.equal(r.status,200);assert.deepEqual(r.body,{eventId,experienceId,queueAcceptingEntries:false,changedAt:at});
  assert.equal(calls[0].userId,userId);assert.equal(calls[0].sessionId,sessionId);assert.equal(calls[0].idempotencyKey,'opaque,key');assert.deepEqual(calls[0].acceptingEntries,false);
  assert.ok((calls[0].expiresAt as Date).getTime()>=start+60000);
});
test('E08.14 HTTP exige Bearer, sessão e 2FA existentes',async()=>{
  reset();problem(await request().unset('Authorization').send({acceptingEntries:false}),401,'MISSING_ACCESS_TOKEN');problem(await request('revoked').send({acceptingEntries:false}),401,'SESSION_REVOKED');problem(await request('no-2fa').send({acceptingEntries:false}),401,'ADMIN_2FA_REQUIRED');assert.equal(calls.length,0);
});
for(const kind of ['unchanged','replay']as const)test(`E08.14 HTTP ${kind} mantém status e corpo histórico sem campos internos`,async()=>{
  reset();result={kind,state:{eventId,experienceId,queueAcceptingEntries:true}};const r=await request().send({acceptingEntries:true});assert.equal(r.status,200);assert.deepEqual(r.body,{eventId,experienceId,queueAcceptingEntries:true});
});
test('E08.14 HTTP UUIDs inválidos e corpo estrito não chegam ao serviço',async()=>{
  reset();for(const url of [route.replace(eventId,'invalid'),route.replace(experienceId,'invalid')])problem(await request('staff',url).send({acceptingEntries:true}),400,'VALIDATION_ERROR');
  for(const body of [{},{acceptingEntries:'false'},{acceptingEntries:null},{acceptingEntries:0},{acceptingEntries:false,userId},{acceptingEntries:false,reason:'x'},[]])problem(await request().send(body),400,'VALIDATION_ERROR');
  problem(await request().send(),400,'VALIDATION_ERROR');problem(await request().type('json').send('null'),400,'BAD_REQUEST');problem(await request().type('json').send('{invalid'),400,'BAD_REQUEST');problem(await request().type('text/plain').send('x'),400,'VALIDATION_ERROR');assert.equal(calls.length,0);
});
test('E08.14 HTTP exige chave única e válida',async()=>{
  reset();for(const key of ['',' ','x'.repeat(129)])problem(await request().set('Idempotency-Key',key).send({acceptingEntries:false}),400,'VALIDATION_ERROR');
  problem(await request().unset('Idempotency-Key').send({acceptingEntries:false}),400,'VALIDATION_ERROR');problem(await request().set({'Idempotency-Key':['a','b']}).send({acceptingEntries:false}),400,'VALIDATION_ERROR');assert.equal(calls.length,0);
});
for(const [kind,status,code]of [['access_denied',404,'RESOURCE_NOT_FOUND'],['account_inactive',401,'ACCOUNT_DEACTIVATED'],['invalid_session',401,'INVALID_SESSION'],['session_revoked',401,'SESSION_REVOKED'],['session_expired',401,'SESSION_EXPIRED'],['admin_2fa_required',401,'ADMIN_2FA_REQUIRED'],['event_operation_ended',409,'EVENT_OPERATION_ENDED'],['request_conflict',409,'IDEMPOTENCY_KEY_REUSED'],['in_progress',409,'IDEMPOTENCY_IN_PROGRESS']]as const)
test(`E08.14 HTTP traduz ${kind} sem detalhes privados`,async()=>{reset();result={kind:kind as ExperienceQueueControlFailure};problem(await request().send({acceptingEntries:false}),status,code);});
test('E08.14 HTTP GET existente continua distinto do novo PATCH',async()=>{
  reset();const r=await supertest(app.getHttpServer()).get(route).set('Authorization','Bearer staff');assert.equal(r.status,200);assert.equal(r.body.canCallWaitingEntries,true);assert.equal(r.body.waitingCount,2);assert.equal(calls.length,0);
});
test('E08.14 HTTP falha interna usa filtro sem divulgar SQL',async()=>{
  reset();failure=new Error('EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR');problem(await request().send({acceptingEntries:false}),500,'INTERNAL_SERVER_ERROR');
});
test('E08.14 DI real resolve controller, serviço e TTL sem conectar',async()=>{
  const real=await NestFactory.create(EventsModule,{logger:false});try{const controller=real.get(ExperienceQueueControlController),service=real.get(ExperienceQueueControlService);
    assert.equal(Reflect.get(controller,'queues'),service);assert.equal(Reflect.get(controller,'policy'),real.get(StaffIdempotencyPolicy));assert.equal(Reflect.get(service,'database'),real.get(DRIZZLE_DATABASE));assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount,0);
  }finally{await real.close();}
});
