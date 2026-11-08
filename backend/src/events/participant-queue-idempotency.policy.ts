import { Injectable } from "@nestjs/common";
import { parseOperationIdempotencyTtl } from "../common/http/idempotency-ttl";

@Injectable()
export class ParticipantQueueIdempotencyPolicy {
  private readonly ttlMs = parseOperationIdempotencyTtl(
    process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS, "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS",
  );

  expiresAt(): Date {
    const result = new Date(Date.now() + this.ttlMs);
    if (!Number.isFinite(result.getTime())) throw new Error("Expiração de idempotência fora do intervalo de Date.");
    return result;
  }
}
