import { createHmac, timingSafeEqual } from "node:crypto";
import { environment } from "../config/environment";
import type { TempTwoFactorTokenClaims } from "./token.util";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Consome somente o desafio de senha emitido pelo login; nunca um Bearer de sessão. */
export function verifyTotpChallenge(token: string, nowMs: number, secret = environment.JWT_TEMP_SECRET): TempTwoFactorTokenClaims | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [headerPart, payloadPart, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    const candidate = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    if (!header || header.alg !== "HS256" || header.typ !== "JWT" || !candidate || candidate.type !== "2fa_challenge") return null;
    const now = Math.floor(nowMs / 1000);
    if (typeof candidate.sub !== "string" || !uuid.test(candidate.sub)
      || typeof candidate.jti !== "string" || !uuid.test(candidate.jti)
      || !Number.isSafeInteger(candidate.iat) || !Number.isSafeInteger(candidate.exp)
      || candidate.exp <= candidate.iat || candidate.exp - candidate.iat > 300
      || candidate.iat > now || now >= candidate.exp || "sid" in candidate) return null;
    return { sub: candidate.sub, jti: candidate.jti, type: "2fa_challenge", iat: candidate.iat, exp: candidate.exp };
  } catch { return null; }
}
