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
import { AdminIdempotencyPolicy } from "../../src/events/admin-idempotency.policy";
import { AdminConfigurationController } from "../../src/events/admin-configuration.controller";
import { AdminConfigurationService } from "../../src/events/admin-configuration.service";
import { AdminConfigurationQueryService } from "../../src/events/admin-configuration-query.service";
import { AdminConfigurationError } from "../../src/events/admin-configuration.problem";
import { AdminScheduleController } from "../../src/events/admin-schedule.controller";
import { AdminScheduleService } from "../../src/events/admin-schedule.service";
import { AdminExternalQueueController } from "../../src/events/admin-external-queue.controller";
import { AdminExternalQueueService } from "../../src/events/admin-external-queue.service";
import { AdminCloseController } from "../../src/events/admin-close.controller";
import { AdminCloseService } from "../../src/events/admin-close.service";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), experienceId = id(2), stationId = id(3), userId = id(4), sessionId = id(5), staffId = id(6);
const at = "2026-11-05T15:00:00.123456Z";
const event = { id: eventId, name: "Evento", accessCode: "EVENT-01", statusStored: "scheduled", effectivePhase: "scheduled" };
const experience = { id: experienceId, eventId, name: "Experiência", queueAcceptingEntries: true, lastQueueOrder: "0" };
const station = { id: stationId, experienceId, label: "Estação", availability: "available" };
const createBody = { name: "Evento", accessCode: "EVENT-01", timezone: "America/Sao_Paulo", startsAt: "2026-11-05T17:00:00.000Z",
  officialEndsAt: "2026-11-05T23:00:00.000Z", operationalDeadlineAt: "2026-11-06T00:00:00.000Z", externalQueueEnabled: true };
type Actor = { userId: string; sessionId: string };
type Call = { method: string; actor: Actor; input?: unknown };
type MutationInput = Actor & { operation: string; eventId?: string; experienceId?: string; stationId?: string; payload: Record<string, unknown>; idempotencyKey: string; expiresAt: Date };
const calls: Call[] = [], oldCalls: string[] = [];
let failure: Error | undefined;
let result: { kind: "created" | "changed" | "unchanged" | "replay"; body: object; httpStatus: 200 | 201 };
let readResult: object;

const readiness = { eventId, statusStored: "scheduled", effectivePhase: "scheduled", ready: false, missing: ["VERIFIED_ACTIVE_STAFF"],
  checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true, hasExperienceWithAvailableStation: true, hasVerifiedActiveStaff: false }, acceptingNewParticipations: false };
type Route = { name: string; method: "get" | "post" | "patch"; path: string; body?: object; operation?: string; response: object; status: 200 | 201 };
const routes: Route[] = [
  { name: "list", method: "get", path: "/admin/events", response: { items: [event], nextCursor: null }, status: 200 },
  { name: "create event", method: "post", path: "/admin/events", body: createBody, operation: "create_event", response: { event }, status: 201 },
  { name: "get event", method: "get", path: `/admin/events/${eventId}`, response: { event }, status: 200 },
  { name: "update event", method: "patch", path: `/admin/events/${eventId}`, body: { name: "Evento" }, operation: "update_event", response: { event }, status: 200 },
  { name: "readiness", method: "get", path: `/admin/events/${eventId}/readiness`, response: readiness, status: 200 },
  { name: "experiences", method: "get", path: `/admin/events/${eventId}/experiences`, response: { items: [{ ...experience, stations: [station] }] }, status: 200 },
  { name: "create experience", method: "post", path: `/admin/events/${eventId}/experiences`, body: { name: "Experiência" }, operation: "create_experience", response: { experience }, status: 201 },
  { name: "update experience", method: "patch", path: `/admin/events/${eventId}/experiences/${experienceId}`, body: { name: "Experiência" }, operation: "update_experience", response: { experience }, status: 200 },
  { name: "create station", method: "post", path: `/admin/events/${eventId}/experiences/${experienceId}/stations`, body: { label: "Estação" }, operation: "create_station", response: { station }, status: 201 },
  { name: "update station", method: "patch", path: `/admin/events/${eventId}/experiences/${experienceId}/stations/${stationId}`, body: { label: "Estação" }, operation: "update_station", response: { station }, status: 200 },
];
function record(method: string, actor: Actor, input?: unknown) {
  calls.push({ method, actor, input });
  if (actor.userId === staffId) throw new AdminConfigurationError("admin_required");
  if (failure) throw failure;
}
@Module({ controllers: [AdminConfigurationController, AdminScheduleController, AdminExternalQueueController, AdminCloseController], providers: [
  SessionAuthGuard, AdminIdempotencyPolicy,
  { provide: AuthService, useValue: { async authenticateBearerToken(token: string) {
    if (token === "no-2fa") throw new ProblemException({ status: 401, code: "ADMIN_2FA_REQUIRED", typeSlug: "admin-2fa-required", title: "2FA obrigatório", detail: "Segundo fator obrigatório." });
    if (token === "revoked") throw new ProblemException({ status: 401, code: "SESSION_REVOKED", typeSlug: "session-revoked", title: "Sessão revogada", detail: "Sessão revogada." });
    if (token !== "unit-admin" && token !== "staff") throw new ProblemException({ status: 401, code: "INVALID_ACCESS_TOKEN", typeSlug: "invalid-access-token", title: "Token inválido", detail: "Token inválido." });
    return { userId: token === "staff" ? staffId : userId, sessionId, roles: token === "staff" ? ["staff"] : ["admin"] };
  } } },
  { provide: AdminConfigurationService, useValue: { async mutate(input: MutationInput) { record("mutate", { userId: input.userId, sessionId: input.sessionId }, input); return result; } } },
  { provide: AdminConfigurationQueryService, useValue: {
    events: async (actor: Actor, query: unknown) => { record("events", actor, query); return readResult; },
    event: async (actor: Actor, target: string) => { record("event", actor, target); return readResult; },
    readiness: async (actor: Actor, target: string) => { record("readiness", actor, target); return readResult; },
    experiences: async (actor: Actor, target: string) => { record("experiences", actor, target); return readResult; },
  } },
  { provide: AdminScheduleService, useValue: { async updateSchedule() { oldCalls.push("schedule"); return { kind: "completed", eventId, officialEndsAt: createBody.officialEndsAt, operationalDeadlineAt: createBody.operationalDeadlineAt, changedAt: at }; } } },
  { provide: AdminExternalQueueService, useValue: { async setExternalQueue() { oldCalls.push("external-queue"); return { kind: "completed", eventId, externalQueueEnabled: false, releasedCount: 0, changedAt: at }; } } },
  { provide: AdminCloseService, useValue: { async closeEvent() { oldCalls.push("close"); return { kind: "completed", eventId, status: "closed", closureMode: "immediate", newEntriesClosedAt: at, effectiveOperationalDeadlineAt: at, externalWaitingFinalized: 0 }; } } },
] }) class HttpModule {}

let app: INestApplication;
const variables = ["ADMIN_IDEMPOTENCY_TTL_SECONDS", "STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS", "EVALUATION_IDEMPOTENCY_TTL_SECONDS"];
const previous = variables.map(name => process.env[name]);
before(async () => {
  variables.forEach(name => { process.env[name] = "60"; });
  app = await NestFactory.create(HttpModule, { logger: false }); app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => { await app?.close(); variables.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); });
function reset(route: Route = routes[0]) {
  calls.length = 0; oldCalls.length = 0; failure = undefined; readResult = route.response;
  result = { kind: route.status === 201 ? "created" : "changed", body: route.response, httpStatus: route.status };
}
function request(route: Route, path = route.path, token = "unit-admin") {
  return supertest(app.getHttpServer())[route.method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "opaque,key");
}
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.status, status); assert.equal(r.body.code, code); assert.match(r.headers["content-type"], /application\/problem\+json/);
}

for (const route of routes) {
  test(`E08.13 HTTP ${route.name} responde contrato e usa exclusivamente ator/sessão autenticados`, async () => {
    reset(route); const start = Date.now();
    const req = request(route); if (route.method === "get") req.unset("Idempotency-Key"); else req.query({ userId: id(90), sessionId: id(91) });
    const r = await req.send(route.body); assert.equal(r.status, route.status, JSON.stringify(r.body)); assert.deepEqual(r.body, route.response); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].actor, { userId, sessionId }); assert.equal(oldCalls.length, 0);
    if (route.operation) {
      const input = calls[0].input as MutationInput; assert.equal(calls[0].method, "mutate"); assert.equal(input.operation, route.operation);
      assert.equal(input.idempotencyKey, "opaque,key"); assert.ok(input.expiresAt.getTime() >= start + 60000 && input.expiresAt.getTime() <= Date.now() + 60000);
      assert.equal(input.eventId, route.path.includes(eventId) ? eventId : undefined);
      assert.equal(input.experienceId, route.path.includes(experienceId) ? experienceId : undefined); assert.equal(input.stationId, route.path.includes(stationId) ? stationId : undefined);
    } else assert.notEqual(calls[0].method, "mutate");
  });
  test(`E08.13 HTTP ${route.name} exige Bearer/sessão e 2FA; Staff isolado não administra`, async () => {
    reset(route); problem(await request(route).unset("Authorization").send(route.body), 401, "MISSING_ACCESS_TOKEN");
    problem(await request(route, route.path, "revoked").send(route.body), 401, "SESSION_REVOKED");
    problem(await request(route, route.path, "no-2fa").send(route.body), 401, "ADMIN_2FA_REQUIRED"); assert.equal(calls.length, 0);
    problem(await request(route, route.path, "staff").send(route.body), 403, "ADMIN_REQUIRED"); assert.equal(calls[0].actor.userId, staffId);
  });
  if (route.path.includes(eventId)) test(`E08.13 HTTP ${route.name} valida UUIDs de toda a cadeia antes do serviço`, async () => {
    reset(route);
    for (const target of [eventId, experienceId, stationId].filter(target => route.path.includes(target))) {
      problem(await request(route, route.path.replace(target, "invalid")).send(route.body), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls.length, 0);
    assert.equal((await request(route, route.path.replaceAll(eventId, eventId.toUpperCase()).replaceAll(experienceId, experienceId.toUpperCase()).replaceAll(stationId, stationId.toUpperCase())).send(route.body)).status, route.status);
    if (route.operation) assert.equal((calls[0].input as MutationInput).eventId, eventId); else assert.equal(calls[0].input, eventId);
  });
}

for (const route of routes.filter(route => route.operation)) {
  test(`E08.13 HTTP ${route.name} exige corpo estrito e Idempotency-Key única`, async () => {
    reset(route);
    for (const body of [undefined, null, {}, [], { ...route.body, userId }, { ...route.body, sessionId }, { ...route.body, expiresAt: at }, { ...route.body, id: id(99) }, { ...route.body, createdAt: at }]) {
      const invalid = request(route);
      if (body === null) invalid.type("json").send("null"); else invalid.send(body);
      problem(await invalid, 400, body === null ? "BAD_REQUEST" : "VALIDATION_ERROR");
    }
    problem(await request(route).type("text/plain").send(JSON.stringify(route.body)), 400, "VALIDATION_ERROR"); problem(await request(route).type("json").send("{bad"), 400, "BAD_REQUEST");
    problem(await request(route).unset("Idempotency-Key").send(route.body), 400, "VALIDATION_ERROR");
    for (const key of ["", " ", "x".repeat(129)]) problem(await request(route).set("Idempotency-Key", key).send(route.body), 400, "VALIDATION_ERROR");
    problem(await request(route).set({ "Idempotency-Key": ["a", "b"] }).send(route.body), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
  });
  test(`E08.13 HTTP ${route.name} replay conserva corpo/status históricos e no-op responde 200`, async () => {
    reset(route); result = { kind: "replay", body: route.response, httpStatus: route.status };
    const r = await request(route).send(route.body); assert.equal(r.status, route.status); assert.deepEqual(r.body, route.response);
    if (route.method === "patch") { result = { kind: "unchanged", body: route.response, httpStatus: 200 }; const unchanged = await request(route).send(route.body); assert.equal(unchanged.status, 200); assert.deepEqual(unchanged.body, route.response); }
  });
}

test("E08.13 HTTP cadastro normaliza código canônico e instantes sem completar recursos", async () => {
  const route = routes[1]; reset(route);
  const r = await request(route).send({ ...createBody, name: " Evento ", accessCode: "  event-01  ", startsAt: "2026-11-05T14:00:00-03:00", reason: " Preparação " });
  assert.equal(r.status, 201, JSON.stringify(r.body)); const input = calls[0].input as MutationInput;
  assert.equal(input.payload.name, "Evento"); assert.equal(input.payload.accessCode, "EVENT-01"); assert.equal(input.payload.startsAt, createBody.startsAt); assert.equal(input.payload.reason, "Preparação");
  assert.equal(Object.hasOwn(input.payload, "experiences"), false); assert.equal(Object.hasOwn(input.payload, "staff"), false);
});
test("E08.13 HTTP cadastro rejeita código, timezone, datas, margem e configurações inválidas", async () => {
  const route = routes[1]; reset(route);
  for (const value of [{ name: " " }, { name: "x".repeat(181) }, { accessCode: "ABC" }, { accessCode: "A--BC" }, { accessCode: "ß-test" }, { accessCode: "x".repeat(65) },
    { timezone: "Mars/Olympus" }, { externalQueueEnabled: "true" }, { startsAt: "2026-02-30T17:00:00Z" }, { startsAt: "2026-11-05T17:00:00" }, { startsAt: "2026-11-05T17:00:00.1234Z" },
    { startsAt: createBody.officialEndsAt }, { operationalDeadlineAt: "2026-11-05T22:00:00.000Z" }, { operationalDeadlineAt: "2026-11-06T00:00:00.001Z" }]) {
    problem(await request(route).send({ ...createBody, ...value }), 400, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 0);
});
test("E08.13 HTTP PATCH evento não contorna código, horários, fechamento ou fila externa", async () => {
  const route = routes[3]; reset(route);
  for (const key of ["accessCode", "timezone", "startsAt", "officialEndsAt", "operationalDeadlineAt", "externalQueueEnabled", "status", "closureMode", "closureRequestedAt", "adminDeadlineAt", "externalLastOrder", "updatedAt", "audit"]) {
    problem(await request(route).send({ ...route.body, [key]: "forged" }), 400, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 0);
});
test("E08.13 HTTP justificativa opcional rejeita branco, controles e excesso em todas as mutações", async () => {
  reset();
  for (const route of routes.filter(route => route.operation)) {
    for (const reason of [" ", "x\u0000y", "x".repeat(501)]) problem(await request(route).send({ ...route.body, reason }), 400, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 0);
});
for (const route of [routes[6], routes[7], routes[8], routes[9]]) test(`E08.13 HTTP ${route.name} protege vínculo, FIFO e disponibilidade operacional`, async () => {
  reset(route);
  for (const key of ["eventId", "experienceId", "stationId", "queueAcceptingEntries", "lastQueueOrder", "queueOrder", "availability", "currentServiceId", "status"]) {
    problem(await request(route).send({ ...route.body, [key]: "forged" }), 400, "VALIDATION_ERROR");
  }
  const field = route.name.includes("station") ? "label" : "name", limit = field === "label" ? 120 : 160;
  for (const value of [" ", "x".repeat(limit + 1), null, 10]) problem(await request(route).send({ [field]: value }), 400, "VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});
test("E08.13 HTTP lista valida filtros/cursor estritamente e entrega paginação normalizada", async () => {
  const route = routes[0]; reset(route);
  for (const query of [{ userId }, { limit: "0" }, { limit: "51" }, { limit: "1.5" }, { limit: ["1", "2"] }, { cursor: "%%%" }, { cursor: "e30" }, { phase: "invalid" }, { statusStored: "invalid" }]) {
    problem(await request(route).query(query), 400, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 0);
  const cursor = Buffer.from(JSON.stringify({ v: 1, createdAt: at, id: eventId })).toString("base64url");
  const r = await request(route).query({ limit: "2", phase: "open", statusStored: "scheduled", cursor }); assert.equal(r.status, 200);
  assert.deepEqual(calls[0].actor, { userId, sessionId }); assert.equal((calls[0].input as { limit: number }).limit, 2);
  assert.deepEqual((calls[0].input as { cursor: unknown }).cursor, { v: 1, createdAt: at, id: eventId });
});
test("E08.13 HTTP rotas antigas schedule/external-queue/close mantêm seus controllers", async () => {
  reset();
  const base = `/api/v1/admin/events/${eventId}`;
  const schedule = await supertest(app.getHttpServer()).patch(`${base}/schedule`).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "schedule").send({ officialEndsAt: createBody.officialEndsAt, operationalDeadlineAt: createBody.operationalDeadlineAt, reason: "Alteração autorizada" });
  const queue = await supertest(app.getHttpServer()).patch(`${base}/external-queue`).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "queue").send({ enabled: false, reason: "Operação autorizada" });
  const closed = await supertest(app.getHttpServer()).post(`${base}/close`).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "close").send({ mode: "immediate", reason: "Encerramento autorizado" });
  assert.equal(schedule.status, 200); assert.equal(queue.status, 200); assert.equal(closed.status, 200); assert.deepEqual(oldCalls, ["schedule", "external-queue", "close"]); assert.equal(calls.length, 0);
});
test("E08.13 HTTP falhas atuais usam RFC 7807 sem expor payload ou SQL", async () => {
  const route = routes[3]; reset(route);
  for (const [kind, status, code] of [
    ["resource_not_found", 404, "RESOURCE_NOT_FOUND"], ["admin_required", 403, "ADMIN_REQUIRED"], ["account_inactive", 401, "ACCOUNT_DEACTIVATED"],
    ["invalid_session", 401, "INVALID_SESSION"], ["session_revoked", 401, "SESSION_REVOKED"], ["session_expired", 401, "SESSION_EXPIRED"], ["admin_2fa_required", 401, "ADMIN_2FA_REQUIRED"],
    ["access_code_used", 409, "ACCESS_CODE_ALREADY_USED"], ["configuration_locked", 409, "EVENT_CONFIGURATION_LOCKED"], ["event_ended", 409, "EVENT_OPERATION_ENDED"], ["request_conflict", 409, "IDEMPOTENCY_KEY_REUSED"], ["in_progress", 409, "IDEMPOTENCY_IN_PROGRESS"],
  ] as const) {
    failure = new AdminConfigurationError(kind); problem(await request(route).send(route.body), status, code);
  }
  failure = new Error("PRIVATE_SQL_secret@example.test"); const r = await request(route).send(route.body); problem(r, 500, "INTERNAL_SERVER_ERROR");
  assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(JSON.stringify(r.body).includes("example.test"), false);
});
test("E08.13 DI real resolve controller, consultas, mutações e TTL Admin sem conexão", async () => {
  const real = await NestFactory.create(AdminEventsModule, { logger: false });
  try {
    const controller = real.get(AdminConfigurationController), reads = real.get(AdminConfigurationQueryService), writes = real.get(AdminConfigurationService);
    const dependencies = Object.values(controller); assert.ok(dependencies.includes(reads)); assert.ok(dependencies.includes(writes)); assert.ok(dependencies.includes(real.get(AdminIdempotencyPolicy)));
    assert.equal(Reflect.get(reads, "database"), real.get(DRIZZLE_DATABASE)); assert.equal(Reflect.get(writes, "database"), real.get(DRIZZLE_DATABASE)); assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally { await real.close(); }
});
