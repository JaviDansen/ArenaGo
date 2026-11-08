import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import type * as schema from "../database/schema";
import { ProblemException } from "../common/errors/problem.exception";
import { AUTHENTICATED_PRINCIPAL_KEY, type AuthenticatedRequest } from "./session-auth.guard";

export interface MutationSession { userId: string; sessionId: string; staffEventId?: string }
export class MutationSessionError extends ProblemException {}
function reject(code: string, detail: string): never {
  throw new MutationSessionError({ status: 401, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
    title: "Autenticação obrigatória", detail });
}
export function assertMutationSession(context: MutationSession, userId: string): void {
  if (!context?.userId || !context.sessionId || context.userId !== userId) {
    reject("UNAUTHENTICATED_CONTEXT", "Contexto de sessão autenticada não encontrado na requisição.");
  }
}
/** Somente o principal instalado pelo guard; nunca headers, query, body ou request.user. */
export function mutationSession(request: AuthenticatedRequest, userId: string): MutationSession {
  const principal = request[AUTHENTICATED_PRINCIPAL_KEY];
  const context = { userId: principal?.userId ?? "", sessionId: principal?.sessionId ?? "" };
  assertMutationSession(context, userId);
  return context;
}

/** Recursos de domínio / reserva existentes precedem conta -> concessões -> sessão.
 * SELECT de tempo separado: uma expressão no SELECT FOR SHARE pode preceder a espera.
 */
export async function revalidateMutationSession(tx: DatabaseTransactionExecutor, context: MutationSession): Promise<void> {
  assertMutationSession(context, context?.userId);
  await tx.execute(sql`SELECT id FROM users WHERE id=${context.userId}::uuid FOR SHARE`);
  await tx.execute(sql`SELECT id FROM user_roles WHERE user_id=${context.userId}::uuid AND revoked_at IS NULL ORDER BY id FOR SHARE`);
  await tx.execute(sql`SELECT id FROM sessions WHERE id=${context.sessionId}::uuid AND user_id=${context.userId}::uuid FOR SHARE`);
  const row = (await tx.execute<{ revoked: boolean; expired: boolean; active: boolean; secondFactor: boolean; admin: boolean; staff: boolean }>(sql`
    SELECT s.revoked_at IS NOT NULL AS revoked, s.expires_at <= clock_timestamp() AS expired,
      u.is_active AS active, s.admin_2fa_verified_at IS NOT NULL AS "secondFactor",
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='admin' AND r.event_id IS NULL AND r.revoked_at IS NULL) AS admin,
      (u.email_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='staff'
        AND r.event_id=${context.staffEventId ?? null}::uuid AND r.revoked_at IS NULL)) AS staff
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${context.sessionId}::uuid AND s.user_id=${context.userId}::uuid
  `)).rows[0];
  if (!row) reject("INVALID_SESSION", "A sessão associada ao token não foi encontrada.");
  if (row.revoked) reject("SESSION_REVOKED", "Esta sessão foi revogada. Faça login novamente.");
  if (row.expired) reject("SESSION_EXPIRED", "O prazo da sessão expirou. Faça login novamente.");
  if (!row.active) reject("ACCOUNT_DEACTIVATED", "Esta conta encontra-se desativada.");
  if (row.admin && !row.secondFactor) reject("ADMIN_2FA_REQUIRED", "Sessão administrativa exige verificação de segundo fator (TOTP).");
  if (context.staffEventId && !row.staff) {
    throw new ProblemException({ status: 403, code: "STAFF_EVENT_FORBIDDEN", typeSlug: "staff-event-forbidden",
      title: "Acesso negado", detail: "Staff autorizado para este evento é obrigatório." });
  }
}

/** null é reservado aos contratos internos existentes, nunca aos métodos HTTP autenticados.
 * A última consulta precede o retorno do callback/COMMIT. Expiração posterior a essa
 * consulta não é observável atomicamente com COMMIT; nenhum prazo de tolerância é criado.
 */
export function mutationTransaction<T>(database: NodePgDatabase<typeof schema>, context: MutationSession | null,
  operation: (tx: DatabaseTransactionExecutor) => Promise<T>, config: { isolationLevel: "read committed" }): Promise<T> {
  return database.transaction(async tx => {
    const result = await operation(tx);
    if (context !== null) await revalidateMutationSession(tx, context);
    return result;
  }, config);
}
