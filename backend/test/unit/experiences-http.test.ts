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
import { ExperiencesController } from "../../src/events/experiences.controller";
import { ExperiencesService } from "../../src/events/experiences.service";
import type { EventExperiencesResult } from "../../src/events/experiences.types";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), userId = id(2), at = new Date("2026-11-03T15:00:00.000Z");
const route = `/api/v1/events/${eventId}/experiences`;
const success = { eventId, observedAt: at, acceptingNewQueueEntries: true, experiences: [{
  id: id(3), name: "Experiência", acceptingNewQueueEntries: true, waitingCount: 3,
  stations: [{ id: id(4), label: "Estação", available: true }],
}] };
let result: EventExperiencesResult, failure: Error | undefined;
const calls: string[][] = [];
@Module({ controllers: [ExperiencesController], providers: [SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit-participant") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId: id(5), roles: [] };
  } } },
  { provide: ExperiencesService, useValue: { getEventExperiences: async (...args: string[]) => {
    calls.push(args); if (failure) throw failure; return result;
  } } },
] })
class HttpUnitModule {}
let app: INestApplication;
before(async () => {
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => { await app?.close(); });
const get = (url = route) => supertest(app.getHttpServer()).get(url).set("Authorization", "Bearer unit-participant");
function reset() { calls.length = 0; failure = undefined; result = { kind: "ok", ...structuredClone(success) }; }
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status); assert.equal(r.body.status, status); assert.equal(r.body.code, code);
  assert.match(r.headers["content-type"], /application\/problem\+json/);
}

test("E08.3 HTTP 200 delega consulta E06 e serializa data UTC sem kind", async () => {
  reset(); const r = await get(); assert.equal(r.status, 200);
  assert.deepEqual(r.body, JSON.parse(JSON.stringify(success))); assert.deepEqual(calls, [[userId, eventId]]);
});
test("E08.3 HTTP aceita lista vazia para titular autorizado", async () => {
  reset(); result = { kind: "ok", eventId, observedAt: at, acceptingNewQueueEntries: false, experiences: [] };
  const r = await get(); assert.equal(r.status, 200); assert.deepEqual(r.body.experiences, []); assert.equal(r.body.acceptingNewQueueEntries, false);
});
test("E08.3 HTTP exige sessão antes de consultar serviço", async () => {
  reset();
  problem(await supertest(app.getHttpServer()).get(route), 401, "MISSING_ACCESS_TOKEN");
  problem(await get().set("Authorization", "Bearer invalid"), 401, "INVALID_ACCESS_TOKEN");
  assert.equal(calls.length, 0);
});
test("E08.3 HTTP ignora identidade forjada e não exige Staff ou Idempotency-Key", async () => {
  reset(); const r = await get().query({ userId: id(9), staffUserId: id(10) }).set("Idempotency-Key", "");
  assert.equal(r.status, 200); assert.deepEqual(calls, [[userId, eventId]]);
});
test("E08.3 HTTP valida UUID e normaliza eventId", async () => {
  reset(); problem(await get(route.replace(eventId, "bad")), 400, "VALIDATION_ERROR"); assert.equal(calls.length, 0);
  assert.equal((await get(route.replace(eventId, eventId.toUpperCase()))).status, 200); assert.deepEqual(calls, [[userId, eventId]]);
});
test("E08.3 HTTP access_denied vira 404 neutro sem detalhes do evento", async () => {
  reset(); result = { kind: "access_denied" };
  const a = await get(), b = await get(route.replace(eventId, id(9)));
  problem(a, 404, "RESOURCE_NOT_FOUND"); problem(b, 404, "RESOURCE_NOT_FOUND"); assert.deepEqual(a.body, b.body);
  assert.equal(JSON.stringify(a.body).includes(eventId), false);
});
test("E08.3 HTTP erro inesperado vira 500 sem SQL ou dados privados", async () => {
  reset(); failure = new Error("PRIVATE_SQL_credentials@example.test");
  const r = await get(); problem(r, 500, "INTERNAL_SERVER_ERROR");
  assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false); assert.equal(JSON.stringify(r.body).includes("example.test"), false);
});
test("E08.3 HTTP seleciona exatamente os campos públicos em todos os níveis", async () => {
  reset(); result = { kind: "ok", ...structuredClone(success) };
  Object.assign(result, { userId, profileSnapshot: "PRIVATE" });
  if (result.kind !== "ok") assert.fail();
  Object.assign(result.experiences[0], { participants: ["PRIVATE"], staffUserId: id(9) });
  Object.assign(result.experiences[0].stations[0], { pendingUserId: id(10) });
  assert.deepEqual((await get()).body, JSON.parse(JSON.stringify(success)));
});
test("E08.3 HTTP preserva contagens e disponibilidade do serviço sem recalcular ou mutar", async () => {
  reset(); const state = { ...structuredClone(success), acceptingNewQueueEntries: false };
  state.experiences[0].acceptingNewQueueEntries = false; state.experiences[0].waitingCount = Number.MAX_SAFE_INTEGER;
  result = { kind: "ok", ...state }; const before = structuredClone(result);
  const r = await get(); assert.equal(r.status, 200); assert.deepEqual(r.body, JSON.parse(JSON.stringify(state)));
  assert.deepEqual(result, before); assert.equal(calls.length, 1);
});
test("E08.3 Nest resolve controller, serviço E06 e EventsService reais sob tsx", async () => {
  const variables = ["STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"];
  const original = variables.map(name => process.env[name]); for (const name of variables) process.env[name] = "60";
  const real = await NestFactory.create(EventsModule, { logger: false });
  try {
    const service = real.get(ExperiencesService), database = real.get(DRIZZLE_DATABASE);
    assert.ok(Reflect.get(real.get(ExperiencesController), "experiences") === service);
    assert.ok(Reflect.get(service, "database") === database);
    assert.ok(Reflect.get(service, "eventsService") === real.get(EventsService), "ExperiencesService deve receber EventsService real");
    assert.ok(Reflect.get(real.get(EventsService), "database") === database);
    assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally {
    await real.close(); variables.forEach((name, index) => { if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index]; });
  }
});
