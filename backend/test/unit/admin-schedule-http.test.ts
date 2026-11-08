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
import { AdminEventsModule } from "../../src/events/admin-events.module";
import { AdminScheduleController } from "../../src/events/admin-schedule.controller";
import { AdminScheduleService } from "../../src/events/admin-schedule.service";
import { AdminIdempotencyPolicy } from "../../src/events/admin-idempotency.policy";
import type { AdminScheduleInput, AdminScheduleResult } from "../../src/events/admin-schedule.types";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), userId = id(2), sessionId = id(3), route = `/api/v1/admin/events/${eventId}/schedule`;
const body = { officialEndsAt: "2026-11-05T23:00:00.000Z", operationalDeadlineAt: "2026-11-06T00:00:00.000Z", reason: "Prorrogação autorizada" };
const state = { eventId, officialEndsAt: body.officialEndsAt, operationalDeadlineAt: body.operationalDeadlineAt, changedAt: "2026-11-03T15:00:00.123456Z" };
let result: AdminScheduleResult, failure: Error | undefined;
const calls: AdminScheduleInput[] = [];
@Module({ controllers: [AdminScheduleController], providers: [SessionAuthGuard, AdminIdempotencyPolicy,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit-admin") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId, roles: ["admin"] };
  } } },
  { provide: AdminScheduleService, useValue: { updateSchedule: async (input: AdminScheduleInput) => { calls.push(input); if (failure) throw failure; return result; } } },
] })
class HttpUnitModule {}
let app: INestApplication;
const vars = ["ADMIN_IDEMPOTENCY_TTL_SECONDS", "STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"];
const previous = vars.map(name => process.env[name]);
before(async () => {
  for (const name of vars) process.env[name] = "60";
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => { await app?.close(); vars.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); });
const patch = (url = route) => supertest(app.getHttpServer()).patch(url).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "opaque");
function reset() { calls.length = 0; failure = undefined; result = { kind: "completed", ...state }; }
function problem(r: supertest.Response, status: number, code: string) { assert.equal(r.status, status); assert.equal(r.body.status, status); assert.equal(r.body.code, code); assert.match(r.headers["content-type"], /application\/problem\+json/); }
test("E08.7 HTTP usa identidade confiável, TTL compartilhado e normalização de instantes/reason", async () => {
  reset(); const at = Date.now(), r = await patch().query({ userId: id(9), sessionId: id(10) }).send({ ...body, officialEndsAt: "2026-11-05T20:00:00-03:00", reason: ` ${body.reason} ` });
  assert.equal(r.status, 200); assert.deepEqual(r.body, state); assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0], expiresAt: undefined }, { userId, sessionId, eventId, ...body, idempotencyKey: "opaque", expiresAt: undefined });
  assert.ok(calls[0].expiresAt.getTime() >= at + 60000 && calls[0].expiresAt.getTime() <= Date.now() + 60000);
});
test("E08.7 HTTP no-op omite changedAt; replay devolve instante original de seis casas", async () => {
  reset(); result = { kind: "completed", eventId, officialEndsAt: body.officialEndsAt, operationalDeadlineAt: body.operationalDeadlineAt };
  assert.deepEqual((await patch().send(body)).body, { eventId, officialEndsAt: body.officialEndsAt, operationalDeadlineAt: body.operationalDeadlineAt });
  result = { kind: "replay", ...state }; assert.deepEqual((await patch().send(body)).body, state);
});
test("E08.7 HTTP Bearer e UUID validados antes do serviço", async () => {
  reset(); problem(await supertest(app.getHttpServer()).patch(route).send(body), 401, "MISSING_ACCESS_TOKEN");
  problem(await patch().set("Authorization", "Bearer invalid").send(body), 401, "INVALID_ACCESS_TOKEN");
  problem(await patch(route.replace(eventId, "bad")).send(body), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
  assert.equal((await patch(route.replace(eventId, eventId.toUpperCase())).send(body)).status, 200); assert.equal(calls[0].eventId, eventId);
});
test("E08.7 HTTP corpo estrito exige dois instantes válidos e reason; rejeita atalhos administrativos", async () => {
  reset(); problem(await patch(), 400, "VALIDATION_ERROR");
  for (const value of [{}, [], { officialEndsAt: body.officialEndsAt, reason: body.reason }, { operationalDeadlineAt: body.operationalDeadlineAt, reason: body.reason },
    { ...body, officialEndsAt: null }, { ...body, officialEndsAt: "2026-11-05T23:00:00" }, { ...body, officialEndsAt: "2026-11-05T23:00:00.1234Z" },
    { ...body, officialEndsAt: "2026-02-30T12:00:00Z" }, { ...body, operationalDeadlineAt: "2026-11-05T22:00:00Z" }, { ...body, operationalDeadlineAt: "2026-11-06T00:00:00.001Z" },
    { ...body, reason: " " }, { ...body, reason: "x".repeat(501) }, { ...body, reason: "x\u0000y" },
    ...["startsAt", "adminDeadlineAt", "closureRequestedAt", "closureMode", "status", "enabled", "queueAcceptingEntries", "userId", "expiresAt"].map(key => ({ ...body, [key]: "private" }))]) problem(await patch().send(value), 400, "VALIDATION_ERROR");
  problem(await patch().type("text/plain").send(JSON.stringify(body)), 400, "VALIDATION_ERROR");
  problem(await patch().type("application/json").send("{bad"), 400, "BAD_REQUEST"); assert.equal(calls.length, 0);
});
test("E08.7 HTTP header de idempotência único obrigatório", async () => {
  reset(); problem(await supertest(app.getHttpServer()).patch(route).set("Authorization", "Bearer unit-admin").send(body), 400, "VALIDATION_ERROR");
  for (const key of ["", " ", "x".repeat(129)]) problem(await patch().set("Idempotency-Key", key).send(body), 400, "VALIDATION_ERROR");
  problem(await patch().set({ "Idempotency-Key": ["a", "b"] }).send(body), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
});
test("E08.7 HTTP catálogo de erros RFC 7807 inclui corte e horários inválidos", async () => {
  reset(); for (const [kind, status, code] of [
    ["resource_not_found", 404, "RESOURCE_NOT_FOUND"], ["admin_required", 403, "ADMIN_REQUIRED"], ["account_inactive", 401, "ACCOUNT_DEACTIVATED"],
    ["invalid_session", 401, "INVALID_SESSION"], ["session_revoked", 401, "SESSION_REVOKED"], ["session_expired", 401, "SESSION_EXPIRED"],
    ["admin_2fa_required", 401, "ADMIN_2FA_REQUIRED"], ["event_time_change_closed", 409, "EVENT_TIME_CHANGE_CLOSED"], ["invalid_schedule", 400, "VALIDATION_ERROR"],
    ["request_conflict", 409, "IDEMPOTENCY_KEY_REUSED"], ["in_progress", 409, "IDEMPOTENCY_IN_PROGRESS"],
  ] as const) { result = { kind }; problem(await patch().send(body), status, code); }
});
test("E08.7 HTTP projeta resposta fechada e oculta detalhes de erro SQL", async () => {
  reset(); Object.assign(result, { actor: userId, reason: "PRIVATE", before: "PRIVATE" }); assert.deepEqual((await patch().send(body)).body, state);
  failure = new Error("PRIVATE_SQL_secret@example.test"); const r = await patch().send(body); problem(r, 500, "INTERNAL_SERVER_ERROR");
  assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(JSON.stringify(r.body).includes("example.test"), false);
});
test("E08.7 DI real resolve novo controller/serviço e a mesma política Admin sem conexão", async () => {
  const real = await NestFactory.create(AdminEventsModule, { logger: false });
  try {
    const service = real.get(AdminScheduleService); assert.equal(Reflect.get(real.get(AdminScheduleController), "schedule"), service);
    assert.equal(Reflect.get(real.get(AdminScheduleController), "idempotency"), real.get(AdminIdempotencyPolicy));
    assert.equal(Reflect.get(service, "database"), real.get(DRIZZLE_DATABASE)); assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally { await real.close(); }
});
