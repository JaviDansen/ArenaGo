/** Ator confiável do chamador interno; autorização Staff revalidada no banco. */
export interface CompleteServiceInput {
  staffUserId: string;
  eventId: string;
  serviceSessionId: string;
  idempotencyKey: string;
  /** Expiração explícita, sem definir política nova de retenção. */
  expiresAt: Date;
}

export interface CompletedService {
  serviceSession: { id: string; status: "completed"; resolvedAt: Date };
  queueEntry: { status: "closed"; closeReason: "completed" };
  participation: { status: "active"; currentQueueEntryId: null };
}

export type CompleteServiceBlock = { kind:
  | "staff_event_forbidden"
  | "service_not_found"
  | "service_not_pending"
  | "event_operation_ended"
};

export type CompleteServiceResult =
  | ({ kind: "completed" | "replay" } & CompletedService)
  | CompleteServiceBlock
  | { kind: "request_conflict" | "in_progress" };
