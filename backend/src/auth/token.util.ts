import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { environment } from "../config/environment";

export const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutos
export const TEMP_2FA_TOKEN_TTL_SECONDS = 300; // 5 minutos
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1_000; // 30 dias absolutos

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  type: "access";
  iat: number;
  exp: number;
  jti: string;
}

export interface TempTwoFactorTokenClaims {
  sub: string;
  type: "2fa_challenge";
  iat: number;
  exp: number;
  jti: string;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecodeToString(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signHmacSha256(signingInput: string, secret: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

export function signAccessToken(
  payload: { userId: string; sessionId: string },
  options?: { nowMs?: number; ttlSeconds?: number; secret?: string },
): string {
  const nowSeconds = Math.floor((options?.nowMs ?? Date.now()) / 1_000);
  const ttl = options?.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const secret = options?.secret ?? environment.JWT_SECRET;

  const header = { alg: "HS256", typ: "JWT" };
  const claims: AccessTokenClaims = {
    sub: payload.userId,
    sid: payload.sessionId,
    type: "access",
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti: randomUUID(),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signHmacSha256(signingInput, secret);

  return `${signingInput}.${signature}`;
}

export function signTempTwoFactorToken(
  userId: string,
  options?: { nowMs?: number; ttlSeconds?: number; secret?: string },
): string {
  const nowSeconds = Math.floor((options?.nowMs ?? Date.now()) / 1_000);
  const ttl = options?.ttlSeconds ?? TEMP_2FA_TOKEN_TTL_SECONDS;
  const secret = options?.secret ?? environment.JWT_TEMP_SECRET;

  const header = { alg: "HS256", typ: "JWT" };
  const claims: TempTwoFactorTokenClaims = {
    sub: userId,
    type: "2fa_challenge",
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti: randomUUID(),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signHmacSha256(signingInput, secret);

  return `${signingInput}.${signature}`;
}

export type VerifyAccessTokenResult =
  | { valid: true; claims: AccessTokenClaims }
  | { valid: false; reason: "MALFORMED" | "INVALID_SIGNATURE" | "EXPIRED" | "INVALID_TYPE" };

export function verifyAccessToken(
  token: string,
  options?: { nowMs?: number; secret?: string },
): VerifyAccessTokenResult {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "MALFORMED" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "MALFORMED" };
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !providedSignature) {
    return { valid: false, reason: "MALFORMED" };
  }

  let headerRaw: unknown;
  let payloadRaw: unknown;
  try {
    headerRaw = JSON.parse(base64UrlDecodeToString(encodedHeader));
    payloadRaw = JSON.parse(base64UrlDecodeToString(encodedPayload));
  } catch {
    return { valid: false, reason: "MALFORMED" };
  }

  if (
    typeof headerRaw !== "object" ||
    headerRaw === null ||
    (headerRaw as { alg?: unknown }).alg !== "HS256" ||
    (headerRaw as { typ?: unknown }).typ !== "JWT"
  ) {
    return { valid: false, reason: "MALFORMED" };
  }

  const secret = options?.secret ?? environment.JWT_SECRET;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signHmacSha256(signingInput, secret);

  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  if (typeof payloadRaw !== "object" || payloadRaw === null) {
    return { valid: false, reason: "MALFORMED" };
  }

  const candidate = payloadRaw as Record<string, unknown>;
  if (candidate.type !== "access") {
    return { valid: false, reason: "INVALID_TYPE" };
  }

  if (
    typeof candidate.sub !== "string" ||
    !candidate.sub ||
    typeof candidate.sid !== "string" ||
    !candidate.sid ||
    typeof candidate.iat !== "number" ||
    typeof candidate.exp !== "number" ||
    typeof candidate.jti !== "string"
  ) {
    return { valid: false, reason: "MALFORMED" };
  }

  const nowSeconds = Math.floor((options?.nowMs ?? Date.now()) / 1_000);
  if (nowSeconds >= candidate.exp) {
    return { valid: false, reason: "EXPIRED" };
  }

  return {
    valid: true,
    claims: {
      sub: candidate.sub,
      sid: candidate.sid,
      type: "access",
      iat: candidate.iat,
      exp: candidate.exp,
      jti: candidate.jti,
    },
  };
}

export function generateOpaqueRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashRefreshToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
