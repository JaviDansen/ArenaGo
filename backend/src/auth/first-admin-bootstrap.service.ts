import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { POSTGRES_POOL } from "../database/database.module";

export type FirstAdminBootstrapResult =
  | { kind: "created" }
  | { kind: "already_bootstrapped" | "account_not_found" | "account_inactive" | "email_unverified" | "invalid_email" };

const BOOTSTRAP_LOCK_NAMESPACE = 1_095_919_439; // 0x4152474f ("ARGO")
const BOOTSTRAP_LOCK_ID = 1;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class FirstAdminBootstrapService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async bootstrap(input: unknown): Promise<FirstAdminBootstrapResult> {
    if (typeof input !== "string") return { kind: "invalid_email" };
    const email = input.trim().toLowerCase();
    if (email.length > 255 || !emailPattern.test(email)) return { kind: "invalid_email" };

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await this.bootstrapInTransaction(client, email);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async bootstrapInTransaction(client: PoolClient, email: string): Promise<FirstAdminBootstrapResult> {
    await client.query(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_ID],
    );

    const existingAdmin = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM user_roles WHERE role='admin' AND event_id IS NULL
       ) AS exists`,
    );
    if (typeof existingAdmin.rows[0]?.exists !== "boolean") {
      throw new Error("Estado do bootstrap administrativo indisponível.");
    }
    // Conta também papéis históricos revogados: este procedimento é de uso único, sem caminho de recuperação.
    if (existingAdmin.rows[0].exists) return { kind: "already_bootstrapped" };

    const account = await client.query<{ id: string; active: boolean; verified: boolean }>(
      `SELECT id, is_active AS active, email_verified_at IS NOT NULL AS verified
       FROM users WHERE email=$1 FOR UPDATE`, [email],
    );
    const user = account.rows[0];
    if (!user) return { kind: "account_not_found" };
    if (!user.active) return { kind: "account_inactive" };
    if (!user.verified) return { kind: "email_unverified" };

    const clock = await client.query<{ at: string }>("SELECT clock_timestamp()::text AS at");
    const at = clock.rows[0]?.at;
    if (typeof at !== "string") throw new Error("Relógio PostgreSQL indisponível.");

    const role = await client.query<{ id: string }>(
      `INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at,revoked_at,revoked_by)
       VALUES($1::uuid,$2::uuid,'admin',NULL,NULL,$3::timestamptz,NULL,NULL) RETURNING id`,
      [randomUUID(), user.id, at],
    );
    if (role.rowCount !== 1) throw new Error("Concessão Admin não persistida.");

    const audit = await client.query<{ id: string }>(
      `INSERT INTO audit_logs(id,actor_user_id,target_user_id,event_id,origin,category,action,reason,metadata,occurred_at,redacted_at)
       VALUES($1::uuid,NULL,$2::uuid,NULL,'cli','identity','first_admin_bootstrapped',NULL,'{"role":"admin"}'::jsonb,$3::timestamptz,NULL)
       RETURNING id`,
      [randomUUID(), user.id, at],
    );
    if (audit.rowCount !== 1) throw new Error("Auditoria do bootstrap não persistida.");
    return { kind: "created" };
  }
}
