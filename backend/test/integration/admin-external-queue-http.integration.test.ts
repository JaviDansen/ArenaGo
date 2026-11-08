import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import supertest from "supertest";
import type * as schema from "../../src/database/schema";
import type { ParticipationsService } from "../../src/participations/participations.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Barreira ANTES de importar AppModule/providers. Não usa .env ou banco remoto.
const urls=["DATABASE_URL","DATABASE_DIRECT_URL","EVENTS_TEST_DATABASE_URL"].map(name=>{
  const value=assertSafeTestDatabase(process.env[name]),url=new URL(value);
  if(url.hostname!=="127.0.0.1"||url.port!=="55432"||url.pathname!=="/arenago_events_test"||url.search||url.hash||!url.username)throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if(urls.some(value=>value!==urls[0]))throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH=devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS="60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS="60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS="60";
const pool=new Pool({connectionString:urls[0],ssl:false,max:6,connectionTimeoutMillis:2000,statement_timeout:15000,lock_timeout:12000});
let app:INestApplication,database:NodePgDatabase<typeof schema>,participations:ParticipationsService;
let signAccess:(userId:string,sessionId:string,expired?:boolean)=>string;
let fingerprint:(eventId:string,enabled:boolean,reason:string)=>string;
const operation="admin_set_external_queue",reason="Acesso direto autorizado pela organização";
const ids={events:[]as string[],users:[]as string[],versions:[]as string[],games:[]as string[]};
before(async()=>{
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,"arenago_events_test");
  const {AppModule}=await import("../../src/app.module");
  const {DRIZZLE_DATABASE}=await import("../../src/database/database.module");
  const {ParticipationsService}=await import("../../src/participations/participations.service");
  const {externalQueueFingerprint}=await import("../../src/events/admin-external-queue.service");fingerprint=externalQueueFingerprint;
  const tokens=await import("../../src/auth/token.util");
  signAccess=(userId,sessionId,expired)=>tokens.signAccessToken({userId,sessionId},expired?{nowMs:Date.now()-120000,ttlSeconds:1}:undefined);
  app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix("api/v1");await app.listen(0,"127.0.0.1");
  database=app.get(DRIZZLE_DATABASE);participations=app.get(ParticipationsService);
});
after(async()=>{
  const errors:unknown[]=[];
  try{
    const c=await pool.connect();try{
      await c.query("BEGIN");
      await c.query("DELETE FROM audit_logs WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])",[ids.events]);
      await c.query("DELETE FROM games WHERE id=ANY($1::uuid[])",[ids.games]);
      await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[ids.users]);
      await c.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])",[ids.versions]);await c.query("COMMIT");
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }catch(error){errors.push(error);}
  for(const r of await Promise.allSettled([app?.close(),pool.end()]))if(r.status==="rejected")errors.push(r.reason);
  if(errors.length)throw new AggregateError(errors,"Limpeza E08.6 falhou.");
});
async function account(){
  const userId=randomUUID(),sessionId=randomUUID();ids.users.push(userId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Pessoa privada E086',$2,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`,[userId,`${userId}@example.test`]);
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`,[sessionId,userId]);return{userId,sessionId,token:signAccess(userId,sessionId)};
}
async function grant(userId:string,eventId:string|null){const id=randomUUID();await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())",[id,userId,eventId?"staff":"admin",eventId]);return id;}
async function admin(){const a=await account(),roleId=await grant(a.userId,null);await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1",[a.sessionId]);return{...a,roleId};}
interface Context{eventId:string;experienceId:string;stationId:string;admin:Awaited<ReturnType<typeof admin>>;staff:Awaited<ReturnType<typeof account>>;}
async function context(enabled=true):Promise<Context>{
  const eventId=randomUUID(),experienceId=randomUUID(),stationId=randomUUID();ids.events.push(eventId);
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
    VALUES($1,'E086 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',$3,9007199254741000,clock_timestamp(),clock_timestamp())`,[eventId,`E086-${eventId.toUpperCase()}`,enabled]);
  const actor=await admin(),staff=await account();await grant(staff.userId,eventId);
  await pool.query("INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at) VALUES($1,$2,'Experiência E086',9007199254741000,clock_timestamp(),clock_timestamp())",[experienceId,eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação E086','available',clock_timestamp(),clock_timestamp())",[stationId,experienceId]);
  return{eventId,experienceId,stationId,admin:actor,staff};
}
async function person(c:Context,status:"waiting"|"active"|"finished"|"canceled"="waiting"){
  const a=await account(),participationId=randomUUID(),terminal=status==="finished"||status==="canceled";
  const order=status==="waiting"?(await pool.query("UPDATE events SET external_last_order=external_last_order+1 WHERE id=$1 RETURNING external_last_order::text AS n",[c.eventId])).rows[0].n:null;
  await pool.query(`INSERT INTO participations(id,user_id,event_id,status,external_queue_order,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4::varchar(20),$5,clock_timestamp(),CASE WHEN $6::boolean THEN clock_timestamp() END,
      CASE WHEN $7::boolean THEN clock_timestamp() END,CASE WHEN $7::boolean THEN 'fixture_terminal' END)`,[participationId,a.userId,c.eventId,status,order,status==="active",terminal]);
  return{...a,participationId};
}
async function snapshotProfile(participationId:string){
  const versionId=randomUUID();ids.versions.push(versionId);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())",[versionId,`e86-${versionId}`]);
  await pool.query(`INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at)
    VALUES($1,$2,'{"private":"E086_PRIVATE_PROFILE"}','[]',clock_timestamp())`,[participationId,versionId]);
}
async function readyEntrant(){
  const a=await account(),versionId=randomUUID(),gameId=randomUUID();ids.versions.push(versionId);ids.games.push(gameId);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())",[versionId,`e86-${versionId}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`,[a.userId,versionId]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())",[gameId,`E086-${gameId}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())",[a.userId,gameId]);return a;
}
const route=(c:Context)=>`/api/v1/admin/events/${c.eventId}/external-queue`;
const patch=(c:Context,enabled=false,key:string=randomUUID(),actor:{token:string}=c.admin,justification=reason)=>supertest(app.getHttpServer()).patch(route(c)).set("Authorization",`Bearer ${actor.token}`).set("Idempotency-Key",key).send({enabled,reason:justification});
const admit=(c:Context,a:{userId:string})=>participations.createParticipation({userId:a.userId,eventId:c.eventId,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+60000)});
async function audit(c:Context){return(await pool.query("SELECT * FROM audit_logs WHERE event_id=$1 ORDER BY occurred_at,id",[c.eventId])).rows;}
async function state(c:Context){return(await pool.query(`SELECT jsonb_build_object(
  'event',(SELECT to_jsonb(e)||jsonb_build_object('external_last_order',e.external_last_order::text) FROM events e WHERE e.id=$1),
  'people',(SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('external_queue_order',p.external_queue_order::text) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
  'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.participation_id) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.event_id=$1),
  'experiences',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('last_queue_order',e.last_queue_order::text) ORDER BY e.id) FROM experiences e WHERE e.event_id=$1),
  'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
  'queues',(SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('queue_order',q.queue_order::text) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
  'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
  'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_logs a WHERE a.event_id=$1),
  'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id IN
    (SELECT p.user_id FROM participations p WHERE p.event_id=$1 UNION SELECT $2::uuid UNION SELECT $3::uuid))) AS value`,[c.eventId,c.admin.userId,c.staff.userId])).rows[0].value;}
function problem(r:supertest.Response,status:number,code:string){assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.body.status,status);assert.equal(r.body.code,code);assert.match(r.headers["content-type"],/application\/problem\+json/);assert.equal(JSON.stringify(r.body).includes("@example.test"),false);}
async function blocked(pid:number){const until=Date.now()+6000;while(Date.now()<until){if((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid])).rows[0].n>0)return;await new Promise(done=>setTimeout(done,20));}throw new Error("Não foi observada espera real pelo lock esperado.");}
async function ordered<A,B>(first:()=>PromiseLike<A>,second:()=>PromiseLike<B>):Promise<[A,B]>{
  const original=database.transaction.bind(database)as typeof database.transaction;let ready!:(pid:number)=>void,release!:()=>void;
  const reached=new Promise<number>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});
  database.transaction=(callback,config)=>original(async tx=>{const value=await callback(tx);ready((await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);await gate;return value;},config);
  let a:Promise<A>|undefined,b:Promise<B>|undefined;
  try{a=Promise.resolve(first());a.catch(()=>undefined);const pid=await Promise.race([reached,a.then(()=>{throw new Error("Primeira operação não manteve tx.");})]);database.transaction=original;b=Promise.resolve(second());b.catch(()=>undefined);await blocked(pid);release();return await Promise.all([a,b]);}
  finally{database.transaction=original;release();await Promise.allSettled([a,b]);}
}
async function lockWait(c:Context,participationId:string|undefined,request:()=>PromiseLike<supertest.Response>,change:(client:PoolClient,pid:number)=>Promise<void>){
  const client=await pool.connect();let pending:Promise<supertest.Response>|undefined;
  try{await client.query("BEGIN");if(participationId)await client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE",[participationId]);else await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[c.eventId]);
    const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;pending=Promise.resolve(request());pending.catch(()=>undefined);await blocked(pid);await change(client,pid);await client.query("COMMIT");return await pending;
  }finally{await client.query("ROLLBACK");await Promise.allSettled([pending]);client.release();}
}
async function waitPastCutoff(c:Context,pid:number){
  assert.equal((await pool.query('SELECT clock_timestamp()<official_ends_at AS "beforeCut" FROM events WHERE id=$1',[c.eventId])).rows[0].beforeCut,true,"A espera precisa ser observada antes do corte real.");
  const until=Date.now()+12000;let crossed=false;
  while(Date.now()<until){if((await pool.query("SELECT clock_timestamp()>=official_ends_at AS ended FROM events WHERE id=$1",[c.eventId])).rows[0].ended){crossed=true;break;}await new Promise(done=>setTimeout(done,100));}
  assert.equal(crossed,true);await blocked(pid);
}

test("E08.6 PostgreSQL HTTP desliga e libera waiting com auditoria e instante comuns",async()=>{
  const c=await context(),people=[await person(c),await person(c),await person(c)];for(const p of people)await snapshotProfile(p.participationId);
  const before=await state(c),r=await patch(c);assert.equal(r.status,200);assert.equal(r.body.releasedCount,3);assert.equal(r.body.externalQueueEnabled,false);assert.match(r.body.changedAt,/Z$/);
  const after=await state(c);assert.deepEqual(after.snapshots,before.snapshots);assert.equal(after.event.external_last_order,before.event.external_last_order);
  for(const p of after.people){const old=before.people.find((row:{id:string})=>row.id===p.id);assert.deepEqual({...p,status:old.status,arena_entered_at:old.arena_entered_at},old);assert.equal(p.status,"active");assert.equal(Date.parse(p.arena_entered_at),Date.parse(r.body.changedAt));}
  const rows=await audit(c);assert.equal(rows.length,1);assert.equal(rows[0].actor_user_id,c.admin.userId);assert.equal(rows[0].event_id,c.eventId);assert.equal(rows[0].reason,reason);
  assert.equal(rows[0].origin,"user");assert.equal(rows[0].category,"event");assert.equal(rows[0].action,"external_queue_enabled_changed");assert.deepEqual(rows[0].metadata,{before:{externalQueueEnabled:true},after:{externalQueueEnabled:false},releasedCount:3});
  assert.equal((await pool.query("SELECT e.updated_at=a.occurred_at AS same FROM events e JOIN audit_logs a ON a.id=$2 WHERE e.id=$1",[c.eventId,rows[0].id])).rows[0].same,true);
});
test("E08.6 PostgreSQL HTTP preserva active/finished/canceled e dados de outros eventos",async()=>{
  const c=await context(),other=await context();await person(c);for(const status of ["active","finished","canceled"]as const)await person(c,status);await person(other);
  const before=await state(c),foreign=await state(other);assert.equal((await patch(c)).status,200);const after=await state(c);
  for(const p of before.people.filter((p:{status:string})=>p.status!=="waiting"))assert.deepEqual(after.people.find((row:{id:string})=>row.id===p.id),p);
  assert.deepEqual(await state(other),foreign);
});
test("E08.6 PostgreSQL HTTP não altera fila interna, atendimento ou recursos",async()=>{
  const c=await context(),p=await person(c,"active");await person(c);
  const joined=await supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/queue-entries`).set("Authorization",`Bearer ${p.token}`).set("Idempotency-Key",randomUUID()).send({experienceId:c.experienceId});assert.equal(joined.status,201);
  const called=await supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`).set("Authorization",`Bearer ${c.staff.token}`).set("Idempotency-Key",randomUUID()).send({});assert.equal(called.status,201);
  const before=await state(c);assert.equal((await patch(c)).status,200);const after=await state(c);
  for(const key of ["queues","services","experiences","stations"])assert.deepEqual(after[key],before[key]);
});
test("E08.6 PostgreSQL HTTP reativação só afeta ingressos futuros e não reinicia FIFO",async()=>{
  const c=await context(),old=await person(c);assert.equal((await patch(c)).status,200);
  const direct=await readyEntrant(),first=await admit(c,direct);assert.equal(first.kind,"created");if(first.kind!=="created")assert.fail();
  const before=await state(c);assert.equal((await patch(c,true)).status,200);const next=await admit(c,await readyEntrant());assert.equal(next.kind,"created");if(next.kind!=="created")assert.fail();
  const after=await state(c);assert.equal(after.people.find((p:{id:string})=>p.id===old.participationId).status,"active");assert.equal(after.people.find((p:{id:string})=>p.id===first.participationId).status,"active");
  const added=after.people.find((p:{id:string})=>p.id===next.participationId);assert.equal(added.status,"waiting");assert.equal(BigInt(added.external_queue_order),BigInt(before.event.external_last_order)+1n);
});
test("E08.6 PostgreSQL HTTP no-op não atualiza timestamps nem audita e omite changedAt",async()=>{
  for(const enabled of [false,true]){const c=await context(enabled);await person(c);const before=await state(c),r=await patch(c,enabled);assert.equal(r.status,200);assert.deepEqual(r.body,{eventId:c.eventId,externalQueueEnabled:enabled,releasedCount:0});
    const after=await state(c);delete before.idempotency;delete after.idempotency;assert.deepEqual(after,before);assert.equal((await audit(c)).length,0);}
});
test("E08.6 PostgreSQL HTTP exige Bearer e rejeita token inválido/expirado",async()=>{
  const c=await context(),before=await state(c);problem(await supertest(app.getHttpServer()).patch(route(c)).send({enabled:false,reason}),401,"MISSING_ACCESS_TOKEN");
  problem(await patch(c,false,randomUUID(),{token:"bad"}),401,"INVALID_ACCESS_TOKEN");problem(await patch(c,false,randomUUID(),{token:signAccess(c.admin.userId,c.admin.sessionId,true)}),401,"ACCESS_TOKEN_EXPIRED");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP Staff isolado, participante e Admin revogado são recusados",async()=>{
  const c=await context(),a=await admin(),outsider=await account();await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[a.roleId]);const before=await state(c);
  for(const actor of [c.staff,a,outsider])problem(await patch(c,false,randomUUID(),actor),403,"ADMIN_REQUIRED");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP segundo fator Admin obrigatório mesmo com concessão Staff",async()=>{
  const c=await context();await grant(c.admin.userId,c.eventId);await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1",[c.admin.sessionId]);const before=await state(c);
  problem(await patch(c),401,"ADMIN_2FA_REQUIRED");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP conta inativa e sessão revogada/expirada não produzem efeitos",async()=>{
  for(const mode of ["inactive","revoked","expired"]){const c=await context();
    if(mode==="inactive")await pool.query("UPDATE users SET is_active=false WHERE id=$1",[c.admin.userId]);
    else if(mode==="revoked")await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.sessionId]);
    else await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.admin.sessionId]);
    const before=await state(c);problem(await patch(c),401,mode==="inactive"?"ACCOUNT_DEACTIVATED":mode==="revoked"?"SESSION_REVOKED":"SESSION_EXPIRED");assert.deepEqual(await state(c),before);}
});
test("E08.6 PostgreSQL HTTP valida UUID e recusa evento ausente sem dados privados",async()=>{
  const c=await context(),before=await state(c);problem(await patch({...c,eventId:"bad"}),400,"VALIDATION_ERROR");problem(await patch({...c,eventId:randomUUID()}),404,"RESOURCE_NOT_FOUND");assert.deepEqual(await state(c),before);
  const r=await patch({...c,eventId:c.eventId.toUpperCase()});assert.equal(r.status,200);assert.equal(r.body.eventId,c.eventId);
});
test("E08.6 PostgreSQL HTTP body/reason estritos e chave única obrigatória",async()=>{
  const c=await context(),before=await state(c),request=()=>supertest(app.getHttpServer()).patch(route(c)).set("Authorization",`Bearer ${c.admin.token}`).set("Idempotency-Key",randomUUID());
  problem(await request(),400,"VALIDATION_ERROR");
  for(const body of [{},[],{enabled:false},{enabled:"false",reason},{enabled:false,reason:" "},{enabled:false,reason:"x".repeat(501)},{enabled:false,reason:"bad\u0000reason"},{enabled:false,reason,userId:c.admin.userId}])problem(await request().send(body),400,"VALIDATION_ERROR");
  problem(await request().type("text/plain").send(JSON.stringify({enabled:false,reason})),400,"VALIDATION_ERROR");problem(await request().type("application/json").send("{bad"),400,"BAD_REQUEST");
  problem(await supertest(app.getHttpServer()).patch(route(c)).set("Authorization",`Bearer ${c.admin.token}`).send({enabled:false,reason}),400,"VALIDATION_ERROR");
  for(const key of [""," ","x".repeat(129)])problem(await patch(c,false,key),400,"VALIDATION_ERROR");
  problem(await request().set({"Idempotency-Key":["a","b"]}).send({enabled:false,reason}),400,"VALIDATION_ERROR");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP reason normalizada e resposta não expõem pessoas/perfis/auditoria",async()=>{
  const c=await context(),p=await person(c);await snapshotProfile(p.participationId);const r=await patch(c,false,randomUUID(),c.admin,`  ${reason}  `);assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.body).sort(),["changedAt","eventId","externalQueueEnabled","releasedCount"]);assert.equal((await audit(c))[0].reason,reason);
  for(const secret of [reason,c.admin.userId,c.admin.sessionId,p.userId,p.participationId,"Pessoa privada E086","E086_PRIVATE_PROFILE","example.test","fixture-private-hash"])assert.equal(JSON.stringify(r.body).includes(secret),false);
});
test("E08.6 PostgreSQL HTTP mudanças após cortes ou antes do início não liberam waiting",async()=>{
  for(const mode of ["future","official","controlled","closed","immediate"]){for(const enabled of [false,true]){
    const c=await context(!enabled);await person(c);
    if(mode==="future")await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1",[c.eventId]);
    if(mode==="official")await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1",[c.eventId]);
    if(mode==="controlled")await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1",[c.eventId]);
    if(mode==="closed")await pool.query("UPDATE events SET status='closed' WHERE id=$1",[c.eventId]);
    if(mode==="immediate")await pool.query("UPDATE events SET status='closing',closure_mode='immediate',closure_requested_at=statement_timestamp()-interval '1 minute',admin_deadline_at=statement_timestamp()-interval '1 minute' WHERE id=$1",[c.eventId]);
    const before=await state(c);problem(await patch(c,enabled),409,"EVENT_REGISTRATION_CLOSED");assert.deepEqual(await state(c),before);
  }}
});
test("E08.6 PostgreSQL HTTP falta de prontidão bloqueia mudança e não mantém reserva parcial",async()=>{
  const c=await context();await person(c);await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1",[c.stationId]);const before=await state(c);problem(await patch(c),409,"EVENT_UNAVAILABLE");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP no-op após encerramento continua permitido sem liberações",async()=>{
  const c=await context(false);await person(c);await pool.query("UPDATE events SET status='closed' WHERE id=$1",[c.eventId]);const r=await patch(c);assert.equal(r.status,200);assert.equal(r.body.releasedCount,0);assert.equal((await audit(c)).length,0);assert.equal((await state(c)).people[0].status,"waiting");
});
test("E08.6 PostgreSQL HTTP retry reproduz resultado, contagem e instante sem nova auditoria",async()=>{
  const c=await context(),key=randomUUID();await person(c);await person(c);const first=await patch(c,false,key),before=await state(c),retry=await patch(c,false,key);assert.equal(first.status,200);assert.equal(retry.status,200);assert.deepEqual(retry.body,first.body);assert.equal(retry.body.releasedCount,2);assert.deepEqual(await state(c),before);assert.equal((await audit(c)).length,1);
});
test("E08.6 PostgreSQL HTTP retry antigo após intenção oposta não desliga nem libera novas esperas",async()=>{
  const c=await context(),key=randomUUID();await person(c);const first=await patch(c,false,key);assert.equal(first.status,200);assert.equal((await patch(c,true)).status,200);
  const entrant=await readyEntrant(),joined=await admit(c,entrant);assert.equal(joined.kind,"created");if(joined.kind!=="created")assert.fail();
  const before=await state(c),retry=await patch(c,false,key);assert.equal(retry.status,200);assert.deepEqual(retry.body,first.body);assert.deepEqual(await state(c),before);
  assert.equal((await state(c)).people.find((p:{id:string})=>p.id===joined.participationId).status,"waiting");assert.equal((await audit(c)).length,2);
});
test("E08.6 PostgreSQL HTTP retry de no-op antigo não reaplica estado após mudança oposta",async()=>{
  const c=await context(),key=randomUUID(),first=await patch(c,true,key);assert.equal(first.status,200);assert.equal(first.body.changedAt,undefined);
  assert.equal((await patch(c)).status,200);const before=await state(c),retry=await patch(c,true,key);assert.deepEqual(retry.body,first.body);assert.deepEqual(await state(c),before);assert.equal((await state(c)).event.external_queue_enabled,false);
});
test("E08.6 PostgreSQL HTTP reutilizar chave com estado ou justificativa distintos gera conflito",async()=>{
  const c=await context(),key=randomUUID();assert.equal((await patch(c,false,key)).status,200);const before=await state(c);
  problem(await patch(c,true,key),409,"IDEMPOTENCY_KEY_REUSED");problem(await patch(c,false,key,c.admin,"Outra justificativa"),409,"IDEMPOTENCY_KEY_REUSED");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP chave do mesmo ator não pode identificar outro evento",async()=>{
  const c=await context(),other=await context(),key=randomUUID();assert.equal((await patch(c,false,key)).status,200);
  const target={...other,admin:c.admin},before=await state(target);problem(await patch(target,false,key),409,"IDEMPOTENCY_KEY_REUSED");assert.deepEqual(await state(target),before);assert.equal((await audit(other)).length,0);
});
test("E08.6 PostgreSQL HTTP namespace de idempotência distingue atores Admin",async()=>{
  const c=await context(),second=await admin(),key=randomUUID();assert.equal((await patch(c,false,key)).status,200);assert.equal((await patch(c,true,key,second)).status,200);
  const rows=await audit(c);assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(row=>row.actor_user_id)),new Set([c.admin.userId,second.userId]));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE operation=$1 AND idempotency_key=$2 AND actor_user_id=ANY($3::uuid[])",[operation,key,[c.admin.userId,second.userId]])).rows[0].n,2);
});
test("E08.6 PostgreSQL HTTP expires_at vencido não elimina replay ou permite reexecução",async()=>{
  const c=await context(),key=randomUUID(),first=await patch(c,false,key);assert.equal(first.status,200);await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 hour' WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3",[c.admin.userId,operation,key]);
  assert.equal((await patch(c,true)).status,200);const before=await state(c);const retry=await patch(c,false,key);assert.equal(retry.status,200);assert.deepEqual(retry.body,first.body);assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP replay continua sujeito a autorização e sessão atuais",async()=>{
  for(const mode of ["role","session"]){const c=await context(),key=randomUUID();assert.equal((await patch(c,false,key)).status,200);
    if(mode==="role")await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.roleId]);else await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.sessionId]);
    const before=await state(c);problem(await patch(c,false,key),mode==="role"?403:401,mode==="role"?"ADMIN_REQUIRED":"SESSION_REVOKED");assert.deepEqual(await state(c),before);}
});
test("E08.6 PostgreSQL HTTP intenção in_progress persistida não é executada nem auditada",async()=>{
  const c=await context(),key=randomUUID();await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 hour')`,[randomUUID(),c.admin.userId,operation,key,fingerprint(c.eventId,false,reason)]);
  const before=await state(c);problem(await patch(c,false,key),409,"IDEMPOTENCY_IN_PROGRESS");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL HTTP normalização de reason conserva intenção e limites válidos são aceitos",async()=>{
  const c=await context(),key=randomUUID(),first=await patch(c,false,key,c.admin,` ${reason} `);assert.equal(first.status,200);assert.deepEqual((await patch(c,false,key)).body,first.body);assert.equal((await audit(c)).length,1);
  for(const text of ["x","x".repeat(500)]){const other=await context();assert.equal((await patch(other,false,randomUUID(),other.admin,text)).status,200);assert.equal((await audit(other))[0].reason,text);}
});
test("E08.6 PostgreSQL HTTP recusa não consome chave: nova tentativa válida pode executar",async()=>{
  const c=await context(),key=randomUUID();await person(c);await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1",[c.stationId]);problem(await patch(c,false,key),409,"EVENT_UNAVAILABLE");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND operation=$2",[c.admin.userId,operation])).rows[0].n,0);
  await pool.query("UPDATE stations SET availability='available' WHERE id=$1",[c.stationId]);assert.equal((await patch(c,false,key)).body.releasedCount,1);assert.equal((await audit(c)).length,1);
});
test("E08.6 PostgreSQL concorrente ingresso E03 primeiro integra a liberação externa",async()=>{
  const c=await context(),a=await readyEntrant();const[joined,changed]=await ordered(()=>admit(c,a),()=>patch(c));assert.equal(joined.kind,"created");assert.equal(changed.status,200);assert.equal(changed.body.releasedCount,1);
  if(joined.kind!=="created")assert.fail();const row=(await pool.query("SELECT status,external_queue_order::text AS n,arena_entered_at FROM participations WHERE id=$1",[joined.participationId])).rows[0];assert.equal(row.status,"active");assert.ok(BigInt(row.n)>BigInt(Number.MAX_SAFE_INTEGER));assert.equal(row.arena_entered_at.toISOString(),changed.body.changedAt);
});
test("E08.6 PostgreSQL concorrente desativação primeiro faz E03 ingressar diretamente active",async()=>{
  const c=await context(),a=await readyEntrant(),before=(await state(c)).event.external_last_order;
  const[changed,joined]=await ordered(()=>patch(c),()=>admit(c,a));assert.equal(changed.status,200);assert.equal(changed.body.releasedCount,0);assert.equal(joined.kind,"created");if(joined.kind!=="created")assert.fail();
  const row=(await pool.query("SELECT status,external_queue_order,arena_entered_at FROM participations WHERE id=$1",[joined.participationId])).rows[0];assert.equal(row.status,"active");assert.equal(row.external_queue_order,null);assert.ok(row.arena_entered_at);assert.equal((await state(c)).event.external_last_order,before);
});
test("E08.6 PostgreSQL concorrente mesma intenção retorna mesmo resultado e uma auditoria",async()=>{
  const c=await context(),key=randomUUID();await person(c);await person(c);const[a,b]=await ordered(()=>patch(c,false,key),()=>patch(c,false,key));assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body,b.body);assert.equal(b.body.releasedCount,2);assert.equal((await audit(c)).length,1);
});
test("E08.6 PostgreSQL concorrente intenções iguais distintas preservam no-op da segunda",async()=>{
  const c=await context();await person(c);const[a,b]=await ordered(()=>patch(c),()=>patch(c));assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.releasedCount,1);assert.equal(b.body.releasedCount,0);assert.equal(b.body.changedAt,undefined);assert.equal((await audit(c)).length,1);
});
for(const first of [false,true])test(`E08.6 PostgreSQL concorrente alternâncias opostas com ${first} primeiro serializam`,async()=>{
  const c=await context(!first),p=await person(c);const[a,b]=await ordered(()=>patch(c,first),()=>patch(c,!first));assert.equal(a.status,200);assert.equal(b.status,200);assert.equal((await state(c)).event.external_queue_enabled,!first);assert.equal((await audit(c)).length,2);
  assert.equal((await pool.query("SELECT status FROM participations WHERE id=$1",[p.participationId])).rows[0].status,"active");assert.equal(a.body.releasedCount+b.body.releasedCount,1);
});
test("E08.6 PostgreSQL concorrente fechamento antes do PATCH bloqueia alteração/liberação",async()=>{
  const c=await context();await person(c);const before=await state(c),r=await lockWait(c,undefined,()=>patch(c),async client=>{
    await client.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1",[c.eventId]);
  });problem(r,409,"EVENT_REGISTRATION_CLOSED");const after=await state(c);assert.deepEqual(after.people,before.people);assert.equal(after.event.external_queue_enabled,true);assert.equal(after.idempotency,null);assert.equal((await audit(c)).length,0);
});
test("E08.6 PostgreSQL concorrente PATCH antes do fechamento confirma e retry não reabre",async()=>{
  const c=await context(),key=randomUUID();await person(c);const[r]=await ordered(()=>patch(c,false,key),()=>pool.query("UPDATE events SET status='closed' WHERE id=$1",[c.eventId]));assert.equal(r.status,200);
  problem(await patch(c,true),409,"EVENT_REGISTRATION_CLOSED");const before=await state(c),retry=await patch(c,false,key);assert.deepEqual(retry.body,r.body);assert.deepEqual(await state(c),before);assert.equal((await audit(c)).length,1);
});
test("E08.6 PostgreSQL concorrente autorização/sessão/2FA são revalidadas após espera de waiting",async()=>{
  for(const mode of ["inactive","role","revoked","expired","2fa"]){const c=await context(),p=await person(c),before=await state(c);
    const r=await lockWait(c,p.participationId,()=>patch(c),async()=>{
      if(mode==="inactive")await pool.query("UPDATE users SET is_active=false WHERE id=$1",[c.admin.userId]);
      if(mode==="role")await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.roleId]);
      if(mode==="revoked")await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.sessionId]);
      if(mode==="expired")await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.admin.sessionId]);
      if(mode==="2fa")await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1",[c.admin.sessionId]);
    });problem(r,mode==="role"?403:401,mode==="inactive"?"ACCOUNT_DEACTIVATED":mode==="role"?"ADMIN_REQUIRED":mode==="revoked"?"SESSION_REVOKED":mode==="expired"?"SESSION_EXPIRED":"ADMIN_2FA_REQUIRED");assert.deepEqual(await state(c),before);}
});
test("E08.6 PostgreSQL concorrente revogação Admin primeiro prevalece após lock da concessão",async()=>{
  const c=await context(),client=await pool.connect();let response:Promise<supertest.Response>|undefined;
  try{await client.query("BEGIN");await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.roleId]);const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    response=Promise.resolve(patch(c));response.catch(()=>undefined);await blocked(pid);await client.query("COMMIT");problem(await response,403,"ADMIN_REQUIRED");assert.equal((await audit(c)).length,0);
  }finally{await client.query("ROLLBACK");await Promise.allSettled([response]);client.release();}
});
test("E08.6 PostgreSQL concorrente PATCH primeiro conserva concessão até commit",async()=>{
  const c=await context(),key=randomUUID();const[r]=await ordered(()=>patch(c,false,key),()=>pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.admin.roleId]));assert.equal(r.status,200);assert.equal((await audit(c)).length,1);problem(await patch(c,false,key),403,"ADMIN_REQUIRED");
});
for(const lock of ["event","participation"]as const)test(`E08.6 PostgreSQL corte temporal real durante espera de ${lock} não libera waiting`,async()=>{
  const c=await context(),p=await person(c);
  await pool.query("UPDATE events SET official_ends_at=clock_timestamp()+interval '10 seconds',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1",[c.eventId]);const before=await state(c);
  const r=await lockWait(c,lock==="event"?undefined:p.participationId,()=>patch(c),async(_client,pid)=>waitPastCutoff(c,pid));problem(r,409,"EVENT_REGISTRATION_CLOSED");assert.deepEqual(await state(c),before);
});
test("E08.6 PostgreSQL falhas reais de E05/auditoria/conclusão revertem todos os efeitos",async()=>{
  const dialect=new PgDialect();
  for(const phase of ["e05","audit","after-audit","after-completion"]){
    const c=await context();await person(c);await person(c);const before=await state(c),original=database.transaction.bind(database)as typeof database.transaction,domain=participations.setExternalQueueEnabledWithTx.bind(participations);let reached=false;
    if(phase==="e05")participations.setExternalQueueEnabledWithTx=async(...args)=>{
      const value=await domain(...args);assert.equal(value.kind,"changed");if(value.kind!=="changed")assert.fail();assert.equal(value.releasedCount,2);
      const rows=(await args[0].execute<{active:boolean}>(sql`SELECT bool_and(status='active') AS active FROM participations WHERE event_id=${c.eventId}`)).rows;assert.equal(rows[0].active,true);reached=true;await args[0].execute(sql`SELECT 1/0`);return value;
    };
    database.transaction=(callback,config)=>original(async tx=>{
      const execute=tx.execute.bind(tx);
      tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{
        const query=args[0],text=typeof query==="string"?query:dialect.sqlToQuery(query.getSQL()).sql;
        if(text.includes("INSERT INTO audit_logs")&&phase==="audit"){reached=true;await execute(sql`SELECT 1/0`);}
        const value=await execute(...args);if(text.includes("INSERT INTO audit_logs")&&phase==="after-audit"){reached=true;await execute(sql`SELECT 1/0`);}return value;
      })as typeof tx.execute;
      const value=await callback(tx);
      if(phase==="after-completion"){
        const persisted=(await execute<{status:string}>(sql`SELECT status FROM idempotency_operations WHERE actor_user_id=${c.admin.userId} AND operation=${operation}`)).rows;assert.equal(persisted.length,1);assert.equal(persisted[0].status,"completed");reached=true;await execute(sql`SELECT 1/0`);
      }
      return value;
    },config);
    try{problem(await patch(c),500,"INTERNAL_SERVER_ERROR");}finally{database.transaction=original;participations.setExternalQueueEnabledWithTx=domain;}
    assert.equal(reached,true);assert.deepEqual(await state(c),before);assert.equal((await audit(c)).length,0);
  }
});
