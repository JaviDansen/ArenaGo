/** Disponibilidade configurada; `available` não indica ausência de chamada pendente. */
export interface ExperienceStationState {
  id: string;
  label: string;
  available: boolean;
}

export interface ExperienceState {
  id: string;
  name: string;
  acceptingNewQueueEntries: boolean;
  /** Somente queue_entries waiting; uma fila compartilhada por todas as estações. */
  waitingCount: number;
  stations: ExperienceStationState[];
}

export interface EventExperiencesState {
  eventId: string;
  /** Relógio PostgreSQL no início da primeira consulta do snapshot; serializa como ISO 8601. */
  observedAt: Date;
  /** Existe ao menos uma experiência apta, respeitadas todas as condições globais. */
  acceptingNewQueueEntries: boolean;
  /** Experiências e suas estações são ordenadas por UUID crescente. */
  experiences: ExperienceState[];
}

/** Ausência de evento e falta de participação ativa são indistinguíveis para o chamador. */
export type EventExperiencesResult =
  | { kind: "access_denied" }
  | ({ kind: "ok" } & EventExperiencesState);
