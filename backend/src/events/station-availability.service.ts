import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import type { SetStationAvailabilityInput, StationAvailabilityResult } from "./station-availability.types";

/** E08.5: configuração e auditoria atômicas; idempotência natural do estado desejado. */
@Injectable()
export class StationAvailabilityService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>) {}

  async setAvailability(input: SetStationAvailabilityInput): Promise<StationAvailabilityResult> {
    if (input.availability !== "available" && input.availability !== "unavailable") throw new Error("Disponibilidade inválida.");
    return this.database.transaction(async (tx): Promise<StationAvailabilityResult> => {
      // Mutex de capacidade compartilhado com ingresso E03 e conflitante com SHARE E07.
      const event = await tx.execute(sql`SELECT id FROM events WHERE id=${input.eventId} FOR UPDATE`);
      if (!event.rows.length) return { kind: "access_denied" };
      const discovery = await tx.execute<{ experienceId: string }>(sql`
        SELECT s.experience_id AS "experienceId" FROM stations s JOIN experiences x ON x.id=s.experience_id
        WHERE s.id=${input.stationId} AND x.event_id=${input.eventId}`);
      if (!discovery.rows.length) return { kind: "access_denied" };
      const experienceId = discovery.rows[0].experienceId;
      const experience = await tx.execute(sql`SELECT id FROM experiences WHERE id=${experienceId} AND event_id=${input.eventId} FOR UPDATE`);
      if (!experience.rows.length) return { kind: "access_denied" };
      const station = await tx.execute<{ availability: "available" | "unavailable" }>(sql`
        SELECT availability FROM stations WHERE id=${input.stationId} AND experience_id=${experienceId} FOR UPDATE`);
      if (!station.rows.length) return { kind: "access_denied" };

      // Ordem conta -> papéis -> sessão, depois dos recursos. Locks retêm autorização até COMMIT.
      const account = await tx.execute<{ active: boolean; verified: boolean }>(sql`
        SELECT is_active AS active, email_verified_at IS NOT NULL AS verified FROM users WHERE id=${input.userId} FOR SHARE`);
      if (!account.rows[0]?.active) return { kind: "account_inactive" };
      const roles = await tx.execute<{ role: string }>(sql`SELECT role FROM user_roles
        WHERE user_id=${input.userId} AND revoked_at IS NULL
          AND ((role='staff' AND event_id=${input.eventId}) OR (role='admin' AND event_id IS NULL))
        ORDER BY id FOR SHARE`);
      const admin = roles.rows.some(row => row.role === "admin");
      if (!admin && !(account.rows[0].verified && roles.rows.some(row => row.role === "staff"))) return { kind: "access_denied" };
      const session = await tx.execute(sql`SELECT id FROM sessions WHERE id=${input.sessionId} AND user_id=${input.userId} FOR SHARE`);
      if (!session.rows.length) return { kind: "invalid_session" };
      // Outra instrução: expressões de tempo de um SELECT com lock podem ser avaliadas antes da espera.
      const validity = await tx.execute<{ revoked: boolean; expired: boolean; secondFactor: boolean }>(sql`
        SELECT revoked_at IS NOT NULL AS revoked, expires_at <= clock_timestamp() AS expired,
          admin_2fa_verified_at IS NOT NULL AS "secondFactor"
        FROM sessions WHERE id=${input.sessionId} AND user_id=${input.userId}`);
      const auth = validity.rows[0];
      if (auth.revoked) return { kind: "session_revoked" };
      if (auth.expired) return { kind: "session_expired" };
      if (admin && !auth.secondFactor) return { kind: "admin_2fa_required" };

      const pending = await tx.execute<{ id: string }>(sql`SELECT id FROM service_sessions
        WHERE station_id=${input.stationId} AND experience_id=${experienceId} AND status='pending'`);
      const current = { stationId: input.stationId, availability: station.rows[0].availability,
        pendingServiceSessionId: pending.rows[0]?.id ?? null };
      if (current.availability === input.availability) return { kind: "unchanged", ...current };
      if (input.availability === "unavailable" && current.pendingServiceSessionId !== null) {
        return { kind: "station_has_pending_call", ...current };
      }
      // Configuração também é permitida antes do início. Cortes de ingresso não impedem operação residual.
      // Prazo e sessão são reavaliados no UPDATE decisivo, após todas as esperas.
      const updated = await tx.execute(sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE stations s SET availability=${input.availability}, updated_at=d.at
        FROM events e, experiences x, sessions a, decision d
        WHERE s.id=${input.stationId} AND s.experience_id=${experienceId} AND x.id=s.experience_id
          AND x.event_id=${input.eventId} AND e.id=x.event_id AND s.availability=${current.availability}
          AND e.status <> 'closed' AND d.at < e.operational_deadline_at
          AND (e.admin_deadline_at IS NULL OR d.at < e.admin_deadline_at)
          AND a.id=${input.sessionId} AND a.user_id=${input.userId} AND a.revoked_at IS NULL AND d.at < a.expires_at
        RETURNING s.id`);
      if (!updated.rows.length) {
        const expired = await tx.execute<{ expired: boolean }>(sql`SELECT expires_at <= clock_timestamp() AS expired FROM sessions WHERE id=${input.sessionId}`);
        return { kind: expired.rows[0]?.expired ? "session_expired" : "event_operation_ended" };
      }
      // Não existe writer/helper de auditoria no backend: usa diretamente o schema vigente.
      // Mesmo instante exato do UPDATE, sem perda de microssegundos em Date/JavaScript.
      const audit = await tx.execute(sql`INSERT INTO audit_logs(id,actor_user_id,event_id,origin,category,action,metadata,occurred_at)
        SELECT ${randomUUID()},${input.userId},${input.eventId},'user','station','station_availability_changed',
          jsonb_build_object('stationId',s.id,'experienceId',s.experience_id,
            'before',jsonb_build_object('availability',${current.availability}::text),
            'after',jsonb_build_object('availability',${input.availability}::text)),s.updated_at
        FROM stations s WHERE s.id=${input.stationId} AND s.experience_id=${experienceId} RETURNING id`);
      if (audit.rows.length !== 1) throw new Error("A alteração da estação exige exatamente um registro de auditoria.");
      return { kind: "changed", stationId: input.stationId, availability: input.availability,
        pendingServiceSessionId: current.pendingServiceSessionId };
    }, { isolationLevel: "read committed" });
  }
}
