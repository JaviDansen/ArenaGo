CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_curated" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_games_name_nonempty" CHECK (length(btrim("games"."name")) >= 1)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"birth_date" date NOT NULL,
	"gender" varchar(30) NOT NULL,
	"other_gender" varchar(100),
	"education" varchar(30) NOT NULL,
	"market_knowledge" varchar(50) NOT NULL,
	"market_interest" varchar(50) NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_profiles_gender" CHECK ("profiles"."gender" IN ('Feminino','Masculino','Outro','Prefiro não informar')),
	CONSTRAINT "ck_profiles_other_gender" CHECK (("profiles"."gender" = 'Outro' AND "profiles"."other_gender" IS NOT NULL AND length(btrim("profiles"."other_gender")) BETWEEN 1 AND 100) OR ("profiles"."gender" <> 'Outro' AND "profiles"."other_gender" IS NULL)),
	CONSTRAINT "ck_profiles_education" CHECK ("profiles"."education" IN ('Fundamental','Médio','Superior','Pós-graduação','Prefiro não informar')),
	CONSTRAINT "ck_profiles_market_knowledge" CHECK ("profiles"."market_knowledge" IN ('Sim, conheço.','Conheço um pouco.','Não conheço.')),
	CONSTRAINT "ck_profiles_market_interest" CHECK ("profiles"."market_interest" IN ('Sim, tenho interesse.','Talvez — quero conhecer melhor.','Não tenho interesse.'))
);
--> statement-breakpoint
CREATE TABLE "questionnaire_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" varchar(40) NOT NULL,
	"definition" jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_questionnaire_versions_version" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "user_games" (
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_user_games" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "fk_games_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "fk_profiles_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "fk_profiles_qversion" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "fk_user_games_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "fk_user_games_game" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_games_name_ci" ON "games" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "ix_user_games_game" ON "user_games" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email_ci" ON "users" USING btree (lower(btrim("email")));