import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { TotpActivationController } from "../../src/auth/totp-activation.controller";
import { TotpActivationService } from "../../src/auth/totp-activation.service";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";

let failure: ProblemException | undefined;
let calls = 0;
const handler = (result: unknown) => { calls++; if (failure) throw failure; return result; };
@Module({ controllers: [TotpActivationController], providers: [
  { provide: TotpActivationService, useValue: {
    setup: () => handler({ secret: "test-only-secret", otpauthUri: "otpauth://totp/test" }),
    confirm: () => handler({ activated: true, recoveryCodes: ["test-only-recovery"] }),
  } },
  { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
] })
class ActivationHttpTestModule {}
let app: INestApplication;
const input = { tempToken: "temporary-challenge", activationToken: "a".repeat(43) };

before(async () => {
  app = await NestFactory.create(ActivationHttpTestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
});
after(async () => { if (app) await app.close(); });

for (const path of ["setup", "confirm"]) {
  test(`B2 HTTP ${path}: resposta sem cache e sem tokens de sessão`, async () => {
    const response = await supertest(app.getHttpServer()).post(`/api/v1/auth/2fa/${path}`)
      .send({ ...input, ...(path === "confirm" ? { code: "123456" } : {}) });
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal("accessToken" in response.body, false);
    assert.equal("refreshToken" in response.body, false);
    assert.equal("admin_2fa_verified_at" in response.body, false);
  });
}

for (const body of [{}, { ...input, userId: "other" }, { ...input, activationToken: "bad" }, { ...input, tempToken: "" }]) {
  test(`B2 HTTP rejeita DTO inválido ${JSON.stringify(Object.keys(body))}`, async () => {
    const previous = calls;
    const response = await supertest(app.getHttpServer()).post("/api/v1/auth/2fa/setup").send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.equal(calls, previous);
  });
}

test("B2 HTTP Bearer sozinho não substitui as duas provas no corpo", async () => {
  const response = await supertest(app.getHttpServer()).post("/api/v1/auth/2fa/setup").set("Authorization", "Bearer temporary-challenge").send({});
  assert.equal(response.status, 400);
});

for (const [status, code] of [[401, "TOTP_CHALLENGE_INVALID"], [403, "TOTP_AUTHORIZATION_INVALID"],
  [409, "TOTP_ALREADY_ACTIVATED"], [429, "TOTP_ACTIVATION_RATE_LIMITED"], [503, "TOTP_CONFIGURATION_UNAVAILABLE"], [500, "INTERNAL_SERVER_ERROR"]] as const) {
  test(`B2 HTTP preserva problema ${status}/${code} sem resposta sensível`, async () => {
    failure = new ProblemException({ status, code, title: "Ativação TOTP", detail: "Operação recusada.", typeSlug: "totp-activation",
      ...(status === 429 ? { headers: { "Retry-After": "900" } } : {}),
    });
    try {
      const response = await supertest(app.getHttpServer()).post("/api/v1/auth/2fa/confirm").send({ ...input, code: "123456" });
      assert.equal(response.status, status);
      assert.equal(response.body.code, code);
      assert.match(response.headers["content-type"], /application\/problem\+json/);
      if (status === 429) assert.equal(response.headers["retry-after"], "900");
      for (const name of ["secret", "recoveryCodes", "activationToken", "tempToken"]) assert.equal(name in response.body, false);
    } finally { failure = undefined; }
  });
}

test("B2 HTTP não expõe emissão de autorização ou login TOTP definitivo", async () => {
  for (const path of ["issue", "activate-token", "login", "reset"]) {
    assert.equal((await supertest(app.getHttpServer()).post(`/api/v1/auth/2fa/${path}`).send(input)).status, 404);
  }
});
