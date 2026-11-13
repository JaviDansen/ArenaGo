import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { ProblemException } from "../common/errors/problem.exception";

type Actor = { userId: string; sessionId: string; eventId: string; experienceId: string; stationId: string };
type WaitingRow = { id: string; displayName: string; order: string; position: string };
type PendingRow = { id: string; queueEntryId: string; displayName: string; calledAt: Date;
  queueStatus: string; participationStatus: string; currentId: string | null };

/** Consulta nominal mínima para a estação escolhida; a fila pertence à experiência. */
@Injectable()
export class StaffStationStateService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async read(actor: Actor) {
    return this.database.transaction(async tx => {
      const session = await tx.execute(sql`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.revoked_at IS NULL
          AND s.expires_at > statement_timestamp() AND u.is_active=true
          AND (s.admin_2fa_verified_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM user_roles a
            WHERE a.user_id=u.id AND a.role='admin' AND a.event_id IS NULL AND a.revoked_at IS NULL))`);
      if (!session.rows.length) throw new ProblemException({ status: 401, code: 'INVALID_SESSION',
        typeSlug: 'invalid-session', title: 'Sessão inválida', detail: 'Sessão inválida ou expirada.' });
      const access = (await tx.execute<{ availability: string; operating: boolean }>(sql`
        SELECT t.availability,
          e.status <> 'closed' AND e.starts_at <= statement_timestamp()
            AND statement_timestamp() < e.operational_deadline_at
            AND (e.admin_deadline_at IS NULL OR statement_timestamp() < e.admin_deadline_at) AS operating
        FROM events e JOIN experiences x ON x.event_id=e.id JOIN stations t ON t.experience_id=x.id
        JOIN users u ON u.id=${actor.userId}
        WHERE e.id=${actor.eventId} AND x.id=${actor.experienceId} AND t.id=${actor.stationId}
          AND u.is_active=true AND u.email_verified_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='staff'
            AND r.event_id=e.id AND r.revoked_at IS NULL)`)).rows[0];
      if (!access) return null;
      if (!['available', 'unavailable'].includes(access.availability) || typeof access.operating !== 'boolean')
        throw new Error('Estado da estação inválido.');
      const waiting = (await tx.execute<WaitingRow>(sql`
        SELECT q.id, u.name AS "displayName", q.queue_order::text AS "order",
          row_number() OVER (ORDER BY q.queue_order,q.id)::text AS position
        FROM queue_entries q JOIN participations p ON p.id=q.participation_id AND p.event_id=q.event_id
        JOIN users u ON u.id=p.user_id
        WHERE q.event_id=${actor.eventId} AND q.experience_id=${actor.experienceId}
          AND q.status='waiting' AND p.status='active' AND p.current_queue_entry_id=q.id
        ORDER BY q.queue_order,q.id`)).rows;
      const pending = (await tx.execute<PendingRow>(sql`
        SELECT s.id, q.id AS "queueEntryId", u.name AS "displayName", s.called_at AS "calledAt",
          q.status AS "queueStatus", p.status AS "participationStatus",
          p.current_queue_entry_id AS "currentId"
        FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id
          AND q.experience_id=s.experience_id
        JOIN participations p ON p.id=q.participation_id AND p.event_id=q.event_id
        JOIN users u ON u.id=p.user_id
        WHERE s.station_id=${actor.stationId} AND s.experience_id=${actor.experienceId}
          AND q.event_id=${actor.eventId} AND s.status='pending'`)).rows;
      if (pending.length > 1) throw new Error('Estação com múltiplos atendimentos pendentes.');
      if (pending[0] && (pending[0].queueStatus !== 'called' || pending[0].participationStatus !== 'active' ||
          pending[0].currentId !== pending[0].queueEntryId || !pending[0].displayName?.trim()))
        throw new Error('Atendimento pendente inconsistente.');
      const list = waiting.map(row => {
        if (!/^[1-9]\d*$/.test(row.order) || BigInt(row.order) > 9223372036854775807n ||
            !/^[1-9]\d*$/.test(row.position) || !Number.isSafeInteger(Number(row.position)) ||
            !row.displayName?.trim()) throw new Error('Fila operacional inconsistente.');
        return { queueEntryId: row.id, displayName: row.displayName, position: Number(row.position) };
      });
      const current = pending[0] ? { serviceSessionId: pending[0].id,
        queueEntryId: pending[0].queueEntryId, displayName: pending[0].displayName,
        calledAt: new Date(pending[0].calledAt).toISOString() } : null;
      return { eventId: actor.eventId, experienceId: actor.experienceId, stationId: actor.stationId,
        availability: access.availability, canCall: access.operating && access.availability === 'available' && !current,
        waitingCount: list.length, waiting: list, pending: current };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }
}
