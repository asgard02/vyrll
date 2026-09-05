-- Paginated clip job list (offset + optional search) with total_count.
-- Replaces the 50-row cap so /projets can page through the full library.

DROP FUNCTION IF EXISTS public.list_my_clip_jobs(INT);

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
