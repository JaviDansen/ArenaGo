import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface TotpKeys { encryption: Buffer; recovery: Buffer }
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function readTotpKeys(env: Record<string, string | undefined>): TotpKeys {
  const read = (name: string): Buffer => {
    const raw = env[name];
    if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error("Configuração TOTP indisponível.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32 || key.toString("base64") !== raw) throw new Error("Configuração TOTP indisponível.");
    return key;
  };
  const encryption = read("TOTP_ENCRYPTION_KEY");
  const recovery = read("TOTP_RECOVERY_HMAC_KEY");
  if (timingSafeEqual(encryption, recovery)) throw new Error("Chaves TOTP devem ser independentes.");
  for (const jwt of [env.JWT_SECRET, env.JWT_TEMP_SECRET]) {
    if (!jwt) continue;
    for (const encoding of ["utf8", "base64"] as const) {
      const candidate = Buffer.from(jwt, encoding);
      if ([encryption, recovery].some(key => candidate.length === key.length && timingSafeEqual(candidate, key))) {
        throw new Error("Chaves TOTP devem ser independentes.");
      }
    }
  }
  return { encryption, recovery };
}

export function generateTotpSecret(): string {
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return encoded;
}

function decodeSecret(secret: string): Buffer {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error("Credencial TOTP inválida.");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** RFC 6238 / RFC 4226, SHA-1, 30 segundos, seis dígitos. */
export function totpCode(secret: string, nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("Relógio TOTP inválido.");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000)));
  const digest = createHmac("sha1", decodeSecret(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, nowMs: number): boolean {
  if (!/^[0-9]{6}$/.test(code)) return false;
  let matches = false;
  for (const offset of [-30_000, 0, 30_000]) {
    if (nowMs + offset < 0) continue;
    const equal = timingSafeEqual(Buffer.from(code), Buffer.from(totpCode(secret, nowMs + offset)));
    matches = equal || matches;
  }
  return matches;
}

export function encryptTotpSecret(secret: string, key: Buffer, userId: string, authorizationId: string): string {
  decodeSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`arenago:totp:v1:${userId}:${authorizationId}`));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptTotpSecret(envelope: string, key: Buffer, userId: string, authorizationId: string): string {
  if (!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(envelope)) {
    throw new Error("Credencial TOTP inválida.");
  }
  const [, iv, tag, ciphertext] = envelope.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`arenago:totp:v1:${userId}:${authorizationId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const secret = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  decodeSecret(secret);
  return secret;
}

export function totpUri(secret: string, email: string): string {
  const query = new URLSearchParams({ secret, issuer: "ArenaGo", algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(`ArenaGo:${email}`)}?${query}`;
}

export function hashActivationToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function recoveryCodeHash(raw: string, userId: string, key: Buffer): string {
  return createHmac("sha256", key).update(`arenago:recovery:v1:${userId}:${raw}`).digest("hex");
}

export function generateRecoveryCodes(userId: string, key: Buffer): Array<{ raw: string; hash: string }> {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(16).toString("hex");
    return { raw, hash: recoveryCodeHash(raw, userId, key) };
  });
}
