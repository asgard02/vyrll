-- List clip jobs without transferring the heavy clips JSONB (PostgREST egress).
-- Returns metadata + clips_count only.

CREATE OR REPLACE FUNCTION public.list_my_clip_jobs(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id UUID,
  url TEXT,
  video_title TEXT,
  channel_title TEXT,
  duration INT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ,
  clips_count INT
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
    COALESCE(jsonb_array_length(j.clips), 0)::INT AS clips_count
  FROM public.clip_jobs j
  WHERE j.user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_clip_jobs(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_clip_jobs(INT) TO service_role;
