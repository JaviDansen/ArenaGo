import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import supertest from "supertest";
import type { EventClosureService } from "../../src/events/event-closure.service";
import type { EvaluationReadRow } from "../../src/evaluations/evaluation-read.policy";
import { setup, cleanup, app, pool, database, context, account, participant, service, evaluation, expire, ownState, routes, get, problem,
  person, rich, close, controlled } from "./evaluation-read-fixture";

let closure: EventClosureService;
let projection: typeof import("../../src/evaluations/evaluation-read.policy").evaluationReadProjection;
before(async () => {
  await setup();
  closure = app.get((await import("../../src/events/event-closure.service")).EventClosureService);
  projection = (await import("../../src/evaluations/evaluation-read.policy")).evaluationReadProjection;
});
after(cleanup);

for (const status of ["waiting", "active", "finished", "canceled"] as const) for (const completed of [0, 2])
  test(`E08.10 PostgreSQL elegibilidade ${status} com ${completed} completed reais`, async () => {
    const c = await context(), p = await participant(c, { status });
    for (let n = 0; n < completed; n++) await service(c, p.participationId);
    // Outros terminais nunca contam como conclusão; pending só é corrente em active.
    await service(c, p.participationId, "absent"); await service(c, p.participationId, "canceled"); if (status === "active") await service(c, p.participationId, "pending");
    const r = await get(p, routes(p.participationId)[0]); assert.equal(r.status, 200);
    assert.equal(r.body.participationId, p.participationId); assert.equal(r.body.participationStatus, status); assert.equal(r.body.completedServicesCount, completed);
    assert.equal(r.body.eligible, status === "finished" && completed > 0); assert.equal(r.body.pending, status === "finished" && completed > 0);
    assert.equal(r.body.submitted, false); assert.equal(r.body.reason, status !== "finished" ? "NOT_FINISHED" : completed ? null : "NO_COMPLETED_SERVICE");
    assert.equal(r.body.firstSubmissionDeadlineAt === null, status !== "finished");
    const own = await get(p, routes(p.participationId)[2]); assert.equal(own.status, 200); assert.equal(own.body.evaluation, null); assert.deepEqual(own.body.eligibility, r.body);
  });

for (const role of ["participant", "staff", "admin"] as const) for (const endpoint of ["evaluation-eligibility", "evaluation"])
  test(`E08.10 PostgreSQL ${role} não consulta participação alheia em ${endpoint}`, async () => {
    const c = await context(), p = await participant(c), actor = role === "admin" ? c.admin : role === "staff" ? c.staff : await account(); await service(c, p.participationId); await evaluation(p.participationId);
    const a = await get(actor, `/participations/${p.participationId}/${endpoint}`), b = await get(actor, `/participations/${randomUUID()}/${endpoint}`);
    problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
  });
for (const endpoint of [0, 1, 2, 3, 4]) for (const state of ["missing", "revoked", "expired", "inactive", "admin-2fa"] as const)
  test(`E08.10 PostgreSQL rota ${endpoint} recusa sessão ${state}`, async () => {
    const c = await context(), actor = state === "admin-2fa" ? c.admin : await account(), p = await participant(c, { actor });
    if (state === "revoked") await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [actor.sessionId]);
    if (state === "expired") await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [actor.sessionId]);
    if (state === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [actor.userId]);
    if (state === "admin-2fa") await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [actor.sessionId]);
    const route = routes(p.participationId)[endpoint], before = await ownState(c, actor);
    const r = state === "missing" ? await supertest(app.getHttpServer()).get(`/api/v1${route}`) : await get(actor, route);
    problem(r, 401, state === "missing" ? "MISSING_ACCESS_TOKEN" : state === "revoked" ? "SESSION_REVOKED" : state === "expired" ? "SESSION_EXPIRED" : state === "inactive" ? "ACCOUNT_DEACTIVATED" : "ADMIN_2FA_REQUIRED");
    assert.deepEqual(await ownState(c, actor), before);
  });
test("E08.10 PostgreSQL Admin participante acessa apenas os próprios registros com 2FA válido", async () => {
  const c = await context(), p = await participant(c, { actor: c.admin }); await service(c, p.participationId); await evaluation(p.participationId);
  for (const route of routes(p.participationId)) assert.equal((await get(c.admin, route)).status, 200);
});
test("E08.10 PostgreSQL pendências separam reentradas, excluem expiradas/submetidas e ordenam por fim/UUID", async () => {
  const c = await context(), actor = await account(), a = await participant(c, { actor, days: 1 }), b = await participant(c, { actor, days: 1 }), expired = await participant(c, { actor, days: 31 }), submitted = await participant(c, { actor });
  const noService = await participant(c, { actor, days: 1 });
  for (const p of [a, b, expired, submitted]) await service(c, p.participationId); await evaluation(submitted.participationId);
  await pool.query(`WITH t AS MATERIALIZED (SELECT date_trunc('seconds',clock_timestamp()-interval '24 hours')+interval '0.123456 second' AS at)
    UPDATE participations SET finished_at=t.at FROM t WHERE id=ANY($1::uuid[])`, [[a.participationId, b.participationId]]);
  const r = await get(actor, "/evaluations/pending"); assert.equal(r.status, 200); assert.deepEqual(r.body.items.map((p: { participationId: string }) => p.participationId), [a.participationId, b.participationId].sort().reverse());
  for (const item of r.body.items) { assert.deepEqual(item.event, { id: c.eventId, name: "E089 fixture" }); assert.equal(item.completedServicesCount, 1); assert.match(item.finishedAt, /\.123456Z$/); }
  const r2 = await get(actor, "/participations/return-state"); assert.deepEqual(r2.body.pendingEvaluationParticipationIds, r.body.items.map((p: { participationId: string }) => p.participationId));
  const old = await get(expired, routes(expired.participationId)[0]); assert.equal(old.body.eligible, true); assert.equal(old.body.pending, false); assert.equal(old.body.reason, "SUBMISSION_EXPIRED");
  const history = await get(actor, "/participations/history"); assert.equal(history.status, 200);
  assert.equal(history.body.items.find((p: { participationId: string }) => p.participationId === expired.participationId).evaluation.pending, false);
  const empty = history.body.items.find((p: { participationId: string }) => p.participationId === noService.participationId); assert.equal(empty.completedServicesCount, 0); assert.equal(empty.evaluation.eligible, false);
});
test("E08.10 PostgreSQL titular sem participações recebe listas vazias e retorno neutro", async () => {
  const actor = await account(); const pending = await get(actor, "/evaluations/pending"), history = await get(actor, "/participations/history"), returned = await get(actor, "/participations/return-state");
  for (const response of [pending, history, returned]) assert.equal(response.status, 200);
  assert.deepEqual(pending.body, { items: [] }); assert.deepEqual(history.body, { items: [], nextCursor: null });
  assert.deepEqual(returned.body, { recentFinalization: null, pendingEvaluationParticipationIds: [] });
});
test("E08.10 PostgreSQL relógios independentes e updated_at recente não reinicia janela de edição", async () => {
  const c = await context(), p = await participant(c, { days: 35 }); await service(c, p.participationId); const eid = await evaluation(p.participationId, { days: 10 });
  const r = await get(p, routes(p.participationId)[2]); assert.equal(r.status, 200); assert.equal(r.body.eligibility.reason, "ALREADY_SUBMITTED"); assert.equal(r.body.eligibility.pending, false);
  assert.deepEqual(r.body.evaluation.permissions, { canEditRating: false, canEditComment: true, canAddFirstComment: true });
  assert.equal(r.body.evaluation.id, eid); assert.equal(r.body.evaluation.rating, 4); assert.equal(r.body.evaluation.comment, null);
  assert.deepEqual((await get(p, "/participations/history")).body.items[0].evaluation, { eligible: true, submitted: true, pending: false });
});

// Fronteiras exatas usam o MESMO fragmento SQL de produção com instantes derivados
// no PostgreSQL. Não tenta sincronizar relógios físicos na mesma fração de microssegundo.
for (const [window, offset, expected] of [
  ["first", "-1 microsecond", true], ["first", "0 microseconds", true], ["first", "1 microsecond", false],
  ["full", "-1 microsecond", true], ["full", "0 microseconds", true], ["full", "1 microsecond", false],
  ["comment", "-1 microsecond", true], ["comment", "0 microseconds", true], ["comment", "1 microsecond", false],
] as const) test(`E08.10 PostgreSQL fronteira ${window} offset ${offset}`, async () => {
  const c = await context(), p = await participant(c); await service(c, p.participationId);
  if (window !== "first") await evaluation(p.participationId);
  const at = (await pool.query(window === "first" ? `SELECT to_char((finished_at+interval '720 hours'+$2::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM participations WHERE id=$1`
    : `SELECT to_char((submitted_at+CASE WHEN $3::boolean THEN interval '168 hours' ELSE interval '720 hours' END+$2::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM evaluations WHERE participation_id=$1`,
  window === "first" ? [p.participationId, offset] : [p.participationId, offset, window === "full"])).rows[0].at as string;
  const result = await database.transaction(tx => tx.execute<EvaluationReadRow>(projection(sql`SELECT p.id,p.event_id,e.name AS event_name,p.status,p.joined_at,p.arena_entered_at,p.finished_at,p.finish_reason
    FROM participations p JOIN events e ON e.id=p.event_id WHERE p.user_id=${p.userId} AND p.id=${p.participationId}`, at)), { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.equal(result.rows.length, 1); const row = result.rows[0];
  assert.equal(window === "first" ? row.pending : window === "full" ? row.editFull : row.addComment, expected);
  if (window === "first") assert.equal(row.reason, expected ? null : "SUBMISSION_EXPIRED");
  if (window === "full") assert.equal(row.addComment, !expected);
});
test("E08.10 PostgreSQL first_comment_at usado impede inclusão tardia mesmo com comment NULL", async () => {
  const c = await context(), p = await participant(c, { days: 20 }); await service(c, p.participationId); await evaluation(p.participationId, { days: 8, usedComment: true });
  const r = await get(p, routes(p.participationId)[2]); assert.equal(r.body.evaluation.comment, null); assert.deepEqual(r.body.evaluation.permissions, { canEditRating: false, canEditComment: false, canAddFirstComment: false });
});
test("E08.10 PostgreSQL histórico keyset separa microssegundos, desempata UUID e preserva reentradas", async () => {
  const c = await context(), actor = await account(), list = [];
  for (let i = 0; i < 5; i++) list.push(await participant(c, { actor, status: i === 4 ? "active" : i === 3 ? "canceled" : "finished" }));
  for (const [i, p] of list.entries()) await pool.query("UPDATE participations SET joined_at='2026-11-01T15:00:00.100000Z'::timestamptz+$2::int*interval '1 microsecond' WHERE id=$1", [p.participationId, i < 2 ? 1 : 2]);
  const expected = (await pool.query("SELECT id FROM participations WHERE user_id=$1 ORDER BY joined_at DESC,id DESC", [actor.userId])).rows.map(p => p.id);
  const seen: string[] = []; let cursor: string | null = null;
  do { const r = await get(actor, "/participations/history").query({ limit: 2, ...(cursor ? { cursor } : {}) }); assert.equal(r.status, 200);
    for (const item of r.body.items) { seen.push(item.participationId); assert.equal(item.event.id, c.eventId); assert.match(item.joinedAt, /\.10000[12]Z$/); }
    cursor = r.body.nextCursor as string | null;
  } while (cursor);
  assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, 5);
});
test("E08.10 PostgreSQL histórico padrão 20, máximo 50 e inserção concorrente não duplica página seguinte", async () => {
  const c = await context(), actor = await account(); for (let i = 0; i < 23; i++) await participant(c, { actor });
  const first = await get(actor, "/participations/history"); assert.equal(first.body.items.length, 20); assert.ok(first.body.nextCursor);
  await participant(c, { actor }); const next = await get(actor, "/participations/history").query({ cursor: first.body.nextCursor });
  assert.equal(next.body.items.length, 3); assert.equal(next.body.nextCursor, null);
  const seen = [...first.body.items, ...next.body.items].map((p: { participationId: string }) => p.participationId); assert.equal(new Set(seen).size, 23);
  assert.equal((await get(actor, "/participations/history").query({ limit: 50 })).body.items.length, 24);
});
test("E08.10 PostgreSQL parâmetros e cursor malformados recebem 400 sem consultar outra identidade", async () => {
  const actor = await account();
  for (const query of [{ limit: "51" }, { cursor: "%%%" }, { limit: ["1", "2"] }, { userId: randomUUID() }]) problem(await get(actor, "/participations/history").query(query), 400, "VALIDATION_ERROR");
  for (const suffix of ["evaluation", "evaluation-eligibility"]) problem(await get(actor, `/participations/not-a-uuid/${suffix}`), 400, "VALIDATION_ERROR");
  const current = await get(actor, "/participations/current");
  assert.equal(current.status, 200);
  assert.deepEqual(current.body, { participation: null });
});

for (const mode of ["immediate", "controlled", "automatic-normal", "automatic-admin"] as const) test(`E08.10 PostgreSQL retomada ${mode} preserva motivo, elegibilidade e prazo lógico`, async () => {
  const c = await context(), p = await participant(c, { status: "active" }); await service(c, p.participationId); const outside = await person(c, "waiting");
  if (mode === "immediate") assert.equal((await close(c)).status, 200);
  else if (mode === "controlled" || mode === "automatic-admin") {
    const body = await controlled(mode === "controlled" ? 1800 : 2); assert.equal((await close(c, body)).status, 200);
    if (mode === "automatic-admin") {
      const until = Date.now() + 6000; while (Date.now() < until && !(await pool.query("SELECT clock_timestamp()>=$1::timestamptz AS ended", [body.controlledUntilAt])).rows[0].ended) await new Promise(done => setTimeout(done, 20));
      assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed");
    }
  } else { await expire(c); assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); }
  const r = await get(mode === "controlled" ? outside : p, "/participations/return-state"); assert.equal(r.status, 200);
  const reason = mode === "immediate" ? "admin_immediate" : mode === "controlled" ? "admin_controlled_external_wait_closed" : mode === "automatic-normal" ? "automatic_operational_deadline" : "automatic_admin_deadline";
  assert.equal(r.body.recentFinalization.finishReason, reason);
  assert.deepEqual(r.body.pendingEvaluationParticipationIds, mode === "controlled" ? [] : [p.participationId]);
  const eligibility = await get(outside, routes(outside.participationId)[0]); assert.equal(eligibility.body.eligible, false); assert.equal(eligibility.body.pending, false);
  assert.equal(eligibility.body.reason, mode === "controlled" || mode === "automatic-admin" ? "EXTERNAL_WAIT_CLOSED" : "NO_COMPLETED_SERVICE");
  const h = await get(mode === "controlled" ? outside : p, "/participations/history"); assert.equal(h.body.items[0].finishReason, reason);
});
test("E08.10 PostgreSQL job 40 dias atrasado não cria nova janela de avaliação", async () => {
  const c = await context(), p = await participant(c, { status: "active", days: 40 }); await service(c, p.participationId); const at = await expire(c, 40); await closure.regularizeEvent(c.eventId);
  const r = await get(p, routes(p.participationId)[0]); assert.equal(r.body.eligible, true); assert.equal(r.body.pending, false); assert.equal(r.body.reason, "SUBMISSION_EXPIRED");
  const returned = await get(p, "/participations/return-state"); assert.equal(returned.body.recentFinalization.finishedAt, at); assert.deepEqual(returned.body.pendingEvaluationParticipationIds, []);
});
test("E08.10 PostgreSQL GET após prazo não executa limpeza, reserva ou finalização artificial", async () => {
  const c = await context(), p = await participant(c, { status: "active" }); await service(c, p.participationId, "pending"); await expire(c);
  const before = await ownState(c, p);
  const info = await get(p, routes(p.participationId)[0]); assert.equal(info.body.participationStatus, "active"); assert.equal(info.body.reason, "NOT_FINISHED"); assert.equal(info.body.pending, false);
  assert.deepEqual((await get(p, "/participations/return-state")).body, { recentFinalization: null, pendingEvaluationParticipationIds: [] });
  assert.equal((await get(p, "/participations/history")).body.items[0].status, "active"); assert.deepEqual(await ownState(c, p), before);
});
test("E08.10 PostgreSQL recent significa última finalização de sistema, sem janela fixa ou consumo", async () => {
  const c = await context(), actor = await account(), old = await participant(c, { actor, days: 200, reason: "automatic_operational_deadline" });
  await participant(c, { actor, days: 1, reason: "voluntary" }); const first = await get(actor, "/participations/return-state"), repeat = await get(actor, "/participations/return-state");
  assert.equal(first.body.recentFinalization.participationId, old.participationId); assert.deepEqual(first.body, repeat.body); assert.deepEqual(first.body.pendingEvaluationParticipationIds, []);
});
test("E08.10 PostgreSQL leituras repetidas são read only sem qualquer alteração ou reserva", async () => {
  const c = await context(), p = await participant(c); await service(c, p.participationId); await evaluation(p.participationId, { comment: "Comentário próprio" });
  const before = await ownState(c, p), original = database.transaction.bind(database) as typeof database.transaction; let snapshots = 0;
  database.transaction = (callback, config) => original(async tx => {
    assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
    assert.equal((await tx.execute<{ transaction_read_only: string }>(sql`SHOW transaction_read_only`)).rows[0].transaction_read_only, "on"); snapshots++; return callback(tx);
  }, config);
  try { for (let i = 0; i < 2; i++) for (const route of routes(p.participationId)) assert.equal((await get(p, route)).status, 200); }
  finally { database.transaction = original; }
  assert.equal(snapshots, 10); assert.deepEqual(await ownState(c, p), before);
});
test("E08.10 PostgreSQL privacidade não carrega questionário/snapshot/pessoas ou auditoria nas projeções", async () => {
  const c = await context(), data = await rich(c); assert.equal((await close(c)).status, 200); const owner = data.outside;
  for (const route of routes(owner.participationId)) { const r = await get(owner, route); assert.equal(r.status, 200); const text = JSON.stringify(r.body);
    for (const secret of ["E088_PRIVATE", "E089_PRIVATE", "@example.test", "fixture-private-hash", c.admin.userId, c.staff.userId]) assert.equal(text.includes(secret), false);
  }
});

for (const kind of ["evaluation", "return", "history"] as const) test(`E08.10 PostgreSQL snapshot ${kind} não mistura commit concorrente com relações anteriores`, async () => {
  const c = await context(), p = await participant(c, { status: kind === "evaluation" ? "finished" : "active" }); await service(c, p.participationId);
  const eid = kind === "evaluation" ? await evaluation(p.participationId, { comment: "Antes" }) : undefined;
  const original = database.transaction.bind(database) as typeof database.transaction, dialect = new PgDialect(); let ready!: () => void, release!: () => void, readerPid = 0, writerPid = 0;
  const reached = new Promise<void>(yes => { ready = yes; }), gate = new Promise<void>(yes => { release = yes; });
  database.transaction = (callback, config) => original(async tx => {
    if (config?.isolationLevel === "read committed") writerPid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    const execute = tx.execute.bind(tx); tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
    const q = args[0], text = typeof q === "string" ? q : dialect.sqlToQuery(q.getSQL()).sql, result = await execute(...args);
    if (text.includes("SELECT to_char(clock_timestamp()")) { readerPid = (await execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid; ready(); await gate; } return result;
  }) as typeof tx.execute; return callback(tx); }, config);
  const pending = get(p, kind === "evaluation" ? routes(p.participationId)[2] : kind === "history" ? "/participations/history" : "/participations/return-state").then(r => r); pending.catch(() => undefined);
  try {
    await Promise.race([reached, pending.then(() => { throw new Error("Snapshot não foi retido."); })]);
    if (kind === "evaluation") {
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN"); writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await writer.query("UPDATE evaluations SET comment='Depois',updated_at=clock_timestamp() WHERE id=$1", [eid]); await writer.query("COMMIT");
      } catch (error) { await writer.query("ROLLBACK"); throw error; } finally { writer.release(); }
    } else { const closed = await close(c); assert.equal(closed.status, 200, JSON.stringify(closed.body)); }
    assert.ok(readerPid > 0 && writerPid > 0); assert.notEqual(readerPid, writerPid);
    release(); const r = await pending; assert.equal(r.status, 200);
    if (kind === "evaluation") assert.equal(r.body.evaluation.comment, "Antes"); else if (kind === "history") { assert.equal(r.body.items[0].status, "active"); assert.equal(r.body.items[0].finishReason, null); }
    else { assert.equal(r.body.recentFinalization, null); assert.deepEqual(r.body.pendingEvaluationParticipationIds, []); }
    database.transaction = original;
    const next = await get(p, kind === "evaluation" ? routes(p.participationId)[2] : kind === "history" ? "/participations/history" : "/participations/return-state");
    if (kind === "evaluation") assert.equal(next.body.evaluation.comment, "Depois"); else if (kind === "history") assert.equal(next.body.items[0].finishReason, "admin_immediate");
    else { assert.equal(next.body.recentFinalization.finishReason, "admin_immediate"); assert.deepEqual(next.body.pendingEvaluationParticipationIds, [p.participationId]); }
  } finally { database.transaction = original; release(); await Promise.allSettled([pending]); }
});
test("E08.10 PostgreSQL snapshot preserva contagem anterior a complete E07.5 real concorrente", async () => {
  const c = await context(), p = await participant(c, { status: "active" }), session = await service(c, p.participationId, "pending");
  const original = database.transaction.bind(database) as typeof database.transaction, dialect = new PgDialect();
  let ready!: () => void, release!: () => void, readerPid = 0, writerPid = 0;
  const reached = new Promise<void>(yes => { ready = yes; }), gate = new Promise<void>(yes => { release = yes; });
  database.transaction = (callback, config) => original(async tx => {
    if (config?.isolationLevel === "read committed") writerPid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    const execute = tx.execute.bind(tx); tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
      const q = args[0], text = typeof q === "string" ? q : dialect.sqlToQuery(q.getSQL()).sql, result = await execute(...args);
      if (text.includes("SELECT to_char(clock_timestamp()")) { readerPid = (await execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid; ready(); await gate; }
      return result;
    }) as typeof tx.execute; return callback(tx);
  }, config);
  const pending = get(p, "/participations/history").then(r => r); pending.catch(() => undefined);
  try {
    await Promise.race([reached, pending.then(() => { throw new Error("Snapshot não foi retido."); })]);
    const completed = await supertest(app.getHttpServer()).post(`/api/v1/staff/events/${c.eventId}/service-sessions/${session.sessionId}/complete`)
      .set("Authorization", `Bearer ${c.staff.token}`).set("Idempotency-Key", randomUUID()).send({});
    assert.equal(completed.status, 200, JSON.stringify(completed.body)); assert.ok(readerPid > 0 && writerPid > 0); assert.notEqual(readerPid, writerPid);
    release(); const response = await pending; assert.equal(response.status, 200); assert.equal(response.body.items[0].completedServicesCount, 0);
    database.transaction = original; assert.equal((await get(p, "/participations/history")).body.items[0].completedServicesCount, 1);
  } finally { database.transaction = original; release(); await Promise.allSettled([pending]); }
});
