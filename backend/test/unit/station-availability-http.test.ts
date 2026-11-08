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
import { StationAvailabilityController } from "../../src/events/station-availability.controller";
import { StationAvailabilityService } from "../../src/events/station-availability.service";
import type { SetStationAvailabilityInput, StationAvailabilityResult } from "../../src/events/station-availability.types";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), stationId = id(2), userId = id(3), sessionId = id(4);
const route = `/api/v1/staff/events/${eventId}/stations/${stationId}/availability`;
const state = { stationId, availability: "unavailable" as const, pendingServiceSessionId: null };
let result: StationAvailabilityResult, failure: Error | undefined;
const calls: SetStationAvailabilityInput[] = [];
@Module({ controllers: [StationAvailabilityController], providers: [SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId, roles: ["staff"] };
  } } },
  { provide: StationAvailabilityService, useValue: { setAvailability: async (input: SetStationAvailabilityInput) => {
    calls.push(input); if (failure) throw failure; return result;
  } } },
] })
class HttpUnitModule {}
let app: INestApplication;
before(async () => {
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => { await app?.close(); });
const patch = (url = route) => supertest(app.getHttpServer()).patch(url).set("Authorization", "Bearer unit");
function reset() { calls.length = 0; failure = undefined; result = { kind: "changed", ...state }; }
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status); assert.equal(r.body.status, status); assert.equal(r.body.code, code);
  assert.match(r.headers["content-type"], /application\/problem\+json/);
}
test("E08.5 HTTP PATCH 200 usa ator/sessão confiáveis e não exige Idempotency-Key", async () => {
  reset(); const r = await patch().query({ userId: id(9), sessionId: id(10) }).send({ availability: "unavailable" });
  assert.equal(r.status, 200); assert.deepEqual(r.body, state);
  assert.deepEqual(calls, [{ userId, sessionId, eventId, stationId, availability: "unavailable" }]);
});
test("E08.5 HTTP reativação/no-op têm mesmo contrato e ignoram header de idempotência", async () => {
  reset(); result = { kind: "unchanged", ...state, availability: "available", pendingServiceSessionId: id(5) };
  const r = await patch().set("Idempotency-Key", "").send({ availability: "available" });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ...state, availability: "available", pendingServiceSessionId: id(5) });
  assert.equal(calls[0].availability, "available");
});
test("E08.5 HTTP Bearer obrigatório e inválido não chegam ao serviço", async () => {
  reset(); problem(await supertest(app.getHttpServer()).patch(route).send({ availability: "unavailable" }), 401, "MISSING_ACCESS_TOKEN");
  problem(await patch().set("Authorization", "Bearer invalid").send({ availability: "unavailable" }), 401, "INVALID_ACCESS_TOKEN"); assert.equal(calls.length, 0);
});
test("E08.5 HTTP UUIDs inválidos recebem 400 e maiúsculas são normalizadas", async () => {
  reset(); for (const value of [eventId,stationId]) problem(await patch(route.replace(value,"bad")).send({ availability: "unavailable" }), 400, "VALIDATION_ERROR");
  assert.equal(calls.length, 0); assert.equal((await patch(route.replace(eventId,eventId.toUpperCase()).replace(stationId,stationId.toUpperCase())).send({ availability: "unavailable" })).status, 200);
  assert.equal(calls[0].eventId,eventId); assert.equal(calls[0].stationId,stationId);
});
test("E08.5 HTTP body obrigatório estrito só admite dois valores exatos", async () => {
  reset(); problem(await patch(), 400, "VALIDATION_ERROR");
  for (const body of [{}, [], { availability: null }, { availability: true }, { availability: "Available" },
    { availability: "busy" }, { availability: "available", actor: userId }, { availability: "unavailable", reason: "extra" }]) {
    problem(await patch().send(body), 400, "VALIDATION_ERROR");
  }
  problem(await patch().type("text/plain").send('{"availability":"available"}'),400,"VALIDATION_ERROR");
  problem(await patch().type("application/json").send("{bad"),400,"BAD_REQUEST"); assert.equal(calls.length,0);
});
test("E08.5 HTTP nega recursos e autorização com mesmo 404 neutro", async () => {
  reset(); result = { kind: "access_denied" }; const a = await patch().send({ availability: "unavailable" });
  const b = await patch(route.replace(eventId,id(9))).send({ availability: "unavailable" });
  problem(a,404,"RESOURCE_NOT_FOUND"); problem(b,404,"RESOURCE_NOT_FOUND"); assert.deepEqual(a.body,b.body); assert.equal(JSON.stringify(a.body).includes(stationId),false);
});
test("E08.5 HTTP conflitos e recusas de sessão após espera usam RFC 7807", async () => {
  reset(); for (const [kind, code, status] of [
    ["account_inactive","ACCOUNT_DEACTIVATED",401], ["invalid_session","INVALID_SESSION",401], ["session_revoked","SESSION_REVOKED",401],
    ["session_expired","SESSION_EXPIRED",401], ["admin_2fa_required","ADMIN_2FA_REQUIRED",401], ["event_operation_ended","EVENT_OPERATION_ENDED",409],
  ] as const) { result = { kind }; problem(await patch().send({ availability: "unavailable" }),status,code); }
  result = { kind: "station_has_pending_call", ...state, availability: "available", pendingServiceSessionId: id(5) };
  const r = await patch().send({ availability: "unavailable" }); problem(r,409,"STATION_HAS_PENDING_CALL");
  assert.deepEqual(r.body.station,{ ...state,availability:"available",pendingServiceSessionId:id(5) });
});
test("E08.5 HTTP filtra propriedades internas e erros privados de auditoria", async () => {
  reset(); Object.assign(result,{ actorUserId:userId, audit: "PRIVATE" }); assert.deepEqual((await patch().send({ availability: "unavailable" })).body,state);
  failure = new Error("PRIVATE_SQL_password@example.test"); const r = await patch().send({ availability: "unavailable" });
  problem(r,500,"INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"),false); assert.equal(JSON.stringify(r.body).includes("example.test"),false);
});
test("E08.5 DI real sob tsx injeta controller/serviço/banco e não abre conexão", async () => {
  const names = ["STAFF_IDEMPOTENCY_TTL_SECONDS","PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"], previous = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = "60";
  const real = await NestFactory.create(EventsModule,{logger:false});
  try {
    const service = real.get(StationAvailabilityService); assert.equal(Reflect.get(real.get(StationAvailabilityController),"stations"),service);
    assert.equal(Reflect.get(service,"database"),real.get(DRIZZLE_DATABASE)); assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount,0);
  } finally { await real.close(); names.forEach((name,index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
