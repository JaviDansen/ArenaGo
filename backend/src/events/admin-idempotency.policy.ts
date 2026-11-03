import { Injectable } from "@nestjs/common";
import { parseOperationIdempotencyTtl } from "../common/http/idempotency-ttl";

/** Prazo técnico explícito; não apaga reservas nem invalida replay pelo vencimento. */
@Injectable()
export class AdminIdempotencyPolicy {
  private readonly ttlMs = parseOperationIdempotencyTtl(process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS, "ADMIN_IDEMPOTENCY_TTL_SECONDS");

  expiresAt(): Date {
    const result = new Date(Date.now() + this.ttlMs);
    if (!Number.isFinite(result.getTime())) throw new Error("Expiração administrativa fora do intervalo de Date.");
    return result;
  }
}
