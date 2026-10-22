import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  validateDto,
} from "../../src/auth/auth.dto";
import { LoginRateLimiterService } from "../../src/auth/login-rate-limiter.service";
import { evaluatePasswordSecurity } from "../../src/auth/password-policy";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateOpaqueRefreshToken,
  hashRefreshToken,
  signAccessToken,
  signTempTwoFactorToken,
  verifyAccessToken,
} from "../../src/auth/token.util";
import { ProblemException } from "../../src/common/errors/problem.exception";

test("Auth Unit Suite: DTOs, política de senhas, tokens e rate limiter", async (t) => {
  await t.test("registerSchema valida e normaliza nome e e-mail corretamente", () => {
    const valid = validateDto(registerSchema, {
      name: "  Maria   Silva  ",
      email: "  MARIA.SILVA@Exemplo.COM ",
      password: "uma-senha-segura-e-unica-2026",
    });

    assert.equal(valid.name, "Maria   Silva");
    assert.equal(valid.email, "maria.silva@exemplo.com");
    assert.equal(valid.password, "uma-senha-segura-e-unica-2026");
  });

  await t.test("registerSchema rejeita confirmPassword ou propriedades extras no payload", () => {
    assert.throws(
      () =>
        validateDto(registerSchema, {
          name: "Maria Silva",
          email: "maria@exemplo.com",
          password: "uma-senha-segura-e-unica-2026",
          confirmPassword: "uma-senha-segura-e-unica-2026",
        }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.code === "VALIDATION_ERROR" &&
        err.problem.invalidParams?.some((p) => p.name === "confirmPassword"),
    );
  });

  await t.test("registerSchema rejeita nome curto (<2), e-mail inválido e senha fora de 8..128", () => {
    assert.throws(
      () =>
        validateDto(registerSchema, {
          name: " A ",
          email: "invalido-sem-arroba",
          password: "curta",
        }),
      (err: unknown) => {
        if (!(err instanceof ProblemException)) return false;
        const fields = err.problem.invalidParams?.map((p) => p.name) ?? [];
        return (
          err.getStatus() === 400 &&
          fields.includes("name") &&
          fields.includes("email") &&
          fields.includes("password")
        );
      },
    );

    assert.throws(
      () =>
        validateDto(registerSchema, {
          name: "Nome Válido",
          email: "valido@exemplo.com",
          password: "x".repeat(129),
        }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "password"),
    );
  });

  await t.test("evaluatePasswordSecurity bloqueia senhas comuns, sequenciais, repetidas ou iguais ao nome/e-mail", () => {
    assert.equal(evaluatePasswordSecurity("12345678").compromised, true);
    assert.equal(evaluatePasswordSecurity("password123").compromised, true);
    assert.equal(evaluatePasswordSecurity("QWERTYUIOP").compromised, true);
    assert.equal(evaluatePasswordSecurity("aaaaaaaaaa").compromised, true);
    assert.equal(evaluatePasswordSecurity("arenago123").compromised, true);
    assert.equal(
      evaluatePasswordSecurity("kaled.barreto", {
        email: "kaled.barreto@exemplo.com",
        name: "Kaled Barreto",
      }).compromised,
      true,
    );
    assert.equal(
      evaluatePasswordSecurity("kaledbarreto", {
        email: "outro@exemplo.com",
        name: "Kaled Barreto",
      }).compromised,
      true,
    );

    const strong = evaluatePasswordSecurity("Tr0pical#Nebula$9841", {
      email: "kaled@exemplo.com",
      name: "Kaled",
    });
    assert.equal(strong.compromised, false);
  });

  await t.test("JWT access token tem 15 minutos, valida assinatura/expiração e rejeita tempToken", () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const nowMs = Date.now();

    const accessToken = signAccessToken({ userId, sessionId }, { nowMs });
    const verified = verifyAccessToken(accessToken, { nowMs });
    assert.equal(verified.valid, true);
    if (verified.valid) {
      assert.equal(verified.claims.sub, userId);
      assert.equal(verified.claims.sid, sessionId);
      assert.equal(verified.claims.exp - verified.claims.iat, ACCESS_TOKEN_TTL_SECONDS);
    }

    // Expirado após 15 minutos
    const expiredCheck = verifyAccessToken(accessToken, {
      nowMs: nowMs + ACCESS_TOKEN_TTL_SECONDS * 1_000,
    });
    assert.deepEqual(expiredCheck, { valid: false, reason: "EXPIRED" });

    // Adulterado
    const parts = accessToken.split(".");
    const tampered = `${parts[0]}.${parts[1]}.assinaturaAdulterada123`;
    assert.deepEqual(verifyAccessToken(tampered, { nowMs }), {
      valid: false,
      reason: "INVALID_SIGNATURE",
    });

    // Temp token 2FA nunca é aceito como access token normal (nem mesmo se assinado com o mesmo segredo)
    const tempTokenDefault = signTempTwoFactorToken(userId, { nowMs });
    assert.equal(verifyAccessToken(tempTokenDefault, { nowMs }).valid, false);

    const tempTokenSameSecret = signTempTwoFactorToken(userId, {
      nowMs,
      secret: "mesmo-segredo-para-testar-claim-type-distinto-32chars",
    });
    assert.deepEqual(
      verifyAccessToken(tempTokenSameSecret, {
        nowMs,
        secret: "mesmo-segredo-para-testar-claim-type-distinto-32chars",
      }),
      { valid: false, reason: "INVALID_TYPE" },
    );
  });

  await t.test("generateOpaqueRefreshToken gera token de alta entropia e hash SHA-256 determinístico", () => {
    const t1 = generateOpaqueRefreshToken();
    const t2 = generateOpaqueRefreshToken();
    assert.notEqual(t1.rawToken, t2.rawToken);
    assert.notEqual(t1.tokenHash, t2.tokenHash);
    assert.equal(t1.tokenHash.length, 64);
    assert.equal(hashRefreshToken(t1.rawToken), t1.tokenHash);
  });

  await t.test("LoginRateLimiterService bloqueia excesso de falhas e limpa após sucesso", () => {
    const limiter = new LoginRateLimiterService();
    const email = "ataque@exemplo.com";
    const ip = "192.0.2.10";
    const now = 1_700_000_000_000;

    for (let i = 0; i < 5; i++) {
      limiter.checkAllowed(email, ip, now + i * 1_000);
      limiter.recordFailure(email, ip, now + i * 1_000);
    }

    assert.throws(
      () => limiter.checkAllowed(email, ip, now + 6_000),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 429 &&
        err.problem.code === "TOO_MANY_LOGIN_ATTEMPTS",
    );

    limiter.reset(email, ip);
    assert.doesNotThrow(() => limiter.checkAllowed(email, ip, now + 7_000));
  });

  await t.test("loginSchema e refreshSchema rejeitam entradas malformadas", () => {
    assert.throws(() => validateDto(loginSchema, { email: "bad", password: "" }));
    assert.throws(() => validateDto(refreshSchema, { refreshToken: "curto" }));
  });
});
