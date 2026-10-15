-- Remplace tout l'index d'une vidéo en une transaction.
-- Un échec d'insertion annule la suppression : l'ancien index reste.

CREATE OR REPLACE FUNCTION public.replace_transcript_segments(
  p_video_key text,
  p_job_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  IF p_rows IS NULL
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_transcript_segments: p_rows is empty';
  END IF;

  DELETE FROM public.transcript_segments
  WHERE video_key = p_video_key;

  INSERT INTO public.transcript_segments (
    job_id,
    video_key,
    source_url,
    title,
    lang,
    start_ms,
    end_ms,
    text
  )
  SELECT
    p_job_id,
    p_video_key,
    NULLIF(item->>'source_url', ''),
    NULLIF(item->>'title', ''),
    COALESCE(NULLIF(item->>'lang', ''), 'fr'),
    (item->>'start_ms')::integer,
    (item->>'end_ms')::integer,
    btrim(item->>'text')
  FROM jsonb_array_elements(p_rows) AS item;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_transcript_segments(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_transcript_segments(text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_transcript_segments(text, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_transcript_segments(text, uuid, jsonb) TO service_role;
