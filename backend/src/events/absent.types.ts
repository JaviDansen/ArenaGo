/** Ator do contexto confiável do chamador, com autorização revalidada no banco. */
export interface AbsentServiceInput {
  staffUserId: string;
  eventId: string;
  serviceSessionId: string;
  idempotencyKey: string;
  /** Expiração explícita, sem definir uma política nova de retenção. */
  expiresAt: Date;
}

export type RegisteredAbsence = {
  serviceSession: { id: string; status: "absent"; resolvedAt: Date };
  previousQueueEntry: { id: string; status: "closed"; closeReason: "absent" };
} & (
  | { requeued: false; newQueueEntry: null }
  | { requeued: true; newQueueEntry: { id: string; status: "waiting"; queueOrder: string; position: number } }
);

export type AbsentServiceBlock = { kind:
  | "staff_event_forbidden"
  | "service_not_found"
  | "service_not_pending"
  | "event_operation_ended"
};

export type AbsentServiceResult =
  | ({ kind: "absent" | "replay" } & RegisteredAbsence)
  | AbsentServiceBlock
  | { kind: "request_conflict" | "in_progress" };
