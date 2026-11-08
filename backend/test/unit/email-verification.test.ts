import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { POSTGRES_POOL } from "../../src/database/database.module";
import { EmailVerificationPolicy, parseEmailVerificationLimits } from "../../src/auth/email-verification.policy";
import { EmailVerificationService, generateEmailVerificationToken, hashEmailVerificationToken, isEmailVerificationToken } from "../../src/auth/email-verification.service";

const userId = "00000000-0000-4000-8000-000000000001";
const at = "2026-11-05 12:00:00.123456+00";
type Options = { missing?: boolean; inactive?: boolean; verified?: boolean; cooldown?: boolean; limited?: boolean;
  unknown?: boolean; invalid?: boolean; fail?: string; zeroUpdate?: boolean; zeroInsert?: boolean };
function fixture(options: Options = {}, limits = parseEmailVerificationLimits({})) {
  const calls: { text: string; values: unknown[] }[] = [];
  let released = 0;
  const query = async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (options.fail && text.includes(options.fail)) throw new Error("SQL_FAILURE");
    let rows: unknown[] = [];
    if (text.startsWith("SELECT user_id")) rows = options.unknown ? [] : [{ userId }];
    else if (text.startsWith("SELECT email,")) rows = options.missing ? [] : [{ email: "person@example.test", active: !options.inactive, verified: !!options.verified }];
    else if (text.includes("AS cooldown")) rows = [{ at, cooldown: !!options.cooldown, limited: !!options.limited }];
    else if (text.startsWith("INSERT INTO")) rows = options.zeroInsert ? [] : [{ expiresAt: "2026-11-06 12:00:00.123456+00" }];
    else if (text.includes("RETURNING t.verified_at")) rows = options.invalid ? [] : [{ at }];
    else if (text.startsWith("UPDATE users")) rows = options.zeroUpdate ? [] : [{ id: userId }];
    return { rows, rowCount: rows.length };
  };
  const client = { query, release: () => { released++; } };
  const pool = { query, connect: async () => client } as unknown as Pool;
  const service = new EmailVerificationService(pool, { limits } as EmailVerificationPolicy);
  return { service, calls, released: () => released };
}

test("T6.1-A1 defaults e configuração central validada", () => {
  assert.deepEqual(parseEmailVerificationLimits({}), { ttlSeconds: 86400, cooldownSeconds: 120, maxPerHour: 5 });
  assert.deepEqual(parseEmailVerificationLimits({ EMAIL_VERIFICATION_TTL_SECONDS: "60", EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: "10", EMAIL_VERIFICATION_MAX_PER_HOUR: "2" }),
    { ttlSeconds: 60, cooldownSeconds: 10, maxPerHour: 2 });
  assert.ok(Object.isFrozen(parseEmailVerificationLimits({})));
});
for (const name of ["EMAIL_VERIFICATION_TTL_SECONDS", "EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", "EMAIL_VERIFICATION_MAX_PER_HOUR"]) {
  test(`T6.1-A1 rejeita configuração inválida: ${name}`, () => {
    for (const raw of ["", " ", "0", "-1", "1.2", "NaN", "Infinity", "1e2", "2147483648", "secret-value"]) {
      assert.throws(() => parseEmailVerificationLimits({ [name]: raw }), error => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith(name));
        assert.ok(!error.message.includes("secret-value"));
        return true;
      });
    }
  });
}
test("T6.1-A1 token canônico de 32 bytes e hash SHA256", () => {
  const tokens = new Set(Array.from({ length: 100 }, generateEmailVerificationToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) {
    assert.ok(isEmailVerificationToken(token));
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(hashEmailVerificationToken(token), createHash("sha256").update(token).digest("hex"));
    assert.match(hashEmailVerificationToken(token), /^[0-9a-f]{64}$/);
  }
});
test("T6.1-A1 primeira emissão persiste só hash e entrega token após COMMIT", async () => {
  const f = fixture(), result = await f.service.issue(userId);
  assert.equal(result.kind, "issued");
  if (result.kind !== "issued") throw Error("emissão esperada");
  const insert = f.calls.find(q => q.text.startsWith("INSERT INTO"))!;
  assert.equal(insert.values[3], hashEmailVerificationToken(result.token));
  assert.equal(insert.values[4], at);
  assert.equal(insert.values[5], 86400);
  assert.equal(result.email, "person@example.test");
  assert.equal(f.calls.at(-1)?.text, "COMMIT");
  assert.equal(f.released(), 1);
  assert.ok(!JSON.stringify(f.calls).includes(result.token));
  assert.ok(f.calls.some(q => q.text.includes("FROM users") && q.text.includes("FOR UPDATE")));
  assert.ok(f.calls.some(q => q.text.includes("ORDER BY id FOR UPDATE")));
  assert.ok(!f.calls.some(q => /sessions|user_roles|refresh_tokens|audit_logs|UPDATE users/.test(q.text)));
});
test("T6.1-A1 TTL customizado e limites são parâmetros internos SQL", async () => {
  const f = fixture({}, { ttlSeconds: 900, cooldownSeconds: 30, maxPerHour: 2 });
  await f.service.issue(userId);
  assert.deepEqual(f.calls.find(q => q.text.includes("AS cooldown"))?.values, [userId, 30, 2]);
  assert.equal(f.calls.find(q => q.text.startsWith("INSERT INTO"))?.values[5], 900);
});
for (const [label, options, expected] of [
  ["conta ausente", { missing: true }, "account_unavailable"],
  ["conta inativa", { inactive: true }, "account_unavailable"],
  ["conta verificada", { verified: true }, "already_verified"],
  ["reemissão antes de dois minutos", { cooldown: true }, "cooldown"],
  ["sexta emissão na hora", { limited: true }, "rate_limited"],
] as const) {
  test(`T6.1-A1 emissão recusa ${label} sem mutações`, async () => {
    const f = fixture(options);
    assert.deepEqual(await f.service.issue(userId), { kind: expected });
    assert.ok(!f.calls.some(q => /^(UPDATE|INSERT|DELETE)/.test(q.text)));
    assert.equal(f.released(), 1);
  });
}
test("T6.1-A1 UUID inválido não consulta banco", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.issue("invalid"), { kind: "account_unavailable" });
  assert.equal(f.calls.length, 0);
});
test("T6.1-A1 reemissão permitida invalida antes de inserir, preservando histórico", async () => {
  const f = fixture();
  assert.equal((await f.service.issue(userId)).kind, "issued");
  const invalidation = f.calls.findIndex(q => q.text.startsWith("UPDATE email_verification_tokens"));
  const insertion = f.calls.findIndex(q => q.text.startsWith("INSERT INTO"));
  assert.ok(invalidation > 0 && invalidation < insertion);
  assert.deepEqual(f.calls[invalidation].values, [userId, at]);
  assert.ok(!f.calls[invalidation].text.includes("SET verified_at"));
  assert.ok(!f.calls.some(q => /DELETE FROM/.test(q.text)));
});
test("T6.1-A1 janela móvel conta todas as emissões e permite quando saem da janela", async () => {
  const f = fixture();
  assert.equal((await f.service.issue(userId)).kind, "issued");
  const decision = f.calls.find(q => q.text.includes("AS cooldown"))!.text;
  assert.ok(decision.includes("clock_timestamp()"));
  assert.ok(decision.includes("interval '1 hour'"));
  assert.ok(!decision.includes("verified_at") && !decision.includes("expires_at"));
});
test("T6.1-A1 confirmação válida preserva microssegundos e não altera sessões/papéis", async () => {
  const f = fixture(), token = generateEmailVerificationToken();
  assert.deepEqual(await f.service.confirm(token), { kind: "verified" });
  assert.equal(f.calls[0].values[0], hashEmailVerificationToken(token));
  const consume = f.calls.find(q => q.text.includes("RETURNING t.verified_at"))!;
  for (const predicate of ["t.email=u.email", "u.is_active", "t.verified_at IS NULL", "t.expires_at>d.at", "u.email_verified_at IS NULL"]) assert.ok(consume.text.includes(predicate));
  assert.deepEqual(f.calls.find(q => q.text.startsWith("UPDATE users"))?.values, [userId, at]);
  assert.equal(f.calls.at(-1)?.text, "COMMIT");
  assert.ok(!JSON.stringify(f.calls).includes(token));
  assert.ok(!f.calls.some(q => /sessions|user_roles|refresh_tokens|audit_logs/.test(q.text)));
});
test("T6.1-A1 token malformado é recusado antes do banco", async () => {
  const f = fixture();
  for (const value of [null, undefined, 2, {}, "", "a".repeat(42), "a".repeat(44), "=".repeat(43), "A".repeat(42) + "B", " " + generateEmailVerificationToken()]) {
    assert.deepEqual(await f.service.confirm(value), { kind: "invalid_token" });
  }
  assert.equal(f.calls.length, 0);
});
test("T6.1-A1 token inexistente não abre transação", async () => {
  const f = fixture({ unknown: true });
  assert.deepEqual(await f.service.confirm(generateEmailVerificationToken()), { kind: "invalid_token" });
  assert.equal(f.calls.length, 1);
});
for (const options of [{ missing: true }, { inactive: true }, { verified: true }]) {
  test(`T6.1-A1 confirmação revalida conta ${JSON.stringify(options)} após lock`, async () => {
    const f = fixture(options);
    assert.deepEqual(await f.service.confirm(generateEmailVerificationToken()), { kind: "invalid_token" });
    assert.ok(!f.calls.some(q => /^(UPDATE|INSERT|DELETE)|RETURNING t.verified_at/.test(q.text)));
  });
}
test("T6.1-A1 token expirado/usado/substituído ou endereço antigo não verifica conta", async () => {
  const f = fixture({ invalid: true });
  assert.deepEqual(await f.service.confirm(generateEmailVerificationToken()), { kind: "invalid_token" });
  assert.ok(!f.calls.some(q => q.text.startsWith("UPDATE users")));
});
for (const phase of ["UPDATE email_verification_tokens", "INSERT INTO", "COMMIT"]) {
  test(`T6.1-A1 emissão falha em ${phase}: rollback e nenhum token retornado`, async () => {
    const f = fixture({ fail: phase });
    await assert.rejects(f.service.issue(userId), /SQL_FAILURE/);
    assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
    assert.equal(f.released(), 1);
  });
}
for (const phase of ["RETURNING t.verified_at", "UPDATE users", "UPDATE email_verification_tokens SET expires_at", "COMMIT"]) {
  test(`T6.1-A1 confirmação falha em ${phase}: rollback e release`, async () => {
    const f = fixture({ fail: phase });
    await assert.rejects(f.service.confirm(generateEmailVerificationToken()), /SQL_FAILURE/);
    assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
    assert.equal(f.released(), 1);
  });
}
test("T6.1-A1 contagens inesperadas causam rollback", async () => {
  const issuing = fixture({ zeroInsert: true }), confirming = fixture({ zeroUpdate: true });
  await assert.rejects(issuing.service.issue(userId), /não persistida/);
  await assert.rejects(confirming.service.confirm(generateEmailVerificationToken()), /não persistida/);
  assert.equal(issuing.calls.at(-1)?.text, "ROLLBACK");
  assert.equal(confirming.calls.at(-1)?.text, "ROLLBACK");
});
test("T6.1-A1 operações não escrevem logs", async t => {
  const logs: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  const f = fixture();
  await f.service.issue(userId);
  await f.service.confirm(generateEmailVerificationToken());
  await fixture({ invalid: true }).service.confirm(generateEmailVerificationToken());
  assert.deepEqual(logs, []);
});

test("T6.1-A1 Nest resolve banco e política por DI explícita sem conexão", async () => {
  @Module({ providers: [
    { provide: POSTGRES_POOL, useValue: { connect: () => { throw Error("Conexão indevida"); } } },
    EmailVerificationPolicy, EmailVerificationService,
  ] })
  class TestModule {}
  const app = await NestFactory.createApplicationContext(TestModule, { logger: false });
  try {
    assert.ok(app.get(EmailVerificationService) instanceof EmailVerificationService);
    assert.ok(app.get(EmailVerificationPolicy).limits.ttlSeconds > 0);
    assert.deepEqual(await app.get(EmailVerificationService).confirm("invalid"), { kind: "invalid_token" });
  } finally { await app.close(); }
});
