import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { TotpActivationService } from "../../src/auth/totp-activation.service";
import { encryptTotpSecret, readTotpKeys, totpCode } from "../../src/auth/totp-activation.crypto";
import { signTempTwoFactorToken } from "../../src/auth/token.util";

process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
process.env.TOTP_RECOVERY_HMAC_KEY = Buffer.alloc(32, 22).toString("base64");
const keys = readTotpKeys(process.env);
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const isCode = (code: string) => (error: unknown) => error instanceof ProblemException && error.problem.code === code;

function fixture(options: { fail?: string; count?: number; role?: boolean; verified?: boolean; credential?: boolean; expired?: boolean } = {}) {
  const id = randomUUID();
  const authorization = randomUUID();
  const now = Date.now();
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let released = false;
  const query = async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (options.fail && text.startsWith(options.fail)) throw new Error("PRIVATE_DATABASE_SECRET");
    let rows: unknown[] = [];
    if (text.includes("FROM users")) rows = [{ id, email: "bootstrap@example.test", active: true, verified: true }];
    else if (text.includes("FROM user_roles r")) rows = options.role === false ? [] : [{ id: randomUUID() }];
    else if (text.includes("FROM user_totp_credentials")) rows = options.credential === false ? [] : [{ id: randomUUID(), is_verified: options.verified ?? false, secret_encrypted: encryptTotpSecret(secret, keys.encryption, id, authorization) }];
    else if (text.includes("FROM totp_activation_tokens")) rows = [{ id: authorization, expires_at: new Date(now + (options.expired ? -1 : 1800_000)) }];
    else if (text.includes("SELECT clock_timestamp()")) rows = [{ now: new Date(now) }];
    else if (text.includes("count(*)")) rows = [{ count: options.count ?? 0 }];
    else if (text.startsWith("INSERT INTO totp_activation_tokens")) rows = [{ expires_at: new Date(now + 1800_000) }];
    return { rows, rowCount: /^(INSERT|UPDATE|DELETE)/.test(text) ? 1 : rows.length };
  };
  const pool = { connect: async () => ({ query, release: () => { released = true; } }) } as unknown as Pool;
  return { service: new TotpActivationService(pool), calls, released: () => released,
    input: { tempToken: signTempTwoFactorToken(id, { nowMs: now }), activationToken: "a".repeat(43), code: totpCode(secret, now) } };
}

test("B2 confirmação grava credencial, autorização, dez hashes e auditoria antes do COMMIT", async () => {
  const f = fixture();
  const response = await f.service.confirm(f.input);
  assert.equal(response.activated, true);
  assert.equal(response.recoveryCodes.length, 10);
  assert.equal(f.calls.filter(call => call.text.startsWith("INSERT INTO user_backup_codes")).length, 10);
  assert.ok(f.calls.some(call => call.text.startsWith("UPDATE user_totp_credentials")));
  assert.ok(f.calls.some(call => call.text.startsWith("UPDATE totp_activation_tokens")));
  assert.ok(f.calls.some(call => call.values.includes("totp_initial_activated")));
  assert.equal(f.calls.at(-1)?.text, "COMMIT");
  assert.ok(!f.calls.some(call => /sessions|refresh_tokens/.test(call.text)));
  const stored = JSON.stringify(f.calls);
  for (const raw of response.recoveryCodes) assert.equal(stored.includes(raw), false);
  assert.equal(stored.includes(secret), false);
  assert.equal(f.released(), true);
});

test("B2 tentativa inválida persiste auditoria e COMMIT antes do erro", async () => {
  const f = fixture();
  await assert.rejects(f.service.confirm({ ...f.input, code: "invalid" }), isCode("TOTP_CODE_INVALID"));
  assert.ok(f.calls.some(call => call.values.includes("totp_initial_code_rejected")));
  assert.equal(f.calls.at(-1)?.text, "COMMIT");
  assert.ok(!f.calls.some(call => call.text.startsWith("UPDATE")));
});

for (const phase of ["UPDATE user_totp_credentials", "UPDATE totp_activation_tokens", "INSERT INTO user_backup_codes", "INSERT INTO audit_logs", "COMMIT"]) {
  test(`B2 falha em ${phase}: rollback, erro seguro e liberação`, async () => {
    const f = fixture({ fail: phase });
    await assert.rejects(f.service.confirm(f.input), error => isCode("INTERNAL_SERVER_ERROR")(error) && !JSON.stringify(error).includes("PRIVATE_DATABASE_SECRET"));
    assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
    assert.equal(f.released(), true);
  });
}

for (const [options, code] of [
  [{ count: 5 }, "TOTP_ACTIVATION_RATE_LIMITED"], [{ role: false }, "TOTP_ACTIVATION_FORBIDDEN"],
  [{ verified: true }, "TOTP_ALREADY_ACTIVATED"], [{ credential: false }, "TOTP_SETUP_REQUIRED"],
  [{ expired: true }, "TOTP_AUTHORIZATION_INVALID"],
] as const) {
  test(`B2 rejeição ${code} não gera códigos`, async () => {
    const f = fixture(options);
    await assert.rejects(f.service.confirm(f.input), isCode(code));
    assert.ok(!f.calls.some(call => call.text.startsWith("INSERT INTO user_backup_codes")));
  });
}

test("B2 emissão CLI revoga autorizações anteriores, remove apenas pendência e audita sem token", async () => {
  const f = fixture();
  const response = await f.service.issue("bootstrap@example.test");
  assert.match(response.activationToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(f.calls.some(call => call.text.includes("SET revoked_at=clock_timestamp()")));
  assert.ok(f.calls.some(call => call.text.includes("DELETE FROM user_totp_credentials") && call.text.includes("is_verified=false")));
  assert.equal(JSON.stringify(f.calls).includes(response.activationToken), false);
});
