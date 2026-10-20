CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"event_id" uuid,
	"origin" varchar(12) NOT NULL,
	"category" varchar(40) NOT NULL,
	"action" varchar(80) NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "ck_audit_logs_origin" CHECK ("audit_logs"."origin" IN ('user','system','cli'))
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_email_verification_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"ip_address" "inet",
	CONSTRAINT "uq_password_reset_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"consumed_at" timestamp with time zone,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_refresh_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(50),
	"admin_2fa_verified_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" varchar(255),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_activation_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"issued_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_totp_activation_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_backup_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" char(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_user_backup_codes_hash" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"event_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "ck_user_roles_shape" CHECK ("user_roles"."role" IN ('participante','staff','admin') AND (("user_roles"."role" = 'staff' AND "user_roles"."event_id" IS NOT NULL) OR ("user_roles"."role" IN ('participante','admin') AND "user_roles"."event_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "user_totp_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_encrypted" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_user_totp_credentials_user" UNIQUE("user_id"),
	CONSTRAINT "ck_user_totp_verified" CHECK (("user_totp_credentials"."is_verified" = false AND "user_totp_credentials"."verified_at" IS NULL) OR ("user_totp_credentials"."is_verified" = true AND "user_totp_credentials"."verified_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_actor" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_target" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "fk_email_verification_tokens_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_session" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_activation_tokens" ADD CONSTRAINT "fk_totp_activation_tokens_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_activation_tokens" ADD CONSTRAINT "fk_totp_activation_tokens_issuer" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "fk_user_backup_codes_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_granted_by" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_revoked_by" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp_credentials" ADD CONSTRAINT "fk_user_totp_credentials_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_audit_logs_event_time" ON "audit_logs" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_actor_time" ON "audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_target_time" ON "audit_logs" USING btree ("target_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_refresh_tokens_session" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refresh_tokens_one_live_session" ON "refresh_tokens" USING btree ("session_id") WHERE "refresh_tokens"."consumed_at" IS NULL AND "refresh_tokens"."is_revoked" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_one_unrevoked_user" ON "sessions" USING btree ("user_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_roles_global_active" ON "user_roles" USING btree ("user_id","role") WHERE "user_roles"."revoked_at" IS NULL AND "user_roles"."event_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_roles_event_active" ON "user_roles" USING btree ("user_id","role","event_id") WHERE "user_roles"."revoked_at" IS NULL AND "user_roles"."event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_user_roles_event_role_active" ON "user_roles" USING btree ("event_id","role") WHERE "user_roles"."revoked_at" IS NULL;