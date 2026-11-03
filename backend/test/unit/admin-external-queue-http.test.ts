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
import { ParticipationsService } from "../../src/participations/participations.service";
import { EventsService } from "../../src/events/events.service";
import { AdminEventsModule } from "../../src/events/admin-events.module";
import { AdminExternalQueueController } from "../../src/events/admin-external-queue.controller";
import { AdminExternalQueueService } from "../../src/events/admin-external-queue.service";
import { AdminIdempotencyPolicy } from "../../src/events/admin-idempotency.policy";
import type { AdminExternalQueueInput, AdminExternalQueueResult } from "../../src/events/admin-external-queue.types";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,"0")}`;
const eventId=id(1),userId=id(2),sessionId=id(3),at=new Date("2026-11-03T15:00:00Z");
const route=`/api/v1/admin/events/${eventId}/external-queue`,body={enabled:false,reason:"Operação autorizada"};
const state={eventId,externalQueueEnabled:false,releasedCount:3,changedAt:at};
let result:AdminExternalQueueResult,failure:Error|undefined;
const calls:AdminExternalQueueInput[]=[];
@Module({controllers:[AdminExternalQueueController],providers:[SessionAuthGuard,AdminIdempotencyPolicy,
  {provide:AuthService,useValue:{authenticateBearerToken:async(token:string)=>{
    if(token!=="unit-admin")throw new ProblemException({typeSlug:"invalid-access-token",title:"Inválido",status:401,code:"INVALID_ACCESS_TOKEN",detail:"Token inválido."});
    return {userId,sessionId,roles:["admin"]};
  }}},
  {provide:AdminExternalQueueService,useValue:{setExternalQueue:async(input:AdminExternalQueueInput)=>{calls.push(input);if(failure)throw failure;return result;}}},
]})
class HttpUnitModule{}
let app:INestApplication;
const variables=["ADMIN_IDEMPOTENCY_TTL_SECONDS","STAFF_IDEMPOTENCY_TTL_SECONDS","PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"];
const previous=variables.map(name=>process.env[name]);
before(async()=>{
  for(const name of variables)process.env[name]="60";
  app=await NestFactory.create(HttpUnitModule,{logger:false});app.setGlobalPrefix("api/v1");app.useGlobalFilters(new ProblemDetailsExceptionFilter());await app.listen(0,"127.0.0.1");
});
after(async()=>{await app?.close();variables.forEach((name,n)=>{if(previous[n]===undefined)delete process.env[name];else process.env[name]=previous[n];});});
const patch=(url=route)=>supertest(app.getHttpServer()).patch(url).set("Authorization","Bearer unit-admin").set("Idempotency-Key","  opaque key  ");
function reset(){calls.length=0;failure=undefined;result={kind:"completed",...state};}
function problem(r:supertest.Response,status:number,code:string){assert.equal(r.status,status);assert.equal(r.body.status,status);assert.equal(r.body.code,code);assert.match(r.headers["content-type"],/application\/problem\+json/);}
test("E08.6 HTTP delega identidade confiável e TTL Admin explícito; projeta 200 sem kind",async()=>{
  reset();const before=Date.now(),r=await patch().query({userId:id(9),sessionId:id(10)}).send({...body,reason:"  Operação autorizada  "});
  assert.equal(r.status,200);assert.deepEqual(r.body,JSON.parse(JSON.stringify(state)));assert.equal(calls.length,1);
  const input=calls[0];assert.equal(input.userId,userId);assert.equal(input.sessionId,sessionId);assert.equal(input.eventId,eventId);assert.equal(input.reason,body.reason);
  assert.equal(input.enabled,false);assert.equal(input.idempotencyKey,"opaque key"); // HTTP remove whitespace externo do valor do header.
  assert.ok(input.expiresAt.getTime()>=before+60000&&input.expiresAt.getTime()<=Date.now()+60000);
});
test("E08.6 HTTP no-op omite changedAt e replay preserva resposta histórica",async()=>{
  reset();result={kind:"completed",eventId,externalQueueEnabled:false,releasedCount:0};const noOp=await patch().send(body);assert.equal(noOp.status,200);assert.deepEqual(noOp.body,{eventId,externalQueueEnabled:false,releasedCount:0});
  result={kind:"replay",...state};assert.deepEqual((await patch().send(body)).body,JSON.parse(JSON.stringify(state)));
});
test("E08.6 HTTP Bearer obrigatório e inválido não chegam ao serviço",async()=>{
  reset();problem(await supertest(app.getHttpServer()).patch(route).send(body),401,"MISSING_ACCESS_TOKEN");problem(await patch().set("Authorization","Bearer invalid").send(body),401,"INVALID_ACCESS_TOKEN");assert.equal(calls.length,0);
});
test("E08.6 HTTP UUID inválido recebe 400; maiúsculas são normalizadas",async()=>{
  reset();problem(await patch(route.replace(eventId,"bad")).send(body),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
  assert.equal((await patch(route.replace(eventId,eventId.toUpperCase())).send(body)).status,200);assert.equal(calls[0].eventId,eventId);
});
test("E08.6 HTTP body/reason estritos e enabled booleano obrigatório",async()=>{
  reset();problem(await patch(),400,"VALIDATION_ERROR");
  for(const value of [{},[],{enabled:false},{...body,enabled:"false"},{...body,reason:null},{...body,reason:" "},
    {...body,reason:"x".repeat(501)},{...body,reason:"bad\u0000reason"},{...body,userId},{...body,expiresAt:"2099-01-01"}])problem(await patch().send(value),400,"VALIDATION_ERROR");
  problem(await patch().type("text/plain").send(JSON.stringify(body)),400,"VALIDATION_ERROR");problem(await patch().type("application/json").send("{bad"),400,"BAD_REQUEST");assert.equal(calls.length,0);
});
test("E08.6 HTTP exige uma única Idempotency-Key opaca válida",async()=>{
  reset();problem(await supertest(app.getHttpServer()).patch(route).set("Authorization","Bearer unit-admin").send(body),400,"VALIDATION_ERROR");
  for(const key of [""," ","x".repeat(129)])problem(await patch().set("Idempotency-Key",key).send(body),400,"VALIDATION_ERROR");
  problem(await patch().set({"Idempotency-Key":["a","b"]}).send(body),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
});
test("E08.6 HTTP mapeia recusas atuais e conflitos administrativos RFC 7807",async()=>{
  reset();for(const [kind,status,code]of[
    ["resource_not_found",404,"RESOURCE_NOT_FOUND"],["admin_required",403,"ADMIN_REQUIRED"],["account_inactive",401,"ACCOUNT_DEACTIVATED"],
    ["invalid_session",401,"INVALID_SESSION"],["session_revoked",401,"SESSION_REVOKED"],["session_expired",401,"SESSION_EXPIRED"],
    ["admin_2fa_required",401,"ADMIN_2FA_REQUIRED"],["event_closed",409,"EVENT_REGISTRATION_CLOSED"],["event_unavailable",409,"EVENT_UNAVAILABLE"],
    ["request_conflict",409,"IDEMPOTENCY_KEY_REUSED"],["in_progress",409,"IDEMPOTENCY_IN_PROGRESS"],
  ]as const){result={kind};const r=await patch().send(body);problem(r,status,code);assert.equal(JSON.stringify(r.body).includes(eventId),false);}
});
test("E08.6 HTTP filtra propriedades internas e erros SQL/auditoria privados",async()=>{
  reset();Object.assign(result,{actor:userId,reason:"PRIVATE",audit:"PRIVATE"});assert.deepEqual((await patch().send(body)).body,JSON.parse(JSON.stringify(state)));
  failure=new Error("PRIVATE_SQL_secret@example.test");const r=await patch().send(body);problem(r,500,"INTERNAL_SERVER_ERROR");assert.equal(JSON.stringify(r.body).includes("PRIVATE"),false);assert.equal(JSON.stringify(r.body).includes("example.test"),false);
});
test("E08.6 TTL Admin é obrigatório e independente dos TTLs Staff/participante",()=>{
  const original=process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS;
  try{
    for(const value of [undefined,""," ","0","-1","1.5","1e3","NaN","9007199254740992","8640000000000"]){
      if(value===undefined)delete process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS;else process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS=value;
      assert.throws(()=>new AdminIdempotencyPolicy(),/ADMIN_IDEMPOTENCY_TTL_SECONDS/);
    }
  }finally{if(original===undefined)delete process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS;else process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS=original;}
});
test("E08.6 DI real sob tsx liga controller, orquestrador, E05 e EventsService ao mesmo banco",async()=>{
  const real=await NestFactory.create(AdminEventsModule,{logger:false});
  try{
    const service=real.get(AdminExternalQueueService),e05=real.get(ParticipationsService),events=real.get(EventsService),database=real.get(DRIZZLE_DATABASE);
    assert.equal(Reflect.get(real.get(AdminExternalQueueController),"queue"),service);assert.equal(Reflect.get(service,"participations"),e05);
    assert.equal(Reflect.get(service,"database"),database);assert.equal(Reflect.get(e05,"database"),database);assert.equal(Reflect.get(e05,"eventsService"),events);
    assert.equal(Reflect.get(events,"database"),database);assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount,0);
  }finally{await real.close();}
});
