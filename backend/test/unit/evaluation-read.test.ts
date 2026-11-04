import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EvaluationReadService } from "../../src/evaluations/evaluation-read.service";
import { completedCount, evaluationReadProjection, type EvaluationReadRow } from "../../src/evaluations/evaluation-read.policy";
import { encodeHistoryCursor, historyQuery, isPreciseInstant } from "../../src/evaluations/evaluation-read.dto";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-03T15:00:00.123456Z", joined = "2026-11-01T15:00:00.123456Z";
function row(n = 1): EvaluationReadRow {
  return { participationId: id(n), eventId: id(100), eventName: "Evento", status: "finished", joinedAt: joined, arenaEnteredAt: joined,
    finishedAt: at, finishReason: "automatic_operational_deadline", completedCount: "2", eligible: true, submitted: false, pending: true,
    deadlineAt: "2026-12-03T15:00:00.123456Z", reason: null, evaluationId: null, rating: null, comment: null, submittedAt: null, updatedAt: null,
    editableUntilAt: null, commentAddUntilAt: null, editFull: false, addComment: false, privateQuestionnaire: "PRIVATE" };
}
function fixture(rows: EvaluationReadRow[] = [row()], options: { clock?: string; fail?: boolean } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes("SELECT to_char(clock_timestamp()")) return { rows: [{ at: options.clock ?? at }] };
    if (options.fail) throw new Error("PRIVATE_SQL");
    if (text.includes("WITH scoped")) return { rows };
    if (text.includes("FROM participations WHERE user_id=")) return { rows: [{ participationId: id(1), eventId: id(100), finishReason: "automatic_operational_deadline", finishedAt: at, private: "PRIVATE" }] };
    throw new Error(`SQL inesperado ${text}`);
  } } as unknown as Client, { schema });
  return { service: new EvaluationReadService(database), queries };
}
test("E08.10 cursor preserva microssegundos sem converter valor keyset para Date", () => {
  const first = encodeHistoryCursor("2026-11-03T15:00:00.100001Z", id(1)), next = encodeHistoryCursor("2026-11-03T15:00:00.100002Z", id(1));
  assert.notEqual(first, next); assert.deepEqual(historyQuery.parse({ cursor: first }), { limit: 20, cursor: { v: 1, joinedAt: "2026-11-03T15:00:00.100001Z", id: id(1) } });
  assert.equal(historyQuery.parse({ limit: "50" }).limit, 50);
});
test("E08.10 paginação rejeita formatos, excesso, duplicatas e cursores não canônicos", () => {
  for (const query of [{ limit: "0" }, { limit: "51" }, { limit: "-1" }, { limit: "1.5" }, { limit: "01" }, { limit: ["1", "2"] }, { cursor: ["a", "b"] }, { userId: id(9) }]) assert.equal(historyQuery.safeParse(query).success, false);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const cursor of ["", "%%%", "x".repeat(513), "e30=", encode({ v: 2, id: id(1), joinedAt: joined }), encode({ v: 1, id: "bad", joinedAt: joined }),
    encode({ v: 1, id: id(1), joinedAt: "2026-02-30T00:00:00.000000Z" }), encode({ v: 1, id: id(1), joinedAt: joined, userId: id(9) }), Buffer.from([255]).toString("base64url")]) assert.equal(historyQuery.safeParse({ cursor }).success, false);
});
test("E08.10 instante exige calendário UTC canônico e seis casas", () => {
  for (const value of [at, "0001-01-01T00:00:00.000001Z", "9999-12-31T23:59:59.999999Z"]) assert.equal(isPreciseInstant(value), true);
  for (const value of [null, "0000-01-01T00:00:00.000000Z", "2026-02-29T00:00:00.000000Z", "2026-11-03T24:00:00.000000Z", at.replace("Z", "+00:00"), at.replace("123456", "123")]) assert.equal(isPreciseInstant(value), false);
});
test("E08.10 política central usa apenas completed e dois relógios inclusivos distintos", () => {
  const query = new PgDialect().sqlToQuery(evaluationReadProjection(sql`SELECT 1`, at));
  for (const expected of ["s.status='completed'", "status='finished' AND completed_count::bigint>0", "finished_at+interval '720 hours'", "submitted_at+interval '168 hours'", "submitted_at+interval '720 hours'", "first_comment_at IS NULL", "'SUBMISSION_EXPIRED'", "'ALREADY_SUBMITTED'", "'EXTERNAL_WAIT_CLOSED'"]) assert.ok(query.sql.includes(expected), expected);
  assert.equal(query.sql.includes("evaluation_updated_at+interval"), false); assert.equal(query.params.filter(value => value === at).length, 6);
});
test("E08.10 contagens só admitem inteiros decimais numericamente seguros", () => {
  assert.equal(completedCount("0"), 0); assert.equal(completedCount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of ["-1", "1.1", "1e3", "01", "9007199254740992", "", "NaN"]) assert.throws(() => completedCount(value), /INTEGRITY/);
});
test("E08.10 elegibilidade projeta campos fechados e respeita titularidade na consulta SQL", async () => {
  const f = fixture(), result = await f.service.getEligibility(id(5), id(1)); assert.deepEqual(result, {
    participationId: id(1), participationStatus: "finished", completedServicesCount: 2, eligible: true, submitted: false, pending: true,
    firstSubmissionDeadlineAt: "2026-12-03T15:00:00.123456Z", reason: null });
  const query = f.queries.find(q => q.text.includes("WITH scoped"))!; assert.ok(query.params.includes(id(5))); assert.ok(query.params.includes(id(1))); assert.match(query.text, /WHERE p.user_id=.+AND p.id=/s);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
for (const method of ["getEligibility", "getEvaluation"] as const) test(`E08.10 ${method} nega acesso neutro sem participação visível`, async () => {
  assert.equal(await fixture([]).service[method](id(5), id(9)), null);
});
test("E08.10 avaliação ausente retorna null junto da mesma elegibilidade", async () => {
  const f = fixture(), result = await f.service.getEvaluation(id(5), id(1)); assert.ok(result); assert.equal(result.evaluation, null); assert.equal(result.eligibility.pending, true);
});
for (const [full, add] of [[true, false], [false, true], [false, false]]) test(`E08.10 permissões próprias full=${full} add=${add} não expõem campos internos`, async () => {
  const data = { ...row(), evaluationId: id(7), rating: 5, comment: null, submittedAt: at, updatedAt: at, editableUntilAt: at, commentAddUntilAt: at,
    editFull: full, addComment: add, submitted: true, pending: false, reason: "ALREADY_SUBMITTED" as const };
  const result = await fixture([data]).service.getEvaluation(id(5), id(1)); assert.ok(result?.evaluation);
  assert.deepEqual(result.evaluation.permissions, { canEditRating: full, canEditComment: full || add, canAddFirstComment: add });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false); assert.equal("firstCommentAt" in result.evaluation, false);
});
test("E08.10 histórico pagina antes das agregações, com lookahead e cursor do último item visível", async () => {
  const a = { ...row(2), joinedAt: "2026-11-01T15:00:00.100002Z" }, b = { ...row(1), joinedAt: "2026-11-01T15:00:00.100001Z" }, f = fixture([a, b]);
  const page = historyQuery.parse({ limit: "1", cursor: encodeHistoryCursor(joined, id(9)) }), result = await f.service.getHistory(id(5), page);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].participationId, id(2)); assert.ok(result.nextCursor);
  assert.equal(historyQuery.parse({ cursor: result.nextCursor }).cursor?.joinedAt, a.joinedAt);
  const query = f.queries.find(q => q.text.includes("WITH scoped"))!; assert.ok(query.params.includes(2)); assert.ok(query.params.includes(joined)); assert.match(query.text, /\(p.joined_at,p.id\)</);
  assert.ok(query.text.indexOf("LIMIT") < query.text.indexOf("LATERAL")); assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("E08.10 histórico e pendências vazios têm 200 informativo sem cursores artificiais", async () => {
  const f = fixture([]); assert.deepEqual(await f.service.getHistory(id(5), { limit: 20 }), { items: [], nextCursor: null }); assert.deepEqual(await f.service.getPending(id(5)), { items: [] });
});
test("E08.10 pending e return-state usam a mesma seleção e recent não depende de janela inventada", async () => {
  const f = fixture(), pending = await f.service.getPending(id(5)), returned = await f.service.getReturnState(id(5));
  assert.deepEqual(returned.pendingEvaluationParticipationIds, pending.items.map(p => p.participationId)); assert.equal(returned.recentFinalization?.finishReason, "automatic_operational_deadline");
  const recent = f.queries.find(q => q.text.includes("FROM participations WHERE user_id="))!;
  assert.match(recent.text, /ORDER BY finished_at DESC,id DESC LIMIT 1/); assert.doesNotMatch(recent.text, /interval|updated_at|acknowledg/); assert.equal(JSON.stringify(returned).includes("PRIVATE"), false);
});
for (const method of ["eligibility", "evaluation", "pending", "history", "return"] as const) test(`E08.10 ${method} é read-only, um relógio DB e snapshot único sem N+1`, async () => {
  const f = fixture();
  if (method === "eligibility") await f.service.getEligibility(id(5), id(1)); else if (method === "evaluation") await f.service.getEvaluation(id(5), id(1));
  else if (method === "pending") await f.service.getPending(id(5)); else if (method === "history") await f.service.getHistory(id(5), { limit: 20 }); else await f.service.getReturnState(id(5));
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only"); assert.equal(f.queries.at(-1)?.text, "commit");
  assert.equal(f.queries.filter(q => q.text.includes("clock_timestamp()")).length, 1); assert.equal(f.queries.length, method === "return" ? 5 : 4);
  for (const query of f.queries) assert.doesNotMatch(query.text, /\b(INSERT|UPDATE|DELETE|FOR SHARE|FOR UPDATE)\b|profiles|snapshots|user_roles|audit_logs/i);
});
test("E08.10 falha SQL ou fato inválido aborta snapshot sem fabricar resposta", async () => {
  const badClock = fixture([], { clock: "bad" }); await assert.rejects(badClock.service.getPending(id(5)), /INTEGRITY/); assert.equal(badClock.queries.at(-1)?.text, "rollback");
  const badCount = fixture([{ ...row(), completedCount: "9007199254740992" }]); await assert.rejects(badCount.service.getEligibility(id(5), id(1)), /INTEGRITY/);
  const badRating = fixture([{ ...row(), evaluationId: id(7), rating: 0 }]); await assert.rejects(badRating.service.getEvaluation(id(5), id(1)), /INTEGRITY/);
  const failure = fixture([], { fail: true }); await assert.rejects(failure.service.getPending(id(5))); assert.equal(failure.queries.at(-1)?.text, "rollback");
});
