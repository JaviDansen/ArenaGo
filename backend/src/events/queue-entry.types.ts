import type { EventAvailabilityMissingCode } from "./event-availability";

export interface JoinExperienceQueueInput {
  /** UUIDs internos; autenticação e validação sintática pertencem ao chamador confiável. */
  userId: string;
  participationId: string;
  experienceId: string;
  idempotencyKey: string;
  /** Política explícita do chamador, como na E03; não define um TTL de produto. */
  expiresAt: Date;
}

export interface JoinedExperienceQueueEntry {
  queueEntryId: string;
  participationId: string;
  experienceId: string;
  status: "waiting";
  /** Decimal exato de bigint, nunca posição dinâmica nem number JavaScript. */
  queueOrder: string;
  enteredAt: Date;
}

export type QueueEntryBlock =
  | { kind: "access_denied" }
  | { kind: "participation_not_active" }
  | { kind: "queue_occupied" }
  | { kind: "queue_closed" }
  | { kind: "experience_unavailable" }
  | { kind: "event_closed"; missing: EventAvailabilityMissingCode[] }
  | { kind: "event_unavailable"; missing: EventAvailabilityMissingCode[] };

export type JoinExperienceQueueResult =
  | ({ kind: "created" | "replay" } & JoinedExperienceQueueEntry)
  | QueueEntryBlock
  | { kind: "request_conflict" }
  | { kind: "in_progress" };
