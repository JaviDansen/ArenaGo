import type { MutationSession } from "../../src/auth/mutation-session";
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Pool } from "pg";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";
import { EventsModule } from "../../src/events/events.module";
import { ParticipantQueueIdempotencyPolicy } from "../../src/events/participant-queue-idempotency.policy";
import { EvaluationReadController } from "../../src/evaluations/evaluation-read.controller";
import { EvaluationReadService } from "../../src/evaluations/evaluation-read.service";
import { ParticipationLifecycleController } from "../../src/participations/participation-lifecycle.controller";
import { ParticipationLifecycleService, type LifecycleResult, type LifecycleFailure } from "../../src/participations/participation-lifecycle.service";
import { ParticipationQueryService } from "../../src/participations/participation-query.service";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,"0")}`,uid=id(1),pid=id(2),at="2026-11-04T15:00:00.123456Z";
const value={id:pid,eventId:id(3),status:"active" as const,joinedAt:at,arenaEnteredAt:at,finishedAt:null,finishReason:null,externalQueue:null};
const calls:Array<{mode:string;input:unknown}>=[];let result:LifecycleResult={kind:"changed",participation:value},found=true,failure=false;
@Module({controllers:[EvaluationReadController,ParticipationLifecycleController],providers:[SessionAuthGuard,ParticipantQueueIdempotencyPolicy,
  {provide:AuthService,useValue:{async authenticateBearerToken(token:string){
    if(token==="admin-no-2fa")throw new ProblemException({status:401,code:"ADMIN_2FA_REQUIRED",typeSlug:"admin-2fa-required",title:"2FA",detail:"Segundo fator obrigatório."});
    if(!["participant","staff","admin"].includes(token))throw new ProblemException({status:401,code:"SESSION_REVOKED",typeSlug:"session-revoked",title:"Sessão inválida",detail:"Sessão inválida."});
    return {userId:uid,sessionId:id(4),roles:token==="participant"?[]:[token]};
  }}},
  {provide:ParticipationQueryService,useValue:{current:(userId:string)=>{calls.push({mode:"current",input:userId});return found?value:null;},byId:(userId:string,participationId:string)=>{calls.push({mode:"byId",input:{userId,participationId}});return found?value:null;}}},
  {provide:ParticipationLifecycleService,useValue:{cancelAuthenticated:(input:unknown, context: MutationSession) => { authenticatedInput(context, undefined); calls.push({mode:"cancel",input});if(failure)throw Error("PARTICIPATION_LIFECYCLE_INTERNAL_ERROR");return result;},finishAuthenticated:(input:unknown, context: MutationSession) => { authenticatedInput(context, undefined); calls.push({mode:"finish",input});if(failure)throw Error("PARTICIPATION_LIFECYCLE_INTERNAL_ERROR");return result;}}},
  {provide:EvaluationReadService,useValue:{getHistory:()=>({items:[],nextCursor:null}),getReturnState:()=>({recentFinalization:null,pendingEvaluationParticipationIds:[]}),getPending:()=>({items:[]})}},
]})class HttpModule{}
let app:INestApplication;
before(async()=>{app=await NestFactory.create(HttpModule,{logger:false});app.setGlobalPrefix("api/v1");app.useGlobalFilters(new ProblemDetailsExceptionFilter());await app.listen(0,"127.0.0.1");});
after(async()=>{await app?.close();});
function request(mode:"current"|"byId"|"cancel"|"finish",token="participant",resource=pid){
  const r=mode==="current"?supertest(app.getHttpServer()).get('/api/v1/participations/current'):mode==="byId"?supertest(app.getHttpServer()).get(`/api/v1/participations/${resource}`):supertest(app.getHttpServer()).post(`/api/v1/participations/${resource}/${mode}`);
  return r.set("Authorization",`Bearer ${token}`).set("Idempotency-Key","opaque,key");
}
function reset(){calls.length=0;result={kind:"changed",participation:value};found=true;failure=false;}
function problem(r:supertest.Response,status:number,code:string){assert.equal(r.status,status);assert.equal(r.body.code,code);assert.match(r.headers['content-type'],/application\/problem\+json/);}
for(const mode of ["current","byId","cancel","finish"]as const){
  test(`E08.12 HTTP ${mode} exige Bearer/sessão e 2FA existente`,async()=>{
    reset();problem(await request(mode).unset('Authorization'),401,"MISSING_ACCESS_TOKEN");problem(await request(mode,"revoked"),401,"SESSION_REVOKED");problem(await request(mode,"admin-no-2fa"),401,"ADMIN_2FA_REQUIRED");assert.equal(calls.length,0);
  });
  test(`E08.12 HTTP ${mode} usa somente o ator autenticado e resposta pública`,async()=>{
    reset();const r=await request(mode).query({userId:id(99)}).send(mode==="cancel"||mode==="finish"?{}:undefined);assert.equal(r.status,200);assert.deepEqual(r.body,{participation:value});
    const arg=calls[0].input;assert.equal(typeof arg==="string"?arg:(arg as {userId:string}).userId,uid);
    if(mode==="cancel"||mode==="finish"){const i=arg as {idempotencyKey:string;expiresAt:Date};assert.equal(i.idempotencyKey,"opaque,key");assert.ok(i.expiresAt.getTime()>Date.now());}
  });
}
test("E08.12 HTTP ausência current é 200/null; detalhe ausente é 404 indistinguível",async()=>{
  reset();found=false;const current=await request("current");assert.equal(current.status,200);assert.deepEqual(current.body,{participation:null});
  const a=await request("byId"),b=await request("byId","participant",id(99));problem(a,404,"RESOURCE_NOT_FOUND");assert.deepEqual(a.body,b.body);
});
test("E08.12 HTTP rotas literais current/history/return-state não colidem com UUID",async()=>{
  reset();for(const route of ["history","return-state"]){const r=await supertest(app.getHttpServer()).get(`/api/v1/participations/${route}`).set('Authorization','Bearer participant');assert.equal(r.status,200);assert.equal(calls.length,0);}
  assert.equal((await request("current")).status,200);assert.equal(calls[0].mode,"current");
});
for(const mode of ["byId","cancel","finish"]as const)test(`E08.12 HTTP ${mode} UUID inválido não chega ao serviço`,async()=>{
  reset();problem(await request(mode,"participant","invalid").send(mode==="byId"?undefined:{}),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
});
for(const mode of ["cancel","finish"]as const){
  test(`E08.12 HTTP ${mode} aceita {} e ausência, replay preserva corpo histórico`,async()=>{
    reset();result={kind:"replay",participation:value};for(const body of [undefined,{}]){const r=await request(mode).send(body);assert.equal(r.status,200);assert.deepEqual(r.body,{participation:value});}
  });
  test(`E08.12 HTTP ${mode} rejeita campos extras, corpo inadequado e chave inválida`,async()=>{
    reset();for(const body of [{userId:uid},{status:"finished"},{finishedAt:at},{reason:"forged"},[],{participationId:pid}])problem(await request(mode).send(body),400,"VALIDATION_ERROR");
    problem(await request(mode).type('text/plain').send('x'),400,"VALIDATION_ERROR");problem(await request(mode).type('json').send('{invalid'),400,"BAD_REQUEST");
    for(const key of [""," ","x".repeat(129)])problem(await request(mode).set('Idempotency-Key',key).send({}),400,"VALIDATION_ERROR");
    problem(await request(mode).unset('Idempotency-Key').send({}),400,"VALIDATION_ERROR");problem(await request(mode).set({'Idempotency-Key':['a','b']}).send({}),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
  });
  test(`E08.12 HTTP ${mode} falha interna não expõe estado ou SQL`,async()=>{
    reset();failure=true;problem(await request(mode).send({}),500,"INTERNAL_SERVER_ERROR");
  });
}
for(const [kind,code]of Object.entries({access_denied:"RESOURCE_NOT_FOUND",not_waiting:"PARTICIPATION_NOT_WAITING",not_active:"PARTICIPATION_NOT_ACTIVE",event_ended:"EVENT_OPERATION_ENDED",request_conflict:"IDEMPOTENCY_KEY_REUSED",in_progress:"IDEMPOTENCY_IN_PROGRESS"}))test(`E08.12 HTTP mapeia ${kind}`,async()=>{
  reset();result={kind:kind as LifecycleFailure};for(const mode of ["cancel","finish"]as const)problem(await request(mode).send({}),kind==="access_denied"?404:409,code);
});
test("E08.12 HTTP conflito de estado traz somente a participação própria atualizada",async()=>{
  reset();result={kind:"not_waiting",participation:value};const r=await request("cancel").send({});problem(r,409,"PARTICIPATION_NOT_WAITING");assert.deepEqual(r.body.participation,value);
});
test("E08.12 HTTP Staff/Admin agem como participantes próprios sem prerrogativa adicional",async()=>{
  reset();for(const actor of ["staff","admin"])for(const mode of ["current","byId","cancel","finish"]as const)assert.equal((await request(mode,actor).send(mode==="cancel"||mode==="finish"?{}:undefined)).status,200);
});
test("E08.12 DI Nest resolve serviços reais e reutiliza TTL explícito sem conectar",async()=>{
  const real=await NestFactory.create(EventsModule,{logger:false});try{
    const controller=real.get(ParticipationLifecycleController),queries=real.get(ParticipationQueryService),writes=real.get(ParticipationLifecycleService);
    assert.equal(Reflect.get(controller,"queries"),queries);assert.equal(Reflect.get(controller,"writes"),writes);assert.equal(Reflect.get(controller,"policy"),real.get(ParticipantQueueIdempotencyPolicy));
    assert.equal(Reflect.get(writes,"database"),real.get(DRIZZLE_DATABASE));assert.equal(Reflect.get(queries,"database"),real.get(DRIZZLE_DATABASE));assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount,0);
  }finally{await real.close();}
});

function authenticatedInput<T>(context: MutationSession, result: T): T {
  assert.deepEqual(context, { userId: uid, sessionId: id(4) }); return result;
}
