-- Patch un seul clip de clip_jobs.clips sans réécrire le tableau entier.
-- SECURITY INVOKER : le droit vient de l'appelant (service_role).
-- L'index doit déjà exister. Le job doit appartenir à p_user_id.
-- Pas lancé automatiquement. À appliquer après relecture.

DROP FUNCTION IF EXISTS public.patch_clip_job_at_index(uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public.patch_clip_job_at_index(
  p_job_id uuid,
  p_index integer,
  p_patch jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated jsonb;
  row_exists boolean;
BEGIN
  IF p_index IS NULL OR p_index < 0 THEN
    RAISE EXCEPTION 'invalid clip index';
  END IF;

  UPDATE public.clip_jobs
  SET clips = jsonb_set(
    clips,
    ARRAY[p_index::text],
    COALESCE(clips -> p_index, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb),
    false
  )
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND jsonb_typeof(clips) = 'array'
    AND p_index < jsonb_array_length(clips)
  RETURNING clips INTO updated;

  IF updated IS NOT NULL THEN
    RETURN updated;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.clip_jobs
    WHERE id = p_job_id
      AND user_id = p_user_id
  ) INTO row_exists;

  IF row_exists THEN
    RAISE EXCEPTION 'invalid clip index';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb, uuid) TO service_role;
