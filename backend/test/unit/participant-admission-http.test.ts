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
import type { JoinEligibilityResult } from "../../src/participations/join-eligibility";
import { ParticipantAdmissionController } from "../../src/participations/participant-admission.controller";
import { ParticipationsService, type CreateParticipationInput, type CreateParticipationResult } from "../../src/participations/participations.service";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const participationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const startsAt = new Date("2026-11-07T12:00:00.000Z");
const event = { id: eventId, name: "Arena Teste", timezone: "America/Sao_Paulo", startsAt,
  officialEndsAt: new Date("2026-11-07T18:00:00.000Z"), operationalDeadlineAt: new Date("2026-11-07T19:00:00.000Z"),
  externalQueueEnabled: true, accessCodeNormalized: "ARENA-2026", secret: "never-expose" };
const eligible: JoinEligibilityResult = { eligible: true, eventExists: true, userExists: true,
  checks: { eventAcceptingNewEntries: true, hasCompletedQuestionnaire: true, questionnaireVersionValid: true,
    hasSelectedGames: true, hasNoCurrentParticipation: true }, blockingReasons: [] };
const created: CreateParticipationResult = { kind: "created", httpStatus: 201, participationId,
  idempotencyResult: { participationId } };
let foundEvent: typeof event | null = event;
let eligibility: JoinEligibilityResult = eligible;
let result: CreateParticipationResult = created;
let infrastructureError: Error | undefined;
const codes: string[] = [];
const eligibilityCalls: Array<{ userId: string; eventId: string; at: Date }> = [];
const joins: CreateParticipationInput[] = [];

@Module({ controllers: [ParticipantAdmissionController], providers: [
  SessionAuthGuard, ParticipantQueueIdempotencyPolicy,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "participant" && token !== "other") throw new ProblemException({
      status: 401, code: "INVALID_ACCESS_TOKEN", typeSlug: "invalid-access-token", title: "Token inválido", detail: "Token inválido.",
    });
    return { userId: token === "participant" ? userId : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", roles: [] };
  } } },
  { provide: EventsService, useValue: { findByAccessCode: async (code: string) => {
    codes.push(code); if (infrastructureError) throw infrastructureError; return foundEvent;
  } } },
  { provide: ParticipationsService, useValue: {
    evaluateJoinEligibility: async (actor: string, target: string, at: Date) => {
      eligibilityCalls.push({ userId: actor, eventId: target, at }); return eligibility;
    },
    createParticipation: async (input: CreateParticipationInput) => {
      joins.push(input); if (infrastructureError) throw infrastructureError; return result;
    },
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
function reset() { foundEvent = event; eligibility = eligible; result = created; infrastructureError = undefined;
  codes.length = 0; eligibilityCalls.length = 0; joins.length = 0; }
const lookup = (token = "participant") => supertest(app.getHttpServer()).post("/api/v1/events/lookup").set("Authorization", `Bearer ${token}`);
const join = (key = "opaque-key", token = "participant") => supertest(app.getHttpServer()).post("/api/v1/participations")
  .set("Authorization", `Bearer ${token}`).set("Idempotency-Key", key);
function problem(response: supertest.Response, status: number, code: string) {
  assert.equal(response.status, status); assert.match(response.headers["content-type"], /application\/problem\+json/);
  assert.equal(response.body.status, status); assert.equal(response.body.code, code);
}

test("Etapa 3 HTTP lookup normaliza código, usa identidade autenticada e expõe somente campos seguros", async () => {
  reset(); const response = await lookup().send({ accessCode: "  arena-2026  " });
  assert.equal(response.status, 200); assert.deepEqual(codes, ["ARENA-2026"]);
  assert.equal(eligibilityCalls.length, 1); assert.equal(eligibilityCalls[0].userId, userId);
  assert.equal(eligibilityCalls[0].eventId, eventId); assert.ok(eligibilityCalls[0].at instanceof Date);
  assert.deepEqual(response.body, { event: { id: eventId, name: event.name, timezone: event.timezone,
    startsAt: startsAt.toISOString(), officialEndsAt: event.officialEndsAt.toISOString(),
    operationalDeadlineAt: event.operationalDeadlineAt.toISOString(), externalQueueEnabled: true },
    eligibility: { eligible: true, blockingReasons: [] } });
  assert.equal(joins.length, 0);
});
test("Etapa 3 HTTP lookup devolve impedimentos informativos sem reservar ingresso", async () => {
  reset(); eligibility = { ...eligible, eligible: false, blockingReasons: ["EVENT_NOT_STARTED", "PROFILE_INCOMPLETE"] };
  const response = await lookup().send({ accessCode: "ARENA-2026" });
  assert.equal(response.status, 200); assert.deepEqual(response.body.eligibility,
    { eligible: false, blockingReasons: ["EVENT_NOT_STARTED", "PROFILE_INCOMPLETE"] }); assert.equal(joins.length, 0);
});
test("Etapa 3 HTTP lookup rejeita código inválido, desconhecido e campos extras", async () => {
  reset(); problem(await lookup().send({ accessCode: "BAD" }), 400, "VALIDATION_ERROR");
  problem(await lookup().send({ accessCode: "ARENA-2026", userId }), 400, "VALIDATION_ERROR");
  assert.equal(codes.length, 0); foundEvent = null;
  problem(await lookup().send({ accessCode: "ARENA-2026" }), 404, "EVENT_NOT_FOUND");
  assert.equal(eligibilityCalls.length, 0);
});
test("Etapa 3 HTTP ambas as rotas exigem sessão antes de consultar ou escrever", async () => {
  reset();
  for (const request of [
    supertest(app.getHttpServer()).post("/api/v1/events/lookup").send({ accessCode: "ARENA-2026" }),
    supertest(app.getHttpServer()).post("/api/v1/participations").set("Idempotency-Key", "x").send({ eventId }),
  ]) problem(await request, 401, "MISSING_ACCESS_TOKEN");
  problem(await lookup("invalid").send({ accessCode: "ARENA-2026" }), 401, "INVALID_ACCESS_TOKEN");
  assert.equal(codes.length + joins.length, 0);
});
test("Etapa 3 HTTP ingresso usa identidade da sessão, UUID normalizado e TTL validado", async () => {
  reset(); const start = Date.now(); const response = await join("opaque-key").send({ eventId: eventId.toUpperCase() });
  assert.equal(response.status, 201); assert.deepEqual(response.body, { participationId });
  assert.equal(joins.length, 1); assert.equal(joins[0].userId, userId); assert.equal(joins[0].eventId, eventId);
  assert.equal(joins[0].idempotencyKey, "opaque-key");
  assert.ok(joins[0].expiresAt.getTime() >= start + 60000 && joins[0].expiresAt.getTime() <= Date.now() + 60000);
});
test("Etapa 3 HTTP ingresso preserva replay e rejeita conflito e operação em andamento", async () => {
  reset(); result = { kind: "replay", httpStatus: 201, participationId, idempotencyResult: { participationId } };
  const response = await join().send({ eventId }); assert.equal(response.status, 201);
  assert.deepEqual(response.body, { participationId });
  result = { kind: "request_conflict", operationId: participationId };
  problem(await join().send({ eventId }), 409, "IDEMPOTENCY_KEY_REUSED");
  result = { kind: "in_progress", operationId: participationId };
  problem(await join().send({ eventId }), 409, "IDEMPOTENCY_IN_PROGRESS");
});
test("Etapa 3 HTTP ingresso traduz impedimentos de domínio sem reescrever suas regras", async () => {
  reset();
  for (const [reason, status] of [["EVENT_NOT_FOUND", 404], ["EVENT_NOT_STARTED", 409],
    ["EVENT_REGISTRATION_CLOSED", 409], ["EVENT_NOT_READY", 409], ["PROFILE_INCOMPLETE", 422],
    ["PARTICIPATION_ALREADY_CURRENT", 409], ["USER_INACTIVE", 403]] as const) {
    result = { kind: "blocked", eligibility: { ...eligible, eligible: false, blockingReasons: [reason] } };
    problem(await join().send({ eventId }), status, reason);
  }
});
test("Etapa 3 HTTP valida corpo, UUID e chave sem aceitar identidade arbitrária", async () => {
  reset();
  for (const body of [{ eventId: "bad" }, { eventId, userId }, { eventId, status: "active" }, {}])
    problem(await join().send(body), 400, "VALIDATION_ERROR");
  problem(await supertest(app.getHttpServer()).post("/api/v1/participations")
    .set("Authorization", "Bearer participant").send({ eventId }), 400, "VALIDATION_ERROR");
  for (const key of ["", " ", "x".repeat(129)]) problem(await join(key).send({ eventId }), 400, "VALIDATION_ERROR");
  problem(await join().set({ "Idempotency-Key": ["a", "b"] }).send({ eventId }), 400, "VALIDATION_ERROR");
  assert.equal(joins.length, 0);
});
test("Etapa 3 HTTP troca de conta não reaproveita identidade nem chave da sessão anterior", async () => {
  reset(); await join("same-key").send({ eventId }); await join("same-key", "other").send({ eventId });
  assert.equal(joins.length, 2); assert.notEqual(joins[0].userId, joins[1].userId);
});
test("Etapa 3 HTTP falha de infraestrutura é 500 RFC 7807 sem afirmar criação", async () => {
  reset(); infrastructureError = new Error("falha simulada");
  const response = await join().send({ eventId });
  assert.equal(response.status, 500); assert.match(response.headers["content-type"], /application\/problem\+json/);
  assert.equal("participationId" in response.body, false);
});
