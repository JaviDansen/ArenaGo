CREATE TABLE IF NOT EXISTS "device_push_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"push_token" varchar(255) NOT NULL,
	"platform" varchar(20) DEFAULT 'android' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "uq_device_push_tokens_token" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_call_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "uq_queue_call_outbox_session" UNIQUE("service_session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_device_push_tokens_user" ON "device_push_tokens" USING btree ("user_id","revoked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_queue_call_outbox_pending" ON "queue_call_outbox" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "fk_device_push_tokens_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_service_session" FOREIGN KEY ("service_session_id") REFERENCES "public"."service_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_experience" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;
