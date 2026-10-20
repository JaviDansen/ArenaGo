CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(180) NOT NULL,
	"access_code_normalized" varchar(64) NOT NULL,
	"timezone" varchar(80) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"official_ends_at" timestamp with time zone NOT NULL,
	"operational_deadline_at" timestamp with time zone NOT NULL,
	"status" varchar(20) NOT NULL,
	"external_queue_enabled" boolean NOT NULL,
	"external_last_order" bigint DEFAULT 0 NOT NULL,
	"closure_mode" varchar(20),
	"closure_requested_at" timestamp with time zone,
	"admin_deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_events_status" CHECK ("events"."status" IN ('scheduled','open','closing','closed')),
	CONSTRAINT "ck_events_time" CHECK ("events"."starts_at" < "events"."official_ends_at" AND "events"."official_ends_at" <= "events"."operational_deadline_at" AND "events"."operational_deadline_at" <= "events"."official_ends_at" + interval '1 hour'),
	CONSTRAINT "ck_events_external_order" CHECK ("events"."external_last_order" >= 0),
	CONSTRAINT "ck_events_access_code" CHECK ("events"."access_code_normalized" = upper(btrim("events"."access_code_normalized"))),
	CONSTRAINT "ck_events_closure_shape" CHECK (("events"."closure_mode" IS NULL AND "events"."closure_requested_at" IS NULL AND "events"."admin_deadline_at" IS NULL) OR ("events"."closure_mode" IN ('immediate','controlled') AND "events"."closure_requested_at" IS NOT NULL AND "events"."admin_deadline_at" IS NOT NULL)),
	CONSTRAINT "ck_events_closure_deadline" CHECK ("events"."closure_mode" IS NULL OR ("events"."closure_mode" = 'immediate' AND "events"."admin_deadline_at" = "events"."closure_requested_at") OR ("events"."closure_mode" = 'controlled' AND "events"."closure_requested_at" < "events"."admin_deadline_at" AND "events"."admin_deadline_at" <= LEAST("events"."closure_requested_at" + interval '1 hour', "events"."operational_deadline_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_events_access_code" ON "events" USING btree ("access_code_normalized");
--> statement-breakpoint
CREATE FUNCTION prevent_event_access_code_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.access_code_normalized IS DISTINCT FROM OLD.access_code_normalized THEN
    RAISE EXCEPTION 'event access code is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ck_events_access_code_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tr_events_access_code_immutable
BEFORE UPDATE OF access_code_normalized ON events
FOR EACH ROW EXECUTE FUNCTION prevent_event_access_code_change();
