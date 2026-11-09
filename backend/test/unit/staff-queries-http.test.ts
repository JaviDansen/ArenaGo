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
import { EventsModule } from "../../src/events/events.module";
import { EventsService } from "../../src/events/events.service";
import { StaffQueriesController } from "../../src/events/staff-queries.controller";
import { StaffQueriesService } from "../../src/events/staff-queries.service";
import type { StaffQueueResult, StaffStationsResult } from "../../src/events/staff-queries.types";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), experienceId = id(2), userId = id(3), at = new Date("2026-11-03T15:00:00Z");
const base = `/api/v1/staff/events/${eventId}`;
const routes = [`${base}/stations`, `${base}/experiences/${experienceId}/queue`];
const stations = { eventId, stations: [{ id: id(4), experienceId, label: "Estação", availability: "available" as const,
  pendingServiceSessionId: id(5), pendingCalledAt: at }] };
const queue = { eventId, experienceId, observedAt: at, waitingCount: 3,
  acceptingNewEntries: false, canCallWaitingEntries: true, firstWaitingQueueEntryId: id(6) };
let stationResult: StaffStationsResult, queueResult: StaffQueueResult, failure: Error | undefined;
let eventResults: Array<{ id: string; name: string; status: "open" }> = [];
const calls: unknown[][] = [];
@Module({ controllers: [StaffQueriesController], providers: [SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit-staff") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId: id(7), roles: ["staff"] };
  } } },
  { provide: StaffQueriesService, useValue: {
    listEvents: async (...args: string[]) => { calls.push(["events", ...args]); if (failure) throw failure; return eventResults; },
    getStations: async (...args: string[]) => { calls.push(["stations", ...args]); if (failure) throw failure; return stationResult; },
    getQueue: async (...args: string[]) => { calls.push(["queue", ...args]); if (failure) throw failure; return queueResult; },
  } },
] })
class HttpUnitModule {}
let app: INestApplication;
before(async () => {
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => { await app?.close(); });
const get = (route: string) => supertest(app.getHttpServer()).get(route).set("Authorization", "Bearer unit-staff");
function reset() {
  calls.length = 0; failure = undefined;
  eventResults = [];
  stationResult = { kind: "ok", ...structuredClone(stations) }; queueResult = { kind: "ok", ...structuredClone(queue) };
}
test("descoberta HTTP exige sessão e usa somente o usuário autenticado", async () => {
  reset();
  problem(await supertest(app.getHttpServer()).get("/api/v1/staff/events"), 401, "MISSING_ACCESS_TOKEN");
  problem(await get("/api/v1/staff/events").set("Authorization", "Bearer invalid"), 401, "INVALID_ACCESS_TOKEN");
  assert.equal(calls.length, 0);
  eventResults = [{ id: eventId, name: "Arena", status: "open" }];
  Object.assign(eventResults[0], { userId: id(9), accessCode: "PRIVATE" });
  const r = await get("/api/v1/staff/events").query({ userId: id(9) });
  assert.equal(r.status, 200); assert.equal(r.headers["cache-control"], "no-store");
  assert.deepEqual(r.body, { events: [{ id: eventId, name: "Arena", status: "open" }] });
  assert.deepEqual(calls, [["events", userId]]);
});
test("descoberta HTTP retorna lista vazia sem concessões", async () => {
  reset(); const r = await get("/api/v1/staff/events");
  assert.equal(r.status, 200); assert.deepEqual(r.body, { events: [] });
});
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status); assert.equal(r.body.status, status); assert.equal(r.body.code, code);
  assert.match(r.headers["content-type"], /application\/problem\+json/);
}
test("E08.4 HTTP estações delega ator da sessão, mantém disponibilidade e serializa pendingCalledAt", async () => {
  reset(); const r = await get(routes[0]).query({ staffUserId: id(9) }); assert.equal(r.status, 200);
  assert.deepEqual(r.body, JSON.parse(JSON.stringify(stations))); assert.deepEqual(calls, [["stations", userId, eventId]]);
});
test("E08.4 HTTP fila preserva os dois indicadores distintos e observedAt PostgreSQL", async () => {
  reset(); const r = await get(routes[1]); assert.equal(r.status, 200);
  assert.deepEqual(r.body, JSON.parse(JSON.stringify(queue))); assert.deepEqual(calls, [["queue", userId, eventId, experienceId]]);
});
test("E08.4 HTTP ambas as rotas exigem Bearer válido antes de consultar", async () => {
  reset(); for (const route of routes) {
    problem(await supertest(app.getHttpServer()).get(route), 401, "MISSING_ACCESS_TOKEN");
    problem(await get(route).set("Authorization", "Bearer invalid"), 401, "INVALID_ACCESS_TOKEN");
  }
  assert.equal(calls.length, 0);
});
test("E08.4 HTTP valida UUIDs e normaliza evento/experiência antes da delegação", async () => {
  reset(); for (const route of routes) problem(await get(route.replace(eventId, "bad")), 400, "VALIDATION_ERROR");
  problem(await get(routes[1].replace(experienceId, "bad")), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
  for (const route of routes) assert.equal((await get(route.replace(eventId, eventId.toUpperCase()).replace(experienceId, experienceId.toUpperCase()))).status, 200);
  assert.deepEqual(calls, [["stations", userId, eventId], ["queue", userId, eventId, experienceId]]);
});
test("E08.4 HTTP recusa neutra 404 não confirma existência de recursos", async () => {
  reset(); stationResult = { kind: "access_denied" }; queueResult = { kind: "access_denied" };
  for (const route of routes) {
    const a = await get(route), b = await get(route.replace(eventId, id(9)));
    problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
    assert.equal(JSON.stringify(a.body).includes(eventId), false);
  }
});
test("E08.4 HTTP erro interno retorna RFC 7807 sem SQL nem informações privadas", async () => {
  reset(); failure = new Error("PRIVATE_SQL_private@example.test");
  for (const route of routes) {
    const r = await get(route); problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
  }
});
test("E08.4 HTTP seleciona campos públicos sem vazar propriedades adicionais dos serviços", async () => {
  reset(); Object.assign(stationResult, { userId, accounts: ["PRIVATE"] }); Object.assign(queueResult, { participants: ["PRIVATE"] });
  assert.ok(stationResult.kind === "ok"); Object.assign(stationResult.stations[0], { calledByUserId: userId, profile: "PRIVATE" });
  assert.deepEqual((await get(routes[0])).body, JSON.parse(JSON.stringify(stations)));
  assert.deepEqual((await get(routes[1])).body, JSON.parse(JSON.stringify(queue)));
});
test("E08.4 HTTP listas vazias e nulos não exigem chave de idempotência", async () => {
  reset(); stationResult = { kind: "ok", eventId, stations: [] };
  queueResult = { kind: "ok", ...queue, waitingCount: 0, firstWaitingQueueEntryId: null };
  assert.deepEqual((await get(routes[0])).body, { eventId, stations: [] });
  const r = await get(routes[1]); assert.equal(r.status, 200); assert.equal(r.body.firstWaitingQueueEntryId, null); assert.equal(r.body.waitingCount, 0);
});
test("E08.4 Nest injeta controller, serviço, EventsService e banco reais sob tsx sem conexão", async () => {
  const names = ["STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"], previous = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = "60";
  const real = await NestFactory.create(EventsModule, { logger: false });
  try {
    const service = real.get(StaffQueriesService), database = real.get(DRIZZLE_DATABASE);
    assert.equal(Reflect.get(real.get(StaffQueriesController), "queries"), service);
    assert.equal(Reflect.get(service, "database"), database); assert.equal(Reflect.get(service, "events"), real.get(EventsService));
    assert.equal(Reflect.get(real.get(EventsService), "database"), database); assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally {
    await real.close(); names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
