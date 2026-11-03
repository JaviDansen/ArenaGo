import { Injectable } from "@nestjs/common";

/** Configuração técnica explícita; não implementa retenção ou expurgo. */
export function parseStaffIdempotencyTtl(raw: string | undefined): number {
  const value = raw?.trim();
  const seconds = Number(value);
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(seconds) || seconds <= 0
    || !Number.isSafeInteger(seconds * 1000) || !Number.isFinite(new Date(Date.now() + seconds * 1000).getTime())) {
    throw new Error("STAFF_IDEMPOTENCY_TTL_SECONDS é obrigatório e deve conter um inteiro positivo compatível com Date.");
  }
  return seconds * 1000;
}

@Injectable()
export class StaffIdempotencyPolicy {
  private readonly ttlMs = parseStaffIdempotencyTtl(process.env.STAFF_IDEMPOTENCY_TTL_SECONDS);

  expiresAt(): Date {
    const result = new Date(Date.now() + this.ttlMs);
    if (!Number.isFinite(result.getTime())) throw new Error("Expiração de idempotência fora do intervalo de Date.");
    return result;
  }
}
