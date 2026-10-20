import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  text,
  boolean,
  check,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: instant("email_verified_at"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_users_email_ci").on(sql`lower(btrim(${table.email}))`)],
);

export const questionnaireVersions = pgTable(
  "questionnaire_versions",
  {
    id: uuid("id").primaryKey(),
    version: varchar("version", { length: 40 }).notNull(),
    definition: jsonb("definition").notNull(),
    activatedAt: instant("activated_at"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [unique("uq_questionnaire_versions_version").on(table.version)],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id").primaryKey(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    gender: varchar("gender", { length: 30 }).notNull(),
    otherGender: varchar("other_gender", { length: 100 }),
    education: varchar("education", { length: 30 }).notNull(),
    marketKnowledge: varchar("market_knowledge", { length: 50 }).notNull(),
    marketInterest: varchar("market_interest", { length: 50 }).notNull(),
    questionnaireVersionId: uuid("questionnaire_version_id").notNull(),
    completedAt: instant("completed_at").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    check("ck_profiles_gender", sql`${table.gender} IN ('Feminino','Masculino','Outro','Prefiro não informar')`),
    check("ck_profiles_other_gender", sql`(${table.gender} = 'Outro' AND ${table.otherGender} IS NOT NULL AND length(btrim(${table.otherGender})) BETWEEN 1 AND 100) OR (${table.gender} <> 'Outro' AND ${table.otherGender} IS NULL)`),
    check("ck_profiles_education", sql`${table.education} IN ('Fundamental','Médio','Superior','Pós-graduação','Prefiro não informar')`),
    check("ck_profiles_market_knowledge", sql`${table.marketKnowledge} IN ('Sim, conheço.','Conheço um pouco.','Não conheço.')`),
    check("ck_profiles_market_interest", sql`${table.marketInterest} IN ('Sim, tenho interesse.','Talvez — quero conhecer melhor.','Não tenho interesse.')`),
    foreignKey({ name: "fk_profiles_user", columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: "fk_profiles_qversion", columns: [table.questionnaireVersionId], foreignColumns: [questionnaireVersions.id] }),
  ],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    isCurated: boolean("is_curated").notNull().default(false),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_games_name_ci").on(sql`lower(btrim(${table.name}))`),
    check("ck_games_name_nonempty", sql`length(btrim(${table.name})) >= 1`),
    foreignKey({ name: "fk_games_creator", columns: [table.createdByUserId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

export const userGames = pgTable(
  "user_games",
  {
    userId: uuid("user_id").notNull(),
    gameId: uuid("game_id").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    primaryKey({ name: "pk_user_games", columns: [table.userId, table.gameId] }),
    index("ix_user_games_game").on(table.gameId),
    foreignKey({ name: "fk_user_games_user", columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: "fk_user_games_game", columns: [table.gameId], foreignColumns: [games.id] }),
  ],
);
