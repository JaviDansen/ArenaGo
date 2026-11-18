import { sql, type SQLWrapper } from "drizzle-orm";

export type EventInstant = Date | bigint;

export function toEpochMicros(instant: EventInstant): bigint | null {
  if (typeof instant === "bigint") return instant;
  const milliseconds = instant.getTime();
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000n : null;
}

/** PostgreSQL calcula o epoch em numeric. O texto evita coerção do driver para double. */
export function epochMicrosText(instant: SQLWrapper) {
  return sql<string>`trunc(extract(epoch from ${instant}) * 1000000)::text`;
}

/** Projeta a precisão persistida, fora do mapeamento timestamp → Date do Drizzle. */
export function readEventInstant(instant: SQLWrapper) {
  return epochMicrosText(instant).mapWith((value: string): EventInstant =>
    /^-?\d+$/.test(value) ? BigInt(value) : new Date(Number.NaN));
}
