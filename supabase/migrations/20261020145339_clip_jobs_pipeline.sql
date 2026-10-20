-- Étape en cours et moments repérés, sans toucher clip_jobs.clips.
-- Lecture : le propriétaire, via la politique SELECT déjà en place.
-- Écriture de pipeline : service role uniquement.
--
-- La politique "Users can update own clip_jobs" est encore là (PUBLIC,
-- USING auth.uid() = user_id). authenticated n'a plus le GRANT UPDATE
-- (019_security_harden). anon a encore l'UPDATE de table : un REVOKE sur
-- la seule colonne ne l'emporte pas. Le trigger bloque le changement
-- de pipeline pour tout rôle autre que service_role, postgres, supabase_admin.
-- SECURITY INVOKER : current_user est l'appelant, pas le propriétaire
-- de la fonction. service_role traverse les politiques, pas les triggers.

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS pipeline jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clip_jobs.pipeline IS
  'Etape du job et moments reperes. Ecrit par le service role. Ne remplace pas clips.';

CREATE OR REPLACE FUNCTION public.clip_jobs_pipeline_service_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.pipeline IS DISTINCT FROM OLD.pipeline
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'pipeline is server-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clip_jobs_pipeline_service_only ON public.clip_jobs;

CREATE TRIGGER trg_clip_jobs_pipeline_service_only
BEFORE UPDATE OF pipeline ON public.clip_jobs
FOR EACH ROW
EXECUTE FUNCTION public.clip_jobs_pipeline_service_only();
