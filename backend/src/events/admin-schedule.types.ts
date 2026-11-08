import type { AdminAuthFailure } from "./admin-operation-auth";

export interface AdminScheduleInput {
  userId: string;
  sessionId: string;
  eventId: string;
  officialEndsAt: string;
  operationalDeadlineAt: string;
  reason: string;
  idempotencyKey: string;
  expiresAt: Date;
}
export interface AdminScheduleState {
  eventId: string;
  officialEndsAt: string;
  operationalDeadlineAt: string;
  /** Texto PostgreSQL UTC com seis casas; preserva microssegundos de updated_at. */
  changedAt?: string;
}
export type AdminScheduleResult = ({ kind: "completed" | "replay" } & AdminScheduleState)
  | { kind: AdminAuthFailure | "resource_not_found" | "event_time_change_closed" | "invalid_schedule" | "request_conflict" | "in_progress" };
