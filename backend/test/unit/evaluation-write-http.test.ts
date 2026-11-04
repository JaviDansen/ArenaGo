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
import { EventsModule } from "../../src/events/events.module";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";
import { EvaluationWriteController, EvaluationWriteIdempotencyPolicy } from "../../src/evaluations/evaluation-write.controller";
import { EvaluationWriteService } from "../../src/evaluations/evaluation-write.service";
import type { EvaluationWriteFailure, EvaluationWriteResult } from "../../src/evaluations/evaluation-write.types";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,"0")}`, uid=id(1),pid=id(2),eid=id(3),at="2026-11-04T15:00:00.123456Z";
const value={ id:eid,participationId:pid,rating:5,comment:null,submittedAt:at,updatedAt:at,editableUntilAt:at,commentAddUntilAt:at,
  permissions:{ canEditRating:true,canEditComment:true,canAddFirstComment:false } };
let result:EvaluationWriteResult={ kind:"created",evaluation:value },failure:Error|undefined;
const calls:Array<{ mode:string; input:Record<string,unknown> }>=[];
@Module({ controllers:[EvaluationWriteController],providers:[EvaluationWriteIdempotencyPolicy,SessionAuthGuard,
  { provide:AuthService,useValue:{ async authenticateBearerToken(token:string) {
    if(token==="admin-no-2fa")throw new ProblemException({status:401,code:"ADMIN_2FA_REQUIRED",typeSlug:"admin-2fa-required",title:"2FA",detail:"Segundo fator obrigatório."});
    if(!["participant","admin","staff"].includes(token))throw new ProblemException({status:401,code:"INVALID_ACCESS_TOKEN",typeSlug:"invalid-access-token",title:"Inválido",detail:"Token inválido."});
    return { userId:uid,sessionId:id(4),roles:token==="participant"?[]:[token] };
  } } },
  { provide:EvaluationWriteService,useValue:{ submit:(input:Record<string,unknown>)=>{calls.push({mode:"submit",input});if(failure)throw failure;return result;},
    edit:(input:Record<string,unknown>)=>{calls.push({mode:"edit",input});if(failure)throw failure;return result;} } },
] })class HttpModule{}
let app:INestApplication;
before(async()=>{app=await NestFactory.create(HttpModule,{logger:false});app.setGlobalPrefix("api/v1");app.useGlobalFilters(new ProblemDetailsExceptionFilter());await app.listen(0,"127.0.0.1");});
after(async()=>{await app?.close();});
function request(mode:"submit"|"edit",token="participant",key="opaque,key"){
  const r=mode==="submit"?supertest(app.getHttpServer()).post(`/api/v1/participations/${pid}/evaluation`):supertest(app.getHttpServer()).patch(`/api/v1/evaluations/${eid}`);
  return r.set("Authorization",`Bearer ${token}`).set("Idempotency-Key",key);
}
function reset(){calls.length=0;failure=undefined;result={kind:"created",evaluation:value};}
function problem(r:supertest.Response,status:number,code:string){assert.equal(r.status,status);assert.equal(r.body.code,code);assert.equal(r.body.status,status);assert.match(r.headers["content-type"],/application\/problem\+json/);}
for(const mode of ["submit","edit"]as const){
  test(`E08.11 HTTP ${mode} responde contrato e usa somente ator autenticado`,async()=>{
    reset();const start=Date.now(),r=await request(mode).query({userId:id(99)}).send({rating:5,comment:" "});
    assert.equal(r.status,mode==="submit"?201:200);assert.deepEqual(r.body,{evaluation:value});assert.equal(calls[0].input.userId,uid);
    assert.equal(calls[0].input.idempotencyKey,"opaque,key");assert.deepEqual(calls[0].input.payload,{rating:5,comment:null});
    const expires=calls[0].input.expiresAt as Date;assert.ok(expires.getTime()>=start+60000&&expires.getTime()<=Date.now()+60000);
  });
  test(`E08.11 HTTP ${mode} replay mantém status original e resposta histórica`,async()=>{
    reset();result={kind:"replay",evaluation:value};const r=await request(mode).send({rating:5});assert.equal(r.status,mode==="submit"?201:200);assert.deepEqual(r.body,{evaluation:value});
  });
  test(`E08.11 HTTP ${mode} exige sessão e respeita segundo fator Admin`,async()=>{
    reset();problem(await request(mode).unset("Authorization").send({rating:5}),401,"MISSING_ACCESS_TOKEN");
    problem(await request(mode,"bad").send({rating:5}),401,"INVALID_ACCESS_TOKEN");problem(await request(mode,"admin-no-2fa").send({rating:5}),401,"ADMIN_2FA_REQUIRED");assert.equal(calls.length,0);
    for(const token of ["admin","staff"])assert.equal((await request(mode,token).send({rating:5})).status,mode==="submit"?201:200);
  });
  test(`E08.11 HTTP ${mode} rejeita UUID e normaliza recurso`,async()=>{
    reset();const route=mode==="submit"?`/api/v1/participations/bad/evaluation`:`/api/v1/evaluations/bad`;
    const r=mode==="submit"?supertest(app.getHttpServer()).post(route):supertest(app.getHttpServer()).patch(route);
    problem(await r.set("Authorization","Bearer participant").set("Idempotency-Key","key").send({rating:5}),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
    const normal=mode==="submit"?supertest(app.getHttpServer()).post(`/api/v1/participations/${pid.toUpperCase()}/evaluation`):supertest(app.getHttpServer()).patch(`/api/v1/evaluations/${eid.toUpperCase()}`);
    await normal.set("Authorization","Bearer participant").set("Idempotency-Key","key").send({rating:5});assert.equal(calls[0].input[mode==="submit"?"participationId":"evaluationId"],mode==="submit"?pid:eid);
  });
  test(`E08.11 HTTP ${mode} valida chave única sem renormalizar`,async()=>{
    reset();for(const key of [""," ","x".repeat(129)])problem(await request(mode,"participant",key).send({rating:5}),400,"VALIDATION_ERROR");
    problem(await request(mode).unset("Idempotency-Key").send({rating:5}),400,"VALIDATION_ERROR");
    problem(await request(mode).set({"Idempotency-Key":["a","b"]}).send({rating:5}),400,"VALIDATION_ERROR");assert.equal(calls.length,0);
    assert.equal((await request(mode,"participant","x".repeat(128)).send({rating:5})).status,mode==="submit"?201:200);
  });
  test(`E08.11 HTTP ${mode} rejeita campos controlados pelo servidor e conteúdo inválido`,async()=>{
    reset();for(const body of [[],{}, {rating:5,userId:uid},{rating:5,permissions:{}},{rating:5,submittedAt:at},{rating:5,comment:"😀".repeat(2001)},{rating:0},{rating:1.5}]){
      problem(await request(mode).send(body),400,"VALIDATION_ERROR");
    }
    problem(await request(mode).type("text/plain").send("private"),400,"VALIDATION_ERROR");problem(await request(mode).type("json").send("{invalid"),400,"BAD_REQUEST");assert.equal(calls.length,0);
  });
  test(`E08.11 HTTP ${mode} falha inesperada preserva RFC 7807 sem informações privadas`,async()=>{
    reset();failure=new Error("EVALUATION_WRITE_INTERNAL_ERROR");const r=await request(mode).send({rating:5,comment:"PRIVATE"});problem(r,500,"INTERNAL_SERVER_ERROR");assert.equal(JSON.stringify(r.body).includes("PRIVATE"),false);
  });
}
for(const [kind,code]of Object.entries({access_denied:"RESOURCE_NOT_FOUND",not_eligible:"EVALUATION_NOT_ELIGIBLE",submission_expired:"EVALUATION_SUBMISSION_EXPIRED",
  already_submitted:"EVALUATION_ALREADY_SUBMITTED",edit_window_closed:"EVALUATION_EDIT_WINDOW_CLOSED",comment_already_added:"COMMENT_ALREADY_ADDED",request_conflict:"IDEMPOTENCY_KEY_REUSED",in_progress:"IDEMPOTENCY_IN_PROGRESS"})){
  test(`E08.11 HTTP mapeia ${kind} sem refletir nota/comentário`,async()=>{
    reset();result={kind:kind as EvaluationWriteFailure};for(const mode of ["submit","edit"]as const)problem(await request(mode).send({rating:5}),kind==="access_denied"?404:409,code);
  });
}
test("E08.11 HTTP PATCH mantém ausência de campos e aceita remoção explícita",async()=>{
  reset();assert.equal((await request("edit").send({comment:null})).status,200);assert.deepEqual(calls[0].input.payload,{comment:null});
  assert.equal((await request("edit").send({rating:4})).status,200);assert.deepEqual(calls[1].input.payload,{rating:4});
});
test("E08.11 TTL de avaliação é explícito e não usa fallback de Staff/Admin",()=>{
  const name="EVALUATION_IDEMPOTENCY_TTL_SECONDS",old=process.env[name];
  try{for(const raw of [undefined,"","0","-1","1.5","1e3","8640000000000"]){if(raw===undefined)delete process.env[name];else process.env[name]=raw;assert.throws(()=>new EvaluationWriteIdempotencyPolicy(),/EVALUATION_IDEMPOTENCY/);}}
  finally{if(old===undefined)delete process.env[name];else process.env[name]=old;}
});
test("E08.11 DI Nest resolve escritas, política e banco reais sob tsx sem conectar",async()=>{
  const real=await NestFactory.create(EventsModule,{logger:false});try{
    const controller=real.get(EvaluationWriteController),writes=real.get(EvaluationWriteService);
    assert.ok(Reflect.get(controller,"writes")===writes);assert.ok(Reflect.get(controller,"policy")===real.get(EvaluationWriteIdempotencyPolicy));
    assert.ok(Reflect.get(writes,"database")===real.get(DRIZZLE_DATABASE));assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount,0);
  }finally{await real.close();}
});
