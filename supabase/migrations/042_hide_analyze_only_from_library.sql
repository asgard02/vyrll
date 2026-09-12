-- Analysis sessions are not library projects. Mark them and hide them from list_my_clip_jobs.

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS analyze_only BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clip_jobs'
      AND column_name = 'credits_quoted'
  ) THEN
    UPDATE public.clip_jobs
    SET analyze_only = true
    WHERE credits_quoted = 0
      AND status = 'done'
      AND COALESCE(jsonb_array_length(clips), 0) = 0;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.list_my_clip_jobs(INT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.list_my_clip_jobs(
  p_limit INT DEFAULT 24,
  p_offset INT DEFAULT 0,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  url TEXT,
  video_title TEXT,
  channel_title TEXT,
  duration INT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ,
  clips_count INT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    j.id,
    j.url,
    j.video_title,
    j.channel_title,
    j.duration,
    j.status,
    j.error,
    j.created_at,
    COALESCE(jsonb_array_length(j.clips), 0)::INT AS clips_count,
    COUNT(*) OVER() AS total_count
  FROM public.clip_jobs j
  WHERE j.user_id = auth.uid()
    AND COALESCE(j.analyze_only, false) = false
    AND (
      COALESCE(jsonb_array_length(j.clips), 0) > 0
      OR j.status IN ('pending', 'processing', 'error')
    )
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR position(lower(btrim(p_query)) IN lower(COALESCE(j.video_title, ''))) > 0
      OR position(lower(btrim(p_query)) IN lower(COALESCE(j.channel_title, ''))) > 0
      OR position(lower(btrim(p_query)) IN lower(COALESCE(j.url, ''))) > 0
    )
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 24), 50))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_clip_jobs(INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_clip_jobs(INT, INT, TEXT) TO service_role;
