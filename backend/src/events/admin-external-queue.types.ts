export interface AdminExternalQueueInput {
  userId: string;
  sessionId: string;
  eventId: string;
  enabled: boolean;
  reason: string;
  idempotencyKey: string;
  expiresAt: Date;
}
export interface AdminExternalQueueState {
  eventId: string;
  externalQueueEnabled: boolean;
  releasedCount: number;
  changedAt?: Date;
}
export type AdminExternalQueueResult =
  | ({ kind: "completed" | "replay" } & AdminExternalQueueState)
  | { kind: "resource_not_found" | "admin_required" | "account_inactive" | "invalid_session"
    | "session_revoked" | "session_expired" | "admin_2fa_required" | "event_closed"
    | "event_unavailable" | "request_conflict" | "in_progress" };
