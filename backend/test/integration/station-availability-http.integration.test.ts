import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import supertest from "supertest";
import type * as schema from "../../src/database/schema";
import type { ParticipationsService } from "../../src/participations/participations.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Preflight antes dos providers/environment: sem .env, Neon ou fallback implícito.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]), url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test"
    || url.search || url.hash || !url.username) throw new Error(`${name}: destino local explícito obrigatório.`);
  return value;
});
if (urls.some(value => value !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
const pool = new Pool({ connectionString: urls[0], ssl: false, max: 6, connectionTimeoutMillis: 2000,
  statement_timeout: 10000, lock_timeout: 8000 });
let app: INestApplication, database: NodePgDatabase<typeof schema>, admissions: ParticipationsService;
let signAccess: (userId: string, sessionId: string, expired?: boolean) => string;
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[], games: [] as string[] };
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,"arenago_events_test");
  const { EventsModule } = await import("../../src/events/events.module");
  const { EventsService } = await import("../../src/events/events.service");
  const { ParticipationsService } = await import("../../src/participations/participations.service");
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { ProblemDetailsExceptionFilter } = await import("../../src/common/errors/problem-details.filter");
  const tokens = await import("../../src/auth/token.util");
  signAccess = (userId,sessionId,expired) => tokens.signAccessToken({userId,sessionId},expired ? {nowMs:Date.now()-120000,ttlSeconds:1} : undefined);
  @Module({ imports:[EventsModule], providers:[{provide:APP_FILTER,useClass:ProblemDetailsExceptionFilter}] })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule,{logger:false}); app.setGlobalPrefix("api/v1"); await app.listen(0,"127.0.0.1");
  database = app.get(DRIZZLE_DATABASE);
  // Dependências explícitas: não modifica DI histórica de ParticipationsModule fora da E08.5.
  admissions = new ParticipationsService(database, app.get(EventsService));
});
after(async () => {
  const errors: unknown[] = [];
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM audit_logs WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])",[ids.events]);
      await client.query("DELETE FROM games WHERE id=ANY($1::uuid[])",[ids.games]);
      await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[ids.users]);
      await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])",[ids.versions]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally {client.release();}
  } catch(error) {errors.push(error);}
  for (const r of await Promise.allSettled([app?.close(),pool.end()])) if(r.status==="rejected") errors.push(r.reason);
  if(errors.length) throw new AggregateError(errors,"Limpeza E08.5 falhou.");
});
async function account() {
  const userId=randomUUID(),sessionId=randomUUID(); ids.users.push(userId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'Pessoa privada E085',$2,'fixture-private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`,[userId,`${userId}@example.test`]);
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`,[sessionId,userId]);
  return {userId,sessionId,token:signAccess(userId,sessionId)};
}
async function grant(userId:string,eventId:string|null) {
  const id=randomUUID(); await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())",[id,userId,eventId ? "staff":"admin",eventId]); return id;
}
async function experience(eventId:string) {
  const id=randomUUID(); await pool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'Experiência E085',9007199254741000,clock_timestamp(),clock_timestamp())`,[id,eventId]);return id;
}
async function station(experienceId:string) {
  const id=randomUUID();await pool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'Estação E085','available',clock_timestamp(),clock_timestamp())`,[id,experienceId]);return id;
}
async function context():Promise<Context> {
  const eventId=randomUUID();ids.events.push(eventId);
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E085 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`,[eventId,`E085-${eventId.toUpperCase()}`]);
  const staff=await account(),roleId=await grant(staff.userId,eventId),experienceId=await experience(eventId),stationId=await station(experienceId);
  return {eventId,experienceId,stationId,staff,roleId};
}
interface Context { eventId:string; experienceId:string; stationId:string; staff:Awaited<ReturnType<typeof account>>; roleId:string; }
async function person(eventId:string) {
  const auth=await account(),participationId=randomUUID();
  await pool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at)
    VALUES($1,$2,$3,'active',clock_timestamp(),clock_timestamp())`,[participationId,auth.userId,eventId]);return {...auth,participationId};
}
async function readyEntrant() {
  const auth=await account(),versionId=randomUUID(),gameId=randomUUID();ids.versions.push(versionId);ids.games.push(gameId);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())",[versionId,`e85-${versionId}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`,[auth.userId,versionId]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())",[gameId,`E085-${gameId}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())",[auth.userId,gameId]);return auth;
}
const path=(c:Context)=>`/api/v1/staff/events/${c.eventId}/stations/${c.stationId}/availability`;
const patch=(c:Context,availability="unavailable",auth=c.staff)=>supertest(app.getHttpServer()).patch(path(c)).set("Authorization",`Bearer ${auth.token}`).send({availability});
const queue=(c:Context)=>supertest(app.getHttpServer()).get(`/api/v1/staff/events/${c.eventId}/experiences/${c.experienceId}/queue`).set("Authorization",`Bearer ${c.staff.token}`);
const post=(c:Context,route:string)=>supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/${route}`).set("Authorization",`Bearer ${c.staff.token}`).set("Idempotency-Key",randomUUID()).send({});
const call=(c:Context)=>post(c,`experiences/${c.experienceId}/stations/${c.stationId}/call-next`);
const resolve=(c:Context,sessionId:string,op:"complete"|"absent")=>post(c,`service-sessions/${sessionId}/${op}`);
const enter=(c:Context,p:Awaited<ReturnType<typeof person>>)=>supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/queue-entries`).set("Authorization",`Bearer ${p.token}`).set("Idempotency-Key",randomUUID()).send({experienceId:c.experienceId});
async function waiting(c:Context) {const p=await person(c.eventId),r=await enter(c,p);assert.equal(r.status,201,JSON.stringify(r.body));return {p,id:r.body.queueEntryId as string};}
async function pending(c:Context) {await waiting(c);const r=await call(c);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.serviceSession.id as string;}
const admit=(c:Context,a:{userId:string})=>admissions.createParticipation({userId:a.userId,eventId:c.eventId,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+60000)});
function problem(r:supertest.Response,status:number,code:string) {
  assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.body.status,status);assert.equal(r.body.code,code);assert.match(r.headers["content-type"],/application\/problem\+json/);
  assert.equal(JSON.stringify(r.body).includes("@example.test"),false);
}
async function audit(c:Context) {return (await pool.query("SELECT * FROM audit_logs WHERE event_id=$1 ORDER BY occurred_at,id",[c.eventId])).rows;}
async function state(c:Context,domainOnly=false) {
  const r=(await pool.query(`SELECT jsonb_build_object(
    'event',(SELECT to_jsonb(e) FROM events e WHERE e.id=$1),
    'experiences',(SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('last_queue_order',e.last_queue_order::text) ORDER BY e.id) FROM experiences e WHERE e.event_id=$1),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=$1),
    'queues',(SELECT jsonb_agg(to_jsonb(q) || jsonb_build_object('queue_order',q.queue_order::text) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=$1),
    'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1),
    'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_logs a WHERE a.event_id=$1),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[]))
    ) AS value`,[c.eventId,ids.users])).rows[0].value;
  if(domainOnly) {delete r.stations;delete r.audits;}
  return r;
}
async function blocked(pid:number) {
  const until=Date.now()+6000;
  while(Date.now()<until) {
    if((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid])).rows[0].n>0) return;
    await new Promise(done=>setTimeout(done,20));
  }
  throw new Error("Não foi observada espera real pelo lock esperado.");
}
/** Mantém a transação real da primeira ação antes do COMMIT e observa a segunda bloqueada. */
async function ordered<A,B>(first:()=>PromiseLike<A>,second:()=>PromiseLike<B>):Promise<[A,B]> {
  const original=database.transaction.bind(database) as typeof database.transaction;
  let ready!:(pid:number)=>void,release!:()=>void;
  const reached=new Promise<number>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});
  database.transaction=(callback,config)=>original(async tx=>{
    const value=await callback(tx);const pid=(await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    ready(pid);await gate;return value;
  },config);
  let a:Promise<A>|undefined,b:Promise<B>|undefined;
  try {
    a=Promise.resolve(first());a.catch(()=>undefined);
    const pid=await Promise.race([reached,a.then(()=>{throw new Error("Primeira ação não manteve transação.");})]);
    database.transaction=original;
    b=Promise.resolve(second());b.catch(()=>undefined);await blocked(pid);release();return await Promise.all([a,b]);
  } finally {database.transaction=original;release();await Promise.allSettled([a,b]);}
}
async function eventWait(c:Context,action:()=>PromiseLike<supertest.Response>,change:(client:import("pg").PoolClient)=>Promise<void>) {
  const client=await pool.connect();let response:Promise<supertest.Response>|undefined;
  try {
    await client.query("BEGIN");await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[c.eventId]);
    const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    response=Promise.resolve(action());response.catch(()=>undefined);await blocked(pid);await change(client);await client.query("COMMIT");return await response;
  } finally {await client.query("ROLLBACK");await Promise.allSettled([response]);client.release();}
}

test("E08.5 PostgreSQL HTTP Staff desativa e registra auditoria exata na mesma transação",async()=>{
  const c=await context(),extra=await station(c.experienceId),other=(await pool.query("SELECT * FROM stations WHERE id=$1",[extra])).rows;
  const before=await state(c,true),r=await patch(c);assert.equal(r.status,200);
  assert.deepEqual(r.body,{stationId:c.stationId,availability:"unavailable",pendingServiceSessionId:null});assert.deepEqual(await state(c,true),before);
  assert.deepEqual((await pool.query("SELECT * FROM stations WHERE id=$1",[extra])).rows,other);
  const rows=await audit(c);assert.equal(rows.length,1);const a=rows[0];assert.equal(a.actor_user_id,c.staff.userId);assert.equal(a.event_id,c.eventId);
  assert.equal(a.origin,"user");assert.equal(a.category,"station");assert.equal(a.action,"station_availability_changed");assert.equal(a.target_user_id,null);assert.equal(a.reason,null);
  assert.deepEqual(a.metadata,{stationId:c.stationId,experienceId:c.experienceId,before:{availability:"available"},after:{availability:"unavailable"}});
  const match=(await pool.query("SELECT s.updated_at=a.occurred_at AS same FROM stations s JOIN audit_logs a ON a.id=$2 WHERE s.id=$1",[c.stationId,a.id])).rows[0];assert.equal(match.same,true);
});
test("E08.5 PostgreSQL HTTP Admin global opera sem concessão Staff e mantém restrições E08.1/E08.4",async()=>{
  const c=await context(),admin=await account();await grant(admin.userId,null);await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1",[admin.sessionId]);
  assert.equal((await patch(c,"unavailable",admin)).status,200);assert.equal((await audit(c))[0].actor_user_id,admin.userId);
  problem(await supertest(app.getHttpServer()).get(`/api/v1/staff/events/${c.eventId}/stations`).set("Authorization",`Bearer ${admin.token}`),404,"RESOURCE_NOT_FOUND");
  problem(await call({...c,staff:admin}),403,"STAFF_EVENT_FORBIDDEN");
});
test("E08.5 PostgreSQL HTTP Admin sem 2FA não altera estação nem audita",async()=>{
  const c=await context(),admin=await account();await grant(admin.userId,null);const before=await state(c);
  problem(await patch(c,"unavailable",admin),401,"ADMIN_2FA_REQUIRED");assert.deepEqual(await state(c),before);
});
test("E08.5 PostgreSQL HTTP Staff alheio/revogado/não verificado e participante têm recusa neutra",async()=>{
  const c=await context(),other=await context();
  for(const mode of ["foreign","revoked","unverified","none"]) {
    const a=await account();if(mode!=="none") {const role=await grant(a.userId,mode==="foreign"?other.eventId:c.eventId);if(mode==="revoked") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[role]);}
    if(mode==="unverified") await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1",[a.userId]);
    const before=await state(c);problem(await patch(c,"unavailable",a),404,"RESOURCE_NOT_FOUND");assert.deepEqual(await state(c),before);
  }
});
test("E08.5 PostgreSQL HTTP Bearer ausente/inválido e token expirado não mutam",async()=>{
  const c=await context(),before=await state(c);problem(await supertest(app.getHttpServer()).patch(path(c)).send({availability:"unavailable"}),401,"MISSING_ACCESS_TOKEN");
  problem(await patch(c,"unavailable",{...c.staff,token:"invalid"}),401,"INVALID_ACCESS_TOKEN");
  problem(await patch(c,"unavailable",{...c.staff,token:signAccess(c.staff.userId,c.staff.sessionId,true)}),401,"ACCESS_TOKEN_EXPIRED");assert.deepEqual(await state(c),before);
});
test("E08.5 PostgreSQL HTTP conta inativa e sessão revogada/expirada bloqueiam alteração",async()=>{
  for(const mode of ["inactive","revoked","expired"]) {
    const c=await context();
    if(mode==="inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1",[c.staff.userId]);
    else if(mode==="revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1",[c.staff.sessionId]);
    else await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.staff.sessionId]);
    const before=await state(c);problem(await patch(c),401,mode==="inactive"?"ACCOUNT_DEACTIVATED":mode==="revoked"?"SESSION_REVOKED":"SESSION_EXPIRED");assert.deepEqual(await state(c),before);
  }
});
test("E08.5 PostgreSQL HTTP UUIDs validados/normalizados e estação de outro evento não vaza relações",async()=>{
  const c=await context(),other=await context(),before=await state(c);
  for(const key of ["eventId","stationId"] as const) problem(await patch({...c,[key]:"bad"}),400,"VALIDATION_ERROR");
  const a=await patch({...c,stationId:other.stationId}),b=await patch({...c,stationId:randomUUID()});problem(a,404,"RESOURCE_NOT_FOUND");problem(b,404,"RESOURCE_NOT_FOUND");assert.deepEqual(a.body,b.body);
  problem(await patch({...c,eventId:randomUUID()}),404,"RESOURCE_NOT_FOUND");assert.deepEqual(await state(c),before);
  const r=await patch({...c,eventId:c.eventId.toUpperCase(),stationId:c.stationId.toUpperCase()});assert.equal(r.status,200);assert.equal(r.body.stationId,c.stationId);
});
test("E08.5 PostgreSQL HTTP body ausente/inválido/extra não chega à mutação",async()=>{
  const c=await context(),before=await state(c);
  const request=()=>supertest(app.getHttpServer()).patch(path(c)).set("Authorization",`Bearer ${c.staff.token}`);
  problem(await request(),400,"VALIDATION_ERROR");
  for(const body of [{},[],{availability:null},{availability:"busy"},{availability:"Available"},{availability:"unavailable",actor:c.staff.userId}]) problem(await request().send(body),400,"VALIDATION_ERROR");
  problem(await request().type("text/plain").send('{"availability":"available"}'),400,"VALIDATION_ERROR");problem(await request().type("application/json").send("{bad"),400,"BAD_REQUEST");assert.deepEqual(await state(c),before);
});
test("E08.5 PostgreSQL HTTP reativação normal restaura capacidade e registra só duas transições",async()=>{
  const c=await context();assert.equal((await patch(c)).status,200);assert.equal((await queue(c)).body.acceptingNewEntries,false);
  const before=await state(c,true);assert.equal((await patch(c,"available")).status,200);assert.deepEqual(await state(c,true),before);assert.equal((await queue(c)).body.acceptingNewEntries,true);
  const rows=await audit(c);assert.equal(rows.length,2);assert.deepEqual(rows[1].metadata.before,{availability:"unavailable"});assert.deepEqual(rows[1].metadata.after,{availability:"available"});
});
test("E08.5 PostgreSQL HTTP repetir estado preserva updated_at/auditoria sem header ou TTL",async()=>{
  const c=await context(),original=await state(c);assert.equal((await patch(c,"available")).status,200);assert.deepEqual(await state(c),original);
  assert.equal((await patch(c)).status,200);const changed=await state(c);
  for(let n=0;n<3;n++) assert.equal((await patch(c).set("Idempotency-Key",n?"ignored":"")).status,200);
  assert.deepEqual(await state(c),changed);assert.equal((await audit(c)).length,1);
});
test("E08.5 PostgreSQL HTTP pending gera 409 com estado mínimo sem UPDATE/auditoria",async()=>{
  const c=await context(),session=await pending(c),before=await state(c),r=await patch(c);problem(r,409,"STATION_HAS_PENDING_CALL");
  assert.deepEqual(r.body.station,{stationId:c.stationId,availability:"available",pendingServiceSessionId:session});assert.deepEqual(await state(c),before);
  const same=await patch(c,"available");assert.equal(same.status,200);assert.equal(same.body.pendingServiceSessionId,session);assert.deepEqual(await state(c),before);
});
for(const op of ["complete","absent"] as const) test(`E08.5 PostgreSQL HTTP desativação após ${op} preserva histórico terminal`,async()=>{
  const c=await context(),session=await pending(c);assert.equal((await resolve(c,session,op)).status,200);const before=await state(c,true);
  assert.equal((await patch(c)).status,200);assert.deepEqual(await state(c,true),before);assert.equal((await audit(c)).length,1);
});
test("E08.5 PostgreSQL HTTP última estação bloqueia Arena/fila sem fechar evento ou apagar espera",async()=>{
  const c=await context();await waiting(c);const p=await person(c.eventId),a=await readyEntrant();
  const before=await state(c,true);assert.equal((await patch(c)).status,200);assert.deepEqual(await state(c,true),before);
  const q=await queue(c);assert.equal(q.body.waitingCount,1);assert.equal(q.body.acceptingNewEntries,false);assert.equal(q.body.canCallWaitingEntries,true);
  problem(await enter(c,p),409,"EVENT_UNAVAILABLE");const admission=await admit(c,a);assert.equal(admission.kind,"blocked");
  if(admission.kind!=="blocked") assert.fail();assert.ok(admission.eligibility.blockingReasons.includes("EVENT_NOT_READY"));
  assert.equal((await pool.query("SELECT status FROM events WHERE id=$1",[c.eventId])).rows[0].status,"open");
  assert.equal((await patch(c,"available")).status,200);assert.equal((await admit(c,a)).kind,"created");assert.equal((await enter(c,p)).status,201);
});
test("E08.5 PostgreSQL HTTP perder estação de uma experiência mantém outra apta",async()=>{
  const c=await context(),experienceId=await experience(c.eventId),stationId=await station(experienceId),p=await person(c.eventId);
  assert.equal((await patch(c)).status,200);assert.equal((await queue(c)).body.acceptingNewEntries,false);
  const other={...c,experienceId,stationId};assert.equal((await queue(other)).body.acceptingNewEntries,true);assert.equal((await enter(other,p)).status,201);
  assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[stationId])).rows[0].availability,"available");
});
test("E08.5 PostgreSQL HTTP reativação residual após corte oficial/Admin não reabre ingressos",async()=>{
  for(const mode of ["official","admin"]) {
    const c=await context(),p=await person(c.eventId);await waiting(c);assert.equal((await patch(c)).status,200);
    if(mode==="official") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1",[c.eventId]);
    else await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1",[c.eventId]);
    assert.equal((await patch(c,"available")).status,200);const r=await queue(c);assert.equal(r.body.acceptingNewEntries,false);assert.equal(r.body.canCallWaitingEntries,true);
    problem(await enter(c,p),409,"EVENT_REGISTRATION_CLOSED");assert.equal((await call(c)).status,201);
  }
});
test("E08.5 PostgreSQL HTTP configuração antes do início é permitida e não antecipa ingressos",async()=>{
  const c=await context();await pool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1",[c.eventId]);
  assert.equal((await patch(c)).status,200);assert.equal((await patch(c,"available")).status,200);assert.equal((await queue(c)).body.acceptingNewEntries,false);
});
test("E08.5 PostgreSQL HTTP closed/prazos operacional/Admin/imediato recusam mudanças; no-op continua 200",async()=>{
  for(const mode of ["closed","operational","admin","immediate"]) {
    const c=await context();
    if(mode==="closed") await pool.query("UPDATE events SET status='closed' WHERE id=$1",[c.eventId]);
    if(mode==="operational") await pool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[c.eventId]);
    if(mode==="admin") await pool.query("UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '20 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[c.eventId]);
    if(mode==="immediate") await pool.query("UPDATE events SET status='closing',closure_mode='immediate',closure_requested_at=statement_timestamp()-interval '1 minute',admin_deadline_at=statement_timestamp()-interval '1 minute' WHERE id=$1",[c.eventId]);
    const before=await state(c);problem(await patch(c),409,"EVENT_OPERATION_ENDED");assert.equal((await patch(c,"available")).status,200);assert.deepEqual(await state(c),before);
    await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1",[c.stationId]);const unavailable=await state(c);
    problem(await patch(c,"available"),409,"EVENT_OPERATION_ENDED");assert.deepEqual(await state(c),unavailable);
  }
});
test("E08.5 PostgreSQL HTTP isolamento e contrato não expõem pessoas ou detalhes de auditoria",async()=>{
  const c=await context(),other=await context(),foreign=await state(other),r=await patch(c);assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.body).sort(),["availability","pendingServiceSessionId","stationId"]);
  for(const secret of [c.staff.userId,c.staff.sessionId,c.eventId,c.experienceId,other.stationId,"Pessoa privada E085","example.test","fixture-private-hash","station_availability_changed"]) assert.equal(JSON.stringify(r.body).includes(secret),false);
  assert.deepEqual(await state(other),foreign);
});
test("E08.5 PostgreSQL concorrente call-next primeiro impede desativação",async()=>{
  const c=await context();await waiting(c);
  const [called,disabled]=await ordered(()=>call(c),()=>patch(c));assert.equal(called.status,201);problem(disabled,409,"STATION_HAS_PENDING_CALL");
  assert.equal((await audit(c)).length,0);const s=(await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0];assert.equal(s.availability,"available");
});
test("E08.5 PostgreSQL concorrente desativação primeiro bloqueia call-next sem furar FIFO",async()=>{
  const c=await context(),first=await waiting(c),second=await waiting(c);
  const [disabled,called]=await ordered(()=>patch(c),()=>call(c));assert.equal(disabled.status,200);problem(called,409,"STATION_UNAVAILABLE");
  const r=await queue(c);assert.equal(r.body.waitingCount,2);assert.equal(r.body.firstWaitingQueueEntryId,first.id);
  const entries=(await pool.query("SELECT id,status FROM queue_entries WHERE id=ANY($1::uuid[])",[[first.id,second.id]])).rows;assert.ok(entries.every(row=>row.status==="waiting"));
});
for(const op of ["complete","absent"] as const) test(`E08.5 PostgreSQL concorrente ${op} primeiro libera desativação; pending primeiro mantém 409`,async()=>{
  {
    const c=await context(),session=await pending(c);
    const [resolved,disabled]=await ordered(()=>resolve(c,session,op),()=>patch(c));assert.equal(resolved.status,200);assert.equal(disabled.status,200);assert.equal((await audit(c)).length,1);
    assert.equal((await pool.query("SELECT status FROM service_sessions WHERE id=$1",[session])).rows[0].status,op==="complete"?"completed":"absent");
  }
  {
    const c=await context(),session=await pending(c);
    const [disabled,resolved]=await ordered(()=>patch(c),()=>resolve(c,session,op));problem(disabled,409,"STATION_HAS_PENDING_CALL");assert.equal(resolved.status,200);assert.equal((await audit(c)).length,0);
  }
});
test("E08.5 PostgreSQL concorrente ingresso interno primeiro é preservado após desativação",async()=>{
  const c=await context(),p=await person(c.eventId);
  const [joined,disabled]=await ordered(()=>enter(c,p),()=>patch(c));assert.equal(joined.status,201);assert.equal(disabled.status,200);
  const r=await queue(c);assert.equal(r.body.waitingCount,1);assert.equal(r.body.firstWaitingQueueEntryId,joined.body.queueEntryId);assert.equal(r.body.acceptingNewEntries,false);
});
test("E08.5 PostgreSQL concorrente desativação primeiro impede ingresso interno desatualizado",async()=>{
  const c=await context(),p=await person(c.eventId);
  const [disabled,joined]=await ordered(()=>patch(c),()=>enter(c,p));assert.equal(disabled.status,200);problem(joined,409,"EVENT_UNAVAILABLE");
  assert.equal((await queue(c)).body.waitingCount,0);
});
test("E08.5 PostgreSQL concorrente ingresso E03 primeiro mantém participação após perda de capacidade",async()=>{
  const c=await context(),a=await readyEntrant();
  const [joined,disabled]=await ordered(()=>admit(c,a),()=>patch(c));assert.equal(joined.kind,"created");assert.equal(disabled.status,200);
  if(joined.kind!=="created") assert.fail();const p=(await pool.query("SELECT status FROM participations WHERE id=$1",[joined.participationId])).rows[0];assert.equal(p.status,"active");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM participation_profile_snapshots WHERE participation_id=$1",[joined.participationId])).rows[0].n,1);
});
test("E08.5 PostgreSQL concorrente desativação primeiro impede novo ingresso E03",async()=>{
  const c=await context(),a=await readyEntrant();
  const [disabled,joined]=await ordered(()=>patch(c),()=>admit(c,a));assert.equal(disabled.status,200);assert.equal(joined.kind,"blocked");
  if(joined.kind!=="blocked") assert.fail();assert.deepEqual(joined.eligibility.blockingReasons,["EVENT_NOT_READY"]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM participations WHERE user_id=$1",[a.userId])).rows[0].n,0);
});
test("E08.5 PostgreSQL concorrente dois PATCH iguais geram uma única auditoria",async()=>{
  const c=await context();const [a,b]=await ordered(()=>patch(c),()=>patch(c));assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body,b.body);assert.equal((await audit(c)).length,1);
});
test("E08.5 PostgreSQL concorrente PATCH opostos serializam duas transições reais",async()=>{
  const c=await context();const [a,b]=await ordered(()=>patch(c),()=>patch(c,"available"));assert.equal(a.status,200);assert.equal(b.status,200);
  const rows=await audit(c);assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.metadata.after.availability),["unavailable","available"]);
  assert.equal((await queue(c)).body.acceptingNewEntries,true);
});
test("E08.5 PostgreSQL concorrente revogação Staff primeiro é revalidada após espera",async()=>{
  const c=await context(),client=await pool.connect();let response:Promise<supertest.Response>|undefined;
  try {
    await client.query("BEGIN");await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.roleId]);
    const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    response=Promise.resolve(patch(c));response.catch(()=>undefined);await blocked(pid);await client.query("COMMIT");problem(await response,404,"RESOURCE_NOT_FOUND");assert.equal((await audit(c)).length,0);
    assert.equal((await pool.query("SELECT availability FROM stations WHERE id=$1",[c.stationId])).rows[0].availability,"available");
  } finally {await client.query("ROLLBACK");await Promise.allSettled([response]);client.release();}
});
test("E08.5 PostgreSQL concorrente PATCH primeiro mantém autorização até commit e revogação seguinte bloqueia",async()=>{
  const c=await context();const [r]=await ordered(()=>patch(c),()=>pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.roleId]));
  assert.equal(r.status,200);assert.equal((await audit(c)).length,1);problem(await patch(c,"available"),404,"RESOURCE_NOT_FOUND");assert.equal((await audit(c)).length,1);
});
test("E08.5 PostgreSQL concorrente conta/sessão/2FA são revalidadas após espera no evento",async()=>{
  for(const mode of ["inactive","revoked","expired","2fa","admin-revoked"]) {
    const c=await context();let adminRole:string|undefined;
    if(mode==="2fa"||mode==="admin-revoked") {adminRole=await grant(c.staff.userId,null);await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1",[c.staff.sessionId]);}
    if(mode==="admin-revoked") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[c.roleId]);
    const r=await eventWait(c,()=>patch(c),async()=>{
      if(mode==="inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1",[c.staff.userId]);
      if(mode==="revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1",[c.staff.sessionId]);
      if(mode==="expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.staff.sessionId]);
      if(mode==="2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1",[c.staff.sessionId]);
      if(mode==="admin-revoked") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1",[adminRole]);
    });
    problem(r,mode==="admin-revoked"?404:401,mode==="inactive"?"ACCOUNT_DEACTIVATED":mode==="revoked"?"SESSION_REVOKED":mode==="expired"?"SESSION_EXPIRED":mode==="2fa"?"ADMIN_2FA_REQUIRED":"RESOURCE_NOT_FOUND");
    assert.equal((await audit(c)).length,0);
  }
});
test("E08.5 PostgreSQL concorrente prazo/status são reavaliados depois do lock",async()=>{
  for(const mode of ["closed","deadline"]) {
    const c=await context(),before=await pool.query("SELECT availability,updated_at FROM stations WHERE id=$1",[c.stationId]);
    const r=await eventWait(c,()=>patch(c),async client=>{
      if(mode==="closed") await client.query("UPDATE events SET status='closed' WHERE id=$1",[c.eventId]);
      else await client.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[c.eventId]);
    });
    problem(r,409,"EVENT_OPERATION_ENDED");assert.equal((await audit(c)).length,0);
    assert.deepEqual((await pool.query("SELECT availability,updated_at FROM stations WHERE id=$1",[c.stationId])).rows,before.rows);
  }
});
test("E08.5 PostgreSQL erro real durante auditoria e após INSERT reverte estação e auditoria integralmente",async()=>{
  const dialect=new PgDialect();
  for(const phase of ["audit","after-audit"]) {
    const c=await context(),before=await state(c),original=database.transaction.bind(database) as typeof database.transaction;
    let reached=false;
    database.transaction=(callback,config)=>original(async tx=>{
      const execute=tx.execute.bind(tx);
      tx.execute=(async (...args:Parameters<typeof tx.execute>)=>{
        const query=args[0],text=typeof query==="string"?query:dialect.sqlToQuery(query.getSQL()).sql;
        if(text.includes("INSERT INTO audit_logs")&&phase==="audit") {reached=true;await execute(sql`SELECT 1/0`);}
        const value=await execute(...args);
        if(text.includes("INSERT INTO audit_logs")&&phase==="after-audit") {reached=true;await execute(sql`SELECT 1/0`);}
        return value;
      }) as typeof tx.execute;
      return callback(tx);
    },config);
    try {problem(await patch(c),500,"INTERNAL_SERVER_ERROR");} finally {database.transaction=original;}
    assert.equal(reached,true);assert.deepEqual(await state(c),before);assert.equal((await audit(c)).length,0);
  }
});
test("E08.5 PostgreSQL leitura E08.4 vê estado confirmado sem esperar escrita ainda não commitada",async()=>{
  const c=await context(),original=database.transaction.bind(database) as typeof database.transaction;let reached=false;
  database.transaction=(callback,config)=>original(async tx=>{
    const value=await callback(tx);database.transaction=original;
    const during=await queue(c).timeout({deadline:3000});assert.equal(during.status,200);assert.equal(during.body.acceptingNewEntries,true);reached=true;
    return value;
  },config);
  try {assert.equal((await patch(c)).status,200);} finally {database.transaction=original;}
  assert.equal(reached,true);assert.equal((await queue(c)).body.acceptingNewEntries,false);assert.equal((await audit(c)).length,1);
});
