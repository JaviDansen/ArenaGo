export interface StaffStationState {
  id: string;
  experienceId: string;
  label: string;
  availability: "available" | "unavailable";
  pendingServiceSessionId: string | null;
  pendingCalledAt: Date | null;
}

export type StaffStationsResult = { kind: "access_denied" } | {
  kind: "ok";
  eventId: string;
  stations: StaffStationState[];
};

export type StaffQueueResult = { kind: "access_denied" } | {
  kind: "ok";
  eventId: string;
  experienceId: string;
  observedAt: Date;
  waitingCount: number;
  acceptingNewEntries: boolean;
  canCallWaitingEntries: boolean;
  firstWaitingQueueEntryId: string | null;
};
