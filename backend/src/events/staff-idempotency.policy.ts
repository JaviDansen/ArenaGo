import { Injectable } from "@nestjs/common";
import { parseOperationIdempotencyTtl } from "../common/http/idempotency-ttl";

/** Configuração técnica explícita; não implementa retenção ou expurgo. */
export function parseStaffIdempotencyTtl(raw: string | undefined): number {
  return parseOperationIdempotencyTtl(raw, "STAFF_IDEMPOTENCY_TTL_SECONDS");
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
