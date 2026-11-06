import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { twoFactorVerifySchema, validateDto } from "../../src/auth/auth.dto";
import { isRecoveryCodeFormat, matchingTotpCounter } from "../../src/auth/admin-two-factor.crypto";
import { generateTotpSecret, totpCode } from "../../src/auth/totp-activation.crypto";
import { ProblemException } from "../../src/common/errors/problem.exception";

test("T6.1-C: valida contrato e uso único dos fatores administrativos", async (t) => {
  await t.test("DTO aceita somente desafio e código TOTP ou recovery code no formato B2", () => {
    const tempToken = "x".repeat(100);
    assert.deepEqual(validateDto(twoFactorVerifySchema, { tempToken, code: "000001" }), {
      tempToken,
      code: "000001",
    });
    assert.equal(validateDto(twoFactorVerifySchema, { tempToken, code: "a".repeat(32) }).code, "a".repeat(32));

    for (const body of [
      { tempToken, code: "12345" },
      { tempToken, code: "1234567" },
      { tempToken, code: "A".repeat(32) },
      { tempToken, code: "a".repeat(33) },
      { tempToken, code: 123456 },
      { tempToken, code: "123456", userId: randomUUID() },
      { tempToken, code: "123456", role: "admin" },
    ]) {
      assert.throws(() => validateDto(twoFactorVerifySchema, body),
        (error: unknown) => error instanceof ProblemException && error.getStatus() === 400);
    }
  });

  await t.test("TOTP respeita janela RFC 6238 e não aceita contador já consumido", () => {
    const secret = generateTotpSecret();
    const nowMs = 1_800_000_000_000;
    const current = Math.floor(nowMs / 30_000);
    const code = totpCode(secret, nowMs);
    assert.equal(matchingTotpCounter(secret, code, nowMs, null), current);
    assert.equal(matchingTotpCounter(secret, code, nowMs, current), null);

    const previousStep = nowMs - 30_000;
    const previousCode = totpCode(secret, previousStep);
    assert.equal(matchingTotpCounter(secret, previousCode, nowMs, null), current - 1);
    assert.equal(matchingTotpCounter(secret, previousCode, nowMs, current - 1), null);
    assert.equal(matchingTotpCounter(secret, "abcdef", nowMs, null), null);
  });

  await t.test("formato de recovery code corresponde aos 16 bytes hexadecimais da B2", () => {
    assert.equal(isRecoveryCodeFormat("a1".repeat(16)), true);
    assert.equal(isRecoveryCodeFormat("A1".repeat(16)), false);
    assert.equal(isRecoveryCodeFormat("a1".repeat(15)), false);
    assert.equal(isRecoveryCodeFormat("a1".repeat(17)), false);
  });
});

test("T6.1-C HTTP simulado: rota estrita delega o desafio e marca a resposta como não armazenável", async () => {
  let received: unknown;
  @Module({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: { verifyTwoFactor: async (dto: unknown) => {
        received = dto;
        return { user: { id: randomUUID(), name: "Admin", email: "admin@example.test", emailVerified: true, roles: ["admin"], hasCompletedQuestionnaire: false }, accessToken: "access-test", refreshToken: "refresh-test", expiresIn: 900 };
      } } },
      { provide: EmailVerificationHttpService, useValue: { request: async () => ({}), confirm: async () => ({ verified: false }) } },
      SessionAuthGuard,
      { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
    ],
  })
  class SimulatedAuthModule {}

  const app = await NestFactory.create(SimulatedAuthModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/v1/auth/2fa/verify`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tempToken: "temporary-test-token", code: "001234" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.deepEqual(received, { tempToken: "temporary-test-token", code: "001234" });
    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tempToken: "temporary-test-token", code: "001234", userId: randomUUID() }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("content-type")?.includes("application/problem+json"), true);
    const problem = await invalid.json() as { code?: string };
    assert.equal(problem.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});
