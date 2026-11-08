import type { AdminAuthFailure } from "./admin-operation-auth";
import type { AdminCloseBody } from "./admin-close.dto";

export type AdminCloseInput = AdminCloseBody & { userId: string; sessionId: string; eventId: string; idempotencyKey: string; expiresAt: Date };
export interface AdminCloseState {
  eventId: string;
  status: "closed" | "closing";
  closureMode: "immediate" | "controlled";
  newEntriesClosedAt: string;
  effectiveOperationalDeadlineAt: string;
  externalWaitingFinalized: number;
}
export type AdminCloseResult = ({ kind: "completed" | "replay" } & AdminCloseState)
  | { kind: AdminAuthFailure | "resource_not_found" | "event_already_closed" | "closure_deadline_invalid" | "request_conflict" | "in_progress" };
