CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"queue_accepting_entries" boolean DEFAULT true NOT NULL,
	"last_queue_order" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_experiences_id_event" UNIQUE("id","event_id"),
	CONSTRAINT "ck_experiences_queue_order" CHECK ("experiences"."last_queue_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"experience_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"availability" varchar(20) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_stations_id_experience" UNIQUE("id","experience_id"),
	CONSTRAINT "ck_stations_availability" CHECK ("stations"."availability" IN ('available','unavailable'))
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participation_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"first_comment_at" timestamp with time zone,
	CONSTRAINT "uq_evaluations_participation" UNIQUE("participation_id"),
	CONSTRAINT "ck_evaluations_rating" CHECK ("evaluations"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "participation_profile_snapshots" (
	"participation_id" uuid PRIMARY KEY NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"games_snapshot" jsonb NOT NULL,
	"age_band_at_event" varchar(30),
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"external_queue_order" bigint,
	"arena_entered_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"finish_reason" varchar(40),
	"current_queue_entry_id" uuid,
	CONSTRAINT "uq_participations_id_event" UNIQUE("id","event_id"),
	CONSTRAINT "uq_participations_event_external_order" UNIQUE("event_id","external_queue_order"),
	CONSTRAINT "ck_participations_status" CHECK ("participations"."status" IN ('waiting','active','finished','canceled')),
	CONSTRAINT "ck_participations_terminal" CHECK (("participations"."status" IN ('waiting','active') AND "participations"."finished_at" IS NULL AND "participations"."finish_reason" IS NULL) OR ("participations"."status" IN ('finished','canceled') AND "participations"."finished_at" IS NOT NULL AND "participations"."finish_reason" IS NOT NULL)),
	CONSTRAINT "ck_participations_waiting_arena" CHECK ("participations"."status" <> 'waiting' OR "participations"."arena_entered_at" IS NULL),
	CONSTRAINT "ck_participations_external_order" CHECK ("participations"."external_queue_order" IS NULL OR "participations"."external_queue_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "queue_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"queue_order" bigint NOT NULL,
	"status" varchar(20) NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" varchar(40),
	CONSTRAINT "uq_queue_entries_id_participation" UNIQUE("id","participation_id"),
	CONSTRAINT "uq_queue_entries_id_experience" UNIQUE("id","experience_id"),
	CONSTRAINT "uq_queue_entries_experience_order" UNIQUE("experience_id","queue_order"),
	CONSTRAINT "ck_queue_entries_status" CHECK ("queue_entries"."status" IN ('waiting','called','closed')),
	CONSTRAINT "ck_queue_entries_order" CHECK ("queue_entries"."queue_order" > 0),
	CONSTRAINT "ck_queue_entries_closed" CHECK (("queue_entries"."status" = 'closed' AND "queue_entries"."closed_at" IS NOT NULL AND "queue_entries"."close_reason" IS NOT NULL) OR ("queue_entries"."status" IN ('waiting','called') AND "queue_entries"."closed_at" IS NULL AND "queue_entries"."close_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "service_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue_entry_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"called_by_user_id" uuid,
	"called_at" timestamp with time zone NOT NULL,
	"status" varchar(20) NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"cancel_reason" varchar(40),
	CONSTRAINT "uq_service_sessions_queue_entry" UNIQUE("queue_entry_id"),
	CONSTRAINT "ck_service_sessions_status" CHECK ("service_sessions"."status" IN ('pending','completed','absent','canceled')),
	CONSTRAINT "ck_service_sessions_resolution" CHECK (("service_sessions"."status" = 'pending' AND "service_sessions"."resolved_at" IS NULL AND "service_sessions"."resolved_by_user_id" IS NULL AND "service_sessions"."cancel_reason" IS NULL) OR ("service_sessions"."status" IN ('completed','absent') AND "service_sessions"."resolved_at" IS NOT NULL AND "service_sessions"."cancel_reason" IS NULL) OR ("service_sessions"."status" = 'canceled' AND "service_sessions"."resolved_at" IS NOT NULL AND "service_sessions"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "fk_experiences_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "fk_stations_experience" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "fk_evaluations_participation" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_profile_snapshots" ADD CONSTRAINT "fk_snapshots_participation" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_profile_snapshots" ADD CONSTRAINT "fk_snapshots_qversion" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "fk_participations_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "fk_participations_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "fk_queue_entries_participation_event" FOREIGN KEY ("participation_id","event_id") REFERENCES "public"."participations"("id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "fk_queue_entries_experience_event" FOREIGN KEY ("experience_id","event_id") REFERENCES "public"."experiences"("id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "fk_service_sessions_called_by" FOREIGN KEY ("called_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "fk_service_sessions_resolved_by" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "fk_service_sessions_queue_experience" FOREIGN KEY ("queue_entry_id","experience_id") REFERENCES "public"."queue_entries"("id","experience_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "fk_service_sessions_station_experience" FOREIGN KEY ("station_id","experience_id") REFERENCES "public"."stations"("id","experience_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_experiences_event" ON "experiences" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_stations_experience_availability" ON "stations" USING btree ("experience_id","availability");--> statement-breakpoint
CREATE INDEX "ix_snapshots_questionnaire_version" ON "participation_profile_snapshots" USING btree ("questionnaire_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_participations_one_current_user" ON "participations" USING btree ("user_id") WHERE "participations"."status" IN ('waiting','active');--> statement-breakpoint
CREATE INDEX "ix_participations_event_status" ON "participations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "ix_participations_user_joined" ON "participations" USING btree ("user_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_queue_entries_one_active_participation" ON "queue_entries" USING btree ("participation_id") WHERE "queue_entries"."status" IN ('waiting','called');--> statement-breakpoint
CREATE INDEX "ix_queue_entries_fifo" ON "queue_entries" USING btree ("experience_id","queue_order","id") WHERE "queue_entries"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_service_sessions_pending_station" ON "service_sessions" USING btree ("station_id") WHERE "service_sessions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_service_sessions_experience_status_called" ON "service_sessions" USING btree ("experience_id","status","called_at");--> statement-breakpoint
CREATE INDEX "ix_service_sessions_resolved" ON "service_sessions" USING btree ("resolved_at");
--> statement-breakpoint
ALTER TABLE participations
ADD CONSTRAINT fk_participations_current_queue_entry
FOREIGN KEY (current_queue_entry_id, id)
REFERENCES queue_entries (id, participation_id)
MATCH SIMPLE ON DELETE NO ACTION ON UPDATE NO ACTION;
