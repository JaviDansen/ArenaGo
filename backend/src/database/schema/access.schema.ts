import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  jsonb,
} from "drizzle-orm/pg-core";
import { users } from "./identity.schema";
import { events } from "./events.schema";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    expiresAt: instant("expires_at").notNull(),
    lastActivityAt: instant("last_activity_at").notNull(),
    revokedAt: instant("revoked_at"),
    revocationReason: varchar("revocation_reason", { length: 50 }),
    admin2faVerifiedAt: instant("admin_2fa_verified_at"),
    ipAddress: inet("ip_address"),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_sessions_one_unrevoked_user").on(table.userId).where(sql`${table.revokedAt} IS NULL`),
    foreignKey({ name: "fk_sessions_user", columns: [table.userId], foreignColumns: [users.id] }),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    consumedAt: instant("consumed_at"),
    isRevoked: boolean("is_revoked").notNull().default(false),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("uq_refresh_tokens_hash").on(table.tokenHash),
    index("ix_refresh_tokens_session").on(table.sessionId),
    uniqueIndex("uq_refresh_tokens_one_live_session").on(table.sessionId).where(sql`${table.consumedAt} IS NULL AND ${table.isRevoked} = false`),
    foreignKey({ name: "fk_refresh_tokens_session", columns: [table.sessionId], foreignColumns: [sessions.id] }),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at"),
    createdAt: instant("created_at").notNull(),
    ipAddress: inet("ip_address"),
  },
  (table) => [
    unique("uq_password_reset_tokens_hash").on(table.tokenHash),
    foreignKey({ name: "fk_password_reset_tokens_user", columns: [table.userId], foreignColumns: [users.id] }),
  ],
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: instant("expires_at").notNull(),
    verifiedAt: instant("verified_at"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("uq_email_verification_tokens_hash").on(table.tokenHash),
    foreignKey({ name: "fk_email_verification_tokens_user", columns: [table.userId], foreignColumns: [users.id] }),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    eventId: uuid("event_id"),
    grantedBy: uuid("granted_by"),
    grantedAt: instant("granted_at").notNull(),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by"),
  },
  (table) => [
    check("ck_user_roles_shape", sql`${table.role} IN ('participante','staff','admin') AND ((${table.role} = 'staff' AND ${table.eventId} IS NOT NULL) OR (${table.role} IN ('participante','admin') AND ${table.eventId} IS NULL))`),
    uniqueIndex("uq_user_roles_global_active").on(table.userId, table.role).where(sql`${table.revokedAt} IS NULL AND ${table.eventId} IS NULL`),
    uniqueIndex("uq_user_roles_event_active").on(table.userId, table.role, table.eventId).where(sql`${table.revokedAt} IS NULL AND ${table.eventId} IS NOT NULL`),
    index("ix_user_roles_event_role_active").on(table.eventId, table.role).where(sql`${table.revokedAt} IS NULL`),
    foreignKey({ name: "fk_user_roles_user", columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: "fk_user_roles_event", columns: [table.eventId], foreignColumns: [events.id] }),
    foreignKey({ name: "fk_user_roles_granted_by", columns: [table.grantedBy], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "fk_user_roles_revoked_by", columns: [table.revokedBy], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

export const userTotpCredentials = pgTable(
  "user_totp_credentials",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: instant("verified_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    unique("uq_user_totp_credentials_user").on(table.userId),
    check("ck_user_totp_verified", sql`(${table.isVerified} = false AND ${table.verifiedAt} IS NULL) OR (${table.isVerified} = true AND ${table.verifiedAt} IS NOT NULL)`),
    foreignKey({ name: "fk_user_totp_credentials_user", columns: [table.userId], foreignColumns: [users.id] }),
  ],
);

export const userBackupCodes = pgTable(
  "user_backup_codes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    codeHash: char("code_hash", { length: 64 }).notNull(),
    usedAt: instant("used_at"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("uq_user_backup_codes_hash").on(table.codeHash),
    foreignKey({ name: "fk_user_backup_codes_user", columns: [table.userId], foreignColumns: [users.id] }),
  ],
);

export const totpActivationTokens = pgTable(
  "totp_activation_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    issuedBy: uuid("issued_by"),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at"),
    revokedAt: instant("revoked_at"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("uq_totp_activation_tokens_hash").on(table.tokenHash),
    foreignKey({ name: "fk_totp_activation_tokens_user", columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: "fk_totp_activation_tokens_issuer", columns: [table.issuedBy], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id"),
    targetUserId: uuid("target_user_id"),
    eventId: uuid("event_id"),
    origin: varchar("origin", { length: 12 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: instant("occurred_at").notNull(),
    redactedAt: instant("redacted_at"),
  },
  (table) => [
    check("ck_audit_logs_origin", sql`${table.origin} IN ('user','system','cli')`),
    index("ix_audit_logs_event_time").on(table.eventId, table.occurredAt),
    index("ix_audit_logs_actor_time").on(table.actorUserId, table.occurredAt),
    index("ix_audit_logs_target_time").on(table.targetUserId, table.occurredAt),
    foreignKey({ name: "fk_audit_logs_actor", columns: [table.actorUserId], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "fk_audit_logs_target", columns: [table.targetUserId], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "fk_audit_logs_event", columns: [table.eventId], foreignColumns: [events.id] }),
  ],
);
