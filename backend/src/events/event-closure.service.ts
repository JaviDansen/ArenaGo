import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";

export const AUTOMATIC_OPERATIONAL_REASON = "automatic_operational_deadline";
export const AUTOMATIC_ADMIN_REASON = "automatic_admin_deadline";
export const EVENT_CLOSURE_PAGE_SIZE = 100;

export type EventClosureResult =
  | { kind: "unavailable" | "not_due" | "already_closed" }
  | { kind: "closed"; deadlineAt: string; executedAt: string; people: number; queues: number; services: number };

function ensure(value: unknown): asserts value {
  if (!value) throw new Error("EVENT_CLOSURE_INTEGRITY");
}

/** E08.9: uma transação por evento, sem identidade humana ou reserva HTTP. */
@Injectable()
export class EventClosureService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  /** Keyset limitado; não mantém todos os eventos/participantes na memória da API. */
  async findCandidates(afterId: string | null): Promise<string[]> {
    const result = await this.database.execute<{ id: string }>(sql`
      SELECT e.id FROM events e WHERE (${afterId}::uuid IS NULL OR e.id > ${afterId}::uuid) AND (
        (e.status <> 'closed' AND LEAST(e.operational_deadline_at,e.admin_deadline_at) <= clock_timestamp())
        OR (e.status='closed' AND (
          EXISTS(SELECT 1 FROM participations p WHERE p.event_id=e.id AND (p.status IN ('waiting','active') OR p.current_queue_entry_id IS NOT NULL))
          OR EXISTS(SELECT 1 FROM queue_entries q WHERE q.event_id=e.id AND q.status IN ('waiting','called'))
          OR EXISTS(SELECT 1 FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=e.id AND s.status='pending'))))
      ORDER BY e.id LIMIT ${EVENT_CLOSURE_PAGE_SIZE}`);
    return result.rows.map(row => row.id);
  }

  async regularizeEvent(eventId: string, skipLocked = false): Promise<EventClosureResult> {
    return this.database.transaction(async tx => {
      const event = (await tx.execute<{ status: string }>(sql`SELECT status FROM events WHERE id=${eventId}
        FOR UPDATE ${skipLocked ? sql`SKIP LOCKED` : sql``}`)).rows[0];
      if (!event) return { kind: "unavailable" };
      // Somente contagens atravessam a conexão. Os locks continuam integrais por evento.
      await tx.execute(sql`SELECT count(*) FROM (SELECT id FROM experiences WHERE event_id=${eventId} ORDER BY id FOR UPDATE) locked`);
      await tx.execute(sql`SELECT count(*) FROM (SELECT s.id FROM stations s JOIN experiences x ON x.id=s.experience_id
        WHERE x.event_id=${eventId} ORDER BY s.id FOR UPDATE OF s) locked`);
      const people = (await tx.execute<{ count: number }>(sql`SELECT count(*) FILTER (WHERE status IN ('waiting','active'))::int AS count
        FROM (SELECT id,status FROM participations WHERE event_id=${eventId} ORDER BY id FOR UPDATE) locked`)).rows[0].count;
      const queues = (await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (SELECT id FROM queue_entries
        WHERE event_id=${eventId} AND status IN ('waiting','called') ORDER BY id FOR UPDATE) locked`)).rows[0].count;
      const services = (await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (SELECT s.id FROM service_sessions s
        JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${eventId} AND s.status='pending' ORDER BY s.id FOR UPDATE OF s) locked`)).rows[0].count;

      const integrity = (await tx.execute<{ valid: boolean; pointers: boolean }>(sql`SELECT
        NOT EXISTS(SELECT 1 FROM queue_entries q LEFT JOIN participations p ON p.id=q.participation_id AND p.event_id=q.event_id
          LEFT JOIN experiences x ON x.id=q.experience_id AND x.event_id=q.event_id
          LEFT JOIN service_sessions s ON s.queue_entry_id=q.id AND s.status='pending'
          WHERE q.event_id=${eventId} AND q.status IN ('waiting','called') AND
            (p.id IS NULL OR p.status<>'active' OR p.current_queue_entry_id IS DISTINCT FROM q.id OR x.id IS NULL
              OR (q.status='called' AND s.id IS NULL) OR (q.status='waiting' AND s.id IS NOT NULL)))
        AND NOT EXISTS(SELECT 1 FROM participations p LEFT JOIN queue_entries q ON q.id=p.current_queue_entry_id
          WHERE p.event_id=${eventId} AND p.current_queue_entry_id IS NOT NULL AND
            (p.status<>'active' OR q.id IS NULL OR q.participation_id<>p.id OR q.event_id<>p.event_id OR q.status NOT IN ('waiting','called')))
        AND NOT EXISTS(SELECT 1 FROM service_sessions s JOIN experiences x ON x.id=s.experience_id
          LEFT JOIN queue_entries q ON q.id=s.queue_entry_id LEFT JOIN stations st ON st.id=s.station_id
          WHERE x.event_id=${eventId} AND s.status='pending' AND
            (q.id IS NULL OR q.status<>'called' OR q.experience_id<>s.experience_id OR q.event_id<>x.event_id
              OR st.id IS NULL OR st.experience_id<>s.experience_id)) AS valid,
        EXISTS(SELECT 1 FROM participations WHERE event_id=${eventId} AND current_queue_entry_id IS NOT NULL) AS pointers`)).rows[0];
      ensure(integrity?.valid);
      if (event.status === "closed") {
        ensure(people === 0 && queues === 0 && services === 0 && !integrity.pointers);
        return { kind: "already_closed" };
      }

      // clock_timestamp após TODAS as esperas. Nunca transporta o prazo por Date.
      const changed = (await tx.execute<{ deadlineAt: string; executedAt: string; reason: string }>(sql`
        WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at), changed AS (
          UPDATE events e SET status='closed',updated_at=d.at FROM decision d
          WHERE e.id=${eventId} AND e.status<>'closed' AND LEAST(e.operational_deadline_at,e.admin_deadline_at)<=d.at
          RETURNING LEAST(e.operational_deadline_at,e.admin_deadline_at) AS deadline,e.updated_at,
            CASE WHEN e.closure_mode IS NULL THEN ${AUTOMATIC_OPERATIONAL_REASON} ELSE ${AUTOMATIC_ADMIN_REASON} END AS reason)
        SELECT to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "deadlineAt",
          to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "executedAt",reason FROM changed`)).rows[0];
      if (!changed) return { kind: "not_due" };

      const canceled = (await tx.execute<{ count: number }>(sql`WITH canceled AS (
        UPDATE service_sessions s SET status='canceled',resolved_at=LEAST(e.operational_deadline_at,e.admin_deadline_at),
          resolved_by_user_id=NULL,cancel_reason=${changed.reason}
        FROM experiences x,events e WHERE s.experience_id=x.id AND x.event_id=e.id AND e.id=${eventId} AND s.status='pending' RETURNING s.id)
        SELECT count(*)::int AS count FROM canceled`)).rows[0].count;
      ensure(canceled === services);
      const closed = (await tx.execute<{ count: number }>(sql`WITH closed AS (
        UPDATE queue_entries q SET status='closed',closed_at=LEAST(e.operational_deadline_at,e.admin_deadline_at),close_reason=${changed.reason}
        FROM events e WHERE q.event_id=e.id AND e.id=${eventId} AND q.status IN ('waiting','called') RETURNING q.id)
        SELECT count(*)::int AS count FROM closed`)).rows[0].count;
      ensure(closed === queues);
      const finished = (await tx.execute<{ count: number }>(sql`WITH finished AS (
        UPDATE participations p SET status='finished',finished_at=LEAST(e.operational_deadline_at,e.admin_deadline_at),
          finish_reason=${changed.reason},current_queue_entry_id=NULL
        FROM events e WHERE p.event_id=e.id AND e.id=${eventId} AND p.status IN ('waiting','active') RETURNING p.id)
        SELECT count(*)::int AS count FROM finished`)).rows[0].count;
      ensure(finished === people);
      return { kind: "closed", deadlineAt: changed.deadlineAt, executedAt: changed.executedAt, people: finished, queues: closed, services: canceled };
    }, { isolationLevel: "read committed" });
  }
}
