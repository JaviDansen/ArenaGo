import { timingSafeEqual } from "node:crypto";
import { totpCode } from "./totp-activation.crypto";

/**
 * Resolve o contador TOTP aceito usando o relógio do banco informado pelo
 * chamador. Só retorna passos ainda não usados nesta credencial.
 */
export function matchingTotpCounter(
  secret: string,
  code: string,
  nowMs: number,
  lastAcceptedCounter: number | null,
): number | null {
  if (!/^[0-9]{6}$/.test(code) || !Number.isFinite(nowMs) || nowMs < 0) {
    return null;
  }
  if (lastAcceptedCounter !== null && (!Number.isSafeInteger(lastAcceptedCounter) || lastAcceptedCounter < 0)) {
    return null;
  }

  const currentCounter = Math.floor(nowMs / 30_000);
  let matchedCounter: number | null = null;
  for (const counter of [currentCounter - 1, currentCounter, currentCounter + 1]) {
    if (counter < 0 || (lastAcceptedCounter !== null && counter <= lastAcceptedCounter)) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, counter * 30_000), "ascii");
    const supplied = Buffer.from(code, "ascii");
    if (timingSafeEqual(supplied, expected)) {
      matchedCounter = matchedCounter === null ? counter : Math.max(matchedCounter, counter);
    }
  }
  return matchedCounter;
}

export function isRecoveryCodeFormat(code: string): boolean {
  return /^[a-f0-9]{32}$/.test(code);
}

/** Recovery code precisa da chave HMAC, sem depender da abertura do segredo AES. */
export function readRecoveryHmacKey(env: Record<string, string | undefined>): Buffer {
  const raw = env.TOTP_RECOVERY_HMAC_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new Error("Configuração de recovery indisponível.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("Configuração de recovery indisponível.");
  }
  const assertIndependent = (candidate: Buffer): void => {
    if (candidate.length === key.length && timingSafeEqual(candidate, key)) {
      throw new Error("Chave HMAC de recovery deve ser independente.");
    }
  };
  for (const jwt of [env.JWT_SECRET, env.JWT_TEMP_SECRET]) {
    if (!jwt) continue;
    assertIndependent(Buffer.from(jwt, "utf8"));
    assertIndependent(Buffer.from(jwt, "base64"));
  }
  const encryptionRaw = env.TOTP_ENCRYPTION_KEY;
  if (encryptionRaw && /^[A-Za-z0-9+/]{43}=$/.test(encryptionRaw)) {
    const encryption = Buffer.from(encryptionRaw, "base64");
    if (encryption.length === 32 && encryption.toString("base64") === encryptionRaw) {
      assertIndependent(encryption);
    }
  }
  return key;
}
