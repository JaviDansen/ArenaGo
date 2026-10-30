import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import * as schema from "../database/schema";
import { EventsService } from "./events.service";
import type { EventExperiencesResult, ExperienceState } from "./experiences.types";

interface ExperienceRow extends Record<string, unknown> {
  id: string;
  name: string;
  queueAcceptingEntries: boolean;
  waitingCount: string;
  stationId: string | null;
  stationLabel: string | null;
  stationAvailable: boolean | null;
}

/** Visão operacional interna E06 para participantes ativos; não expõe rota HTTP. */
@Injectable()
export class ExperiencesService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Consulta experiências do evento para um userId fornecido por chamador confiável.
   *
   * @remarks Titularidade, disponibilidade, estações e contagens usam o mesmo snapshot
   * REPEATABLE READ READ ONLY, sem locks de linha. Não substitui autenticação HTTP.
   * A observação pode ficar desatualizada após sua obtenção: E07 deve revalidar acesso,
   * cortes e capacidade dentro da própria mutação transacional. Nenhum FIFO é alterado.
   */
  async getEventExperiences(userId: string, eventId: string): Promise<EventExperiencesResult> {
    return this.database.transaction(async (tx): Promise<EventExperiencesResult> => {
      const [access] = await tx.select({
        observedAtMs: sql<number>`(EXTRACT(EPOCH FROM statement_timestamp()) * 1000)::double precision`,
      }).from(schema.participations).where(and(
        eq(schema.participations.userId, userId),
        eq(schema.participations.eventId, eventId),
        eq(schema.participations.status, "active"),
      )).limit(1);

      // Não consultar nem divulgar detalhes do evento antes de verificar titularidade.
      if (!access) return { kind: "access_denied" };
      const observedAt = new Date(access.observedAtMs);
      if (!Number.isFinite(access.observedAtMs) || !Number.isFinite(observedAt.getTime())) {
        throw new Error("PostgreSQL não retornou um instante válido para observar as experiências.");
      }

      const availability = await this.eventsService.evaluateEventAvailabilityById(eventId, observedAt, tx);
      if (!availability.eventExists) return { kind: "access_denied" };

      // Agrupar antes de juntar estações evita multiplicar a contagem por estação.
      // Consultas em número constante, independentemente do total de experiências.
      const result = await tx.execute<ExperienceRow>(sql`
        WITH waiting_counts AS (
          SELECT experience_id, count(*)::text AS waiting_count
          FROM queue_entries
          WHERE event_id = ${eventId} AND status = 'waiting'
          GROUP BY experience_id
        )
        SELECT e.id, e.name, e.queue_accepting_entries AS "queueAcceptingEntries",
          COALESCE(q.waiting_count, '0') AS "waitingCount",
          s.id AS "stationId", s.label AS "stationLabel",
          (s.availability = 'available') AS "stationAvailable"
        FROM experiences e
        LEFT JOIN waiting_counts q ON q.experience_id = e.id
        LEFT JOIN stations s ON s.experience_id = e.id
        WHERE e.event_id = ${eventId}
        ORDER BY e.id ASC, s.id ASC
      `);

      const experiences = new Map<string, ExperienceState>();
      for (const row of result.rows) {
        let experience = experiences.get(row.id);
        if (!experience) {
          if (!/^\d+$/.test(row.waitingCount) || !Number.isSafeInteger(Number(row.waitingCount))) {
            throw new Error("A contagem da fila interna excede o contrato numérico seguro ou é inválida.");
          }
          experience = {
            id: row.id,
            name: row.name,
            acceptingNewQueueEntries: false,
            waitingCount: Number(row.waitingCount),
            stations: [],
          };
          experiences.set(row.id, experience);
        }
        if (row.stationId !== null) {
          experience.stations.push({
            id: row.stationId,
            label: row.stationLabel!,
            available: row.stationAvailable === true,
          });
          if (availability.eventAcceptingNewEntries && row.queueAcceptingEntries && row.stationAvailable) {
            experience.acceptingNewQueueEntries = true;
          }
        }
      }
      const states = [...experiences.values()];
      return {
        kind: "ok",
        eventId,
        observedAt,
        acceptingNewQueueEntries: states.some((experience) => experience.acceptingNewQueueEntries),
        experiences: states,
      };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
