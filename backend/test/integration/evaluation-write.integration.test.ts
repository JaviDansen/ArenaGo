import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { QueryConfig, QueryResult } from "pg";
import supertest from "supertest";
import * as schema from "../../src/database/schema";
import type { EvaluationWriteService } from "../../src/evaluations/evaluation-write.service";
import { submissionStatement, editStatement, type EvaluationDecisionRow } from "../../src/evaluations/evaluation-write.policy";
import { submitEvaluationBody, editEvaluationBody } from "../../src/evaluations/evaluation-write.dto";
import { setup, cleanup, app, pool, database, context, account, participant, service, evaluation, expire, ownState, routes, get, problem,
  person, close, controlled, type Actor } from "./evaluation-read-fixture";
import { ordered, blocked } from "./event-closure-fixture";

let writes: EvaluationWriteService, makeWrites: (db: NodePgDatabase<typeof schema>) => EvaluationWriteService;
let fingerprint: typeof import("../../src/evaluations/evaluation-write.service").evaluationWriteFingerprint;
before(async () => {
  process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60"; await setup();
  const module = await import("../../src/evaluations/evaluation-write.service"); writes = app.get(module.EvaluationWriteService);
  makeWrites = db => new module.EvaluationWriteService(db); fingerprint = module.evaluationWriteFingerprint;
});
after(cleanup);
const submit = (p: Actor & { participationId: string }, body: object = { rating: 5 }, key: string = randomUUID(), actor: Actor = p) =>
  supertest(app.getHttpServer()).post(`/api/v1/participations/${p.participationId}/evaluation`).set("Authorization", `Bearer ${actor.token}`).set("Idempotency-Key", key).send(body);
const edit = (actor: Actor, id: string, body: object = { rating: 5 }, key: string = randomUUID()) =>
  supertest(app.getHttpServer()).patch(`/api/v1/evaluations/${id}`).set("Authorization", `Bearer ${actor.token}`).set("Idempotency-Key", key).send(body);
const selection = (userId: string, participationId: string) => sql`SELECT p.id,p.event_id,e.name AS event_name,p.status,p.joined_at,p.arena_entered_at,p.finished_at,p.finish_reason
  FROM participations p JOIN events e ON e.id=p.event_id WHERE p.id=${participationId}::uuid AND p.user_id=${userId}::uuid`;
async function eligible() { const c = await context(), p = await participant(c); await service(c, p.participationId); return { c, p }; }
async function stored(id: string) {
  return (await pool.query(`SELECT id,participation_id,rating,comment,
    to_char(submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted,
    to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated,
    to_char(first_comment_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first FROM evaluations WHERE id=$1`, [id])).rows[0];
}
for (const rating of [1,2,3,4,5]) test(`E08.11 PostgreSQL POST nota ${rating}, instantes consistentes e avaliação única`, async () => {
  const {p}=await eligible(),r=await submit(p,{rating});assert.equal(r.status,201,JSON.stringify(r.body));const v=await stored(r.body.evaluation.id);
  assert.equal(v.rating,rating);assert.equal(v.comment,null);assert.equal(v.first,null);assert.equal(v.submitted,v.updated);assert.equal(v.submitted,r.body.evaluation.submittedAt);
  assert.match(v.submitted,/\.\d{6}Z$/);assert.equal(r.body.evaluation.participationId,p.participationId);
});
for (const body of [{}, {rating:0},{rating:6},{rating:1.5},{rating:"5"},{rating:null},{rating:true},{rating:5,userId:"forged"},{rating:5,permissions:{}},{rating:5,submittedAt:"forged"}])
test(`E08.11 PostgreSQL POST rejeita payload ${JSON.stringify(body)} sem intenção ou avaliação`,async()=>{
  const {c,p}=await eligible(),before=await ownState(c,p);problem(await submit(p,body),400,"VALIDATION_ERROR");assert.deepEqual(await ownState(c,p),before);
});
for(const comment of [null,""," \t\n","Unicode 😀 e\u0301","  texto preservado  ","😀".repeat(2000)])
test(`E08.11 PostgreSQL POST comentário categoria ${comment===null?"null":comment.length}`,async()=>{
  const {p}=await eligible(),r=await submit(p,{rating:4,comment});assert.equal(r.status,201,JSON.stringify(r.body));const expected=comment===null||comment.trim()===""?null:comment,v=await stored(r.body.evaluation.id);
  assert.equal(v.comment,expected);assert.equal(v.first,expected===null?null:v.submitted);assert.equal(r.body.evaluation.comment,expected);
});
for(const [name,comment] of [["unicode","😀".repeat(2001)],["spaces"," ".repeat(2001)],["NUL","\0"],["surrogate","\ud800"]] as const)
test(`E08.11 PostgreSQL comentário inválido ${name} não trunca nem grava`,async()=>{
  const {c,p}=await eligible(),before=await ownState(c,p);problem(await submit(p,{rating:4,comment}),400,"VALIDATION_ERROR");assert.deepEqual(await ownState(c,p),before);
  const id=await evaluation(p.participationId);const previous=await ownState(c,p);problem(await edit(p,id,{comment}),400,"VALIDATION_ERROR");assert.deepEqual(await ownState(c,p),previous);
});
for(const status of ["waiting","active","finished","canceled"]as const)for(const completions of [0,1,3])
test(`E08.11 PostgreSQL POST elegibilidade ${status} com ${completions} conclusões reais`,async()=>{
  const c=await context(),p=await participant(c,{status});for(let n=0;n<completions;n++)await service(c,p.participationId);
  await service(c,p.participationId,"absent");await service(c,p.participationId,"canceled");
  const before=await ownState(c,p),r=await submit(p);
  if(status==="finished"&&completions>0)assert.equal(r.status,201,JSON.stringify(r.body));else{problem(r,409,"EVALUATION_NOT_ELIGIBLE");assert.deepEqual(await ownState(c,p),before);}
});
for(const reason of ["voluntary","admin_immediate","admin_controlled_external_wait_closed","automatic_operational_deadline","automatic_admin_deadline"])
for(const completed of [false,true])test(`E08.11 PostgreSQL finalização ${reason} exige completed=${completed}`,async()=>{
  const c=await context(),p=await participant(c,{reason});if(completed)await service(c,p.participationId);const r=await submit(p);
  if(completed)assert.equal(r.status,201,JSON.stringify(r.body));else problem(r,409,"EVALUATION_NOT_ELIGIBLE");
});
for(const offset of [-1,0,1])test(`E08.11 PostgreSQL INSERT decisivo no corte inicial ${offset} microssegundo`,async()=>{
  const c=await context(),p=await participant(c,{days:31});await service(c,p.participationId);
  const at=(await pool.query(`UPDATE participations SET finished_at=clock_timestamp()-interval '720 hours' WHERE id=$1
    RETURNING to_char((finished_at+interval '720 hours'+$2::int*interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,[p.participationId,offset])).rows[0].at as string;
  const id=randomUUID(),result=await database.transaction(async tx=>{await tx.execute(sql`SELECT id FROM participations WHERE id=${p.participationId} FOR UPDATE`);
    return tx.execute<EvaluationDecisionRow>(submissionStatement(selection(p.userId,p.participationId),id,{rating:5,comment:null},sql`${at}::timestamptz`));},{isolationLevel:"read committed"});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].decisionAt,at);assert.equal(result.rows[0].pending,offset<=0);assert.equal(result.rows[0].writtenId,offset<=0?id:null);
  if(offset<=0){const v=await stored(id);assert.equal(v.submitted,at);assert.equal(v.updated,at);}else assert.equal(await stored(id),undefined);
});
test("E08.11 PostgreSQL POST após prazo retorna código específico sem consumir intenção",async()=>{
  const c=await context(),p=await participant(c,{days:31});await service(c,p.participationId);const before=await ownState(c,p);
  problem(await submit(p),409,"EVALUATION_SUBMISSION_EXPIRED");assert.deepEqual(await ownState(c,p),before);
});
test("E08.11 PostgreSQL reentrada no mesmo evento produz avaliações distintas por participação",async()=>{
  const c=await context(),actor=await account(),a=await participant(c,{actor}),b=await participant(c,{actor});await service(c,a.participationId);await service(c,b.participationId);
  const x=await submit(a),y=await submit(b);assert.equal(x.status,201);assert.equal(y.status,201);assert.notEqual(x.body.evaluation.id,y.body.evaluation.id);
  const h=await get(actor,"/participations/history");assert.equal(h.body.items.length,2);assert.ok(h.body.items.every((p:{evaluation:{submitted:boolean}})=>p.evaluation.submitted));
});
test("E08.11 PostgreSQL POST duplicado distinto é conflito e mesmo payload normalizado é replay",async()=>{
  const {c,p}=await eligible(),key=randomUUID(),a=await submit(p,{rating:5},key);assert.equal(a.status,201);
  const before=await ownState(c,p),b=await submit(p,{rating:5,comment:" "},key);assert.equal(b.status,201);assert.deepEqual(b.body,a.body);
  problem(await submit(p,{rating:5}),409,"EVALUATION_ALREADY_SUBMITTED");problem(await submit(p,{rating:4},key),409,"IDEMPOTENCY_KEY_REUSED");assert.deepEqual(await ownState(c,p),before);
});
test("E08.11 PostgreSQL chaves distinguem recurso e ator sem compartilhar respostas",async()=>{
  const {c,p}=await eligible(),other=await participant(c),again=await participant(c,{actor:p});await service(c,other.participationId);await service(c,again.participationId);
  const key=randomUUID(),a=await submit(p,{rating:5},key);assert.equal(a.status,201);
  problem(await submit(again,{rating:5},key),409,"IDEMPOTENCY_KEY_REUSED");const b=await submit(other,{rating:5},key);assert.equal(b.status,201);assert.notEqual(a.body.evaluation.id,b.body.evaluation.id);
});
for(const sameKey of [false,true])test(`E08.11 PostgreSQL POST concorrente sameKey=${sameKey} cria uma linha e uma intenção concluída`,async()=>{
  const {p}=await eligible(),key=randomUUID();const [a,b]=await ordered(()=>submit(p,{rating:5},key),()=>submit(p,{rating:5},sameKey?key:randomUUID()));
  assert.equal(a.status,201);if(sameKey){assert.equal(b.status,201);assert.deepEqual(a.body,b.body);}else problem(b,409,"EVALUATION_ALREADY_SUBMITTED");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM evaluations WHERE participation_id=$1",[p.participationId])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND operation='submit_evaluation' AND status='completed'",[p.userId])).rows[0].n,1);
});
test("E08.11 PostgreSQL POST replay após TTL e fim de envio não muda dados",async()=>{
  const {c,p}=await eligible(),key=randomUUID(),a=await submit(p,{rating:5},key);assert.equal(a.status,201);
  await pool.query("UPDATE participations SET finished_at=clock_timestamp()-interval '40 days' WHERE id=$1",[p.participationId]);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_user_id=$1",[p.userId]);
  const before=await ownState(c,p),b=await submit(p,{rating:5},key);assert.equal(b.status,201);assert.deepEqual(b.body,a.body);assert.deepEqual(await ownState(c,p),before);
  problem(await submit(p,{rating:5}),409,"EVALUATION_SUBMISSION_EXPIRED");assert.deepEqual(await ownState(c,p),before);
});
for(const [name,body] of [["rating",{rating:2}],["comment",{comment:"Comentário novo"}],["both",{rating:3,comment:"Ambos"}],
  ["null",{comment:null}],["empty",{comment:""}],["spaces",{comment:" \t"}]] as const)
test(`E08.11 PostgreSQL PATCH integral ${name} mantém envio e histórico de comentário`,async()=>{
  const {p}=await eligible(),a=await submit(p,{rating:5,comment:"Original"});assert.equal(a.status,201);const id=a.body.evaluation.id,before=await stored(id),r=await edit(p,id,body);assert.equal(r.status,200,JSON.stringify(r.body));
  const after=await stored(id);assert.equal(after.submitted,before.submitted);assert.equal(after.first,before.first);
  assert.equal(after.rating,"rating"in body?body.rating:before.rating);assert.equal(after.comment,"comment"in body?(body.comment===null||body.comment?.trim()===""?null:body.comment):before.comment);
  assert.equal(r.body.evaluation.submittedAt,before.submitted);assert.equal(r.body.evaluation.editableUntilAt,a.body.evaluation.editableUntilAt);
});
test("E08.11 PostgreSQL PATCH sem mudança material não escreve avaliação nem avança updated_at",async()=>{
  const {p}=await eligible(),a=await submit(p,{rating:4});const id=a.body.evaluation.id;
  const before=(await pool.query("SELECT xmin::text AS version FROM evaluations WHERE id=$1",[id])).rows[0].version,old=await stored(id);
  const r=await edit(p,id,{rating:4,comment:" "});assert.equal(r.status,200);assert.equal((await stored(id)).updated,old.updated);
  assert.equal((await pool.query("SELECT xmin::text AS version FROM evaluations WHERE id=$1",[id])).rows[0].version,before);
});
for(const window of ["full","comment"]as const)for(const offset of [-1,0,1])
test(`E08.11 PostgreSQL UPDATE decisivo ${window} ${offset} microssegundo`,async()=>{
  const c=await context(),p=await participant(c,{days:40});await service(c,p.participationId);const id=await evaluation(p.participationId,{days:35});
  await pool.query("UPDATE evaluations SET updated_at=submitted_at WHERE id=$1",[id]);
  const at=(await pool.query(`SELECT to_char((submitted_at+CASE WHEN $2::boolean THEN interval '168 hours' ELSE interval '720 hours' END
    +$3::int*interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM evaluations WHERE id=$1`,[id,window==="full",offset])).rows[0].at as string;
  const body=window==="full"?{rating:5}:{comment:"Tardio"},before=await stored(id);
  const result=await database.transaction(async tx=>{await tx.execute(sql`SELECT id FROM participations WHERE id=${p.participationId} FOR UPDATE`);await tx.execute(sql`SELECT id FROM evaluations WHERE id=${id} FOR UPDATE`);
    return tx.execute<EvaluationDecisionRow>(editStatement(selection(p.userId,p.participationId),id,body,sql`${at}::timestamptz`));},{isolationLevel:"read committed"});
  assert.equal(result.rows[0].allowed,offset<=0);assert.equal(result.rows[0].writtenId,offset<=0?id:null);const after=await stored(id);assert.equal(after.submitted,before.submitted);
  assert.equal(after.updated,offset<=0?at:before.updated);if(window==="comment")assert.equal(after.first,offset<=0?at:null);
});
test("E08.11 PostgreSQL após 168 horas só primeiro comentário é permitido",async()=>{
  const c=await context(),p=await participant(c,{days:20});await service(c,p.participationId);const id=await evaluation(p.participationId,{days:8});
  const before=await ownState(c,p);for(const body of [{rating:4},{rating:4,comment:"Novo"},{comment:null},{comment:""},{comment:" "}])problem(await edit(p,id,body),409,"EVALUATION_EDIT_WINDOW_CLOSED");
  assert.deepEqual(await ownState(c,p),before);const r=await edit(p,id,{comment:"  Primeiro 😀  "});assert.equal(r.status,200,JSON.stringify(r.body));const v=await stored(id);
  assert.equal(v.comment,"  Primeiro 😀  ");assert.equal(v.first,v.updated);problem(await edit(p,id,{comment:"Segundo"}),409,"COMMENT_ALREADY_ADDED");
  assert.deepEqual((await get(p,routes(p.participationId)[2])).body.evaluation.permissions,{canEditRating:false,canEditComment:false,canAddFirstComment:false});
});
for(const previous of [null,"Comentário anterior"])test(`E08.11 PostgreSQL histórico de comentário usado bloqueia inclusão tardia atual=${previous===null?"null":"texto"}`,async()=>{
  const c=await context(),p=await participant(c,{days:20});await service(c,p.participationId);const id=await evaluation(p.participationId,{days:8,usedComment:true,comment:previous}),before=await ownState(c,p);
  problem(await edit(p,id,{comment:"Outro"}),409,"COMMENT_ALREADY_ADDED");assert.deepEqual(await ownState(c,p),before);
});
test("E08.11 PostgreSQL remover comentário na semana inicial nunca restaura first_comment_at",async()=>{
  const {p}=await eligible(),a=await submit(p,{rating:4,comment:"Primeiro"}),id=a.body.evaluation.id,first=(await stored(id)).first;
  assert.equal((await edit(p,id,{comment:null})).status,200);assert.equal((await stored(id)).first,first);
  await pool.query("UPDATE evaluations SET submitted_at=submitted_at-interval '8 days',updated_at=updated_at-interval '8 days',first_comment_at=first_comment_at-interval '8 days' WHERE id=$1",[id]);
  problem(await edit(p,id,{comment:"Tardio"}),409,"COMMENT_ALREADY_ADDED");
});
test("E08.11 PostgreSQL PATCH definitivo não muda valores e retry histórico sobrevive ao vencimento",async()=>{
  const {c,p}=await eligible(),a=await submit(p,{rating:4}),id=a.body.evaluation.id,key=randomUUID(),changed=await edit(p,id,{rating:5},key);assert.equal(changed.status,200);
  await pool.query("UPDATE evaluations SET submitted_at=submitted_at-interval '31 days',updated_at=updated_at-interval '31 days' WHERE id=$1",[id]);
  await pool.query("UPDATE idempotency_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_user_id=$1",[p.userId]);
  const before=await ownState(c,p);problem(await edit(p,id,{rating:3}),409,"EVALUATION_EDIT_WINDOW_CLOSED");const replay=await edit(p,id,{rating:5},key);assert.equal(replay.status,200);assert.deepEqual(replay.body,changed.body);assert.deepEqual(await ownState(c,p),before);
});
test("E08.11 PostgreSQL PATCHs concorrentes parciais não perdem campos nem reiniciam prazos",async()=>{
  const {p}=await eligible(),first=await submit(p,{rating:1}),id=first.body.evaluation.id;
  const [a,b]=await ordered(()=>edit(p,id,{rating:2}),()=>edit(p,id,{comment:"Complemento"}));assert.equal(a.status,200);assert.equal(b.status,200);const v=await stored(id);
  assert.equal(v.rating,2);assert.equal(v.comment,"Complemento");assert.equal(v.submitted,first.body.evaluation.submittedAt);
});
for(const sameKey of [false,true])test(`E08.11 PostgreSQL inclusão tardia concorrente sameKey=${sameKey}`,async()=>{
  const c=await context(),p=await participant(c,{days:20});await service(c,p.participationId);const id=await evaluation(p.participationId,{days:8}),key=randomUUID();
  const [a,b]=await ordered(()=>edit(p,id,{comment:"Primeiro"},key),()=>edit(p,id,{comment:"Primeiro"},sameKey?key:randomUUID()));assert.equal(a.status,200);
  if(sameKey){assert.equal(b.status,200);assert.deepEqual(a.body,b.body);}else problem(b,409,"COMMENT_ALREADY_ADDED");const v=await stored(id);assert.equal(v.comment,"Primeiro");assert.equal(v.first,v.updated);
});
test("E08.11 PostgreSQL PATCH conflito diferencia recurso e ausência de campo; namespaces são distintos",async()=>{
  const {c,p}=await eligible(),key=randomUUID(),a=await submit(p,{rating:5},key),id=a.body.evaluation.id;
  assert.equal((await edit(p,id,{rating:4},key)).status,200);problem(await edit(p,id,{rating:4,comment:null},key),409,"IDEMPOTENCY_KEY_REUSED");
  const other=await participant(c,{actor:p});await service(c,other.participationId);const b=await submit(other);assert.equal(b.status,201);
  problem(await edit(p,b.body.evaluation.id,{rating:4},key),409,"IDEMPOTENCY_KEY_REUSED");
});
for(const operation of ["submit_evaluation","edit_evaluation"])test(`E08.11 PostgreSQL intenção in_progress ${operation} não executa escrita`,async()=>{
  const {c,p}=await eligible(),key=randomUUID(),id=operation==="edit_evaluation"?await evaluation(p.participationId):p.participationId;
  const payload=operation==="submit_evaluation"?submitEvaluationBody.parse({rating:5}):editEvaluationBody.parse({rating:5});
  await pool.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 minute')`,[randomUUID(),p.userId,operation,key,fingerprint(operation,id,payload)]);
  const before=await ownState(c,p);problem(operation==="submit_evaluation"?await submit(p,{rating:5},key):await edit(p,id,{rating:5},key),409,"IDEMPOTENCY_IN_PROGRESS");assert.deepEqual(await ownState(c,p),before);
});
for(const mode of ["post","patch"]as const)test(`E08.11 PostgreSQL ${mode} autenticação real, sessão revogada e 404 indistinguível`,async()=>{
  const {c,p}=await eligible(),id=await evaluation(p.participationId),other=await account(),before=await ownState(c,p);
  const req=mode==="post"?submit(p):edit(p,id);problem(await req.unset("Authorization"),401,"MISSING_ACCESS_TOKEN");
  const a=mode==="post"?await submit(p,{rating:5},randomUUID(),other):await edit(other,id),b=mode==="post"?await submit({...p,participationId:randomUUID()},{rating:5},randomUUID(),other):await edit(other,randomUUID());
  problem(a,404,"RESOURCE_NOT_FOUND");problem(b,404,"RESOURCE_NOT_FOUND");assert.deepEqual(a.body,b.body);
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE id=$1",[p.sessionId]);
  problem(mode==="post"?await submit(p):await edit(p,id),401,"SESSION_REVOKED");
  const after=await ownState(c,p);assert.deepEqual(after.evaluations,before.evaluations);assert.deepEqual(after.intents,before.intents);
});
for(const role of ["staff","admin"]as const)test(`E08.11 PostgreSQL ${role} só avalia participação própria e respeita 2FA`,async()=>{
  const c=await context(),actor=role==="admin"?c.admin:c.staff,p=await participant(c,{actor}),foreign=await participant(c);await service(c,p.participationId);await service(c,foreign.participationId);
  const foreignId=await evaluation(foreign.participationId),foreignBefore=await ownState(c,foreign);
  if(role==="admin"){await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1",[actor.sessionId]);problem(await submit(p),401,"ADMIN_2FA_REQUIRED");await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1",[actor.sessionId]);}
  const a=await submit(p);assert.equal(a.status,201,JSON.stringify(a.body));assert.equal((await edit(p,a.body.evaluation.id,{comment:"Próprio"})).status,200);
  problem(await submit(foreign,{rating:5},randomUUID(),actor),404,"RESOURCE_NOT_FOUND");
  problem(await edit(actor,foreignId,{rating:1}),404,"RESOURCE_NOT_FOUND");assert.deepEqual(await ownState(c,foreign),foreignBefore);
});
for(const mode of ["post","patch"]as const)test(`E08.11 PostgreSQL replay ${mode} revalida autorização atual sem vazar histórico`,async()=>{
  const {p}=await eligible(),key=randomUUID(),a=await submit(p,{rating:5},key),id=a.body.evaluation.id;
  if(mode==="patch")assert.equal((await edit(p,id,{comment:"Privado"},key)).status,200);const other=await account();
  await pool.query("UPDATE participations SET user_id=$2 WHERE id=$1",[p.participationId,other.userId]);
  const r=mode==="post"?await submit(p,{rating:5},key):await edit(p,id,{comment:"Privado"},key);problem(r,404,"RESOURCE_NOT_FOUND");assert.equal(JSON.stringify(r.body).includes("Privado"),false);
});
test("E08.11 PostgreSQL cinco GETs oficiais refletem POST/PATCH sem duplicação ou efeito de leitura",async()=>{
  const {c,p}=await eligible();assert.equal((await get(p,"/evaluations/pending")).body.items.some((x:{participationId:string})=>x.participationId===p.participationId),true);
  const a=await submit(p,{rating:5}),id=a.body.evaluation.id;assert.equal(a.status,201);const expected=await ownState(c,p);
  for(const route of routes(p.participationId)){const r=await get(p,route);assert.equal(r.status,200);if(route.endsWith("evaluation-eligibility")){assert.equal(r.body.submitted,true);assert.equal(r.body.pending,false);}else if(route==="/evaluations/pending")assert.equal(r.body.items.some((x:{participationId:string})=>x.participationId===p.participationId),false);
    else if(route.endsWith("/evaluation"))assert.deepEqual(r.body.evaluation,a.body.evaluation);else if(route==="/participations/history"){assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].evaluation.submitted,true);}else assert.equal(r.body.pendingEvaluationParticipationIds.includes(p.participationId),false);}
  assert.deepEqual(await ownState(c,p),expected);const b=await edit(p,id,{rating:3,comment:"Atual"});assert.equal(b.status,200);assert.deepEqual((await get(p,routes(p.participationId)[2])).body.evaluation,b.body.evaluation);assert.equal(b.body.evaluation.submittedAt,a.body.evaluation.submittedAt);
  for(const secret of [p.userId,c.staff.userId,c.admin.userId,"@example.test","fixture-private-hash","firstCommentAt"]){assert.equal(JSON.stringify(b.body).includes(secret),false);}
});
for(const mode of ["manual","automatic"]as const)test(`E08.11 PostgreSQL finalização ${mode} real concorrente libera elegibilidade após lock`,async()=>{
  const c=await context(),p=await participant(c,{status:"active"});await service(c,p.participationId);
  if(mode==="automatic")await expire(c);const closure=app.get((await import("../../src/events/event-closure.service")).EventClosureService);
  const [first,second]=await ordered(()=>mode==="manual"?close(c).then(r=>{assert.equal(r.status,200);return r.status;}):closure.regularizeEvent(c.eventId).then(r=>{assert.equal(r.kind,"closed");return 200;}),()=>submit(p));
  assert.equal(first,200);assert.equal(second.status,201,JSON.stringify(second.body));
});
test("E08.11 PostgreSQL fechamento controlado externo sem completed não autoriza avaliação",async()=>{
  const c=await context(),p=await person(c,"waiting");assert.equal((await close(c,await controlled())).status,200);problem(await submit(p),409,"EVALUATION_NOT_ELIGIBLE");
});
test("E08.11 PostgreSQL job atrasado não estende prazo de envio",async()=>{
  const c=await context(),p=await participant(c,{status:"active",days:40});await service(c,p.participationId);await expire(c,40);
  const closure=app.get((await import("../../src/events/event-closure.service")).EventClosureService);assert.equal((await closure.regularizeEvent(c.eventId)).kind,"closed");problem(await submit(p),409,"EVALUATION_SUBMISSION_EXPIRED");
});
for(const phase of ["reserve","domain","complete"]as const)for(const mode of ["post","patch"]as const)
test(`E08.11 PostgreSQL falha depois da escrita ${phase} ${mode} reverte avaliação e intenção`,async()=>{
  const {c,p}=await eligible(),id=mode==="patch"?await evaluation(p.participationId):undefined,key=randomUUID(),before=await ownState(c,p),client=await pool.connect();
  const originalQuery=client.query.bind(client) as (config:string|QueryConfig,params?:unknown[])=>Promise<QueryResult>;
  let reached=false;const proxy=new Proxy(client,{get(target,property){if(property==="query")return async(config:string|QueryConfig,params?:unknown[])=>{
    const result=await originalQuery(config,params),text=typeof config==="string"?config:config.text;
    if(!reached&&((phase==="reserve"&&text.includes('insert into "idempotency_operations"'))||(phase==="complete"&&text.includes('update "idempotency_operations"'))||(phase==="domain"&&text.includes("WITH decision AS MATERIALIZED")))){
      assert.equal(result.rows.length,1);if(phase==="domain")assert.ok(result.rows[0].writtenId);reached=true;
      await originalQuery("SELECT 1/0");assert.fail("A falha SQL real deveria abortar a transação.");}return result;};return Reflect.get(target,property,target);}});
  const failing=makeWrites(drizzle(proxy,{schema})),originalPost=writes.submitAuthenticated.bind(writes),originalPatch=writes.editAuthenticated.bind(writes);
  writes.submitAuthenticated=(input,context)=>failing.submitAuthenticated(input,context);writes.editAuthenticated=(input,context)=>failing.editAuthenticated(input,context);
  try{const r=mode==="post"?await submit(p,{rating:5},key):await edit(p,id!,{rating:5},key);problem(r,500,"INTERNAL_SERVER_ERROR");assert.equal(JSON.stringify(r.body).includes("PRIVATE"),false);assert.equal(reached,true);assert.deepEqual(await ownState(c,p),before);}
  finally{writes.submitAuthenticated=originalPost;writes.editAuthenticated=originalPatch;client.release();}
  assert.equal((mode==="post"?await submit(p,{rating:5},key):await edit(p,id!,{rating:5},key)).status,mode==="post"?201:200);
});
for(const mode of ["post","patch"]as const)test(`E08.11 PostgreSQL snapshot de leitura permanece coerente durante ${mode} concorrente real`,async()=>{
  const {p}=await eligible();let id:string|undefined;if(mode==="patch"){const a=await submit(p,{rating:4,comment:"Antes"});id=a.body.evaluation.id;}
  const original=database.transaction.bind(database) as typeof database.transaction,dialect=new PgDialect();let ready!:()=>void,release!:()=>void,readerPid=0,writerPid=0;
  const reached=new Promise<void>(yes=>{ready=yes;}),gate=new Promise<void>(yes=>{release=yes;});
  database.transaction=(callback,config)=>original(async tx=>{if(config?.isolationLevel==="read committed")writerPid=(await tx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    const execute=tx.execute.bind(tx);tx.execute=(async(...args:Parameters<typeof tx.execute>)=>{const q=args[0],text=typeof q==="string"?q:dialect.sqlToQuery(q.getSQL()).sql,result=await execute(...args);
      if(text.includes("SELECT to_char(clock_timestamp()")){readerPid=(await execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;ready();await gate;}return result;}) as typeof tx.execute;return callback(tx);},config);
  const pending=get(p,routes(p.participationId)[2]).then(r=>r);pending.catch(()=>undefined);
  try{await Promise.race([reached,pending.then(()=>{throw new Error("Snapshot não foi retido");})]);const changed=mode==="post"?await submit(p,{rating:5}):await edit(p,id!,{comment:"Depois"});assert.equal(changed.status,mode==="post"?201:200,JSON.stringify(changed.body));
    assert.ok(readerPid>0&&writerPid>0);assert.notEqual(readerPid,writerPid);release();const r=await pending;assert.equal(r.status,200);if(mode==="post"){assert.equal(r.body.evaluation,null);assert.equal(r.body.eligibility.pending,true);}else assert.equal(r.body.evaluation.comment,"Antes");
    database.transaction=original;const after=await get(p,routes(p.participationId)[2]);if(mode==="post"){assert.equal(after.body.eligibility.submitted,true);assert.equal(after.body.eligibility.pending,false);}else assert.equal(after.body.evaluation.comment,"Depois");
  }finally{database.transaction=original;release();await Promise.allSettled([pending]);}
});
test("E08.11 PostgreSQL prazo de edição é revalidado depois da espera real pela participação",async()=>{
  const {p}=await eligible(),id=await evaluation(p.participationId),client=await pool.connect();let pending:Promise<supertest.Response>|undefined;
  await pool.query("UPDATE evaluations SET submitted_at=clock_timestamp()-interval '720 hours'+interval '5 seconds' WHERE id=$1",[id]);
  try{await client.query("BEGIN");await client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE",[p.participationId]);const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=edit(p,id,{comment:"Atrasado"}).then(r=>r);pending.catch(()=>undefined);await blocked(pid);
    assert.equal((await pool.query("SELECT clock_timestamp()<submitted_at+interval '720 hours' AS before_cut FROM evaluations WHERE id=$1",[id])).rows[0].before_cut,true);
    const until=Date.now()+12000;
    while(!(await pool.query("SELECT clock_timestamp()>submitted_at+interval '720 hours' AS ended FROM evaluations WHERE id=$1",[id])).rows[0].ended){assert.ok(Date.now()<until);await new Promise(done=>setTimeout(done,25));}
    await client.query("COMMIT");problem(await pending,409,"EVALUATION_EDIT_WINDOW_CLOSED");assert.equal((await stored(id)).comment,null);
  }finally{await client.query("ROLLBACK");await Promise.allSettled([pending]);client.release();}
});
test("E08.11 PostgreSQL envio cruza prazo enquanto aguarda lock e reverte a reserva",async()=>{
  const {c,p}=await eligible(),client=await pool.connect();let pending:Promise<supertest.Response>|undefined;
  await pool.query("UPDATE participations SET finished_at=clock_timestamp()-interval '720 hours'+interval '5 seconds' WHERE id=$1",[p.participationId]);const before=await ownState(c,p);
  try{await client.query("BEGIN");await client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE",[p.participationId]);const pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=submit(p).then(r=>r);pending.catch(()=>undefined);await blocked(pid);
    assert.equal((await pool.query("SELECT clock_timestamp()<finished_at+interval '720 hours' AS before_cut FROM participations WHERE id=$1",[p.participationId])).rows[0].before_cut,true);
    const until=Date.now()+12000;while(!(await pool.query("SELECT clock_timestamp()>finished_at+interval '720 hours' AS ended FROM participations WHERE id=$1",[p.participationId])).rows[0].ended){assert.ok(Date.now()<until);await new Promise(done=>setTimeout(done,25));}
    await client.query("COMMIT");problem(await pending,409,"EVALUATION_SUBMISSION_EXPIRED");assert.deepEqual(await ownState(c,p),before);
  }finally{await client.query("ROLLBACK");await Promise.allSettled([pending]);client.release();}
});
test("E08.11 PostgreSQL escritas do titular não alteram conta ou evento terceiros",async()=>{
  const {p}=await eligible(),other=await eligible(),before=await ownState(other.c,other.p),a=await submit(p,{rating:5,comment:"Próprio"});assert.equal(a.status,201);
  assert.equal((await edit(p,a.body.evaluation.id,{rating:3})).status,200);assert.deepEqual(await ownState(other.c,other.p),before);
});
