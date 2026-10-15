-- Patch un seul clip de clip_jobs.clips sans réécrire le tableau entier.
-- SECURITY INVOKER : le droit vient de l'appelant (service_role).
-- Pas lancé automatiquement. À appliquer après relecture.

CREATE OR REPLACE FUNCTION public.patch_clip_job_at_index(
  p_job_id uuid,
  p_index integer,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated jsonb;
BEGIN
  IF p_index IS NULL OR p_index < 0 THEN
    RAISE EXCEPTION 'invalid clip index';
  END IF;

  UPDATE public.clip_jobs
  SET clips = jsonb_set(
    COALESCE(clips, '[]'::jsonb),
    ARRAY[p_index::text],
    COALESCE(clips -> p_index, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb),
    true
  )
  WHERE id = p_job_id
  RETURNING clips INTO updated;

  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.patch_clip_job_at_index(uuid, integer, jsonb) TO service_role;
