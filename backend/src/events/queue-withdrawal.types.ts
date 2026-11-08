export interface WithdrawExperienceQueueInput {
  /** Identidade e UUIDs fornecidos por chamador confiável; não substitui autenticação HTTP. */
  userId: string;
  participationId: string;
  /** Tentativa explícita: nunca interpretar retry como saída da entrada mais recente. */
  queueEntryId: string;
  idempotencyKey: string;
  /** Política de expiração explícita do chamador, como na E03. */
  expiresAt: Date;
}

export interface WithdrawnExperienceQueue {
  participationId: string;
  queueEntryId: string;
  experienceId: string;
  status: "closed";
  closedAt: Date;
  serviceSession: { id: string; status: "canceled"; resolvedAt: Date } | null;
}

export type QueueWithdrawalBlock =
  | { kind: "access_denied" }
  | { kind: "participation_not_active" }
  | { kind: "entry_not_current" }
  | { kind: "event_ended" };

export type WithdrawExperienceQueueResult =
  | ({ kind: "withdrawn" | "replay" } & WithdrawnExperienceQueue)
  | QueueWithdrawalBlock
  | { kind: "request_conflict" }
  | { kind: "in_progress" };
