import { sql, type SQL } from "drizzle-orm";

export const AUTOMATIC_OPERATIONAL_REASON = "automatic_operational_deadline";
export const AUTOMATIC_ADMIN_REASON = "automatic_admin_deadline";

/** SQL interno compartilhado com o regularizador E08.9; aliases nunca vêm do HTTP. */
export function effectiveEventDeadline(event: SQL = sql`e`): SQL {
  return sql`LEAST(${event}.operational_deadline_at,${event}.admin_deadline_at)`;
}
export function automaticFinalizationReason(event: SQL = sql`e`): SQL {
  return sql`CASE WHEN ${event}.closure_mode IS NULL THEN ${AUTOMATIC_OPERATIONAL_REASON} ELSE ${AUTOMATIC_ADMIN_REASON} END`;
}
