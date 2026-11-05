import type { MutationSession } from "../../src/auth/mutation-session";
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { CallNextIntegrityError, CallNextService } from "../../src/events/call-next.service";
import type { CallNextInput, CallNextResult } from "../../src/events/call-next.types";
import { CompleteService, CompleteServiceIntegrityError } from "../../src/events/complete.service";
import type { CompleteServiceInput, CompleteServiceResult } from "../../src/events/complete.types";
import { AbsentService, AbsentServiceIntegrityError } from "../../src/events/absent.service";
import type { AbsentServiceInput, AbsentServiceResult } from "../../src/events/absent.types";
import { StaffOperationsController } from "../../src/events/staff-operations.controller";
import { parseStaffIdempotencyTtl, StaffIdempotencyPolicy } from "../../src/events/staff-idempotency.policy";
import { rejectStaffOperation } from "../../src/events/staff-operation.problem";
import { validateStaffRequest } from "../../src/events/staff-operation.dto";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = id(1), experienceId = id(2), stationId = id(3), serviceId = id(4), staffId = id(5);
const callPath = `/api/v1/staff/events/${eventId}/experiences/${experienceId}/stations/${stationId}/call-next`;
const completePath = `/api/v1/staff/events/${eventId}/service-sessions/${serviceId}/complete`;
const absentPath = completePath.replace(/complete$/, "absent");
const at = new Date("2026-11-03T18:00:00.000Z");
const called: CallNextResult = { kind: "created", serviceSession: { id: serviceId, queueEntryId: id(6), experienceId,
  station: { id: stationId, label: "Estação" }, status: "pending", calledAt: at } };
const completed: CompleteServiceResult = { kind: "completed", serviceSession: { id: serviceId, status: "completed", resolvedAt: at },
  queueEntry: { status: "closed", closeReason: "completed" }, participation: { status: "active", currentQueueEntryId: null } };
const absent: AbsentServiceResult = { kind: "absent", serviceSession: { id: serviceId, status: "absent", resolvedAt: at },
  previousQueueEntry: { id: id(6), status: "closed", closeReason: "absent" }, requeued: true,
  newQueueEntry: { id: id(7), status: "waiting", queueOrder: "9007199254741003", position: 3 } };
let callResult: CallNextResult = called, completeResult: CompleteServiceResult = completed, absentResult: AbsentServiceResult = absent, error: Error | undefined;
const captured: Array<CallNextInput | CompleteServiceInput | AbsentServiceInput> = [];
function record<T>(input: CallNextInput | CompleteServiceInput | AbsentServiceInput, result: T): T {
  captured.push(input); if (error) throw error; return result;
}
@Module({ controllers: [StaffOperationsController], providers: [StaffIdempotencyPolicy, SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit-staff") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId: staffId, sessionId: id(8) };
  } } },
  { provide: CallNextService, useValue: { callNextAuthenticated: async (input: CallNextInput, context: MutationSession) => authenticatedInput(context, record(input, callResult)) } },
  { provide: CompleteService, useValue: { completeAuthenticated: async (input: CompleteServiceInput, context: MutationSession) => authenticatedInput(context, record(input, completeResult)) } },
  { provide: AbsentService, useValue: { absentAuthenticated: async (input: AbsentServiceInput, context: MutationSession) => authenticatedInput(context, record(input, absentResult)) } },
] })
class HttpUnitModule {}
let app: INestApplication;
const originalTtl = process.env.STAFF_IDEMPOTENCY_TTL_SECONDS;
before(async () => {
  process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  if (originalTtl === undefined) delete process.env.STAFF_IDEMPOTENCY_TTL_SECONDS; else process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = originalTtl;
});
const post = (path: string) => supertest(app.getHttpServer()).post(path).set("Authorization", "Bearer unit-staff").set("Idempotency-Key", "unit-intent");
function reset() { captured.length = 0; callResult = called; completeResult = completed; absentResult = absent; error = undefined; }

test("E08.1 HTTP delega chamada com ator autenticado, TTL backend e resposta 201 mínima", async () => {
  reset(); const start = Date.now(); const response = await post(callPath).send({});
  assert.equal(response.status, 201); assert.deepEqual(response.body, JSON.parse(JSON.stringify({ serviceSession: called.serviceSession })));
  assert.equal(captured.length, 1); assert.equal(captured[0].staffUserId, staffId); assert.equal(captured[0].eventId, eventId);
  assert.ok(captured[0].expiresAt.getTime() >= start + 60000 && captured[0].expiresAt.getTime() <= Date.now() + 60000);
});
test("E08.1 HTTP complete/absent mantêm 200, ISO UTC, bigint decimal e contrato efetivo", async () => {
  reset(); const a = await post(completePath).send({}), b = await post(absentPath).send({});
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(a.body.serviceSession.resolvedAt, at.toISOString());
  assert.equal(b.body.newQueueEntry.queueOrder, "9007199254741003"); assert.equal(b.body.requeued, true);
  assert.equal(a.body.kind, undefined); assert.equal(b.body.kind, undefined); assert.equal(captured.length, 2);
  absentResult = { ...absent, requeued: false, newQueueEntry: null };
  const c = await post(absentPath); assert.equal(c.status, 200); assert.equal(c.body.newQueueEntry, null);
});
test("E08.1 HTTP replay preserva status original 201/200 e mesmo JSON", async () => {
  reset();
  for (const path of [callPath, completePath, absentPath]) {
    const first = await post(path).send({});
    callResult = { ...called, kind: "replay" }; completeResult = { ...completed, kind: "replay" }; absentResult = { ...absent, kind: "replay" };
    const replay = await post(path).send({}); assert.equal(replay.status, first.status); assert.deepEqual(replay.body, first.body);
    reset();
  }
});
test("E08.1 HTTP exige Bearer antes de chamar qualquer serviço", async () => {
  reset();
  for (const path of [callPath, completePath, absentPath]) {
    assert.equal((await supertest(app.getHttpServer()).post(path).send({})).status, 401);
    assert.equal((await post(path).set("Authorization", "Bearer invalid").send({})).status, 401);
  }
  assert.equal(captured.length, 0);
});
test("E08.1 HTTP rejeita UUIDs inválidos em todos os parâmetros", async () => {
  reset();
  for (const path of [callPath.replace(eventId, "invalid"), callPath.replace(experienceId, "invalid"), callPath.replace(stationId, "invalid"), completePath.replace(serviceId, "invalid"), absentPath.replace(serviceId, "invalid")]) {
    const r = await post(path).send({}); assert.equal(r.status, 400); assert.match(r.headers["content-type"], /application\/problem\+json/);
  }
  assert.equal(captured.length, 0);
});
test("E08.1 HTTP header obrigatório único, chave opaca até 128 caracteres", async () => {
  reset();
  for (const path of [callPath, completePath, absentPath]) {
    for (const key of ["", " ", "x".repeat(129)]) assert.equal((await post(path).set("Idempotency-Key", key).send({})).status, 400);
    assert.equal((await supertest(app.getHttpServer()).post(path).set("Authorization", "Bearer unit-staff").send({})).status, 400);
    assert.equal((await post(path).set({ "Idempotency-Key": ["a", "b"] }).send({})).status, 400);
  }
  assert.equal(captured.length, 0);
  assert.equal((await post(callPath).set("Idempotency-Key", "x".repeat(128)).send({})).status, 201);
});
test("E08.1 HTTP aceita apenas {} ou ausência de corpo e não ignora corpo text/plain", async () => {
  reset();
  for (const body of [[], { staffUserId: staffId }, { expiresAt: at.toISOString() }, { status: "completed" }, { queueOrder: "1" }, { eventId }]) {
    for (const path of [callPath, completePath, absentPath]) assert.equal((await post(path).send(body)).status, 400);
  }
  assert.equal((await post(callPath).type("text/plain").send("forbidden")).status, 400);
  assert.equal((await post(callPath).type("form").send("&&")).status, 400);
  assert.equal((await post(callPath).type("application/json").send("{invalid")).status, 400);
  assert.equal(captured.length, 0); assert.equal((await post(callPath)).status, 201);
});
test("E08.1 todos os resultados negativos reais têm RFC 7807 explícito", () => {
  for (const [kind, status, code] of [
    ["staff_event_forbidden", 403, "STAFF_EVENT_FORBIDDEN"], ["service_not_found", 404, "SERVICE_NOT_FOUND"],
    ["service_not_pending", 409, "SERVICE_NOT_PENDING"], ["station_unavailable", 409, "STATION_UNAVAILABLE"],
    ["station_has_pending_call", 409, "STATION_HAS_PENDING_CALL"], ["queue_empty", 409, "QUEUE_EMPTY"],
    ["event_operation_ended", 409, "EVENT_OPERATION_ENDED"], ["request_conflict", 409, "IDEMPOTENCY_REQUEST_CONFLICT"], ["in_progress", 409, "IDEMPOTENCY_IN_PROGRESS"],
  ] as const) {
    assert.throws(() => rejectStaffOperation(kind), (error: unknown) => {
      assert.ok(error instanceof ProblemException); assert.equal(error.getStatus(), status); assert.equal(error.problem.code, code); return true;
    });
  }
});
test("E08.1 HTTP traduz os bloqueios dos três serviços sem expor detalhes internos", async () => {
  reset(); callResult = { kind: "station_has_pending_call" }; completeResult = { kind: "service_not_found" }; absentResult = { kind: "request_conflict" };
  assert.equal((await post(callPath).send({})).body.code, "STATION_HAS_PENDING_CALL");
  assert.equal((await post(completePath).send({})).status, 404); assert.equal((await post(absentPath).send({})).status, 409);
  for (const [path, failure] of [[callPath, new CallNextIntegrityError("private SQL")], [completePath, new CompleteServiceIntegrityError("private SQL")], [absentPath, new AbsentServiceIntegrityError("private SQL")]] as const) {
    error = failure; const r = await post(path).send({}); assert.equal(r.status, 500); assert.equal(r.body.code, "INTERNAL_SERVER_ERROR");
    assert.equal(JSON.stringify(r.body).includes("private"), false);
  }
  reset();
});
test("E08.1 TTL exige inteiro positivo explícito, sem fallback e sem aceitar overflow", () => {
  for (const raw of [undefined, "", " ", "0", "-1", "1.5", "1e3", "NaN", "9007199254740992", "8640000000000"]) assert.throws(() => parseStaffIdempotencyTtl(raw), /STAFF_IDEMPOTENCY_TTL_SECONDS/);
  assert.equal(parseStaffIdempotencyTtl("60"), 60000);
  const current = process.env.STAFF_IDEMPOTENCY_TTL_SECONDS;
  delete process.env.STAFF_IDEMPOTENCY_TTL_SECONDS;
  try { assert.throws(() => new StaffIdempotencyPolicy(), /obrigatório/); } finally { process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = current; }
});
test("E08.1 header com controles não chega aos serviços internos", () => {
  assert.throws(() => validateStaffRequest({}, { headers: { "content-type": "application/json", "idempotency-key": "a\tb" }, rawHeaders: ["Idempotency-Key", "a\tb"] }), ProblemException);
});

function authenticatedInput<T>(context: MutationSession, result: T): T {
  assert.deepEqual(context, { userId: staffId, sessionId: id(8) }); return result;
}
