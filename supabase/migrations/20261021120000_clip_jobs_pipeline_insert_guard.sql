-- pipeline : service role à l'écriture.
-- INSERT hors service_role, postgres, supabase_admin : forcer '{}'.
-- UPDATE hors ces rôles : refuser le changement. Ne jamais réécrire pipeline à '{}'.
-- SECURITY INVOKER : current_user est l'appelant.
-- OLD n'existe pas en INSERT : TG_OP est testé avant de le lire.

CREATE OR REPLACE FUNCTION public.clip_jobs_pipeline_service_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.pipeline := '{}'::jsonb;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.pipeline IS DISTINCT FROM OLD.pipeline THEN
    RAISE EXCEPTION 'pipeline is server-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clip_jobs_pipeline_service_only ON public.clip_jobs;

CREATE TRIGGER trg_clip_jobs_pipeline_service_only
BEFORE INSERT OR UPDATE OF pipeline ON public.clip_jobs
FOR EACH ROW
EXECUTE FUNCTION public.clip_jobs_pipeline_service_only();

REVOKE UPDATE ON public.clip_jobs FROM anon;
