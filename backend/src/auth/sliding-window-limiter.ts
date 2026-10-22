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

interface WindowEntry {
  hits: number[];
  blockedUntilMs: number | null;
}

export class SlidingWindowLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(private readonly policy: SlidingWindowPolicy) {}

  /** Segundos restantes de bloqueio para a chave (0 quando liberada). */
  retryAfterSeconds(key: string, nowMs = Date.now()): number {
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
