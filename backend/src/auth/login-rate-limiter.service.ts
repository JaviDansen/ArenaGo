import { Injectable } from "@nestjs/common";
import { buildRateLimitProblem, SlidingWindowLimiter, SlidingWindowPolicy } from "./sliding-window-limiter";

const LOGIN_FAILURE_POLICY: SlidingWindowPolicy = {
  windowMs: 15 * 60 * 1_000, // 15 minutos
  maxHits: 5,
  blockMs: 15 * 60 * 1_000, // 15 minutos
};

/**
 * Limita falhas de login por conta e por par IP+conta. Apenas falhas contam;
 * um login bem-sucedido limpa os contadores.
 */
@Injectable()
export class LoginRateLimiterService {
  private readonly accountAttempts = new SlidingWindowLimiter(LOGIN_FAILURE_POLICY);
  private readonly ipAccountAttempts = new SlidingWindowLimiter(LOGIN_FAILURE_POLICY);

  checkAllowed(normalizedEmail: string, ipAddress?: string | null, nowMs = Date.now()): void {
    const accountRetry = this.accountAttempts.retryAfterSeconds(normalizedEmail, nowMs);
    const ipKey = ipAddress ? `${ipAddress}:${normalizedEmail}` : null;
    const ipRetry = ipKey ? this.ipAccountAttempts.retryAfterSeconds(ipKey, nowMs) : 0;

    const retryAfterSeconds = Math.max(accountRetry, ipRetry);
    if (retryAfterSeconds > 0) {
      throw buildRateLimitProblem({
        typeSlug: "too-many-login-attempts",
        title: "Muitas tentativas de login",
        code: "TOO_MANY_LOGIN_ATTEMPTS",
        detail: "Muitas tentativas malsucedidas de login. Aguarde antes de tentar novamente.",
        retryAfterSeconds,
      });
    }
  }

  recordFailure(normalizedEmail: string, ipAddress?: string | null, nowMs = Date.now()): void {
    this.accountAttempts.hit(normalizedEmail, nowMs);
    if (ipAddress) {
      this.ipAccountAttempts.hit(`${ipAddress}:${normalizedEmail}`, nowMs);
    }
  }

  reset(normalizedEmail: string, ipAddress?: string | null): void {
    this.accountAttempts.delete(normalizedEmail);
    if (ipAddress) {
      this.ipAccountAttempts.delete(`${ipAddress}:${normalizedEmail}`);
    }
  }

  clearAll(): void {
    this.accountAttempts.clear();
    this.ipAccountAttempts.clear();
  }
}
