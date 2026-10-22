-- Pause du choix : n'écrit que choix_en_cours_at.
-- Étape moments_prets, pause encore absente, et aucun moments_choisis.
-- Si le rendu a déjà un choix, la ligne ne change pas.
-- Pas lancé automatiquement. À coller dans le SQL Editor.

CREATE OR REPLACE FUNCTION public.clip_jobs_pause_moment_choice(
  p_job_id uuid,
  p_user_id uuid,
  p_at text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_id uuid;
  at_text text;
BEGIN
  at_text := NULLIF(btrim(p_at), '');
  IF at_text IS NULL THEN
    RETURN false;
  END IF;
  PERFORM at_text::timestamptz;

  UPDATE public.clip_jobs AS job
  SET pipeline = jsonb_set(
    COALESCE(job.pipeline, '{}'::jsonb),
    '{choix_en_cours_at}',
    to_jsonb(at_text),
    true
  )
  WHERE job.id = p_job_id
    AND job.user_id = p_user_id
    AND job.pipeline->>'etape' = 'moments_prets'
    AND NULLIF(btrim(job.pipeline->>'choix_en_cours_at'), '') IS NULL
    AND (
      job.pipeline->'moments_choisis' IS NULL
      OR job.pipeline->'moments_choisis' = '[]'::jsonb
    )
  RETURNING job.id INTO updated_id;

  RETURN updated_id IS NOT NULL;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.clip_jobs_pause_moment_choice(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clip_jobs_pause_moment_choice(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.clip_jobs_pause_moment_choice(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clip_jobs_pause_moment_choice(uuid, uuid, text) TO service_role;
