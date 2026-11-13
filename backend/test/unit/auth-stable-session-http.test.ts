import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";

test("auth/me retorna somente o vínculo da sessão validada e exige Bearer", async () => {
  const sessionId = "10000000-0000-4000-8000-000000000001";
  const principal = { userId: "20000000-0000-4000-8000-000000000001", sessionId,
    name: "Teste", email: "teste@example.test", emailVerified: true,
    roles: ["participante"] as const, staffEventIds: [], hasCompletedQuestionnaire: true, admin2faVerifiedAt: null };
  @Module({ controllers: [AuthController], providers: [
    { provide: AuthService, useValue: {
      authenticateBearerToken: async (token: string) => {
        if (token !== "valid") throw new ProblemException({ typeSlug: "invalid-session", title: "Inválida",
          status: 401, code: "SESSION_REVOKED", detail: "Sessão revogada." });
        return principal;
      },
      getMe: AuthService.prototype.getMe,
    } },
    { provide: EmailVerificationHttpService, useValue: {} }, SessionAuthGuard,
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
  ] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/auth/me?sessionId=client-controlled`;
    const valid = await fetch(url, { headers: { Authorization: "Bearer valid" } });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    const body = await valid.json() as Record<string, unknown>;
    assert.equal(body.sessionId, sessionId);
    assert.deepEqual(Object.keys(body).sort(), ["email", "emailVerified", "hasCompletedQuestionnaire", "id", "name", "roles", "sessionId"]);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: "Bearer revoked" } })).status, 401);
  } finally { await app.close(); }
});
