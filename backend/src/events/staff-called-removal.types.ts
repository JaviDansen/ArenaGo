/** Ator confiável do chamador interno; autorização Staff revalidada no banco. */
export interface CalledRemovalServiceInput {
  staffUserId: string;
  eventId: string;
  serviceSessionId: string;
  idempotencyKey: string;
  /** Expiração explícita, sem definir política nova de retenção. */
  expiresAt: Date;
}

export interface RemovedCalledService {
  serviceSession: { id: string; status: "canceled"; cancelReason: "staff_queue_removed"; resolvedAt: Date };
  queueEntry: { status: "closed"; closeReason: "staff_queue_removed" };
  participation: { status: "active"; currentQueueEntryId: null };
}

export type CalledRemovalServiceBlock = { kind:
  | "staff_event_forbidden"
  | "service_not_found"
  | "service_not_pending"
  | "event_operation_ended"
};

export type CalledRemovalServiceResult =
  | ({ kind: "removed" | "replay" } & RemovedCalledService)
  | CalledRemovalServiceBlock
  | { kind: "request_conflict" | "in_progress" };
