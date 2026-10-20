CREATE TABLE "idempotency_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation" varchar(80) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"status" varchar(20) NOT NULL,
	"http_status" smallint,
	"result_reference" uuid,
	"result_payload" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_idempotency_actor_operation_key" UNIQUE("actor_user_id","operation","idempotency_key"),
	CONSTRAINT "ck_idempotency_status" CHECK ("idempotency_operations"."status" IN ('in_progress','completed')),
	CONSTRAINT "ck_idempotency_http_status" CHECK (("idempotency_operations"."status" = 'in_progress' AND "idempotency_operations"."http_status" IS NULL) OR ("idempotency_operations"."status" = 'completed' AND "idempotency_operations"."http_status" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "idempotency_operations" ADD CONSTRAINT "fk_idempotency_actor" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_idempotency_expires" ON "idempotency_operations" USING btree ("expires_at");