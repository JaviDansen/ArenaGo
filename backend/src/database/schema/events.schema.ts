import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    accessCodeNormalized: varchar("access_code_normalized", { length: 64 }).notNull(),
    timezone: varchar("timezone", { length: 80 }).notNull(),
    startsAt: instant("starts_at").notNull(),
    officialEndsAt: instant("official_ends_at").notNull(),
    operationalDeadlineAt: instant("operational_deadline_at").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    externalQueueEnabled: boolean("external_queue_enabled").notNull(),
    externalLastOrder: bigint("external_last_order", { mode: "bigint" }).notNull().default(sql`0`),
    closureMode: varchar("closure_mode", { length: 20 }),
    closureRequestedAt: instant("closure_requested_at"),
    adminDeadlineAt: instant("admin_deadline_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_events_access_code").on(table.accessCodeNormalized),
    check("ck_events_status", sql`${table.status} IN ('scheduled','open','closing','closed')`),
    check("ck_events_time", sql`${table.startsAt} < ${table.officialEndsAt} AND ${table.officialEndsAt} <= ${table.operationalDeadlineAt} AND ${table.operationalDeadlineAt} <= ${table.officialEndsAt} + interval '1 hour'`),
    check("ck_events_external_order", sql`${table.externalLastOrder} >= 0`),
    check("ck_events_access_code", sql`${table.accessCodeNormalized} = upper(btrim(${table.accessCodeNormalized}))`),
    check("ck_events_closure_shape", sql`(${table.closureMode} IS NULL AND ${table.closureRequestedAt} IS NULL AND ${table.adminDeadlineAt} IS NULL) OR (${table.closureMode} IN ('immediate','controlled') AND ${table.closureRequestedAt} IS NOT NULL AND ${table.adminDeadlineAt} IS NOT NULL)`),
    check("ck_events_closure_deadline", sql`${table.closureMode} IS NULL OR (${table.closureMode} = 'immediate' AND ${table.adminDeadlineAt} = ${table.closureRequestedAt}) OR (${table.closureMode} = 'controlled' AND ${table.closureRequestedAt} < ${table.adminDeadlineAt} AND ${table.adminDeadlineAt} <= LEAST(${table.closureRequestedAt} + interval '1 hour', ${table.operationalDeadlineAt}))`),
  ],
);
