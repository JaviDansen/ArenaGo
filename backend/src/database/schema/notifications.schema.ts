import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./identity.schema";
import { events } from "./events.schema";
import { experiences } from "./arena-structure.schema";
import { serviceSessions } from "./participations.schema";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const devicePushTokens = pgTable(
  "device_push_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    pushToken: varchar("push_token", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 20 }).notNull().default("android"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    revokedAt: instant("revoked_at"),
  },
  (table) => [
    unique("uq_device_push_tokens_token").on(table.pushToken),
    index("ix_device_push_tokens_user").on(table.userId, table.revokedAt),
    foreignKey({
      name: "fk_device_push_tokens_user",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const queueCallOutbox = pgTable(
  "queue_call_outbox",
  {
    id: uuid("id").primaryKey(),
    serviceSessionId: uuid("service_session_id").notNull(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id").notNull(),
    experienceId: uuid("experience_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: instant("next_attempt_at"),
    lockedAt: instant("locked_at"),
    ticketId: varchar("ticket_id", { length: 255 }),
    lastError: text("last_error"),
    createdAt: instant("created_at").notNull(),
    processedAt: instant("processed_at"),
  },
  (table) => [
    unique("uq_queue_call_outbox_session").on(table.serviceSessionId),
    index("ix_queue_call_outbox_pending").on(table.status, table.nextAttemptAt, table.createdAt),
    foreignKey({
      name: "fk_queue_call_outbox_service_session",
      columns: [table.serviceSessionId],
      foreignColumns: [serviceSessions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_queue_call_outbox_user",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_queue_call_outbox_event",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_queue_call_outbox_experience",
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
    }).onDelete("cascade"),
  ],
);
