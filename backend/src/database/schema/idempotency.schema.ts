import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./identity.schema";

export const idempotencyOperations = pgTable(
  "idempotency_operations",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id").notNull(),
    operation: varchar("operation", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    httpStatus: smallint("http_status"),
    resultReference: uuid("result_reference"),
    resultPayload: jsonb("result_payload"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    unique("uq_idempotency_actor_operation_key").on(table.actorUserId, table.operation, table.idempotencyKey),
    index("ix_idempotency_expires").on(table.expiresAt),
    check("ck_idempotency_status", sql`${table.status} IN ('in_progress','completed')`),
    check("ck_idempotency_http_status", sql`(${table.status} = 'in_progress' AND ${table.httpStatus} IS NULL) OR (${table.status} = 'completed' AND ${table.httpStatus} IS NOT NULL)`),
    foreignKey({ name: "fk_idempotency_actor", columns: [table.actorUserId], foreignColumns: [users.id] }),
  ],
);
