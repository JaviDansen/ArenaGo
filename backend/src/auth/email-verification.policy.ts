import { Injectable } from "@nestjs/common";

export interface EmailVerificationLimits {
  readonly ttlSeconds: number;
  readonly cooldownSeconds: number;
  readonly maxPerHour: number;
}

/** Limite técnico do inteiro SQL; erros nunca reproduzem o valor recebido. */
export function parseEmailVerificationLimits(env: Record<string, string | undefined>): EmailVerificationLimits {
  function positive(name: string, fallback: number): number {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`${name} deve ser um inteiro positivo de até 2147483647.`);
    }
    return value;
  }
  return Object.freeze({
    ttlSeconds: positive("EMAIL_VERIFICATION_TTL_SECONDS", 86_400),
    cooldownSeconds: positive("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", 120),
    maxPerHour: positive("EMAIL_VERIFICATION_MAX_PER_HOUR", 5),
  });
}

@Injectable()
export class EmailVerificationPolicy {
  readonly limits = parseEmailVerificationLimits(process.env);
}
