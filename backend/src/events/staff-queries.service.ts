import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { EventsService } from "./events.service";
import { configurationProjection } from "./admin-configuration.projection";
import type { StaffExperiencesResult, StaffQueueResult, StaffStationsResult } from "./staff-queries.types";

interface AccessRow extends Record<string, unknown> {
  observedAtMs: number;
  operating: boolean;
}
interface StaffEventRow extends Record<string, unknown> {
  id: string;
  name: string;
  status: "scheduled" | "open" | "closing" | "closed";
  effectivePhase: "scheduled" | "open" | "closing" | "closed" | "not_ready";
}
interface StaffExperienceRow extends Record<string, unknown> {
  id: string;
  name: string;
}
interface StationRow extends Record<string, unknown> {
  id: string;
  experienceId: string;
  label: string;
  availability: "available" | "unavailable";
  pendingServiceSessionId: string | null;
  pendingCalledAtMs: number | null;
}
interface QueueRow extends Record<string, unknown> {
  queueAcceptingEntries: boolean;
  hasAvailableStation: boolean;
  waitingCount: string;
  firstWaitingQueueEntryId: string | null;
}

function instant(ms: number): Date {
  const date = new Date(ms);
  if (typeof ms !== "number" || !Number.isFinite(ms) || !Number.isFinite(date.getTime())) {
    throw new Error("Instante PostgreSQL inválido na consulta Staff.");
  }
  return date;
}

/** E08.4: autorização e dados no mesmo snapshot, sem locks de linha ou efeitos. */
@Injectable()
export class StaffQueriesService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Lista apenas eventos com concessão Staff vigente para a conta da sessão. */
  async listEvents(staffUserId: string): Promise<StaffEventRow[]> {
    const result = await this.database.execute<StaffEventRow>(sql`
      SELECT p.id, p.name, p."statusStored" AS status, p."effectivePhase"
      FROM (${configurationProjection(sql`EXISTS (
        SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id
        WHERE u.id=${staffUserId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
          AND r.role='staff' AND r.event_id=e.id AND r.revoked_at IS NULL
      )`)}) p
      ORDER BY p.name, p.id
    `);
    return result.rows.map(({ id, name, status, effectivePhase }) => ({ id, name, status, effectivePhase }));
  }

  private async authorize(tx: DatabaseExecutor, staffUserId: string, eventId: string) {
    // Papel da sessão não substitui concessão vigente. Admin isolado não autoriza.
    // statement_timestamp é estável na instrução que estabelece o snapshot.
    const result = await tx.execute<AccessRow>(sql`
      SELECT (EXTRACT(EPOCH FROM statement_timestamp())*1000)::double precision AS "observedAtMs",
        e.status <> 'closed' AND e.starts_at <= statement_timestamp()
          AND statement_timestamp() < e.operational_deadline_at
          AND (e.admin_deadline_at IS NULL OR statement_timestamp() < e.admin_deadline_at) AS operating
      FROM events e
      WHERE e.id=${eventId} AND EXISTS (
        SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id
        WHERE u.id=${staffUserId} AND u.is_active=true AND u.email_verified_at IS NOT NULL
          AND r.role='staff' AND r.event_id=e.id AND r.revoked_at IS NULL
      )
    `);
    return result.rows[0];
  }

  async getExperiences(staffUserId: string, eventId: string): Promise<StaffExperiencesResult> {
    return this.database.transaction(async (tx): Promise<StaffExperiencesResult> => {
      const access = await this.authorize(tx, staffUserId, eventId);
      if (!access) return { kind: "access_denied" };
      const result = await tx.execute<StaffExperienceRow>(sql`
        SELECT e.id, e.name FROM experiences e
        WHERE e.event_id=${eventId}
        ORDER BY e.name, e.id
      `);
      return { kind: "ok", eventId, experiences: result.rows.map(({ id, name }) => ({ id, name })) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async getStations(staffUserId: string, eventId: string): Promise<StaffStationsResult> {
    return this.database.transaction(async (tx): Promise<StaffStationsResult> => {
      const access = await this.authorize(tx, staffUserId, eventId);
      if (!access) return { kind: "access_denied" };
      const result = await tx.execute<StationRow>(sql`
        SELECT s.id, s.experience_id AS "experienceId", s.label, s.availability,
          p.id AS "pendingServiceSessionId",
          (EXTRACT(EPOCH FROM p.called_at)*1000)::double precision AS "pendingCalledAtMs"
        FROM experiences e JOIN stations s ON s.experience_id=e.id
        LEFT JOIN service_sessions p ON p.station_id=s.id AND p.experience_id=e.id AND p.status='pending'
        WHERE e.event_id=${eventId}
        ORDER BY e.id, s.id
      `);
      // O índice único parcial garante no máximo um pending por estação.
      return { kind: "ok", eventId, stations: result.rows.map(row => ({
        id: row.id, experienceId: row.experienceId, label: row.label, availability: row.availability,
        pendingServiceSessionId: row.pendingServiceSessionId,
        pendingCalledAt: row.pendingCalledAtMs === null ? null : instant(row.pendingCalledAtMs),
      })) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async getQueue(staffUserId: string, eventId: string, experienceId: string): Promise<StaffQueueResult> {
    return this.database.transaction(async (tx): Promise<StaffQueueResult> => {
      const access = await this.authorize(tx, staffUserId, eventId);
      if (!access) return { kind: "access_denied" };
      const observedAt = instant(access.observedAtMs);
      const result = await tx.execute<QueueRow>(sql`
        WITH waiting AS (
          SELECT id, queue_order FROM queue_entries
          WHERE event_id=${eventId} AND experience_id=${experienceId} AND status='waiting'
        )
        SELECT e.queue_accepting_entries AS "queueAcceptingEntries",
          EXISTS (SELECT 1 FROM stations s WHERE s.experience_id=e.id AND s.availability='available') AS "hasAvailableStation",
          (SELECT count(*)::text FROM waiting) AS "waitingCount",
          (SELECT id FROM waiting ORDER BY queue_order, id LIMIT 1) AS "firstWaitingQueueEntryId"
        FROM experiences e WHERE e.id=${experienceId} AND e.event_id=${eventId}
      `);
      const row = result.rows[0];
      if (!row) return { kind: "access_denied" };
      if (!/^(0|[1-9]\d*)$/.test(row.waitingCount) || !Number.isSafeInteger(Number(row.waitingCount))) {
        throw new Error("Contagem da fila Staff fora do contrato numérico seguro.");
      }
      const availability = await this.events.evaluateEventAvailabilityById(eventId, observedAt, tx);
      if (!availability.eventExists) return { kind: "access_denied" };
      return { kind: "ok", eventId, experienceId, observedAt, waitingCount: Number(row.waitingCount),
        acceptingNewEntries: availability.eventAcceptingNewEntries && row.queueAcceptingEntries && row.hasAvailableStation,
        // Janela para chamadas residuais, como E07.4; não promete fila não vazia ou estação livre.
        canCallWaitingEntries: access.operating, firstWaitingQueueEntryId: row.firstWaitingQueueEntryId };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
