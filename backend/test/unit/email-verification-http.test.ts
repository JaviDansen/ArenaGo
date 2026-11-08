import assert from "node:assert/strict";
import { test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";

const principal = { userId: "00000000-0000-4000-8000-000000000001", sessionId: "session", email: "a@example.test",
  name: "Pessoa", emailVerified: false, roles: ["participante"], staffEventIds: [], hasCompletedQuestionnaire: false, admin2faVerifiedAt: null };
let app: INestApplication;

@Module({ controllers: [AuthController], providers: [
  { provide: AuthService, useValue: { authenticateBearerToken: async () => principal } },
  { provide: EmailVerificationHttpService, useValue: { request: async (id: string) => ({ message: id === principal.userId ? "ok" : "wrong principal" }), confirm: async (token: unknown) => ({ verified: token === "valid" }) } },
  SessionAuthGuard, { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
] })
class HttpTestModule {}

test("T6.1-A2 rotas HTTP exigem sessão na solicitação e aceitam confirmação sem sessão", async () => {
  app = await NestFactory.create(HttpTestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  try {
    const server = app.getHttpServer();
    const unauthenticated = await supertest(server).post("/api/v1/auth/verify-email/request").send({});
    assert.equal(unauthenticated.status, 401);
    const spoofed = await supertest(server).post("/api/v1/auth/verify-email/request").set("Authorization", "Bearer session-token").send({ userId: "attacker" });
    assert.equal(spoofed.status, 400);
    const requested = await supertest(server).post("/api/v1/auth/verify-email/request").set("Authorization", "Bearer session-token")
      .set("Host", "attacker.invalid").set("Origin", "https://attacker.invalid").send({});
    assert.equal(requested.status, 202);
    assert.deepEqual(requested.body, { message: "ok" });
    const confirmed = await supertest(server).post("/api/v1/auth/verify-email/confirm").send({ token: "valid" });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.body, { verified: true });
    const extra = await supertest(server).post("/api/v1/auth/verify-email/confirm").send({ token: "valid", userId: "attacker" });
    assert.equal(extra.status, 400);
  } finally { await app.close(); }
});
