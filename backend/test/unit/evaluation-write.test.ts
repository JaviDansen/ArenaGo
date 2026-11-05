import { sessionScenario, assertSessionRefusal, assertSessionTransaction } from "./mutation-session-scenario";
import type { MutationSession } from "../../src/auth/mutation-session";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { editEvaluationBody, submitEvaluationBody } from "../../src/evaluations/evaluation-write.dto";
import { EDIT_EVALUATION_OPERATION, evaluationWriteFingerprint, EvaluationWriteService, SUBMIT_EVALUATION_OPERATION } from "../../src/evaluations/evaluation-write.service";
import { editStatement, submissionStatement } from "../../src/evaluations/evaluation-write.policy";
import type { EvaluationDecisionRow } from "../../src/evaluations/evaluation-write.policy";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-04T15:00:00.123456Z", pid = id(1), uid = id(2), eid = id(3);
const expiresAt = new Date("2099-01-01"), base = { userId: uid, idempotencyKey: "opaque,key", expiresAt };
const post = { ...base, participationId: pid, payload: { rating: 5, comment: null } };
const patch = { ...base, evaluationId: eid, payload: { rating: 4 } };
function row(): EvaluationDecisionRow {
  return { participationId: pid, eventId: id(4), eventName: "Evento", status: "finished", joinedAt: at, arenaEnteredAt: at,
    finishedAt: at, finishReason: "automatic_operational_deadline", completedCount: "2", eligible: true, submitted: false, pending: true,
    deadlineAt: at, reason: null, evaluationId: eid, rating: 5, comment: null, submittedAt: at, updatedAt: at,
    editableUntilAt: "2026-11-11T15:00:00.123456Z", commentAddUntilAt: "2026-12-04T15:00:00.123456Z",
    editFull: true, addComment: false, writtenId: eid, allowed: true, changed: true, commentWindow: false, decisionAt: at, submissionOpen: true };
}
function fixture(mode: "submit" | "edit" = "submit", options: { access?: boolean; revalidated?: boolean; evaluation?: boolean;
  intent?: "replay" | "conflict" | "in_progress"; decision?: Partial<EvaluationDecisionRow>; fail?: string; malformedReplay?: boolean } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let evaluationId = eid;
  const evaluation = { id: eid, participationId: pid, rating: 5, comment: null, submittedAt: at, updatedAt: at,
    editableUntilAt: row().editableUntilAt, commentAddUntilAt: row().commentAddUntilAt,
    permissions: { canEditRating: true, canEditComment: true, canAddFirstComment: false } };
  const operation = mode === "submit" ? SUBMIT_EVALUATION_OPERATION : EDIT_EVALUATION_OPERATION;
  const resource = mode === "submit" ? pid : eid, payload = mode === "submit" ? post.payload : patch.payload;
  const database = drizzle({ async query(config: { text: string }, params: unknown[] = []) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes('AS "participationId"') && !text.includes("WITH")) return { rows: options.access === false ? [] : [{ participationId: pid }] };
    if (text.includes('insert into "idempotency_operations"')) { if (options.fail === "reserve") throw new Error("PRIVATE_COMMENT"); return { rows: options.intent ? [] : [["intent"]] }; }
    if (text.includes('from "idempotency_operations"')) return { rows: [["intent", options.intent === "conflict" ? "different" : evaluationWriteFingerprint(operation, resource, payload),
      options.intent === "in_progress" ? "in_progress" : "completed", mode === "submit" ? 201 : 200, eid, options.malformedReplay ? {} : { evaluation }]] };
    if (text.includes("SELECT id FROM participations")) return { rows: options.revalidated === false ? [] : [{ id: pid }] };
    if (text.includes("SELECT id FROM evaluations")) return { rows: options.evaluation === false ? [] : [{ id: eid }] };
    if (text.includes("WITH decision AS MATERIALIZED")) {
      if (options.fail === "decision") throw new Error("PRIVATE_COMMENT");
      if (mode === "submit") evaluationId = params.find(p => typeof p === "string" && /^[a-f0-9-]{36}$/.test(p) && ![uid,pid].includes(p)) as string;
      return { rows: [{ ...row(), writtenId: evaluationId, ...options.decision }] };
    }
    if (text.includes("WITH scoped")) { if (options.fail === "response") throw new Error("PRIVATE_COMMENT"); return { rows: [{ ...row(), evaluationId }] }; }
    if (text.includes('update "idempotency_operations"')) {
      if (options.fail === "complete") throw new Error("PRIVATE_COMMENT"); return { rows: [["intent", mode === "submit" ? 201 : 200, evaluationId, { evaluation: { ...evaluation, id: evaluationId } }]] };
    }
    throw new Error("Unexpected SQL");
  } } as unknown as Client, { schema });
  return { service: new EvaluationWriteService(database), queries, evaluation };
}
for (const rating of [1,2,3,4,5]) test(`E08.11 POST aceita nota ${rating}`, () => { assert.equal(submitEvaluationBody.parse({ rating }).rating, rating); });
test("E08.11 nota estrita rejeita ausente, fracionária, booleana, string e limites", () => {
  for (const rating of [undefined,null,true,"5",0,6,2.5,NaN,Infinity]) assert.equal(submitEvaluationBody.safeParse({ rating }).success, false);
});
test("E08.11 comentários ausente, NULL, vazio e whitespace normalizam sem confundir PATCH ausente", () => {
  for (const comment of [undefined,null,""," \t\n\u00a0"]) assert.deepEqual(submitEvaluationBody.parse({ rating: 4, comment }), { rating: 4, comment: null });
  assert.deepEqual(editEvaluationBody.parse({ rating: 4 }), { rating: 4 }); assert.deepEqual(editEvaluationBody.parse({ comment: " " }), { comment: null });
  assert.deepEqual(editEvaluationBody.parse({ rating: undefined, comment: null }), { comment: null });
  assert.equal(editEvaluationBody.safeParse({}).success, false);
});
test("E08.11 limite conta Unicode, preserva conteúdo e rejeita excesso sem truncar", () => {
  const text = "😀".repeat(2000); assert.equal(submitEvaluationBody.parse({ rating: 5, comment: text }).comment, text);
  const raw = "  <script>texto</script> e\u0301\n "; assert.equal(editEvaluationBody.parse({ comment: raw }).comment, raw);
  for (const comment of ["😀".repeat(2001)," ".repeat(2001),"\0","\ud800",42,{},[]]) {
    assert.equal(submitEvaluationBody.safeParse({ rating: 5, comment }).success, false); assert.equal(editEvaluationBody.safeParse({ comment }).success, false);
  }
});
test("E08.11 schemas recusam IDs, permissions, horários e extras sem normalização destrutiva", () => {
  for (const extra of [{ userId: uid },{ submittedAt: at },{ permissions: {} },{ firstCommentAt: at },{ state: "finished" }]) {
    assert.equal(submitEvaluationBody.safeParse({ rating: 4, ...extra }).success, false); assert.equal(editEvaluationBody.safeParse({ rating: 4, ...extra }).success, false);
  }
});
test("E08.11 fingerprint separa recurso, namespace e presença dos campos no PATCH", () => {
  const fingerprint = (operation: string, resource: string, payload: object) => evaluationWriteFingerprint(operation, resource, payload as { rating?: number; comment?: null });
  const a = fingerprint(SUBMIT_EVALUATION_OPERATION,pid,submitEvaluationBody.parse({ rating: 5 }));
  assert.equal(a,fingerprint(SUBMIT_EVALUATION_OPERATION,pid,submitEvaluationBody.parse({ comment: " ", rating: 5 })));
  for (const value of [fingerprint(EDIT_EVALUATION_OPERATION,pid,{ rating: 5 }), fingerprint(SUBMIT_EVALUATION_OPERATION,id(9),{ rating: 5, comment: null })]) assert.notEqual(value,a);
  assert.notEqual(fingerprint(EDIT_EVALUATION_OPERATION,eid,{ rating: 4 }),fingerprint(EDIT_EVALUATION_OPERATION,eid,{ rating: 4, comment: null }));
});
for (const mode of ["submit", "edit"] as const) {
  test(`E08.11 ${mode} autoriza antes da reserva e usa locks e READ COMMITTED`, async () => {
    const f = fixture(mode), result = mode === "submit" ? await f.service.submit(post) : await f.service.edit(patch);
    assert.equal(result.kind,mode === "submit" ? "created" : "updated"); assert.equal(f.queries[0].text,"begin isolation level read committed");
    const reserve = f.queries.findIndex(q=>q.text.includes('insert into "idempotency_operations"')), parent = f.queries.findIndex(q=>q.text.includes("SELECT id FROM participations"));
    assert.ok(reserve>1 && parent>reserve); if (mode === "edit") assert.ok(f.queries.findIndex(q=>q.text.includes("SELECT id FROM evaluations"))>parent);
    assert.equal(f.queries.at(-1)?.text,"commit"); assert.equal(JSON.stringify(result).includes("first_comment_at"),false);
    const completed=f.queries.find(q=>q.text.includes('update "idempotency_operations"'))!; assert.ok(completed.params.includes(mode === "submit" ? 201 : 200));
  });
  test(`E08.11 ${mode} sem acesso não reserva e perda de titularidade aborta antes do replay`, async () => {
    const f=fixture(mode,{ access:false }); assert.deepEqual(mode==="submit"?await f.service.submit(post):await f.service.edit(patch),{ kind:"access_denied" });
    assert.equal(f.queries.some(q=>q.text.includes('idempotency_operations')),false);
    const lost=fixture(mode,{ intent:"replay", revalidated:false }); assert.deepEqual(mode==="submit"?await lost.service.submit(post):await lost.service.edit(patch),{ kind:"access_denied" });
    assert.equal(lost.queries.at(-1)?.text,"rollback");
  });
  for (const intent of ["replay","conflict","in_progress"] as const) test(`E08.11 ${mode} intenção ${intent} não escreve avaliação nem conclui de novo`, async () => {
    const f=fixture(mode,{ intent }), result=mode==="submit"?await f.service.submit(post):await f.service.edit(patch);
    assert.equal(result.kind,intent==="conflict"?"request_conflict":intent);
    assert.equal(f.queries.some(q=>q.text.includes("WITH decision")||q.text.includes('update "idempotency_operations"')),false);
    if ("evaluation" in result) assert.deepEqual(result.evaluation,f.evaluation);
  });
  test(`E08.11 ${mode} replay corrompido falha sem refletir dados`, async () => {
    const f=fixture(mode,{ intent:"replay", malformedReplay:true }); await assert.rejects(mode==="submit"?f.service.submit(post):f.service.edit(patch),{ message:"EVALUATION_WRITE_INTERNAL_ERROR" });
    assert.equal(f.queries.at(-1)?.text,"rollback");
  });
  for (const fail of ["reserve","decision","response","complete"]) test(`E08.11 ${mode} falha ${fail} faz rollback e não propaga comentário`, async () => {
    const f=fixture(mode,{ fail }); await assert.rejects(mode==="submit"?f.service.submit(post):f.service.edit(patch),{ message:"EVALUATION_WRITE_INTERNAL_ERROR" }); assert.equal(f.queries.at(-1)?.text,"rollback");
  });
}
for (const [decision,kind] of [[{ eligible:false },"not_eligible"],[{ submitted:true },"already_submitted"],[{ pending:false,submissionOpen:false },"submission_expired"]] as const) test(`E08.11 POST ${kind} reverte intenção reservada`, async () => {
  const f=fixture("submit",{ decision:{ ...decision,writtenId:null } }); assert.deepEqual(await f.service.submit(post),{ kind }); assert.equal(f.queries.at(-1)?.text,"rollback");
});
test("E08.11 PATCH no-op não exige UPDATE e preserva updatedAt na resposta", async () => {
  const f=fixture("edit",{ decision:{ changed:false,writtenId:null } }), r=await f.service.edit(patch); assert.ok("evaluation" in r); assert.equal(r.evaluation.updatedAt,at);
});
test("E08.11 PATCH distingue comentário tardio já usado e janela fechada", async () => {
  const closed=fixture("edit",{ decision:{ allowed:false,commentWindow:false,writtenId:null } }); assert.deepEqual(await closed.service.edit(patch),{ kind:"edit_window_closed" });
  const used=fixture("edit",{ decision:{ allowed:false,commentWindow:true,addComment:false,writtenId:null } });
  assert.deepEqual(await used.service.edit({ ...patch,payload:{ comment:"Novo" } }),{ kind:"comment_already_added" });
});
test("E08.11 predicados decisivos usam política de leitura, relógio único e preservam histórico", () => {
  const dialect=new PgDialect(), selection=sql`SELECT 1`, a=dialect.sqlToQuery(submissionStatement(selection,eid,post.payload)), b=dialect.sqlToQuery(editStatement(selection,eid,{ comment:null }));
  for (const query of [a,b]) { assert.equal(query.sql.match(/clock_timestamp\(\)/g)?.length,1); assert.match(query.sql,/WITH scoped AS MATERIALIZED/); assert.match(query.sql,/s.status='completed'/); }
  assert.match(a.sql,/f.eligible AND f.pending AND NOT f.submitted/); assert.match(b.sql,/c.allowed AND c.changed/);
  assert.match(b.sql,/first_comment_at=COALESCE/); assert.doesNotMatch(b.sql,/SET submitted_at|submitted_at=/); assert.match(b.sql,/IS DISTINCT FROM/);
});

// E08-EST01: a entrada HTTP não admite fallback para o contrato interno E07.
for (const scenario of ["valid", "revoked", "expired", "foreign", "inactive", "admin", "late", "wait", "intent-wait"] as const) {
  test(`E08-EST01 submit sessão ${scenario}`, async () => {
    const f = fixture("submit"), auth = sessionScenario(f.service, uid, scenario);
    if (scenario === "valid") {
      const result = await f.service.submitAuthenticated(post, auth.context);
      assert.equal(result.kind, "created");
      assert.ok(auth.checks() >= 2); assertSessionTransaction(auth.queries, true);
    } else {
      const code = scenario === "foreign" ? "INVALID_SESSION" : scenario === "inactive" ? "ACCOUNT_DEACTIVATED"
        : scenario === "admin" ? "ADMIN_2FA_REQUIRED" : scenario === "late" || scenario === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED";
      await assert.rejects(f.service.submitAuthenticated(post, auth.context), error => assertSessionRefusal(error, code));
      assertSessionTransaction(auth.queries, false);
      if (scenario === "late") assert.ok(auth.queries.some(q => q.includes('update "idempotency_operations"')));
    }
  });
}
for (const context of [undefined, { userId: "other", sessionId: "session" }, { userId: uid, sessionId: "" }]) {
  test(`E08-EST01 submit recusa contexto ausente ou incompatível ${JSON.stringify(context)}`, async () => {
    const f = fixture("submit");
    await assert.rejects(async () => f.service.submitAuthenticated(post, context as MutationSession), error => assertSessionRefusal(error, "UNAUTHENTICATED_CONTEXT"));
    assert.equal(f.queries.length, 0);
  });
}
for (const scenario of ["valid", "revoked", "expired", "late"] as const) {
  test(`E08-EST01 submit replay exige sessão ${scenario}`, async () => {
    const f = fixture("submit", { intent: "replay" }), auth = sessionScenario(f.service, uid, scenario);
    if (scenario === "valid") { assert.equal((await f.service.submitAuthenticated(post, auth.context)).kind, "replay"); assertSessionTransaction(auth.queries, true); }
    else { await assert.rejects(f.service.submitAuthenticated(post, auth.context), error => assertSessionRefusal(error, scenario === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED")); assertSessionTransaction(auth.queries, false); }
    assert.equal(auth.queries.some(q => q.includes('update "idempotency_operations"')), false);
  });
}

// E08-EST01: a entrada HTTP não admite fallback para o contrato interno E07.
for (const scenario of ["valid", "revoked", "expired", "foreign", "inactive", "admin", "late", "wait", "intent-wait"] as const) {
  test(`E08-EST01 edit sessão ${scenario}`, async () => {
    const f = fixture("edit"), auth = sessionScenario(f.service, uid, scenario);
    if (scenario === "valid") {
      const result = await f.service.editAuthenticated(patch, auth.context);
      assert.equal(result.kind, "updated");
      assert.ok(auth.checks() >= 2); assertSessionTransaction(auth.queries, true);
    } else {
      const code = scenario === "foreign" ? "INVALID_SESSION" : scenario === "inactive" ? "ACCOUNT_DEACTIVATED"
        : scenario === "admin" ? "ADMIN_2FA_REQUIRED" : scenario === "late" || scenario === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED";
      await assert.rejects(f.service.editAuthenticated(patch, auth.context), error => assertSessionRefusal(error, code));
      assertSessionTransaction(auth.queries, false);
      if (scenario === "late") assert.ok(auth.queries.some(q => q.includes('update "idempotency_operations"')));
    }
  });
}
for (const context of [undefined, { userId: "other", sessionId: "session" }, { userId: uid, sessionId: "" }]) {
  test(`E08-EST01 edit recusa contexto ausente ou incompatível ${JSON.stringify(context)}`, async () => {
    const f = fixture("edit");
    await assert.rejects(async () => f.service.editAuthenticated(patch, context as MutationSession), error => assertSessionRefusal(error, "UNAUTHENTICATED_CONTEXT"));
    assert.equal(f.queries.length, 0);
  });
}
for (const scenario of ["valid", "revoked", "expired", "late"] as const) {
  test(`E08-EST01 edit replay exige sessão ${scenario}`, async () => {
    const f = fixture("edit", { intent: "replay" }), auth = sessionScenario(f.service, uid, scenario);
    if (scenario === "valid") { assert.equal((await f.service.editAuthenticated(patch, auth.context)).kind, "replay"); assertSessionTransaction(auth.queries, true); }
    else { await assert.rejects(f.service.editAuthenticated(patch, auth.context), error => assertSessionRefusal(error, scenario === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED")); assertSessionTransaction(auth.queries, false); }
    assert.equal(auth.queries.some(q => q.includes('update "idempotency_operations"')), false);
  });
}

for (const intent of ["conflict", "in_progress"] as const) test(`E08-EST01 submit reserva ${intent} exige autorizacao atual`, async () => {
  const f = fixture("submit", { intent }), auth = sessionScenario(f.service, uid, "intent-wait");
  await assert.rejects(f.service.submitAuthenticated(post, auth.context), error => assertSessionRefusal(error, "SESSION_REVOKED"));
  assertSessionTransaction(auth.queries, false);
});

for (const intent of ["conflict", "in_progress"] as const) test(`E08-EST01 edit reserva ${intent} exige autorizacao atual`, async () => {
  const f = fixture("edit", { intent }), auth = sessionScenario(f.service, uid, "intent-wait");
  await assert.rejects(f.service.editAuthenticated(patch, auth.context), error => assertSessionRefusal(error, "SESSION_REVOKED"));
  assertSessionTransaction(auth.queries, false);
});
