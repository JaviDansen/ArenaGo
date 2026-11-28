// PARTICIPANTE-01 R02: contrato HTTP de consulta/abandono de intenção e replay de chave abandonada.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { EventsService } from "../../src/events/events.service";
import { ParticipantQueueIdempotencyPolicy } from "../../src/events/participant-queue-idempotency.policy";
import { ParticipantAdmissionController } from "../../src/participations/participant-admission.controller";
import type { JoinIntentLookupResult } from "../../src/participations/join-idempotency";
import {
  ParticipationsService, type AbandonJoinIntentResult, type CreateParticipationResult, type JoinIntentInput,
} from "../../src/participations/participations.service";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const participationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let lookupResult: JoinIntentLookupResult = { state: "not_found" };
let abandonResult: AbandonJoinIntentResult = { state: "abandoned", abandonedNow: true };
let joinResult: CreateParticipationResult = { kind: "created", httpStatus: 201, participationId, idempotencyResult: { participationId } };
const lookups: JoinIntentInput[] = [];
const abandons: Array<JoinIntentInput & { expiresAt: Date }> = [];
const joins: unknown[] = [];

@Module({ controllers: [ParticipantAdmissionController], providers: [
  SessionAuthGuard, ParticipantQueueIdempotencyPolicy,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "participant" && token !== "other") throw new ProblemException({
      status: 401, code: "INVALID_ACCESS_TOKEN", typeSlug: "invalid-access-token", title: "Token inválido", detail: "Token inválido.",
    });
    return { userId: token === "participant" ? userId : otherUserId, sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", roles: [] };
  } } },
  { provide: EventsService, useValue: { findByAccessCode: async () => null } },
  { provide: ParticipationsService, useValue: {
    lookupJoinIntent: async (input: JoinIntentInput) => { lookups.push(input); return lookupResult; },
    abandonJoinIntent: async (input: JoinIntentInput & { expiresAt: Date }) => { abandons.push(input); return abandonResult; },
    createParticipation: async (input: unknown) => { joins.push(input); return joinResult; },
    evaluateJoinEligibility: async () => assert.fail("rotas de intenção não avaliam elegibilidade"),
  } },
] })
class HttpTestModule {}

let app: INestApplication;
const oldTtl = process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS;
before(async () => {
  process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
  app = await NestFactory.create(HttpTestModule, { logger: false });
  app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter());
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  if (oldTtl === undefined) delete process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS;
  else process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = oldTtl;
});
function reset() {
  lookupResult = { state: "not_found" }; abandonResult = { state: "abandoned", abandonedNow: true };
  joinResult = { kind: "created", httpStatus: 201, participationId, idempotencyResult: { participationId } };
  lookups.length = 0; abandons.length = 0; joins.length = 0;
}
const route = (path: string, key = "intent-key", token = "participant") =>
  supertest(app.getHttpServer()).post(`/api/v1/participations/admission-intents/${path}`)
    .set("Authorization", `Bearer ${token}`).set("Idempotency-Key", key);
function problem(response: supertest.Response, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.match(response.headers["content-type"], /application\/problem\+json/); assert.equal(response.body.code, code);
}

test("R02-T01: consulta usa a identidade da sessão, a chave do cabeçalho e devolve só o estado", async () => {
  reset();
  const response = await route("lookup").send({ eventId: eventId.toUpperCase() });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { intent: { state: "not_found" } });
  assert.deepEqual(lookups, [{ userId, eventId, idempotencyKey: "intent-key" }]);
  assert.equal(joins.length + abandons.length, 0, "consulta não ingressa nem abandona");
});

test("R02-T02: intenção concluída devolve só o identificador da própria participação", async () => {
  reset(); lookupResult = { state: "completed", participationId };
  const response = await route("lookup").send({ eventId });
  assert.deepEqual(response.body, { intent: { state: "completed", participationId } });
  for (const state of ["in_progress", "abandoned", "conflict"] as const) {
    lookupResult = { state };
    assert.deepEqual((await route("lookup").send({ eventId })).body, { intent: { state } });
  }
});

test("R02-T03: outra conta consulta com a própria identidade, nunca com a do corpo", async () => {
  reset();
  await route("lookup", "same-key", "other").send({ eventId });
  assert.equal(lookups[0].userId, otherUserId);
  problem(await route("lookup").send({ eventId, userId }), 400, "VALIDATION_ERROR");
});

test("consulta e abandono exigem sessão, corpo exato e uma única chave válida", async () => {
  reset();
  for (const path of ["lookup", "abandon"]) {
    problem(await supertest(app.getHttpServer()).post(`/api/v1/participations/admission-intents/${path}`)
      .set("Idempotency-Key", "k").send({ eventId }), 401, "MISSING_ACCESS_TOKEN");
    problem(await route(path, "k", "invalid").send({ eventId }), 401, "INVALID_ACCESS_TOKEN");
    for (const body of [{ eventId: "bad" }, {}, { eventId, extra: true }]) problem(await route(path).send(body), 400, "VALIDATION_ERROR");
    for (const key of ["", " ", "x".repeat(129)]) problem(await route(path, key).send({ eventId }), 400, "VALIDATION_ERROR");
    problem(await supertest(app.getHttpServer()).post(`/api/v1/participations/admission-intents/${path}`)
      .set("Authorization", "Bearer participant").send({ eventId }), 400, "VALIDATION_ERROR");
  }
  assert.equal(lookups.length + abandons.length + joins.length, 0);
});

test("R02-T07/T08/T09: abandono devolve resultado terminal ou o ingresso que venceu", async () => {
  reset(); const start = Date.now();
  const abandoned = await route("abandon").send({ eventId });
  assert.equal(abandoned.status, 200);
  assert.deepEqual(abandoned.body, { intent: { state: "abandoned" } });
  assert.equal(abandons[0].userId, userId); assert.equal(abandons[0].eventId, eventId);
  assert.equal(abandons[0].idempotencyKey, "intent-key");
  assert.ok(abandons[0].expiresAt.getTime() >= start + 60000, "mesma política de TTL do ingresso");
  abandonResult = { state: "abandoned" };
  assert.deepEqual((await route("abandon").send({ eventId })).body, { intent: { state: "abandoned" } });
  abandonResult = { state: "completed", participationId };
  assert.deepEqual((await route("abandon").send({ eventId })).body, { intent: { state: "completed", participationId } });
});

test("R02-T04: abandono com fingerprint diferente ou operação em andamento é recusado", async () => {
  reset(); abandonResult = { state: "conflict" };
  problem(await route("abandon").send({ eventId }), 409, "IDEMPOTENCY_KEY_REUSED");
  abandonResult = { state: "in_progress" };
  problem(await route("abandon").send({ eventId }), 409, "IDEMPOTENCY_IN_PROGRESS");
});

test("R02-T07: POST de ingresso com chave abandonada é 409 terminal, nunca 500 nem participação", async () => {
  reset();
  joinResult = { kind: "replay", httpStatus: 409, participationId: null,
    idempotencyResult: { code: "ADMISSION_INTENT_ABANDONED" } };
  const response = await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", "Bearer participant").set("Idempotency-Key", "intent-key").send({ eventId });
  problem(response, 409, "ADMISSION_INTENT_ABANDONED");
  assert.equal("participationId" in response.body, false);
});

test("R02-T23: replay de sucesso gravado antes da R02 continua 201 com o mesmo participationId", async () => {
  reset(); joinResult = { kind: "replay", httpStatus: 201, participationId, idempotencyResult: { participationId } };
  const response = await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", "Bearer participant").set("Idempotency-Key", "legacy").send({ eventId });
  assert.equal(response.status, 201); assert.deepEqual(response.body, { participationId });
  // Formato desconhecido continua sendo falha de integridade (500), não ingresso.
  joinResult = { kind: "replay", httpStatus: 409, participationId: null, idempotencyResult: { code: "OUTRO" } };
  const broken = await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", "Bearer participant").set("Idempotency-Key", "legacy").send({ eventId });
  assert.equal(broken.status, 500); assert.equal("participationId" in broken.body, false);
});
