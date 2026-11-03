export type StationAvailability = "available" | "unavailable";
export interface SetStationAvailabilityInput {
  userId: string;
  sessionId: string;
  eventId: string;
  stationId: string;
  availability: StationAvailability;
}
export interface StationAvailabilityState {
  stationId: string;
  availability: StationAvailability;
  pendingServiceSessionId: string | null;
}
export type StationAvailabilityResult =
  | ({ kind: "changed" | "unchanged" } & StationAvailabilityState)
  | ({ kind: "station_has_pending_call" } & StationAvailabilityState)
  | { kind: "access_denied" | "account_inactive" | "invalid_session" | "session_revoked"
    | "session_expired" | "admin_2fa_required" | "event_operation_ended" };
