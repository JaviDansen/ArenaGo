import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashActivationToken,
  readTotpKeys, recoveryCodeHash, totpCode, totpUri, verifyTotpCode } from "../../src/auth/totp-activation.crypto";
import { verifyTotpChallenge } from "../../src/auth/totp-challenge";
import { signAccessToken, signTempTwoFactorToken, verifyAccessToken } from "../../src/auth/token.util";

const fixtureKeys = { TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"), TOTP_RECOVERY_HMAC_KEY: Buffer.alloc(32, 22).toString("base64") };
const keys = readTotpKeys(fixtureKeys);
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC: 12345678901234567890

for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"],
  [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]] as const) {
  test(`B2 RFC 6238 SHA-1 em ${seconds}, redução para seis dígitos`, () => assert.equal(totpCode(secret, seconds * 1000), expected));
}

test("B2 aceita janela de um passo e rejeita código malformado e fora da janela", () => {
  const now = 1_700_000_000_000;
  for (const offset of [-30_000, 0, 30_000]) assert.equal(verifyTotpCode(secret, totpCode(secret, now + offset), now), true);
  assert.equal(verifyTotpCode(secret, totpCode(secret, now + 90_000), now), false);
  for (const bad of ["", "12345", "1234567", "abcdef", " 287082", "１２３４５６"]) assert.equal(verifyTotpCode(secret, bad, now), false);
});

test("B2 segredo aleatório e URI interoperável não confundem caracteres do e-mail", () => {
  const first = generateTotpSecret();
  assert.match(first, /^[A-Z2-7]{32}$/);
  assert.notEqual(first, generateTotpSecret());
  const uri = new URL(totpUri(first, "admin+teste@example.test"));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(decodeURIComponent(uri.pathname), "/ArenaGo:admin+teste@example.test");
  assert.equal(uri.searchParams.get("secret"), first);
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
});

test("B2 AES-GCM autentica segredo, conta e autorização, com nonce independente", () => {
  const encrypted = encryptTotpSecret(secret, keys.encryption, "u1", "a1");
  assert.equal(encrypted.includes(secret), false);
  assert.notEqual(encrypted, encryptTotpSecret(secret, keys.encryption, "u1", "a1"));
  assert.equal(decryptTotpSecret(encrypted, keys.encryption, "u1", "a1"), secret);
  assert.throws(() => decryptTotpSecret(encrypted, keys.encryption, "u2", "a1"));
  assert.throws(() => decryptTotpSecret(encrypted, keys.encryption, "u1", "a2"));
  assert.throws(() => decryptTotpSecret(encrypted, Buffer.alloc(32, 33), "u1", "a1"));
  const parts = encrypted.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.throws(() => decryptTotpSecret(parts.join("."), keys.encryption, "u1", "a1"));
  assert.throws(() => decryptTotpSecret(secret, keys.encryption, "u1", "a1"));
});

for (const [label, changes] of [
  ["ausente", { TOTP_ENCRYPTION_KEY: undefined }],
  ["curta", { TOTP_ENCRYPTION_KEY: "a" }],
  ["chaves iguais", { TOTP_RECOVERY_HMAC_KEY: fixtureKeys.TOTP_ENCRYPTION_KEY }],
  ["JWT reutilizado", { JWT_SECRET: fixtureKeys.TOTP_ENCRYPTION_KEY }],
  ["JWT temporário reutilizado", { JWT_TEMP_SECRET: Buffer.alloc(32, 22).toString("utf8") }],
] as const) {
  test(`B2 configuração insegura: ${label}`, () => assert.throws(() => readTotpKeys({ ...fixtureKeys, ...changes })));
}

test("B2 dez códigos de recuperação possuem 128 bits, hashes HMAC e vínculo à conta", () => {
  const codes = generateRecoveryCodes("user1", keys.recovery);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes.map(code => code.raw)).size, 10);
  for (const code of codes) {
    assert.match(code.raw, /^[a-f0-9]{32}$/);
    assert.match(code.hash, /^[a-f0-9]{64}$/);
    assert.equal(code.hash, recoveryCodeHash(code.raw, "user1", keys.recovery));
    assert.notEqual(code.hash, recoveryCodeHash(code.raw, "user2", keys.recovery));
    assert.notEqual(code.hash, hashActivationToken(code.raw));
  }
});

test("B2 desafio aceita somente JWT temporário recente e não autentica Bearer", () => {
  const id = randomUUID();
  const now = 1_700_000_000_000;
  const token = signTempTwoFactorToken(id, { nowMs: now });
  assert.equal(verifyTotpChallenge(token, now)?.sub, id);
  assert.equal(verifyTotpChallenge(token, now + 300_000), null);
  assert.equal(verifyTotpChallenge(token, now - 1000), null);
  assert.equal(verifyTotpChallenge(token.slice(0, -5) + "wrong", now), null);
  assert.equal(verifyTotpChallenge(signTempTwoFactorToken(id, { nowMs: now, ttlSeconds: 301 }), now), null);
  assert.equal(verifyTotpChallenge(signAccessToken({ userId: id, sessionId: randomUUID() }, { nowMs: now }), now), null);
  assert.equal(verifyAccessToken(token, { nowMs: now }).valid, false);
});

test("B2 rejeita claims, finalidade e algoritmo inválidos mesmo com assinatura válida", () => {
  const key = "test-only-temporary-signing-key-at-least-32";
  const now = 1_700_000_000;
  const base = { sub: randomUUID(), jti: randomUUID(), type: "2fa_challenge", iat: now, exp: now + 300 };
  for (const claims of [{ ...base, type: "access" }, { ...base, sid: randomUUID() }, { ...base, exp: now }, { ...base, sub: "invalid" }, { ...base, iat: 1.5 }]) {
    const input = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const token = `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
    assert.equal(verifyTotpChallenge(token, now * 1000, key), null);
  }
  const input = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(base)).toString("base64url")}`;
  assert.equal(verifyTotpChallenge(`${input}.${createHmac("sha256", key).update(input).digest("base64url")}`, now * 1000, key), null);
});
