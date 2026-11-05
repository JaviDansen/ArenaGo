import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { MutationSessionError, type MutationSession } from "../../src/auth/mutation-session";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { StaffOperationsController } from "../../src/events/staff-operations.controller";
import { ParticipantQueueController } from "../../src/events/participant-queue.controller";
import { EvaluationWriteController, EvaluationWriteIdempotencyPolicy } from "../../src/evaluations/evaluation-write.controller";
import { ParticipationLifecycleController } from "../../src/participations/participation-lifecycle.controller";
import { StaffIdempotencyPolicy } from "../../src/events/staff-idempotency.policy";
import { ParticipantQueueIdempotencyPolicy } from "../../src/events/participant-queue-idempotency.policy";
import { CallNextService } from "../../src/events/call-next.service";
import { CompleteService } from "../../src/events/complete.service";
import { AbsentService } from "../../src/events/absent.service";
import { QueueEntryService } from "../../src/events/queue-entry.service";
import { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import { QueueStateService } from "../../src/events/queue-state.service";
import { EvaluationWriteService } from "../../src/evaluations/evaluation-write.service";
import { ParticipationLifecycleService } from "../../src/participations/participation-lifecycle.service";
import { ParticipationQueryService } from "../../src/participations/participation-query.service";

const id = "abcdef00-0000-4000-8000-000000000001", sid = "abcdef00-0000-4000-8000-000000000002";
let calls = 0, mode = "valid", app: INestApplication;
function invoke(input: { userId?: string; staffUserId?: string }, context: MutationSession) {
  calls++;
  assert.deepEqual(context, { userId: id, sessionId: sid }); assert.equal(input.userId ?? input.staffUserId, id);
  if (mode === "revoked" || mode === "expired") {
    const code = mode === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED";
    throw new MutationSessionError({ status: 401, code, typeSlug: code.toLowerCase().replaceAll("_", "-"), title: "Sessão inválida", detail: "Sessão inválida." });
  }
  return { kind: "replay", serviceSession: { id }, evaluation: { id }, participation: { id }, queueEntryId: id,
    participationId: id, experienceId: id, status: "waiting", queueOrder: "1", enteredAt: new Date(), closedAt: new Date() };
}
@Module({ controllers: [StaffOperationsController, ParticipantQueueController, EvaluationWriteController, ParticipationLifecycleController],
  providers: [SessionAuthGuard, StaffIdempotencyPolicy, ParticipantQueueIdempotencyPolicy, EvaluationWriteIdempotencyPolicy,
    { provide: AuthService, useValue: { authenticateBearerToken: async () => mode === "no-principal" ? undefined : { userId: id, sessionId: mode === "no-session" ? undefined : sid } } },
    { provide: CallNextService, useValue: { callNextAuthenticated: invoke } }, { provide: CompleteService, useValue: { completeAuthenticated: invoke } },
    { provide: AbsentService, useValue: { absentAuthenticated: invoke } }, { provide: QueueEntryService, useValue: { joinExperienceQueueAuthenticated: invoke } },
    { provide: QueueWithdrawalService, useValue: { withdrawExperienceQueueAuthenticated: invoke } }, { provide: QueueStateService, useValue: {} },
    { provide: EvaluationWriteService, useValue: { submitAuthenticated: invoke, editAuthenticated: invoke } },
    { provide: ParticipationLifecycleService, useValue: { cancelAuthenticated: invoke, finishAuthenticated: invoke } },
    { provide: ParticipationQueryService, useValue: {} },
  ] }) class HttpModule {}
before(async () => { app = await NestFactory.create(HttpModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1"); });
after(async () => { await app?.close(); });
const routes = [
  ["post", `/staff/events/${id}/experiences/${id}/stations/${id}/call-next`, {}, 201],
  ["post", `/staff/events/${id}/service-sessions/${id}/complete`, {}, 200],
  ["post", `/staff/events/${id}/service-sessions/${id}/absent`, {}, 200],
  ["post", `/participations/${id}/queue-entries`, { experienceId: id }, 201],
  ["post", `/participations/${id}/queue-entries/${id}/withdraw`, {}, 200],
  ["post", `/participations/${id}/evaluation`, { rating: 5 }, 201],
  ["patch", `/evaluations/${id}`, { rating: 5 }, 200],
  ["post", `/participations/${id}/cancel`, {}, 200], ["post", `/participations/${id}/finish`, {}, 200],
] as const;
for (const [method, path, body, status] of routes) for (const scenario of ["valid", "body-session", "no-session", "no-principal", "revoked", "expired"] as const) {
  test(`E08-EST01 HTTP ${path} ${scenario}`, async () => {
    calls = 0; mode = scenario;
    const r = await supertest(app.getHttpServer())[method](`/api/v1${path}`).set("Authorization", "Bearer simulated")
      .set("Idempotency-Key", "same-intent").set("X-Session-Id", "forged")
      .query({ sessionId: "forged", userId: "forged" }).send(scenario === "body-session" ? { ...body, sessionId: sid } : body);
    assert.equal(r.status, scenario === "valid" ? status : scenario === "body-session" ? 400 : 401, JSON.stringify(r.body));
    assert.equal(calls, ["valid", "revoked", "expired"].includes(scenario) ? 1 : 0);
    if (scenario !== "valid") {
      assert.match(r.headers["content-type"], /application\/problem\+json/);
      assert.equal(r.body.code, scenario === "body-session" ? "VALIDATION_ERROR" : scenario === "revoked" ? "SESSION_REVOKED"
        : scenario === "expired" ? "SESSION_EXPIRED" : "UNAUTHENTICATED_CONTEXT");
    }
  });
}
