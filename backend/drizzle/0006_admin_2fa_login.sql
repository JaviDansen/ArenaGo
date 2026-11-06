ALTER TABLE "user_totp_credentials"
  ADD COLUMN "last_totp_counter" bigint;
--> statement-breakpoint
CREATE TABLE "admin_2fa_challenges" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_2fa_challenges" ADD CONSTRAINT "ck_admin_2fa_challenges_expiration" CHECK ("expires_at" > "issued_at" AND "expires_at" <= "issued_at" + interval '5 minutes');
--> statement-breakpoint
ALTER TABLE "admin_2fa_challenges" ADD CONSTRAINT "ck_admin_2fa_challenges_terminal" CHECK (NOT ("consumed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "admin_2fa_challenges" ADD CONSTRAINT "fk_admin_2fa_challenges_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ix_admin_2fa_challenges_user_created" ON "admin_2fa_challenges" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "ix_admin_2fa_challenges_expires" ON "admin_2fa_challenges" USING btree ("expires_at");
