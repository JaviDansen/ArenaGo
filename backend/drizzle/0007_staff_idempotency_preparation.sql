ALTER TABLE "public"."idempotency_operations"
  ADD COLUMN "origin_session_id" uuid,
  ADD COLUMN "origin_assurance" varchar(20) DEFAULT 'legacy' NOT NULL,
  ADD COLUMN "origin_epoch_id" uuid,
  ADD COLUMN "result_state" varchar(20),
  ADD COLUMN "completed_at" timestamp with time zone,
  ADD COLUMN "result_retain_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."idempotency_operations" ADD CONSTRAINT "ck_idempotency_staff_preparation_disabled"
  CHECK ("origin_assurance" = 'legacy' AND "origin_session_id" IS NULL AND "origin_epoch_id" IS NULL
    AND "result_state" IS NULL AND "completed_at" IS NULL AND "result_retain_until" IS NULL);
--> statement-breakpoint
CREATE TABLE "public"."staff_idempotency_epochs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "controls_version" varchar(80) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "change_reference" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  CONSTRAINT "ck_staff_idempotency_epoch_pending" CHECK ("status" = 'pending' AND "activated_at" IS NULL AND "invalidated_at" IS NULL),
  CONSTRAINT "ck_staff_idempotency_epoch_version" CHECK (length(btrim("controls_version")) > 0)
);
--> statement-breakpoint
-- Controle local de UPDATE; não impede DELETE nem substitui proteção por papéis.
CREATE FUNCTION "public"."staff_idempotency_preparation_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD."operation" IN ('call_next', 'complete_service_session', 'absent_service_session')
     OR NEW."operation" IN ('call_next', 'complete_service_session', 'absent_service_session') THEN
    IF OLD."id" IS DISTINCT FROM NEW."id"
       OR OLD."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
       OR OLD."operation" IS DISTINCT FROM NEW."operation"
       OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
       OR OLD."request_hash" IS DISTINCT FROM NEW."request_hash" THEN
      RAISE EXCEPTION 'Identidade da operação Staff é imutável' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" = 'completed' AND
       (NEW."status" IS DISTINCT FROM OLD."status"
        OR NEW."http_status" IS DISTINCT FROM OLD."http_status"
        OR NEW."result_reference" IS DISTINCT FROM OLD."result_reference"
        OR NEW."result_payload" IS DISTINCT FROM OLD."result_payload") THEN
      RAISE EXCEPTION 'Resultado terminal Staff é imutável' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tr_staff_idempotency_preparation_guard"
  BEFORE UPDATE ON "public"."idempotency_operations"
  FOR EACH ROW EXECUTE FUNCTION "public"."staff_idempotency_preparation_guard"();
