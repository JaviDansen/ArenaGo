import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EmailVerificationService } from "../../src/auth/email-verification.service";
import { EMAIL_DELIVERY, ResendEmailVerificationMailer, readEmailVerificationConfig, resendFetchTransport, type ResendRequest } from "../../src/auth/email-verification-mailer";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";

const token = "a".repeat(43);
const config = () => readEmailVerificationConfig({ RESEND_API_KEY: "fake-key-for-tests", RESEND_FROM: "onboarding@resend.dev",
  RESEND_TEST_RECIPIENT: "aluno@example.test", EMAIL_VERIFICATION_CONFIRMATION_URL: "https://example.test/confirm" });

test("T6.1-A2 Resend usa transporte simulado, conteúdo PT e chave idempotente sem registrar token", async () => {
  const calls: Array<{ apiKey: string; payload: ResendRequest; key: string }> = [];
  const mailer = new ResendEmailVerificationMailer(async (apiKey, payload, key) => { calls.push({ apiKey, payload, key }); }, config());
  assert.equal(mailer.isAvailable(), true);
  await mailer.sendVerification("aluno@example.test", token);
  await mailer.sendVerification("aluno@example.test", token);
  assert.equal(calls[0].apiKey, "fake-key-for-tests");
  assert.deepEqual(calls[0].payload.to, ["aluno@example.test"]);
  assert.match(calls[0].payload.text, /24 horas/);
  assert.match(calls[0].payload.html, /confirmar seu e-mail/);
  assert.match(calls[0].payload.html, new RegExp(token));
  assert.equal(calls[0].key.length, 64);
  assert.ok(!calls[0].key.includes(token));
  assert.equal(calls[1].key, calls[0].key);
  await assert.rejects(new ResendEmailVerificationMailer(async () => {}, config()).sendVerification("outra@example.test", token));
});

test("T6.1-A2 configuração incompleta/inválida não habilita transporte", () => {
  assert.throws(() => readEmailVerificationConfig({ RESEND_API_KEY: "", RESEND_FROM: "onboarding@resend.dev",
    RESEND_TEST_RECIPIENT: "aluno@example.test", EMAIL_VERIFICATION_CONFIRMATION_URL: "https://example.test/confirm" }));
  assert.throws(() => readEmailVerificationConfig({ RESEND_API_KEY: "re_test", RESEND_FROM: "onboarding@resend.dev",
    EMAIL_VERIFICATION_CONFIRMATION_URL: "https://example.test/confirm" }));
  assert.throws(() => readEmailVerificationConfig({ RESEND_API_KEY: "re_test", RESEND_FROM: "sender@example.test",
    EMAIL_VERIFICATION_CONFIRMATION_URL: "http://example.test/confirm" }));
  assert.throws(() => readEmailVerificationConfig({ RESEND_API_KEY: "re_test", RESEND_FROM: "sender@example.test",
    EMAIL_VERIFICATION_CONFIRMATION_URL: "https://example.test/confirm?token=unsafe" }));
});

test("T6.1-A2 falha de envio não afirma entrega nem imprime detalhes do provedor", async () => {
  const verification = { issue: async () => ({ kind: "issued" as const, token, email: "aluno@example.test", expiresAt: "later" }),
    confirm: async () => ({ kind: "invalid_token" as const }) };
  const delivery = { isAvailable: () => true, sendVerification: async () => { throw new Error(`secret ${token}`); } };
  const http = new EmailVerificationHttpService(verification as never, delivery);
  await assert.rejects(http.request("user-id"), error => {
    const problem = (error as { problem?: { code?: string; status?: number } }).problem;
    assert.equal(problem?.code, "EMAIL_DELIVERY_UNAVAILABLE");
    assert.equal(problem?.status, 503);
    assert.ok(!JSON.stringify(problem).includes(token));
    return true;
  });
});

test("T6.1-A2 sem configuração não emite token; confirmação não concede sessão", async () => {
  let issued = false;
  const verification = { issue: async () => { issued = true; return { kind: "issued" as const, token, email: "x@y.test", expiresAt: "later" }; },
    confirm: async () => ({ kind: "verified" as const }) };
  const http = new EmailVerificationHttpService(verification as never, { isAvailable: () => false, sendVerification: async () => {} });
  await assert.rejects(http.request("user-id"), error => {
    const problem = (error as { problem?: { code?: string; status?: number } }).problem;
    assert.equal(problem?.code, "EMAIL_DELIVERY_UNAVAILABLE");
    assert.equal(problem?.status, 503);
    return true;
  });
  assert.equal(issued, false);
  assert.deepEqual(await http.confirm(token), { verified: true });
});

test("T6.1-A2 módulo Nest resolve EmailVerificationHttpService e suas duas dependências", async () => {
  let issueUserId = "";
  let deliveryCount = 0;
  @Module({ providers: [
    { provide: EmailVerificationService, useValue: {
      issue: async (userId: string) => { issueUserId = userId; return { kind: "issued", token, email: "aluno@example.test", expiresAt: "later" }; },
      confirm: async () => ({ kind: "verified" }),
    } },
    { provide: EMAIL_DELIVERY, useValue: { isAvailable: () => true, sendVerification: async () => { deliveryCount++; } } },
    EmailVerificationHttpService,
  ] })
  class DiTestModule {}
  const app = await NestFactory.createApplicationContext(DiTestModule, { logger: false });
  try {
    const service = app.get(EmailVerificationHttpService);
    assert.ok(service instanceof EmailVerificationHttpService);
    assert.deepEqual(await service.request("user-from-session"), {
      message: "Se a conta puder receber uma confirmação, enviaremos as instruções por e-mail.",
    });
    assert.equal(issueUserId, "user-from-session");
    assert.equal(deliveryCount, 1);
    assert.deepEqual(await service.confirm(token), { verified: true });
  } finally { await app.close(); }
});

test("T6.1-A2 already_verified, cooldown e rate_limited retornam a mesma resposta sem envio", async () => {
  const generic = { message: "Se a conta puder receber uma confirmação, enviaremos as instruções por e-mail." };
  for (const kind of ["already_verified", "cooldown", "rate_limited"] as const) {
    let deliveryCount = 0;
    const verification = { issue: async () => ({ kind }), confirm: async () => ({ kind: "invalid_token" as const }) };
    const delivery = { isAvailable: () => true, sendVerification: async () => { deliveryCount++; } };
    const http = new EmailVerificationHttpService(verification as never, delivery);
    assert.deepEqual(await http.request("user-id"), generic);
    assert.equal(deliveryCount, 0);
  }
});

test("T6.1-A2 transporte HTTP trata não 2xx e resposta sem ID e envia Idempotency-Key", async t => {
  let status = 429;
  let body = JSON.stringify({ error: `${token}-sensitive` });
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requestInit = init;
    return new Response(body, { status });
  });
  await assert.rejects(resendFetchTransport("fake-key-for-tests", { from: "x@y.test", to: ["a@b.test"], subject: "x", text: "x", html: "x" }, "stable-idempotency-key"), /Resend recusou/);
  assert.equal(new Headers(requestInit?.headers).get("Idempotency-Key"), "stable-idempotency-key");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer fake-key-for-tests");
  status = 200;
  body = JSON.stringify({ message: "accepted without id" });
  await assert.rejects(resendFetchTransport("fake-key-for-tests", { from: "x@y.test", to: ["a@b.test"], subject: "x", text: "x", html: "x" }, "stable-idempotency-key"), /não confirmou/);
  body = JSON.stringify({ id: "simulated-email-id" });
  await assert.doesNotReject(resendFetchTransport("fake-key-for-tests", { from: "x@y.test", to: ["a@b.test"], subject: "x", text: "x", html: "x" }, "stable-idempotency-key"));
});

test("T6.1-A2 timeout e falha de rede viram 503 sem expor chave, token ou erro do transporte", async t => {
  let transportError: Error = new DOMException(`timeout ${token} fake-key-for-tests`, "TimeoutError");
  t.mock.method(globalThis, "fetch", async () => { throw transportError; });
  const verification = { issue: async () => ({ kind: "issued" as const, token, email: "aluno@example.test", expiresAt: "later" }),
    confirm: async () => ({ kind: "invalid_token" as const }) };
  const delivery = new ResendEmailVerificationMailer(resendFetchTransport, config());
  const http = new EmailVerificationHttpService(verification as never, delivery);
  for (const failure of [new DOMException(`timeout ${token} fake-key-for-tests`, "TimeoutError"), new TypeError(`network ${token} fake-key-for-tests`)]) {
    transportError = failure;
    await assert.rejects(http.request("user-id"), error => {
      const problem = (error as { problem?: { code?: string; status?: number; detail?: string } }).problem;
      assert.equal(problem?.code, "EMAIL_DELIVERY_UNAVAILABLE");
      assert.equal(problem?.status, 503);
      assert.ok(!JSON.stringify(problem).includes(token));
      assert.ok(!JSON.stringify(problem).includes("fake-key-for-tests"));
      assert.ok(!JSON.stringify(problem).includes(failure.message));
      return true;
    });
  }
});
