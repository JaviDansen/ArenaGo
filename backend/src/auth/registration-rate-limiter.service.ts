import { Injectable } from "@nestjs/common";
import { buildRateLimitProblem, SlidingWindowLimiter, SlidingWindowPolicy } from "./sliding-window-limiter";

/** Tentativas de cadastro por endereço IP do cliente (já resolvido pelo Express). */
export const REGISTRATION_PER_IP_POLICY: SlidingWindowPolicy = {
  windowMs: 15 * 60 * 1_000,
  maxHits: 10,
  blockMs: 15 * 60 * 1_000,
};

/** Tentativas de cadastro para o mesmo e-mail normalizado, de qualquer origem. */
export const REGISTRATION_PER_EMAIL_POLICY: SlidingWindowPolicy = {
  windowMs: 15 * 60 * 1_000,
  maxHits: 5,
  blockMs: 15 * 60 * 1_000,
};

const UNKNOWN_IP_KEY = "unknown-ip";

/**
 * Limita requisições de cadastro. Toda tentativa conta (sucesso, e-mail duplicado
 * ou senha rejeitada), de modo que o resultado do limite não depende da existência
 * da conta e não pode ser usado para enumeração. Deve ser consultado ANTES de
 * qualquer custo de Argon2.
 */
@Injectable()
export class RegistrationRateLimiterService {
  private readonly perIp = new SlidingWindowLimiter(REGISTRATION_PER_IP_POLICY);
  private readonly perEmail = new SlidingWindowLimiter(REGISTRATION_PER_EMAIL_POLICY);

  consume(normalizedEmail: string, ipAddress?: string | null, nowMs = Date.now()): void {
    const ipKey = ipAddress ?? UNKNOWN_IP_KEY;
    const retryAfterSeconds = Math.max(
      this.perIp.retryAfterSeconds(ipKey, nowMs),
      this.perEmail.retryAfterSeconds(normalizedEmail, nowMs),
    );

    if (retryAfterSeconds > 0) {
      throw buildRateLimitProblem({
        typeSlug: "too-many-registration-attempts",
        title: "Muitas tentativas de cadastro",
        code: "TOO_MANY_REGISTRATION_ATTEMPTS",
        detail: "Muitas tentativas de cadastro em sequência. Aguarde antes de tentar novamente.",
        retryAfterSeconds,
      });
    }

    this.perIp.hit(ipKey, nowMs);
    this.perEmail.hit(normalizedEmail, nowMs);
  }

  clearAll(): void {
    this.perIp.clear();
    this.perEmail.clear();
  }
}
