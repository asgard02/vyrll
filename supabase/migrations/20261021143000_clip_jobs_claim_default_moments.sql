-- Choix par défaut : n'écrit que moments_choisis.
-- La ligne doit être en processing, étape moments_prets, choix encore absent.
-- Si choix_en_cours_at est déjà posé, l'écriture attend moments_prets_at + 30 min.
-- Pas lancé automatiquement. À coller dans le SQL Editor.

CREATE OR REPLACE FUNCTION public.clip_jobs_claim_default_moments(
  p_job_id uuid,
  p_chosen jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_id uuid;
BEGIN
  IF p_chosen IS NULL
     OR jsonb_typeof(p_chosen) <> 'array'
     OR jsonb_array_length(p_chosen) = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.clip_jobs AS job
  SET pipeline = jsonb_set(
    COALESCE(job.pipeline, '{}'::jsonb),
    '{moments_choisis}',
    p_chosen,
    true
  )
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.pipeline->>'etape' = 'moments_prets'
    AND (
      job.pipeline->'moments_choisis' IS NULL
      OR job.pipeline->'moments_choisis' = '[]'::jsonb
    )
    AND CASE
      WHEN NULLIF(btrim(job.pipeline->>'choix_en_cours_at'), '') IS NULL THEN true
      WHEN NULLIF(btrim(job.pipeline->>'moments_prets_at'), '') IS NULL THEN false
      ELSE now() >= (job.pipeline->>'moments_prets_at')::timestamptz + interval '30 minutes'
    END
  RETURNING job.id INTO updated_id;

  RETURN updated_id IS NOT NULL;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.clip_jobs_claim_default_moments(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clip_jobs_claim_default_moments(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.clip_jobs_claim_default_moments(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clip_jobs_claim_default_moments(uuid, jsonb) TO service_role;
