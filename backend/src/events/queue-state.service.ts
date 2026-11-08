import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import type { ParticipationQueueResult } from "./queue-state.types";

interface AccessRow extends Record<string, unknown> {
  id: string;
  eventId: string;
  participationStatus: string;
  currentId: string | null;
  loadedEventId: string | null;
  eventStatus: string;
  operationalDeadlineMs: number;
  closureMode: string | null;
  closureRequestedMs: number | null;
  adminDeadlineMs: number | null;
  observedAtMs: number;
}

interface QueueRow extends Record<string, unknown> {
  currentCount: string;
  id: string | null;
  experienceId: string | null;
  loadedExperienceId: string | null;
  experienceName: string | null;
  status: string | null;
  queueOrder: string | null;
  position: string | null;
  sessionId: string | null;
  sessionExperienceId: string | null;
  sessionStatus: string | null;
  calledAtMs: number | null;
  stationId: string | null;
  stationExperienceId: string | null;
  stationLabel: string | null;
}

/** Erro interno; não inventar estado válido nem divulgar identificadores em inconsistência. */
export class QueueStateIntegrityError extends Error {
  constructor(detail: string) { super(`Integridade da fila interna: ${detail}`); this.name = "QueueStateIntegrityError"; }
}

function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new QueueStateIntegrityError(detail);
}

function instant(ms: number, field: string): Date {
  ensure(typeof ms === "number" && Number.isFinite(ms), `${field} inválido.`);
  const date = new Date(ms);
  ensure(Number.isFinite(date.getTime()), `${field} fora do intervalo de Date.`);
  return date;
}

function count(value: string, positive: boolean): number {
  ensure(typeof value === "string" && /^(0|[1-9]\d*)$/.test(value), "contagem decimal inválida.");
  const exact = BigInt(value);
  ensure(exact <= BigInt(Number.MAX_SAFE_INTEGER) && (!positive || exact > 0n), "contagem fora do intervalo seguro.");
  return Number(exact);
}

/** E07.2: duas leituras no mesmo snapshot; sem locks de linha, limpeza ou mutações. */
@Injectable()
export class QueueStateService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  /** UUIDs e userId fornecidos por chamador confiável; não substitui autenticação HTTP. */
  async getParticipationQueue(userId: string, participationId: string): Promise<ParticipationQueueResult> {
    return this.database.transaction(async (tx): Promise<ParticipationQueueResult> => {
      const access = await tx.execute<AccessRow>(sql`
        SELECT p.id, p.event_id AS "eventId", p.status AS "participationStatus",
          p.current_queue_entry_id AS "currentId", e.id AS "loadedEventId", e.status AS "eventStatus",
          (EXTRACT(EPOCH FROM e.operational_deadline_at)*1000)::double precision AS "operationalDeadlineMs",
          e.closure_mode AS "closureMode",
          (EXTRACT(EPOCH FROM e.closure_requested_at)*1000)::double precision AS "closureRequestedMs",
          (EXTRACT(EPOCH FROM e.admin_deadline_at)*1000)::double precision AS "adminDeadlineMs",
          (EXTRACT(EPOCH FROM statement_timestamp())*1000)::double precision AS "observedAtMs"
        FROM participations p LEFT JOIN events e ON e.id=p.event_id
        WHERE p.id=${participationId} AND p.user_id=${userId}
      `);
      if (!access.rows.length) return { kind: "access_denied" };
      ensure(access.rows.length === 1, "participação duplicada.");
      const owner = access.rows[0];
      ensure(owner.loadedEventId === owner.eventId && owner.loadedEventId !== null, "evento incoerente.");
      ensure(["waiting", "active", "finished", "canceled"].includes(owner.participationStatus), "estado da participação desconhecido.");
      ensure(["scheduled", "open", "closing", "closed"].includes(owner.eventStatus), "estado do evento desconhecido.");
      const observedAt = instant(owner.observedAtMs, "observedAt");
      let deadline = instant(owner.operationalDeadlineMs, "prazo operacional").getTime();
      if (owner.closureMode === null) {
        ensure(owner.closureRequestedMs === null && owner.adminDeadlineMs === null, "fechamento administrativo incompleto.");
      } else {
        ensure(owner.closureMode === "immediate" || owner.closureMode === "controlled", "modo administrativo desconhecido.");
        ensure(owner.closureRequestedMs !== null && owner.adminDeadlineMs !== null, "fechamento administrativo incompleto.");
        const requested = instant(owner.closureRequestedMs, "instante administrativo").getTime();
        const adminDeadline = instant(owner.adminDeadlineMs, "prazo administrativo").getTime();
        ensure(owner.closureMode === "immediate" ? requested === adminDeadline : requested < adminDeadline,
          "prazo administrativo incoerente.");
        deadline = Math.min(deadline, adminDeadline);
      }
      const ended = owner.eventStatus === "closed" || observedAt.getTime() >= deadline;

      const result = await tx.execute<QueueRow>(sql`
        SELECT q.id, q.experience_id AS "experienceId", x.id AS "loadedExperienceId", x.name AS "experienceName",
          q.status, q.queue_order::text AS "queueOrder",
          (SELECT count(*)::text FROM queue_entries c
            WHERE c.participation_id=p.id AND c.status IN ('waiting','called')) AS "currentCount",
          CASE WHEN q.status='waiting' THEN (SELECT count(*)::text FROM queue_entries w
            WHERE w.event_id=p.event_id AND w.experience_id=q.experience_id
              AND w.status='waiting' AND w.queue_order <= q.queue_order) END AS position,
          s.id AS "sessionId", s.experience_id AS "sessionExperienceId", s.status AS "sessionStatus",
          (EXTRACT(EPOCH FROM s.called_at)*1000)::double precision AS "calledAtMs",
          t.id AS "stationId", t.experience_id AS "stationExperienceId", t.label AS "stationLabel"
        FROM participations p
        LEFT JOIN queue_entries q ON q.id=p.current_queue_entry_id AND q.participation_id=p.id AND q.event_id=p.event_id
        LEFT JOIN experiences x ON x.id=q.experience_id AND x.event_id=q.event_id
        LEFT JOIN service_sessions s ON s.queue_entry_id=q.id
        LEFT JOIN stations t ON t.id=s.station_id
        WHERE p.id=${participationId} AND p.user_id=${userId} AND p.event_id=${owner.eventId}
      `);
      ensure(result.rows.length === 1, "participação mudou dentro do snapshot ou atendimento duplicado.");
      const row = result.rows[0];
      const currentCount = count(row.currentCount, false);
      const empty: ParticipationQueueResult = { kind: "ok", participationId: owner.id, observedAt, currentQueueEntry: null };
      if (owner.currentId === null) {
        ensure(row.id === null && currentCount === 0, "entrada corrente sem ponteiro.");
        return empty;
      }
      ensure(row.id === owner.currentId && currentCount === 1, "ponteiro não corresponde à entrada corrente.");
      ensure(row.status === "waiting" || row.status === "called", "ponteiro para entrada encerrada ou desconhecida.");
      ensure(row.experienceId !== null && row.loadedExperienceId === row.experienceId
        && typeof row.experienceName === "string", "experiência incoerente.");
      ensure(typeof row.queueOrder === "string" && /^[1-9]\d*$/.test(row.queueOrder), "ordem histórica inválida.");
      if (row.sessionId !== null) {
        ensure(row.sessionExperienceId === row.experienceId && row.stationId !== null
          && row.stationExperienceId === row.experienceId && typeof row.stationLabel === "string", "atendimento/estação incoerente.");
      }
      // Projeção no instante observedAt: fechamento lógico prevalece sobre limpeza atrasada.
      // Não encerrar linhas, resolver atendimentos ou alterar participação nesta consulta.
      if (ended) return empty;
      ensure(owner.participationStatus === "active", "participação não ativa com entrada corrente.");
      const entry = { id: row.id, experienceId: row.experienceId, experienceName: row.experienceName, queueOrder: row.queueOrder };
      if (row.status === "waiting") {
        ensure(row.sessionId === null, "entrada waiting já possui atendimento.");
        ensure(row.position !== null, "posição ausente.");
        return { kind: "ok", participationId: owner.id, observedAt,
          currentQueueEntry: { ...entry, status: "waiting", position: count(row.position, true), serviceSession: null } };
      }
      ensure(row.position === null && row.sessionId !== null && row.sessionStatus === "pending"
        && row.calledAtMs !== null && row.stationId !== null && row.stationLabel !== null, "chamada sem atendimento pending válido.");
      return { kind: "ok", participationId: owner.id, observedAt,
        currentQueueEntry: { ...entry, status: "called", position: null,
          serviceSession: { id: row.sessionId, status: "pending", calledAt: instant(row.calledAtMs, "calledAt"),
            station: { id: row.stationId, label: row.stationLabel } } } };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
