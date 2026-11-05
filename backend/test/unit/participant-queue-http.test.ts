import type { MutationSession } from "../../src/auth/mutation-session";
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
import { parseOperationIdempotencyTtl } from "../../src/common/http/idempotency-ttl";
import { validateOperationIdempotencyKey } from "../../src/common/http/operation-validation";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";
import { EventsModule } from "../../src/events/events.module";
import { EventsService } from "../../src/events/events.service";
import { ParticipantQueueController } from "../../src/events/participant-queue.controller";
import { ParticipantQueueIdempotencyPolicy } from "../../src/events/participant-queue-idempotency.policy";
import { QueueEntryService } from "../../src/events/queue-entry.service";
import type { JoinExperienceQueueInput, JoinExperienceQueueResult } from "../../src/events/queue-entry.types";
import { QueueStateIntegrityError, QueueStateService } from "../../src/events/queue-state.service";
import type { ParticipationQueueResult } from "../../src/events/queue-state.types";
import { QueueWithdrawalIntegrityError, QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import type { WithdrawExperienceQueueInput, WithdrawExperienceQueueResult } from "../../src/events/queue-withdrawal.types";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const participationId = id(1), experienceId = id(2), queueEntryId = id(3), userId = id(4);
const base = `/api/v1/participations/${participationId}`;
const joinPath = `${base}/queue-entries`, getPath = `${base}/queue`, withdrawPath = `${joinPath}/${queueEntryId}/withdraw`;
const at = new Date("2026-11-03T12:00:00.000Z");
const created: JoinExperienceQueueResult = { kind: "created", participationId, experienceId, queueEntryId, status: "waiting", queueOrder: "9007199254741001", enteredAt: at };
const waiting: ParticipationQueueResult = { kind: "ok", participationId, observedAt: at, currentQueueEntry: {
  id: queueEntryId, experienceId, experienceName: "Experiência", queueOrder: "9007199254741001", status: "waiting", position: 2, serviceSession: null,
} };
const withdrawn: WithdrawExperienceQueueResult = { kind: "withdrawn", participationId, queueEntryId, experienceId, status: "closed", closedAt: at, serviceSession: null };
let joinResult: JoinExperienceQueueResult = created, queueResult: ParticipationQueueResult = waiting, withdrawResult: WithdrawExperienceQueueResult = withdrawn;
let failure: Error | undefined;
const mutations: Array<JoinExperienceQueueInput | WithdrawExperienceQueueInput> = [];
const reads: string[][] = [];
function record<T>(input: JoinExperienceQueueInput | WithdrawExperienceQueueInput, result: T): T {
  mutations.push(input); if (failure) throw failure; return result;
}
@Module({ controllers: [ParticipantQueueController], providers: [ParticipantQueueIdempotencyPolicy, SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (!["unit-participant", "unit-admin"].includes(token)) throw new ProblemException({ typeSlug: "invalid-access-token", title: "Inválido", status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId: id(5), roles: token === "unit-admin" ? ["admin"] : [] };
  } } },
  { provide: QueueEntryService, useValue: { joinExperienceQueueAuthenticated: async (input: JoinExperienceQueueInput, context: MutationSession) => authenticatedInput(context, record(input, joinResult)) } },
  { provide: QueueStateService, useValue: { getParticipationQueue: async (...input: string[]) => {
    reads.push(input); if (failure) throw failure; return queueResult;
  } } },
  { provide: QueueWithdrawalService, useValue: { withdrawExperienceQueueAuthenticated: async (input: WithdrawExperienceQueueInput, context: MutationSession) => authenticatedInput(context, record(input, withdrawResult)) } },
] })
class HttpUnitModule {}
let app: INestApplication;
const originalParticipantTtl = process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS;
const originalStaffTtl = process.env.STAFF_IDEMPOTENCY_TTL_SECONDS;
before(async () => {
  process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
  process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "90";
  app = await NestFactory.create(HttpUnitModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  if (originalParticipantTtl === undefined) delete process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS;
  else process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = originalParticipantTtl;
  if (originalStaffTtl === undefined) delete process.env.STAFF_IDEMPOTENCY_TTL_SECONDS;
  else process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = originalStaffTtl;
});
const post = (route: string, key = "opaque,intent") => supertest(app.getHttpServer()).post(route).set("Authorization", "Bearer unit-participant").set("Idempotency-Key", key);
const get = () => supertest(app.getHttpServer()).get(getPath).set("Authorization", "Bearer unit-participant");
function reset() { mutations.length = 0; reads.length = 0; joinResult = created; queueResult = waiting; withdrawResult = withdrawn; failure = undefined; }
function problem(r: supertest.Response, status: number, code: string) {
  assert.equal(r.status, status); assert.match(r.headers["content-type"], /application\/problem\+json/);
  assert.equal(r.body.code, code); assert.equal(r.body.status, status);
}

test("E08.2 HTTP ingresso usa ator autenticado, TTL próprio, ordem exata e não inventa posição", async () => {
  reset(); const start = Date.now(), r = await post(joinPath).send({ experienceId });
  assert.equal(r.status, 201); const { kind: _kind, ...expected } = created;
  void _kind;
  assert.deepEqual(r.body, JSON.parse(JSON.stringify(expected))); assert.equal("position" in r.body, false);
  assert.equal(mutations.length, 1); assert.equal(mutations[0].userId, userId); assert.equal(mutations[0].idempotencyKey, "opaque,intent");
  assert.ok(mutations[0].expiresAt.getTime() >= start+60000 && mutations[0].expiresAt.getTime() <= Date.now()+60000);
});
test("E08.2 HTTP GET mantém snapshot waiting, chamado e vazio sem mutação ou TTL", async () => {
  reset(); const policy = app.get(ParticipantQueueIdempotencyPolicy), original = policy.expiresAt;
  policy.expiresAt = () => { throw new Error("GET não pode calcular TTL"); };
  try {
    const called: ParticipationQueueResult = { kind: "ok", participationId, observedAt: at, currentQueueEntry: {
      id: queueEntryId, experienceId, experienceName: "Experiência", queueOrder: "9007199254741001", status: "called", position: null,
      serviceSession: { id: id(6), status: "pending", calledAt: at, station: { id: id(7), label: "Estação" } },
    } };
    for (const value of [waiting, called, { kind: "ok", participationId, observedAt: at, currentQueueEntry: null }] as const) {
      queueResult = value; const r = await get(); assert.equal(r.status, 200);
      const { kind: _kind, ...expected } = value; void _kind; assert.deepEqual(r.body, JSON.parse(JSON.stringify(expected)));
    }
    assert.deepEqual(reads, Array(3).fill([userId, participationId])); assert.equal(mutations.length, 0);
  } finally { policy.expiresAt = original; }
});
test("E08.2 HTTP desistência identifica tentativa e serializa cancelamento sem ausência", async () => {
  reset(); withdrawResult = { ...withdrawn, serviceSession: { id: id(6), status: "canceled", resolvedAt: at } };
  const r = await post(withdrawPath).send({}); assert.equal(r.status, 200);
  assert.equal(r.body.queueEntryId, queueEntryId); assert.equal(r.body.serviceSession.status, "canceled"); assert.equal(r.body.closedAt, at.toISOString());
  assert.equal(r.body.serviceSession.resolvedAt, at.toISOString()); assert.equal("kind" in r.body, false);
  assert.equal((mutations[0] as WithdrawExperienceQueueInput).queueEntryId, queueEntryId); assert.equal(mutations[0].userId, userId);
});
test("E08.2 HTTP replay preserva status original 201/200 e JSON", async () => {
  reset(); const join = await post(joinPath).send({ experienceId }), withdraw = await post(withdrawPath).send({});
  joinResult = { ...created, kind: "replay" }; withdrawResult = { ...withdrawn, kind: "replay" };
  const a = await post(joinPath).send({ experienceId }), b = await post(withdrawPath).send({});
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.deepEqual(a.body, join.body); assert.deepEqual(b.body, withdraw.body);
});
test("E08.2 HTTP todas as rotas exigem autenticação antes de delegar", async () => {
  reset();
  for (const token of [undefined, "invalid"]) {
    for (const r of [supertest(app.getHttpServer()).post(joinPath).send({ experienceId }), supertest(app.getHttpServer()).get(getPath), supertest(app.getHttpServer()).post(withdrawPath)]) {
      if (token) r.set("Authorization", `Bearer ${token}`); assert.equal((await r).status, 401);
    }
  }
  assert.equal(mutations.length+reads.length, 0);
});
test("E08.2 HTTP não exige Staff nem proíbe Admin autenticado", async () => {
  reset(); assert.equal((await post(joinPath).set("Authorization", "Bearer unit-admin").send({ experienceId })).status, 201);
  assert.equal((await get()).status, 200); assert.equal((await post(withdrawPath)).status, 200);
});
test("E08.2 HTTP UUIDs de parâmetros e corpo são validados e normalizados", async () => {
  reset();
  for (const route of [joinPath.replace(participationId, "bad"), withdrawPath.replace(queueEntryId, "bad"), withdrawPath.replace(participationId, "bad")]) problem(await post(route).send({ experienceId }), 400, "VALIDATION_ERROR");
  problem(await supertest(app.getHttpServer()).get(getPath.replace(participationId, "bad")).set("Authorization", "Bearer unit-participant"), 400, "VALIDATION_ERROR");
  problem(await post(joinPath).send({ experienceId: "bad" }), 400, "VALIDATION_ERROR"); assert.equal(mutations.length+reads.length, 0);
  assert.equal((await post(joinPath.replace(participationId, participationId.toUpperCase())).send({ experienceId: experienceId.toUpperCase() })).status, 201);
  assert.equal(mutations[0].participationId, participationId); assert.equal((mutations[0] as JoinExperienceQueueInput).experienceId, experienceId);
});
test("E08.2 HTTP chave é obrigatória, única, opaca e limitada nos dois POSTs", async () => {
  reset();
  for (const route of [joinPath, withdrawPath]) {
    const body = route === joinPath ? { experienceId } : {};
    problem(await supertest(app.getHttpServer()).post(route).set("Authorization", "Bearer unit-participant").send(body), 400, "VALIDATION_ERROR");
    for (const key of ["", " ", "x".repeat(129)]) problem(await post(route, key).send(body), 400, "VALIDATION_ERROR");
    problem(await post(route).set({ "Idempotency-Key": ["a", "b"] }).send(body), 400, "VALIDATION_ERROR");
  }
  assert.equal(mutations.length, 0); assert.equal((await post(joinPath, "x".repeat(128)).send({ experienceId })).status, 201);
  assert.throws(() => validateOperationIdempotencyKey({ headers: { "idempotency-key": "a\tb" }, rawHeaders: ["Idempotency-Key", "a\tb"] }), ProblemException);
});
test("E08.2 HTTP corpo de ingresso exige somente experienceId e rejeita dados forjados", async () => {
  reset();
  for (const body of [{}, [], { experienceId, userId }, { experienceId, expiresAt: at.toISOString() }, { experienceId, position: 1 }, { experienceId, queueOrder: "1" }, { experienceId, status: "called" }]) problem(await post(joinPath).send(body), 400, "VALIDATION_ERROR");
  problem(await post(joinPath).type("json").send("null"), 400, "BAD_REQUEST");
  problem(await post(joinPath), 400, "VALIDATION_ERROR"); assert.equal(mutations.length, 0);
});
test("E08.2 HTTP desistência aceita {} ou corpo ausente e rejeita extras", async () => {
  reset();
  for (const body of [[], { queueEntryId }, { userId }, { expiresAt: at.toISOString() }]) problem(await post(withdrawPath).send(body), 400, "VALIDATION_ERROR");
  assert.equal(mutations.length, 0); assert.equal((await post(withdrawPath)).status, 200); assert.equal((await post(withdrawPath).send({})).status, 200);
});
test("E08.2 HTTP POSTs não ignoram texto, formulário ou JSON malformado", async () => {
  reset();
  for (const route of [joinPath, withdrawPath]) {
    problem(await post(route).type("text/plain").send("private"), 400, "VALIDATION_ERROR");
    problem(await post(route).type("form").send("experienceId=x"), 400, "VALIDATION_ERROR");
    problem(await post(route).type("json").send("{invalid"), 400, "BAD_REQUEST");
  }
  assert.equal(mutations.length, 0);
});
test("E08.2 HTTP acesso negado tem resposta neutra idêntica nas três rotas", async () => {
  reset(); joinResult = queueResult = withdrawResult = { kind: "access_denied" };
  const responses = [await post(joinPath).send({ experienceId }), await get(), await post(withdrawPath)];
  for (const r of responses) problem(r, 404, "RESOURCE_NOT_FOUND");
  assert.deepEqual(responses[0].body, responses[1].body); assert.deepEqual(responses[0].body, responses[2].body);
});
test("E08.2 HTTP mapeia todos os bloqueios de ingresso em conflitos RFC 7807", async () => {
  reset();
  for (const [kind, code] of [["participation_not_active", "PARTICIPATION_NOT_ACTIVE"], ["queue_occupied", "ALREADY_IN_INTERNAL_QUEUE"],
    ["queue_closed", "EXPERIENCE_QUEUE_CLOSED"], ["experience_unavailable", "EXPERIENCE_UNAVAILABLE"],
    ["event_closed", "EVENT_REGISTRATION_CLOSED"], ["event_unavailable", "EVENT_UNAVAILABLE"],
    ["request_conflict", "IDEMPOTENCY_REQUEST_CONFLICT"], ["in_progress", "IDEMPOTENCY_IN_PROGRESS"]] as const) {
    joinResult = kind === "event_closed" || kind === "event_unavailable" ? { kind, missing: ["EVENT_ENTRY_CLOSED"] } : { kind };
    problem(await post(joinPath).send({ experienceId }), 409, code);
  }
});
test("E08.2 HTTP mapeia todos os bloqueios de desistência sem efeitos aparentes", async () => {
  reset();
  for (const [kind, code] of [["participation_not_active", "PARTICIPATION_NOT_ACTIVE"], ["entry_not_current", "QUEUE_ENTRY_NOT_CURRENT"],
    ["event_ended", "EVENT_OPERATION_ENDED"], ["request_conflict", "IDEMPOTENCY_REQUEST_CONFLICT"], ["in_progress", "IDEMPOTENCY_IN_PROGRESS"]] as const) {
    withdrawResult = { kind }; problem(await post(withdrawPath), 409, code);
  }
});
test("E08.2 HTTP erros SQL/integridade não expõem detalhes, IDs privados ou credenciais", async () => {
  reset();
  for (const error of [new Error("PRIVATE_SQL_secret"), new QueueStateIntegrityError("PRIVATE_SQL_secret"), new QueueWithdrawalIntegrityError("PRIVATE_SQL_secret")]) {
    failure = error;
    for (const r of [await post(joinPath).send({ experienceId }), await get(), await post(withdrawPath)]) {
      problem(r, 500, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
    }
  }
});
test("E08.2 TTL próprio é obrigatório, positivo e independente da configuração Staff", () => {
  const variable = "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS";
  for (const raw of [undefined, "", " ", "0", "-1", "1.5", "1e3", "NaN", "9007199254740992", "8640000000000"]) assert.throws(() => parseOperationIdempotencyTtl(raw, variable), /PARTICIPANT_QUEUE/);
  const old = process.env[variable]; delete process.env[variable];
  try { assert.throws(() => new ParticipantQueueIdempotencyPolicy(), /PARTICIPANT_QUEUE/); }
  finally { if (old === undefined) delete process.env[variable]; else process.env[variable] = old; }
  assert.equal(parseOperationIdempotencyTtl("60", variable), 60000);
});
test("E08.2 Nest resolve controller, guard e serviços reais sob tsx sem conectar ao banco", async () => {
  const real = await NestFactory.create(EventsModule, { logger: false });
  try {
    const controller = real.get(ParticipantQueueController), database = real.get(DRIZZLE_DATABASE);
    for (const [name, token] of [["joining", QueueEntryService], ["state", QueueStateService], ["withdrawal", QueueWithdrawalService]] as const) {
      assert.ok(Reflect.get(controller, name) === real.get(token));
      assert.ok(Reflect.get(real.get(token), "database") === database);
    }
    assert.ok(Reflect.get(real.get(QueueEntryService), "eventsService") === real.get(EventsService));
    assert.ok(Reflect.get(controller, "idempotency") === real.get(ParticipantQueueIdempotencyPolicy));
    assert.ok(Reflect.get(real.get(SessionAuthGuard), "authService") === real.get(AuthService));
    assert.equal(real.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally { await real.close(); }
});

function authenticatedInput<T>(context: MutationSession, result: T): T {
  assert.deepEqual(context, { userId: userId, sessionId: id(5) }); return result;
}
