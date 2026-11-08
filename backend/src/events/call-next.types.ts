/** Ator confiável fornecido pelo chamador interno; o serviço revalida Staff no banco. */
export interface CallNextInput {
  staffUserId: string;
  eventId: string;
  experienceId: string;
  stationId: string;
  idempotencyKey: string;
  /** Expiração explícita; não define uma política nova de retenção. */
  expiresAt: Date;
}

export interface CalledNext {
  serviceSession: {
    id: string;
    queueEntryId: string;
    experienceId: string;
    station: { id: string; label: string };
    status: "pending";
    calledAt: Date;
  };
}

export type CallNextBlock = { kind:
  | "staff_event_forbidden"
  | "station_unavailable"
  | "station_has_pending_call"
  | "queue_empty"
  | "event_operation_ended"
};

export type CallNextResult =
  | ({ kind: "created" | "replay" } & CalledNext)
  | CallNextBlock
  | { kind: "request_conflict" | "in_progress" };
