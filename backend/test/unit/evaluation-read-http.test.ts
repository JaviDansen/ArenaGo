import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import type { Pool } from "pg";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { EvaluationReadController } from "../../src/evaluations/evaluation-read.controller";
import { EvaluationReadService } from "../../src/evaluations/evaluation-read.service";
import { encodeHistoryCursor } from "../../src/evaluations/evaluation-read.dto";
import { EventsModule } from "../../src/events/events.module";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`, userId = id(1), pid = id(2), at = "2026-11-03T15:00:00.123456Z";
const eligibility = { participationId: pid, participationStatus: "finished", completedServicesCount: 2, eligible: true, submitted: false, pending: true, firstSubmissionDeadlineAt: at, reason: null };
const routes = [`/participations/${pid}/evaluation-eligibility`, "/evaluations/pending", `/participations/${pid}/evaluation`, "/participations/history", "/participations/return-state"];
const calls: unknown[][] = []; let missing = false, failure: Error | undefined;
const responses = [eligibility, { items: [] }, { evaluation: null, eligibility }, { items: [], nextCursor: null }, { recentFinalization: null, pendingEvaluationParticipationIds: [] }];
function read(index: number, ...args: unknown[]) { calls.push([index, ...args]); if (failure) throw failure; return missing && (index === 0 || index === 2) ? null : responses[index]; }
@Module({ controllers: [EvaluationReadController], providers: [SessionAuthGuard,
  { provide: AuthService, useValue: { async authenticateBearerToken(token: string) {
    if (token === "admin-no-2fa") throw new ProblemException({ typeSlug: "admin-2fa-required", title: "2FA", status: 401, code: "ADMIN_2FA_REQUIRED", detail: "2FA obrigatório." });
    if (!["participant", "admin", "staff"].includes(token)) throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId: id(3), roles: token === "participant" ? [] : [token] };
  } } },
  { provide: EvaluationReadService, useValue: { getEligibility: (...args: unknown[]) => read(0, ...args), getPending: (...args: unknown[]) => read(1, ...args),
    getEvaluation: (...args: unknown[]) => read(2, ...args), getHistory: (...args: unknown[]) => read(3, ...args), getReturnState: (...args: unknown[]) => read(4, ...args) } },
] }) class HttpModule {}
let app: INestApplication;
before(async () => { app = await NestFactory.create(HttpModule, { logger: false }); app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1"); });
after(async () => { await app?.close(); });
const get = (route: string, token = "participant") => supertest(app.getHttpServer()).get(`/api/v1${route}`).set("Authorization", `Bearer ${token}`);
function reset() { missing = false; failure = undefined; calls.length = 0; }
function problem(r: supertest.Response, status: number, code: string) { assert.equal(r.status, status); assert.equal(r.body.code, code); assert.equal(r.body.status, status); assert.match(r.headers["content-type"], /application\/problem\+json/); }
for (const [index, route] of routes.entries()) test(`E08.10 HTTP ${route} contrato JSON e identidade confiável`, async () => {
  reset(); const r = await get(route); assert.equal(r.status, 200); assert.deepEqual(r.body, responses[index]); assert.equal(calls[0][1], userId);
});
for (const route of routes) test(`E08.10 HTTP ${route} exige sessão antes de consultar`, async () => {
  reset(); problem(await supertest(app.getHttpServer()).get(`/api/v1${route}`), 401, "MISSING_ACCESS_TOKEN"); problem(await get(route, "invalid"), 401, "INVALID_ACCESS_TOKEN");
  problem(await get(route, "admin-no-2fa"), 401, "ADMIN_2FA_REQUIRED"); assert.equal(calls.length, 0);
});
test("E08.10 HTTP UUIDs inválidos recebem 400, maiúsculas normalizam e 404 é neutro", async () => {
  reset(); for (const index of [0, 2]) { problem(await get(routes[index].replace(pid, "bad")), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0); }
  assert.equal((await get(routes[0].replace(pid, pid.toUpperCase()))).status, 200); assert.equal(calls[0][2], pid);
  missing = true; const absent = await get(routes[0].replace(pid, id(99))), foreign = await get(routes[0]); problem(absent, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(absent.body, foreign.body);
  problem(await get(routes[2]), 404, "RESOURCE_NOT_FOUND");
});
test("E08.10 HTTP Admin e Staff usam a própria identidade e query não concede titularidade", async () => {
  reset(); for (const token of ["admin", "staff", "participant"]) { assert.equal((await get(routes[0], token).query({ userId: id(99), actor: id(9) }).set("Idempotency-Key", "")).status, 200); }
  for (const call of calls) assert.equal(call[1], userId);
  problem(await get(routes[3]).query({ userId: id(99) }), 400, "VALIDATION_ERROR");
});
test("E08.10 HTTP paginação valida somente parâmetros escalares limitados e cursor opaco", async () => {
  reset(); for (const query of [{ limit: "0" }, { limit: "51" }, { limit: "20.1" }, { limit: ["1", "2"] }, { cursor: "bad" }, { cursor: "" }, { other: "x" }]) problem(await get(routes[3]).query(query), 400, "VALIDATION_ERROR");
  assert.equal(calls.length, 0); const cursor = encodeHistoryCursor(at, pid); assert.equal((await get(routes[3]).query({ limit: 50, cursor })).status, 200);
  assert.deepEqual(calls[0], [3, userId, { limit: 50, cursor: { v: 1, joinedAt: at, id: pid } }]);
});
test("E08.10 HTTP literais history/return-state não viram UUID e current não é interceptado", async () => {
  reset(); assert.equal((await get(routes[3])).status, 200); assert.equal((await get(routes[4])).status, 200);
  problem(await get("/participations/current"), 404, "RESOURCE_NOT_FOUND"); assert.equal(calls.length, 2);
});
test("E08.10 HTTP erro interno não expõe SQL, credenciais ou dados pessoais", async () => {
  reset(); failure = new Error("PRIVATE_SQL_password@example.test"); for (const route of routes) { const r = await get(route); problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); }
});
test("E08.10 DI real resolve controller e serviço no mesmo banco sem abrir conexão", async () => {
  const real = await NestFactory.create(EventsModule, { logger: false }); try {
    assert.equal(Reflect.get(real.get(EvaluationReadController), "reads"), real.get(EvaluationReadService)); assert.equal(Reflect.get(real.get(EvaluationReadService), "database"), real.get(DRIZZLE_DATABASE));
    assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally { await real.close(); }
});
