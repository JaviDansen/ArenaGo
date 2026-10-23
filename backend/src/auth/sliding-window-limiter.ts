import { HttpStatus } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";

/**
 * Núcleo reutilizável de limitação por janela deslizante, compartilhado pelos
 * limitadores de login e de cadastro.
 *
 * LIMITAÇÃO DOCUMENTADA: o estado fica em memória do processo Node.js. É adequado
 * ao monólito de instância única do desenvolvimento local (DA-01); com várias
 * réplicas, cada instância teria contadores próprios e o estado se perde ao
 * reiniciar. Um armazenamento compartilhado fica fora do escopo da K01.
 */
export interface SlidingWindowPolicy {
  windowMs: number;
  maxHits: number;
  blockMs: number;
}

const MAX_CLEANUP_INTERVAL_MS = 60_000;

interface WindowEntry {
  hits: number[];
  blockedUntilMs: number | null;
}

export class SlidingWindowLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private lastCleanupAtMs: number | null = null;

  constructor(private readonly policy: SlidingWindowPolicy) {}

  /** Segundos restantes de bloqueio para a chave (0 quando liberada). */
  retryAfterSeconds(key: string, nowMs = Date.now()): number {
    this.pruneExpiredEntriesIfDue(nowMs);

    const entry = this.entries.get(key);
    if (!entry) return 0;

    if (entry.blockedUntilMs !== null) {
      if (nowMs < entry.blockedUntilMs) {
        return Math.max(1, Math.ceil((entry.blockedUntilMs - nowMs) / 1_000));
      }
      this.entries.delete(key);
      return 0;
    }

    entry.hits = entry.hits.filter((ts) => nowMs - ts < this.policy.windowMs);
    if (entry.hits.length === 0) this.entries.delete(key);
    return 0;
  }

  /** Registra uma ocorrência e bloqueia a chave ao atingir o limite da janela. */
  hit(key: string, nowMs = Date.now()): void {
    this.pruneExpiredEntriesIfDue(nowMs);

    const existing = this.entries.get(key) ?? { hits: [], blockedUntilMs: null };
    const hits = existing.hits.filter((ts) => nowMs - ts < this.policy.windowMs);
    hits.push(nowMs);
    const blockedUntilMs =
      hits.length >= this.policy.maxHits ? nowMs + this.policy.blockMs : existing.blockedUntilMs;
    this.entries.set(key, { hits, blockedUntilMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * A limpeza oportunista descarta chaves abandonadas sem usar timers.
   * A varredura ocorre no máximo uma vez por minuto (ou por janela menor) e remove
   * apenas estado expirado, preservando os contadores e bloqueios ativos.
   */
  private pruneExpiredEntriesIfDue(nowMs: number): void {
    const cleanupIntervalMs = Math.min(this.policy.windowMs, MAX_CLEANUP_INTERVAL_MS);
    if (
      this.lastCleanupAtMs !== null &&
      nowMs - this.lastCleanupAtMs < cleanupIntervalMs
    ) {
      return;
    }

    this.lastCleanupAtMs = nowMs;
    for (const [key, entry] of this.entries) {
      if (entry.blockedUntilMs !== null) {
        if (nowMs >= entry.blockedUntilMs) {
          this.entries.delete(key);
        }
        continue;
      }

      const activeHits = entry.hits.filter(
        (hitAtMs) => nowMs - hitAtMs < this.policy.windowMs,
      );
      if (activeHits.length === 0) {
        this.entries.delete(key);
      } else if (activeHits.length !== entry.hits.length) {
        this.entries.set(key, { ...entry, hits: activeHits });
      }
    }
  }
}

export function buildRateLimitProblem(options: {
  typeSlug: string;
  title: string;
  code: string;
  detail: string;
  retryAfterSeconds: number;
}): ProblemException {
  return new ProblemException({
    typeSlug: options.typeSlug,
    title: options.title,
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: options.code,
    detail: options.detail,
    extensions: { retryAfterSeconds: options.retryAfterSeconds },
    headers: { "Retry-After": String(options.retryAfterSeconds) },
  });
}
