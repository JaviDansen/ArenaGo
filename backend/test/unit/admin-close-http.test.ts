import "reflect-metadata";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import type { Pool } from "pg";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { AdminCloseController } from "../../src/events/admin-close.controller";
import { AdminCloseService } from "../../src/events/admin-close.service";
import { AdminIdempotencyPolicy } from "../../src/events/admin-idempotency.policy";
import { AdminEventsModule } from "../../src/events/admin-events.module";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";
import type { AdminCloseInput, AdminCloseResult } from "../../src/events/admin-close.types";
const eventId = "abcdef00-0000-4000-8000-000000000001", userId = "admin", sessionId = "session", route = `/api/v1/admin/events/${eventId}/close`;
const body = { mode: "immediate", reason: "Interrupção autorizada" }, at = "2026-11-03T15:00:00.123456Z";
const state = { eventId, status: "closed", closureMode: "immediate", newEntriesClosedAt: at, effectiveOperationalDeadlineAt: at, externalWaitingFinalized: 2 } as const;
let result: AdminCloseResult, failure: Error | undefined; const calls: AdminCloseInput[] = [];
@Module({ controllers: [AdminCloseController], providers: [SessionAuthGuard, AdminIdempotencyPolicy,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => { if (token !== "unit-admin") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." }); return { userId, sessionId, roles: ["admin"] }; } } },
  { provide: AdminCloseService, useValue: { closeEvent: async (input: AdminCloseInput) => { calls.push(input); if (failure) throw failure; return result; } } },
] }) class HttpModule {}
let app: INestApplication; const variables = ["ADMIN_IDEMPOTENCY_TTL_SECONDS", "STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"], previous = variables.map(v => process.env[v]);
before(async () => { variables.forEach(v => { process.env[v] = "60"; }); app = await NestFactory.create(HttpModule, { logger: false }); app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1"); });
after(async () => { await app?.close(); variables.forEach((v, i) => { if (previous[i] === undefined) delete process.env[v]; else process.env[v] = previous[i]; }); });
const post = (url = route) => supertest(app.getHttpServer()).post(url).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "opaque");
function reset() { calls.length = 0; failure = undefined; result = { kind: "completed", ...state }; }
function problem(r: supertest.Response, status: number, code: string) { assert.equal(r.status, status); assert.equal(r.body.status, status); assert.equal(r.body.code, code); assert.match(r.headers["content-type"], /application\/problem\+json/); }
test("E08.8 HTTP 200 projeta somente encerramento e usa identidade/TTL confiáveis", async () => {
  reset(); const now = Date.now(), r = await post().query({ userId: "other", sessionId: "other" }).send({ ...body, reason: ` ${body.reason} ` }); assert.equal(r.status, 200); assert.deepEqual(r.body, state);
  assert.equal(calls[0].userId, userId); assert.equal(calls[0].sessionId, sessionId); assert.equal(calls[0].reason, body.reason); assert.equal(calls[0].idempotencyKey, "opaque"); assert.ok(calls[0].expiresAt.getTime() >= now + 60000 && calls[0].expiresAt.getTime() <= Date.now() + 60000);
});
test("E08.8 HTTP controlado normaliza instante e replay conserva resposta histórica", async () => {
  reset(); result = { kind: "replay", ...state, closureMode: "controlled", status: "closing", effectiveOperationalDeadlineAt: "2026-11-03T15:30:00.000000Z" };
  const r = await post().send({ mode: "controlled", reason: body.reason, controlledUntilAt: "2026-11-03T12:30:00-03:00" }); assert.equal(r.status, 200); assert.equal(calls[0].mode, "controlled"); if (calls[0].mode !== "controlled") assert.fail(); assert.equal(calls[0].controlledUntilAt, "2026-11-03T15:30:00.000Z"); assert.equal(r.body.effectiveOperationalDeadlineAt, "2026-11-03T15:30:00.000000Z");
});
test("E08.8 HTTP Bearer obrigatório e UUID normalizado", async () => {
  reset(); problem(await supertest(app.getHttpServer()).post(route).send(body), 401, "MISSING_ACCESS_TOKEN"); problem(await post().set("Authorization", "Bearer invalid").send(body), 401, "INVALID_ACCESS_TOKEN"); problem(await post(route.replace(eventId, "bad")).send(body), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
  assert.equal((await post(route.replace(eventId, eventId.toUpperCase())).send(body)).status, 200); assert.equal(calls[0].eventId, eventId);
});
test("E08.8 HTTP body estrito, modos e prazos sem coerção ou campos administrativos", async () => {
  reset(); problem(await post(), 400, "VALIDATION_ERROR");
  for (const value of [{}, [], { ...body, mode: "other" }, { ...body, mode: "controlled" }, { ...body, controlledUntilAt: at }, { ...body, reason: " " }, { ...body, reason: "x\u0000y" }, { ...body, reason: "x".repeat(501) },
    ...["bad", "2026-02-30T00:00:00Z", "2026-11-03T15:30:00", "2026-11-03T15:30:00.1234Z"].map(controlledUntilAt => ({ mode: "controlled", reason: "x", controlledUntilAt })),
    ...["status", "adminDeadlineAt", "closureRequestedAt", "userId", "expiresAt", "queueAcceptingEntries"].map(key => ({ ...body, [key]: "private" }))]) problem(await post().send(value), 400, "VALIDATION_ERROR");
  problem(await post().type("text/plain").send(JSON.stringify(body)), 400, "VALIDATION_ERROR"); problem(await post().type("application/json").send("{bad"), 400, "BAD_REQUEST"); assert.equal(calls.length, 0);
});
test("E08.8 HTTP header único obrigatório e chave opaca", async () => {
  reset(); problem(await supertest(app.getHttpServer()).post(route).set("Authorization", "Bearer unit-admin").send(body), 400, "VALIDATION_ERROR");
  for (const key of ["", " ", "x".repeat(129)]) problem(await post().set("Idempotency-Key", key).send(body), 400, "VALIDATION_ERROR"); problem(await post().set({ "Idempotency-Key": ["a", "b"] }).send(body), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
});
test("E08.8 HTTP erros atuais e encerramento usam RFC 7807", async () => {
  reset(); for (const [kind, status, code] of [["resource_not_found", 404, "RESOURCE_NOT_FOUND"], ["admin_required", 403, "ADMIN_REQUIRED"], ["account_inactive", 401, "ACCOUNT_DEACTIVATED"], ["invalid_session", 401, "INVALID_SESSION"], ["session_revoked", 401, "SESSION_REVOKED"], ["session_expired", 401, "SESSION_EXPIRED"], ["admin_2fa_required", 401, "ADMIN_2FA_REQUIRED"], ["event_already_closed", 409, "EVENT_ALREADY_CLOSED"], ["closure_deadline_invalid", 409, "CLOSURE_DEADLINE_INVALID"], ["request_conflict", 409, "IDEMPOTENCY_KEY_REUSED"], ["in_progress", 409, "IDEMPOTENCY_IN_PROGRESS"]] as const) { result = { kind }; problem(await post().send(body), status, code); }
});
test("E08.8 HTTP privacidade de resposta e erro SQL", async () => {
  reset(); Object.assign(result, { reason: "PRIVATE", actor: userId, audit: "PRIVATE" }); assert.deepEqual((await post().send(body)).body, state);
  failure = new Error("PRIVATE_SQL_secret@example.test"); const r = await post().send(body); problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
});
test("E08.8 DI real resolve controller, serviço, banco e TTL compartilhados sem conexão", async () => {
  const real = await NestFactory.create(AdminEventsModule, { logger: false }); try { const service = real.get(AdminCloseService); assert.equal(Reflect.get(real.get(AdminCloseController), "closure"), service); assert.equal(Reflect.get(service, "database"), real.get(DRIZZLE_DATABASE)); assert.equal(Reflect.get(real.get(AdminCloseController), "idempotency"), real.get(AdminIdempotencyPolicy)); assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0); } finally { await real.close(); }
});
