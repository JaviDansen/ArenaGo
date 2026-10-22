import { HttpStatus, Injectable } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";

interface AttemptWindow {
  failures: number[];
  blockedUntilMs: number | null;
}

const WINDOW_DURATION_MS = 15 * 60 * 1_000; // 15 minutos
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP_ACCOUNT = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1_000; // 15 minutos

@Injectable()
export class LoginRateLimiterService {
  private readonly accountAttempts = new Map<string, AttemptWindow>();
  private readonly ipAccountAttempts = new Map<string, AttemptWindow>();

  checkAllowed(normalizedEmail: string, ipAddress?: string | null, nowMs = Date.now()): void {
    const accountRetry = this.getRetrySeconds(this.accountAttempts, normalizedEmail, nowMs);
    const ipKey = ipAddress ? `${ipAddress}:${normalizedEmail}` : null;
    const ipRetry = ipKey ? this.getRetrySeconds(this.ipAccountAttempts, ipKey, nowMs) : 0;

    const retryAfterSeconds = Math.max(accountRetry, ipRetry);
    if (retryAfterSeconds > 0) {
      throw new ProblemException({
        typeSlug: "too-many-login-attempts",
        title: "Muitas tentativas de login",
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: "TOO_MANY_LOGIN_ATTEMPTS",
        detail: "Muitas tentativas malsucedidas de login. Aguarde antes de tentar novamente.",
        extensions: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
  }

  recordFailure(normalizedEmail: string, ipAddress?: string | null, nowMs = Date.now()): void {
    this.registerFailureInMap(
      this.accountAttempts,
      normalizedEmail,
      MAX_FAILURES_PER_ACCOUNT,
      nowMs,
    );
    if (ipAddress) {
      this.registerFailureInMap(
        this.ipAccountAttempts,
        `${ipAddress}:${normalizedEmail}`,
        MAX_FAILURES_PER_IP_ACCOUNT,
        nowMs,
      );
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

  private getRetrySeconds(
    store: Map<string, AttemptWindow>,
    key: string,
    nowMs: number,
  ): number {
    const entry = store.get(key);
    if (!entry) {
      return 0;
    }

    if (entry.blockedUntilMs !== null) {
      if (nowMs < entry.blockedUntilMs) {
        return Math.max(1, Math.ceil((entry.blockedUntilMs - nowMs) / 1_000));
      }
      store.delete(key);
      return 0;
    }

    entry.failures = entry.failures.filter((ts) => nowMs - ts < WINDOW_DURATION_MS);
    if (entry.failures.length === 0) {
      store.delete(key);
    }
    return 0;
  }

  private registerFailureInMap(
    store: Map<string, AttemptWindow>,
    key: string,
    maxFailures: number,
    nowMs: number,
  ): void {
    const existing = store.get(key) ?? { failures: [], blockedUntilMs: null };
    const recentFailures = existing.failures.filter((ts) => nowMs - ts < WINDOW_DURATION_MS);
    recentFailures.push(nowMs);

    const blockedUntilMs =
      recentFailures.length >= maxFailures ? nowMs + BLOCK_DURATION_MS : existing.blockedUntilMs;

    store.set(key, {
      failures: recentFailures,
      blockedUntilMs,
    });
  }
}
