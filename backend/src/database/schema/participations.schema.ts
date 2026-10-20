import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { questionnaireVersions, users } from "./identity.schema";
import { events } from "./events.schema";
import { experiences, stations } from "./arena-structure.schema";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const participations = pgTable(
  "participations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    joinedAt: instant("joined_at").notNull(),
    externalQueueOrder: bigint("external_queue_order", { mode: "bigint" }),
    arenaEnteredAt: instant("arena_entered_at"),
    finishedAt: instant("finished_at"),
    finishReason: varchar("finish_reason", { length: 40 }),
    // FK circular versionada explicitamente em 0004_event_operations.sql.
    currentQueueEntryId: uuid("current_queue_entry_id"),
  },
  (table) => [
    unique("uq_participations_id_event").on(table.id, table.eventId),
    uniqueIndex("uq_participations_one_current_user").on(table.userId).where(sql`${table.status} IN ('waiting','active')`),
    unique("uq_participations_event_external_order").on(table.eventId, table.externalQueueOrder),
    index("ix_participations_event_status").on(table.eventId, table.status),
    index("ix_participations_user_joined").on(table.userId, table.joinedAt),
    check("ck_participations_status", sql`${table.status} IN ('waiting','active','finished','canceled')`),
    check("ck_participations_terminal", sql`(${table.status} IN ('waiting','active') AND ${table.finishedAt} IS NULL AND ${table.finishReason} IS NULL) OR (${table.status} IN ('finished','canceled') AND ${table.finishedAt} IS NOT NULL AND ${table.finishReason} IS NOT NULL)`),
    check("ck_participations_waiting_arena", sql`${table.status} <> 'waiting' OR ${table.arenaEnteredAt} IS NULL`),
    check("ck_participations_external_order", sql`${table.externalQueueOrder} IS NULL OR ${table.externalQueueOrder} > 0`),
    foreignKey({ name: "fk_participations_user", columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: "fk_participations_event", columns: [table.eventId], foreignColumns: [events.id] }),
  ],
);

export const queueEntries = pgTable(
  "queue_entries",
  {
    id: uuid("id").primaryKey(),
    participationId: uuid("participation_id").notNull(),
    eventId: uuid("event_id").notNull(),
    experienceId: uuid("experience_id").notNull(),
    queueOrder: bigint("queue_order", { mode: "bigint" }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    enteredAt: instant("entered_at").notNull(),
    closedAt: instant("closed_at"),
    closeReason: varchar("close_reason", { length: 40 }),
  },
  (table) => [
    unique("uq_queue_entries_id_participation").on(table.id, table.participationId),
    unique("uq_queue_entries_id_experience").on(table.id, table.experienceId),
    unique("uq_queue_entries_experience_order").on(table.experienceId, table.queueOrder),
    uniqueIndex("uq_queue_entries_one_active_participation").on(table.participationId).where(sql`${table.status} IN ('waiting','called')`),
    index("ix_queue_entries_fifo").on(table.experienceId, table.queueOrder, table.id).where(sql`${table.status} = 'waiting'`),
    check("ck_queue_entries_status", sql`${table.status} IN ('waiting','called','closed')`),
    check("ck_queue_entries_order", sql`${table.queueOrder} > 0`),
    check("ck_queue_entries_closed", sql`(${table.status} = 'closed' AND ${table.closedAt} IS NOT NULL AND ${table.closeReason} IS NOT NULL) OR (${table.status} IN ('waiting','called') AND ${table.closedAt} IS NULL AND ${table.closeReason} IS NULL)`),
    foreignKey({ name: "fk_queue_entries_participation_event", columns: [table.participationId, table.eventId], foreignColumns: [participations.id, participations.eventId] }),
    foreignKey({ name: "fk_queue_entries_experience_event", columns: [table.experienceId, table.eventId], foreignColumns: [experiences.id, experiences.eventId] }),
  ],
);

export const serviceSessions = pgTable(
  "service_sessions",
  {
    id: uuid("id").primaryKey(),
    queueEntryId: uuid("queue_entry_id").notNull(),
    experienceId: uuid("experience_id").notNull(),
    stationId: uuid("station_id").notNull(),
    calledByUserId: uuid("called_by_user_id"),
    calledAt: instant("called_at").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedAt: instant("resolved_at"),
    cancelReason: varchar("cancel_reason", { length: 40 }),
  },
  (table) => [
    unique("uq_service_sessions_queue_entry").on(table.queueEntryId),
    uniqueIndex("uq_service_sessions_pending_station").on(table.stationId).where(sql`${table.status} = 'pending'`),
    index("ix_service_sessions_experience_status_called").on(table.experienceId, table.status, table.calledAt),
    index("ix_service_sessions_resolved").on(table.resolvedAt),
    check("ck_service_sessions_status", sql`${table.status} IN ('pending','completed','absent','canceled')`),
    check("ck_service_sessions_resolution", sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL AND ${table.cancelReason} IS NULL) OR (${table.status} IN ('completed','absent') AND ${table.resolvedAt} IS NOT NULL AND ${table.cancelReason} IS NULL) OR (${table.status} = 'canceled' AND ${table.resolvedAt} IS NOT NULL AND ${table.cancelReason} IS NOT NULL)`),
    foreignKey({ name: "fk_service_sessions_called_by", columns: [table.calledByUserId], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "fk_service_sessions_resolved_by", columns: [table.resolvedByUserId], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "fk_service_sessions_queue_experience", columns: [table.queueEntryId, table.experienceId], foreignColumns: [queueEntries.id, queueEntries.experienceId] }),
    foreignKey({ name: "fk_service_sessions_station_experience", columns: [table.stationId, table.experienceId], foreignColumns: [stations.id, stations.experienceId] }),
  ],
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey(),
    participationId: uuid("participation_id").notNull(),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    submittedAt: instant("submitted_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    firstCommentAt: instant("first_comment_at"),
  },
  (table) => [
    unique("uq_evaluations_participation").on(table.participationId),
    check("ck_evaluations_rating", sql`${table.rating} BETWEEN 1 AND 5`),
    foreignKey({ name: "fk_evaluations_participation", columns: [table.participationId], foreignColumns: [participations.id] }),
  ],
);

export const participationProfileSnapshots = pgTable(
  "participation_profile_snapshots",
  {
    participationId: uuid("participation_id").primaryKey(),
    questionnaireVersionId: uuid("questionnaire_version_id").notNull(),
    answers: jsonb("answers").notNull(),
    gamesSnapshot: jsonb("games_snapshot").notNull(),
    ageBandAtEvent: varchar("age_band_at_event", { length: 30 }),
    capturedAt: instant("captured_at").notNull(),
  },
  (table) => [
    index("ix_snapshots_questionnaire_version").on(table.questionnaireVersionId),
    foreignKey({ name: "fk_snapshots_participation", columns: [table.participationId], foreignColumns: [participations.id] }),
    foreignKey({ name: "fk_snapshots_qversion", columns: [table.questionnaireVersionId], foreignColumns: [questionnaireVersions.id] }),
  ],
);
