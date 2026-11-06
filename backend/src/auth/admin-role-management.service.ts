import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx, type JsonValue } from "../participations/join-idempotency";
import { assertAdminSessionWithTx, authorizeGlobalAdminWithTx } from "../events/admin-operation-auth";
import { managedRoleResponse, type GrantAdminRoleBody } from "./admin-role-management.dto";
import { failAdminRoleManagement } from "./admin-role-management.problem";

const ROLE_MANAGEMENT_LOCK_CLASS = 0x41524e47;
const ROLE_MANAGEMENT_LOCK_ID = 0x524f4c45;
const GRANT_OPERATION = "admin_grant_role";
const REVOKE_OPERATION = "admin_revoke_role";

export function shouldBlockLastAdminRevocation(targetIsViable: boolean, otherViableAdmins: number): boolean {
  return targetIsViable && otherViableAdmins === 0;
}

export interface AdminRoleActor { userId: string; sessionId: string }
export interface AdminRoleMutationInput extends AdminRoleActor {
  body: GrantAdminRoleBody;
  idempotencyKey: string;
  expiresAt: Date;
}
export interface AdminRoleRevokeInput extends AdminRoleActor {
  grantId: string;
  idempotencyKey: string;
  expiresAt: Date;
}

function ensure(value: unknown): asserts value { if (!value) throw new Error("ADMIN_ROLE_MANAGEMENT_INTEGRITY"); }

function fingerprint(operation: string, value: JsonValue): string {
  return createRequestFingerprint(operation, value);
}

async function roleMutationMutex(tx: DatabaseTransactionExecutor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROLE_MANAGEMENT_LOCK_CLASS}::integer, ${ROLE_MANAGEMENT_LOCK_ID}::integer)`);
}

async function authorizeActor(tx: DatabaseTransactionExecutor, actor: AdminRoleActor): Promise<void> {
  await authorizeGlobalAdminWithTx(tx, actor, result => failAdminRoleManagement(result.kind));
  const verified = await tx.execute<{ verified: boolean }>(sql`SELECT email_verified_at IS NOT NULL AS verified
    FROM users WHERE id=${actor.userId}::uuid`);
  if (!verified.rows[0]?.verified) failAdminRoleManagement("actor_email_unverified");
}

function replayBody(value: JsonValue | null, reference: string | null) {
  const parsed = managedRoleResponse.parse(value);
  ensure(parsed.grant.id === reference);
  return parsed;
}

function iso(value: string): string {
  const date = new Date(value);
  ensure(Number.isFinite(date.getTime()));
  return date.toISOString();
}

@Injectable()
export class AdminRoleManagementService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async grant(input: AdminRoleMutationInput) {
    ensure(input.idempotencyKey.trim() && input.idempotencyKey.length <= 128 && Number.isFinite(input.expiresAt.getTime()));
    const requested = input.body;
    const eventId = requested.role === "staff" ? requested.eventId : null;
    return this.database.transaction(async tx => {
      let eventExists = true;
      if (eventId) eventExists = (await tx.execute(sql`SELECT id FROM events WHERE id=${eventId}::uuid FOR UPDATE`)).rows.length === 1;
      await roleMutationMutex(tx);
      await authorizeActor(tx, input);
      if (!eventExists) failAdminRoleManagement("event_not_found");

      const intent = await reserveIdempotencyOperationWithTx(tx, {
        actorUserId: input.userId, operation: GRANT_OPERATION, idempotencyKey: input.idempotencyKey,
        requestHash: fingerprint(GRANT_OPERATION, { role: requested.role, email: requested.email, eventId }),
        expiresAt: input.expiresAt,
      });
      await assertAdminSessionWithTx(tx, input, result => failAdminRoleManagement(result.kind));
      if (intent.kind === "request_conflict" || intent.kind === "in_progress") failAdminRoleManagement(intent.kind);
      if (intent.kind === "replay") return replayBody(intent.resultPayload, intent.resultReference);

      const target = (await tx.execute<{ id: string; active: boolean; verified: boolean }>(sql`
        SELECT id, is_active AS active, email_verified_at IS NOT NULL AS verified
        FROM users WHERE lower(btrim(email))=${requested.email} FOR UPDATE`)).rows[0];
      if (!target) failAdminRoleManagement("target_not_found");
      if (!target.active || !target.verified) failAdminRoleManagement("target_ineligible");

      const active = await tx.execute(sql`SELECT id FROM user_roles WHERE user_id=${target.id}::uuid
        AND role=${requested.role} AND event_id IS NOT DISTINCT FROM ${eventId}::uuid AND revoked_at IS NULL FOR UPDATE`);
      if (active.rows.length) failAdminRoleManagement("role_already_granted");

      const grantId = randomUUID();
      const inserted = await tx.execute<{ id: string; userId: string; role: "admin" | "staff"; eventId: string | null; grantedAt: string; auditCount: number }>(sql`
        WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at),
        granted AS (
          INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at,revoked_at,revoked_by)
          SELECT ${grantId}::uuid,${target.id}::uuid,${requested.role}::varchar(20),${eventId}::uuid,${input.userId}::uuid,d.at,NULL,NULL
          FROM decision d ON CONFLICT DO NOTHING
          RETURNING id,user_id,role,event_id,granted_at
        ), audited AS (
          INSERT INTO audit_logs(id,actor_user_id,target_user_id,event_id,origin,category,action,metadata,occurred_at)
          SELECT ${randomUUID()}::uuid,${input.userId}::uuid,g.user_id,g.event_id,'user','identity','admin_role_granted',
            jsonb_build_object('grantId',g.id,'role',g.role),g.granted_at FROM granted g RETURNING id
        )
        SELECT g.id,g.user_id AS "userId",g.role,g.event_id AS "eventId",
          to_char(g.granted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "grantedAt",
          (SELECT count(*)::integer FROM audited) AS "auditCount" FROM granted g`);
      const row = inserted.rows[0];
      if (!row) failAdminRoleManagement("role_already_granted");
      ensure(row.auditCount === 1);
      const body = managedRoleResponse.parse({ grant: { id: row.id, userId: row.userId, role: row.role,
        eventId: row.eventId, grantedAt: iso(row.grantedAt), revokedAt: null } });
      await completeIdempotencyOperationWithTx(tx, intent.operationId, {
        httpStatus: 201, resultReference: row.id, resultPayload: body as unknown as JsonValue,
      });
      await assertAdminSessionWithTx(tx, input, result => failAdminRoleManagement(result.kind));
      return body;
    }, { isolationLevel: "read committed" });
  }

  async revoke(input: AdminRoleRevokeInput) {
    ensure(input.idempotencyKey.trim() && input.idempotencyKey.length <= 128 && Number.isFinite(input.expiresAt.getTime()));
    return this.database.transaction(async tx => {
      // Leitura de descoberta apenas escolhe o lock de evento; todos os campos são revalidados depois.
      const discovered = (await tx.execute<{ userId: string; role: string; eventId: string | null }>(sql`SELECT user_id AS "userId",role,event_id AS "eventId"
        FROM user_roles WHERE id=${input.grantId}::uuid`)).rows[0];
      let eventExists = true;
      if (discovered?.role === "staff" && discovered.eventId) {
        eventExists = (await tx.execute(sql`SELECT id FROM events WHERE id=${discovered.eventId}::uuid FOR UPDATE`)).rows.length === 1;
      }
      await roleMutationMutex(tx);
      await authorizeActor(tx, input);

      const intent = await reserveIdempotencyOperationWithTx(tx, {
        actorUserId: input.userId, operation: REVOKE_OPERATION, idempotencyKey: input.idempotencyKey,
        requestHash: fingerprint(REVOKE_OPERATION, { grantId: input.grantId }), expiresAt: input.expiresAt,
      });
      await assertAdminSessionWithTx(tx, input, result => failAdminRoleManagement(result.kind));
      if (intent.kind === "request_conflict" || intent.kind === "in_progress") failAdminRoleManagement(intent.kind);
      if (intent.kind === "replay") return replayBody(intent.resultPayload, intent.resultReference);

      if (!discovered || (discovered.role !== "admin" && discovered.role !== "staff")) failAdminRoleManagement("role_not_found");
      if (!eventExists) failAdminRoleManagement("event_not_found");
      const target = (await tx.execute<{ active: boolean; verified: boolean }>(sql`SELECT is_active AS active,
        email_verified_at IS NOT NULL AS verified FROM users WHERE id=${discovered.userId}::uuid FOR UPDATE`)).rows[0];
      if (!target) throw new Error("ADMIN_ROLE_TARGET_INTEGRITY");
      const grant = (await tx.execute<{ id: string; userId: string; role: "admin" | "staff"; eventId: string | null; revoked: boolean }>(sql`
        SELECT id,user_id AS "userId",role,event_id AS "eventId",revoked_at IS NOT NULL AS revoked
        FROM user_roles WHERE id=${input.grantId}::uuid FOR UPDATE`)).rows[0];
      if (!grant || grant.userId !== discovered.userId || grant.role !== discovered.role || grant.eventId !== discovered.eventId || grant.revoked) {
        failAdminRoleManagement("role_not_found");
      }
      const credential = (await tx.execute<{ verified: boolean }>(sql`SELECT is_verified AS verified FROM user_totp_credentials
        WHERE user_id=${grant.userId}::uuid`)).rows[0];
      const targetIsViable = target.active && target.verified && credential?.verified === true;

      if (grant.role === "admin" && targetIsViable) {
        const otherAdmins = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count
          FROM user_roles r JOIN users u ON u.id=r.user_id JOIN user_totp_credentials t ON t.user_id=u.id
          WHERE r.role='admin' AND r.event_id IS NULL AND r.revoked_at IS NULL AND r.user_id<>${grant.userId}::uuid
            AND u.is_active AND u.email_verified_at IS NOT NULL AND t.is_verified`);
        if (shouldBlockLastAdminRevocation(targetIsViable, otherAdmins.rows[0]?.count ?? 0)) failAdminRoleManagement("last_admin");
      }

      await assertAdminSessionWithTx(tx, input, result => failAdminRoleManagement(result.kind));
      const changed = await tx.execute<{ id: string; userId: string; role: "admin" | "staff"; eventId: string | null; revokedAt: string; auditCount: number }>(sql`
        WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at),
        revoked AS (
          UPDATE user_roles r SET revoked_at=d.at,revoked_by=${input.userId}::uuid FROM decision d
          WHERE r.id=${grant.id}::uuid AND r.user_id=${grant.userId}::uuid AND r.role=${grant.role}
            AND r.event_id IS NOT DISTINCT FROM ${grant.eventId}::uuid AND r.revoked_at IS NULL
          RETURNING r.id,r.user_id,r.role,r.event_id,r.granted_at,r.revoked_at
        ), audited AS (
          INSERT INTO audit_logs(id,actor_user_id,target_user_id,event_id,origin,category,action,metadata,occurred_at)
          SELECT ${randomUUID()}::uuid,${input.userId}::uuid,r.user_id,r.event_id,'user','identity','admin_role_revoked',
            jsonb_build_object('grantId',r.id,'role',r.role),r.revoked_at FROM revoked r RETURNING id
        )
        SELECT r.id,r.user_id AS "userId",r.role,r.event_id AS "eventId",
          to_char(r.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "revokedAt",
          (SELECT count(*)::integer FROM audited) AS "auditCount" FROM revoked r`);
      const row = changed.rows[0];
      if (!row) failAdminRoleManagement("role_not_found");
      ensure(row.auditCount === 1);
      const original = (await tx.execute<{ grantedAt: string }>(sql`SELECT to_char(granted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "grantedAt"
        FROM user_roles WHERE id=${row.id}::uuid`)).rows[0];
      ensure(original);
      const body = managedRoleResponse.parse({ grant: { id: row.id, userId: row.userId, role: row.role,
        eventId: row.eventId, grantedAt: iso(original.grantedAt), revokedAt: iso(row.revokedAt) } });
      await completeIdempotencyOperationWithTx(tx, intent.operationId, {
        httpStatus: 200, resultReference: row.id, resultPayload: body as unknown as JsonValue,
      });
      await assertAdminSessionWithTx(tx, input, result => failAdminRoleManagement(result.kind));
      return body;
    }, { isolationLevel: "read committed" });
  }
}
