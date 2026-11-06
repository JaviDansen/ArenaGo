import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { AdminRoleManagementController } from "../../src/auth/admin-role-management.controller";
import { AdminRoleManagementService, type AdminRoleMutationInput, type AdminRoleRevokeInput } from "../../src/auth/admin-role-management.service";
import { AdminRoleManagementError, executeAdminRoleManagement } from "../../src/auth/admin-role-management.problem";
import { AdminIdempotencyPolicy } from "../../src/events/admin-idempotency.policy";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1), sessionId = id(2), grantId = id(3), targetId = id(4);
const routes = ["/api/v1/admin/roles/grant", "/api/v1/admin/roles/revoke"];
const bodies = [{ role: "admin", email: "target@example.test" }, { grantId }];
const view = { id: grantId, userId: targetId, role: "admin" as const, eventId: null,
  grantedAt: "2026-11-06T12:00:00.000Z", revokedAt: null as string | null };
let result = { grant: { ...view } }, failure: Error | undefined;
const grants: AdminRoleMutationInput[] = [], revocations: AdminRoleRevokeInput[] = [];
@Module({ controllers: [AdminRoleManagementController], providers: [SessionAuthGuard, AdminIdempotencyPolicy,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "unit-admin") throw new ProblemException({ typeSlug: "invalid-access-token", title: "Token inválido",
      status: 401, code: "INVALID_ACCESS_TOKEN", detail: "Token inválido." });
    return { userId, sessionId, roles: ["admin"] };
  } } },
  { provide: AdminRoleManagementService, useValue: {
    grant: async (input: AdminRoleMutationInput) => { grants.push(input); if (failure) throw failure; return result; },
    revoke: async (input: AdminRoleRevokeInput) => { revocations.push(input); if (failure) throw failure; return result; },
  } },
] })
class HttpUnitModule {}
let app: INestApplication;
const previousTtl = process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS;
before(async () => {
  process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
  app = await NestFactory.create(HttpUnitModule, { logger: false });
  app.setGlobalPrefix("api/v1"); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1");
});
after(async () => {
  try { await app?.close(); }
  finally { if (previousTtl === undefined) delete process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS; else process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = previousTtl; }
});
function reset() { grants.length = 0; revocations.length = 0; failure = undefined; result = { grant: { ...view } }; }
function post(route = routes[0]) { return supertest(app.getHttpServer()).post(route).set("Authorization", "Bearer unit-admin").set("Idempotency-Key", "opaque"); }
function problem(response: supertest.Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.body.status, status); assert.equal(response.body.code, code);
  assert.match(response.headers["content-type"], /application\/problem\+json/);
}

test("T6.1-D HTTP concede Admin com identidade da sessão, e-mail normalizado e TTL compartilhado", async () => {
  reset(); const now = Date.now();
  const response = await post().query({ userId: id(8), sessionId: id(9) }).send({ role: "admin", email: "  TARGET@Example.Test " });
  assert.equal(response.status, 201); assert.deepEqual(response.body, result); assert.equal(grants.length, 1);
  assert.deepEqual({ ...grants[0], expiresAt: undefined }, { userId, sessionId, body: bodies[0], idempotencyKey: "opaque", expiresAt: undefined });
  assert.ok(grants[0].expiresAt.getTime() >= now + 60_000 && grants[0].expiresAt.getTime() <= Date.now() + 60_000);
});

test("T6.1-D HTTP revoga concessão por UUID normalizado usando o ator autenticado", async () => {
  reset(); result = { grant: { ...view, revokedAt: view.grantedAt } };
  const response = await post(routes[1]).query({ userId: id(8) }).send({ grantId: grantId.toUpperCase() });
  assert.equal(response.status, 200); assert.deepEqual(response.body, result); assert.equal(revocations.length, 1);
  assert.deepEqual({ ...revocations[0], expiresAt: undefined }, { userId, sessionId, grantId, idempotencyKey: "opaque", expiresAt: undefined });
});

test("T6.1-D HTTP exige Bearer válido nas duas rotas antes do serviço", async () => {
  reset();
  for (const [index, route] of routes.entries()) {
    problem(await supertest(app.getHttpServer()).post(route).send(bodies[index]), 401, "MISSING_ACCESS_TOKEN");
    problem(await post(route).set("Authorization", "Bearer invalid").send(bodies[index]), 401, "INVALID_ACCESS_TOKEN");
  }
  assert.equal(grants.length + revocations.length, 0);
});

test("T6.1-D HTTP rejeita corpo extra, escopo inválido e conteúdo fora de JSON antes do serviço", async () => {
  reset();
  for (const [index, route] of routes.entries()) {
    for (const body of [{}, [], { ...bodies[index], userId }, { ...bodies[index], expiresAt: view.grantedAt }]) {
      problem(await post(route).send(body), 400, "VALIDATION_ERROR");
    }
    problem(await post(route).type("text/plain").send(JSON.stringify(bodies[index])), 400, "VALIDATION_ERROR");
    problem(await post(route).type("application/json").send("{invalid"), 400, "BAD_REQUEST");
  }
  for (const body of [{ role: "staff", email: "target@example.test" }, { role: "admin", email: "target@example.test", eventId: id(9) }]) {
    problem(await post().send(body), 400, "VALIDATION_ERROR");
  }
  problem(await post(routes[1]).send({ grantId: "invalid" }), 400, "VALIDATION_ERROR");
  assert.equal(grants.length + revocations.length, 0);
});

test("T6.1-D HTTP exige uma única chave idempotente válida em ambas as mutações", async () => {
  reset();
  for (const [index, route] of routes.entries()) {
    problem(await supertest(app.getHttpServer()).post(route).set("Authorization", "Bearer unit-admin").send(bodies[index]), 400, "VALIDATION_ERROR");
    for (const key of ["", " ", "x".repeat(129)]) problem(await post(route).set("Idempotency-Key", key).send(bodies[index]), 400, "VALIDATION_ERROR");
    problem(await post(route).set({ "Idempotency-Key": ["a", "b"] }).send(bodies[index]), 400, "VALIDATION_ERROR");
  }
  assert.equal(grants.length + revocations.length, 0);
});

test("T6.1-D HTTP traduz autorização, duplicidade, último Admin e idempotência em RFC 7807", async () => {
  reset();
  for (const [kind, status, code] of [
    ["account_inactive", 401, "ACCOUNT_DEACTIVATED"], ["admin_required", 403, "ADMIN_REQUIRED"],
    ["invalid_session", 401, "INVALID_SESSION"], ["session_revoked", 401, "SESSION_REVOKED"],
    ["session_expired", 401, "SESSION_EXPIRED"], ["admin_2fa_required", 401, "ADMIN_2FA_REQUIRED"],
    ["actor_email_unverified", 403, "ADMIN_EMAIL_UNVERIFIED"], ["event_not_found", 404, "RESOURCE_NOT_FOUND"],
    ["target_not_found", 404, "RESOURCE_NOT_FOUND"], ["target_ineligible", 422, "ROLE_TARGET_INELIGIBLE"],
    ["role_already_granted", 409, "ROLE_ALREADY_GRANTED"], ["role_not_found", 404, "RESOURCE_NOT_FOUND"],
    ["last_admin", 409, "LAST_ADMIN_REQUIRED"], ["request_conflict", 409, "IDEMPOTENCY_KEY_REUSED"], ["in_progress", 409, "IDEMPOTENCY_IN_PROGRESS"],
  ] as const) {
    failure = new AdminRoleManagementError(kind);
    for (const [index, route] of routes.entries()) problem(await post(route).send(bodies[index]), status, code);
  }
});

test("T6.1-D HTTP preserva resposta histórica de replay e não expõe detalhes de erro interno", async () => {
  reset(); const first = await post().send(bodies[0]), replay = await post().send(bodies[0]);
  assert.equal(replay.status, 201); assert.deepEqual(replay.body, first.body);
  assert.deepEqual(Object.keys(replay.body.grant).sort(), ["id", "userId", "role", "eventId", "grantedAt", "revokedAt"].sort());
  failure = new Error("PRIVATE_SQL_secret@example.test");
  for (const [index, route] of routes.entries()) {
    const response = await post(route).send(bodies[index]); problem(response, 500, "INTERNAL_SERVER_ERROR");
    assert.equal(JSON.stringify(response.body).includes("PRIVATE"), false); assert.equal(JSON.stringify(response.body).includes("example.test"), false);
  }
});

test("T6.1-D tradução de erro desconhecido preserva cause inclusive para valores não Error", async () => {
  for (const original of [new Error("internal"), "unknown failure", null]) {
    await assert.rejects(executeAdminRoleManagement(async () => { throw original; }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message, "ADMIN_ROLE_MANAGEMENT_INTERNAL_ERROR");
      assert.equal(error.cause, original); return true;
    });
  }
});
