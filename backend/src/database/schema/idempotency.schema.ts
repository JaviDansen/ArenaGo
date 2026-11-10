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
    originSessionId: uuid("origin_session_id"),
    originAssurance: varchar("origin_assurance", { length: 20 }).notNull().default("legacy"),
    originEpochId: uuid("origin_epoch_id"),
    resultState: varchar("result_state", { length: 20 }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    resultRetainUntil: timestamp("result_retain_until", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("uq_idempotency_actor_operation_key").on(table.actorUserId, table.operation, table.idempotencyKey),
    index("ix_idempotency_expires").on(table.expiresAt),
    check("ck_idempotency_status", sql`${table.status} IN ('in_progress','completed')`),
    check("ck_idempotency_http_status", sql`(${table.status} = 'in_progress' AND ${table.httpStatus} IS NULL) OR (${table.status} = 'completed' AND ${table.httpStatus} IS NOT NULL)`),
    // Etapa A: ainda não existe caminho autorizado para prova ou compactação.
    check("ck_idempotency_staff_preparation_disabled", sql`${table.originAssurance} = 'legacy' AND ${table.originSessionId} IS NULL AND ${table.originEpochId} IS NULL AND ${table.resultState} IS NULL AND ${table.completedAt} IS NULL AND ${table.resultRetainUntil} IS NULL`),
    foreignKey({ name: "fk_idempotency_actor", columns: [table.actorUserId], foreignColumns: [users.id] }),
  ],
);

/** Marcos são somente planejados nesta etapa; nenhum estado ativo é aceito. */
export const staffIdempotencyEpochs = pgTable(
  "staff_idempotency_epochs",
  {
    id: uuid("id").primaryKey(),
    controlsVersion: varchar("controls_version", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    changeReference: varchar("change_reference", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check("ck_staff_idempotency_epoch_pending", sql`${table.status} = 'pending' AND ${table.activatedAt} IS NULL AND ${table.invalidatedAt} IS NULL`),
    check("ck_staff_idempotency_epoch_version", sql`length(btrim(${table.controlsVersion})) > 0`),
  ],
);
