CREATE TABLE public.external_entry_calls (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  participation_id uuid NOT NULL,
  called_by_user_id uuid,
  called_at timestamptz NOT NULL,
  status varchar(20) NOT NULL,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  resolution_reason varchar(64),
  CONSTRAINT fk_external_calls_event FOREIGN KEY(event_id) REFERENCES public.events(id),
  CONSTRAINT fk_external_calls_participation_event FOREIGN KEY(participation_id,event_id) REFERENCES public.participations(id,event_id),
  CONSTRAINT fk_external_calls_caller FOREIGN KEY(called_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fk_external_calls_resolver FOREIGN KEY(resolved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT ck_external_calls_status CHECK(status IN ('pending','confirmed','absent','removed','canceled')),
  CONSTRAINT ck_external_calls_resolution CHECK (
    (status='pending' AND resolved_at IS NULL AND resolved_by_user_id IS NULL AND resolution_reason IS NULL) OR
    (status<>'pending' AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason))>0 AND resolved_at>=called_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_external_calls_pending_event ON public.external_entry_calls(event_id) WHERE status='pending';
CREATE UNIQUE INDEX uq_external_calls_pending_participation ON public.external_entry_calls(participation_id) WHERE status='pending';
CREATE INDEX ix_external_calls_participation_time ON public.external_entry_calls(participation_id,called_at);
--> statement-breakpoint
-- Autor pode ser anonimizado por DELETE da conta. Não armazenar nome/credencial.
-- O histórico terminal só admite a anonimização de FKs cuja conta já foi removida.
CREATE FUNCTION public.protect_external_entry_call() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EXTERNAL_CALL_HISTORY_PROTECTED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' OR NEW.called_by_user_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_CALL_CREATION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'called_by_user_id'-'resolved_by_user_id') = (to_jsonb(OLD)-'called_by_user_id'-'resolved_by_user_id')
    AND (NEW.called_by_user_id IS NOT DISTINCT FROM OLD.called_by_user_id OR
      (NEW.called_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.called_by_user_id)))
    AND (NEW.resolved_by_user_id IS NOT DISTINCT FROM OLD.resolved_by_user_id OR
      (NEW.resolved_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.resolved_by_user_id))) THEN RETURN NEW; END IF;
  IF OLD.status<>'pending' OR NEW.status='pending' OR
    ROW(NEW.id,NEW.event_id,NEW.participation_id,NEW.called_at,NEW.called_by_user_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.participation_id,OLD.called_at,OLD.called_by_user_id) THEN
    RAISE EXCEPTION 'EXTERNAL_CALL_TERMINAL_IMMUTABLE';
  END IF;
  IF NEW.status IN ('confirmed','absent','removed') AND NEW.resolved_by_user_id IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CALL_RESOLVER_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_external_entry_call BEFORE INSERT OR UPDATE OR DELETE ON public.external_entry_calls
  FOR EACH ROW EXECUTE FUNCTION public.protect_external_entry_call();
--> statement-breakpoint
-- Integra TODOS os escritores existentes de participação no mesmo commit.
-- Eles já adquirem evento, recursos internos e participação antes desta chamada.
CREATE FUNCTION public.resolve_external_call_on_participation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.events%ROWTYPE; c public.external_entry_calls%ROWTYPE; reason text; at_time timestamptz;
BEGIN
  IF OLD.status<>'waiting' OR NEW.status='waiting' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.events WHERE id=NEW.event_id;
  FOR c IN SELECT * FROM public.external_entry_calls WHERE participation_id=NEW.id AND status='pending' ORDER BY id FOR UPDATE LOOP
    IF NEW.status='active' AND NOT e.external_queue_enabled THEN
      reason:='external_queue_disabled'; at_time:=NEW.arena_entered_at;
    ELSIF NEW.status IN ('finished','canceled') THEN
      reason:=NEW.finish_reason; at_time:=NEW.finished_at;
    ELSE RAISE EXCEPTION 'EXTERNAL_CALL_REQUIRED_FOR_ADMISSION'; END IF;
    UPDATE public.external_entry_calls SET status='canceled',resolved_at=at_time,resolution_reason=reason
      WHERE id=c.id AND status='pending';
    INSERT INTO public.audit_logs(id,event_id,origin,category,action,reason,metadata,occurred_at)
      VALUES(gen_random_uuid(),NEW.event_id,'system','event','external_call_canceled',reason,
        jsonb_build_object('callId',c.id,'participationId',NEW.id),at_time);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER resolve_external_call_on_participation AFTER UPDATE OF status ON public.participations
  FOR EACH ROW EXECUTE FUNCTION public.resolve_external_call_on_participation();
--> statement-breakpoint
-- Diferidos: resoluções explícitas atualizam chamada e participação em qualquer
-- ordem interna, mas nunca podem confirmar um commit com pending órfão.
CREATE FUNCTION public.check_external_call_integrity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME='events' THEN target:=NEW.id; ELSE target:=NEW.event_id; END IF;
  IF TG_TABLE_NAME='external_entry_calls' AND TG_OP='UPDATE' THEN
    IF OLD.status='pending' AND NEW.status<>'pending' AND NOT EXISTS (
      SELECT 1 FROM public.participations p WHERE p.id=NEW.participation_id AND p.event_id=NEW.event_id AND (
        (NEW.status='confirmed' AND p.arena_entered_at=NEW.resolved_at AND p.status IN ('active','finished')) OR
        (NEW.status='removed' AND p.status='canceled' AND p.finish_reason='staff_external_wait_removed' AND p.finished_at=NEW.resolved_at) OR
        (NEW.status='absent' AND p.arena_entered_at IS NULL AND
          (p.status='waiting' OR (p.status='finished' AND p.finish_reason='external_absence_after_entry_cutoff' AND p.finished_at=NEW.resolved_at))) OR
        (NEW.status='canceled' AND (
          (p.status IN ('finished','canceled') AND p.finish_reason=NEW.resolution_reason AND p.finished_at=NEW.resolved_at) OR
          (p.status='active' AND NEW.resolution_reason='external_queue_disabled' AND p.arena_entered_at=NEW.resolved_at)))
      )) THEN RAISE EXCEPTION 'EXTERNAL_CALL_RESOLUTION_INTEGRITY'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.external_entry_calls c
    LEFT JOIN public.participations p ON p.id=c.participation_id AND p.event_id=c.event_id
    LEFT JOIN public.events e ON e.id=c.event_id
    WHERE c.event_id=target AND c.status='pending' AND
      (p.id IS NULL OR p.status<>'waiting' OR p.arena_entered_at IS NOT NULL OR p.current_queue_entry_id IS NOT NULL
       OR NOT e.external_queue_enabled OR e.status IN ('closing','closed') OR e.closure_requested_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'EXTERNAL_CALL_INTEGRITY';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_external_call_integrity AFTER INSERT OR UPDATE ON public.external_entry_calls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_external_call_integrity();
CREATE CONSTRAINT TRIGGER check_external_call_participation AFTER UPDATE ON public.participations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_external_call_integrity();
CREATE CONSTRAINT TRIGGER check_external_call_event AFTER UPDATE ON public.events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_external_call_integrity();
--> statement-breakpoint
CREATE FUNCTION public.prevent_external_calls_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'EXTERNAL_CALL_HISTORY_PROTECTED'; END $$;
CREATE TRIGGER prevent_external_calls_truncate BEFORE TRUNCATE ON public.external_entry_calls
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_external_calls_truncate();
