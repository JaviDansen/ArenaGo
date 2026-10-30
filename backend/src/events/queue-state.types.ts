interface QueueEntryIdentity {
  id: string;
  experienceId: string;
  experienceName: string;
  /** Ordem histórica exata, não a posição dinâmica. */
  queueOrder: string;
}

export type CurrentParticipationQueueEntry =
  | (QueueEntryIdentity & { status: "waiting"; position: number; serviceSession: null })
  | (QueueEntryIdentity & {
      status: "called";
      position: null;
      serviceSession: {
        id: string;
        status: "pending";
        calledAt: Date;
        station: { id: string; label: string };
      };
    });

export type ParticipationQueueResult =
  | { kind: "access_denied" }
  | {
      kind: "ok";
      participationId: string;
      /** Instante PostgreSQL da primeira consulta do snapshot, serializável como ISO 8601. */
      observedAt: Date;
      /** Sem fila ou projeção após encerramento operacional efetivo; nunca replay histórico. */
      currentQueueEntry: CurrentParticipationQueueEntry | null;
    };
