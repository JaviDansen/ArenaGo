import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { events } from "./events.schema";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey(),
    eventId: uuid("event_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    queueAcceptingEntries: boolean("queue_accepting_entries").notNull().default(true),
    lastQueueOrder: bigint("last_queue_order", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    unique("uq_experiences_id_event").on(table.id, table.eventId),
    index("ix_experiences_event").on(table.eventId),
    check("ck_experiences_queue_order", sql`${table.lastQueueOrder} >= 0`),
    foreignKey({ name: "fk_experiences_event", columns: [table.eventId], foreignColumns: [events.id] }),
  ],
);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey(),
    experienceId: uuid("experience_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    availability: varchar("availability", { length: 20 }).notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    unique("uq_stations_id_experience").on(table.id, table.experienceId),
    check("ck_stations_availability", sql`${table.availability} IN ('available','unavailable')`),
    index("ix_stations_experience_availability").on(table.experienceId, table.availability),
    foreignKey({ name: "fk_stations_experience", columns: [table.experienceId], foreignColumns: [experiences.id] }),
  ],
);
