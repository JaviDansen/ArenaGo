import { sql } from "drizzle-orm";
import type { DatabaseTransactionExecutor } from "../database/database-executor";

export type AdminAuthFailure = "account_inactive" | "admin_required" | "invalid_session"
  | "session_revoked" | "session_expired" | "admin_2fa_required";
type Actor = { userId: string; sessionId: string };
type Deny = (result: { kind: AdminAuthFailure }) => never;

/** Instrução nova depois de locks/reserva: clock_timestamp não precede a espera. */
export async function assertAdminSessionWithTx(tx: DatabaseTransactionExecutor, input: Actor, deny: Deny) {
  const rows = await tx.execute<{ revoked: boolean; expired: boolean; secondFactor: boolean }>(sql`
    SELECT revoked_at IS NOT NULL AS revoked, expires_at <= clock_timestamp() AS expired,
      admin_2fa_verified_at IS NOT NULL AS "secondFactor"
    FROM sessions WHERE id=${input.sessionId} AND user_id=${input.userId}`);
  const auth = rows.rows[0];
  if (!auth) deny({ kind: "invalid_session" });
  if (auth.revoked) deny({ kind: "session_revoked" });
  if (auth.expired) deny({ kind: "session_expired" });
  if (!auth.secondFactor) deny({ kind: "admin_2fa_required" });
}

/** Recursos do evento primeiro; conta -> concessão global -> sessão, retidos até COMMIT. */
export async function authorizeGlobalAdminWithTx(tx: DatabaseTransactionExecutor, input: Actor, deny: Deny) {
  const account = await tx.execute<{ active: boolean }>(sql`SELECT is_active AS active FROM users WHERE id=${input.userId} FOR SHARE`);
  if (!account.rows[0]?.active) deny({ kind: "account_inactive" });
  const role = await tx.execute(sql`SELECT id FROM user_roles WHERE user_id=${input.userId}
    AND role='admin' AND event_id IS NULL AND revoked_at IS NULL ORDER BY id FOR SHARE`);
  if (!role.rows.length) deny({ kind: "admin_required" });
  const session = await tx.execute(sql`SELECT id FROM sessions WHERE id=${input.sessionId} AND user_id=${input.userId} FOR SHARE`);
  if (!session.rows.length) deny({ kind: "invalid_session" });
  await assertAdminSessionWithTx(tx, input, deny);
}
