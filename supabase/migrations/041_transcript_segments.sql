-- Lot 1A : index FTS des transcripts horodatés (pas d'embeddings).
-- Lecture : propriétaire du clip_job. Écriture : service_role uniquement.

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS embedding_tokens INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id           bigserial PRIMARY KEY,
  job_id       uuid REFERENCES public.clip_jobs(id) ON DELETE CASCADE,
  video_key    text NOT NULL,
  source_url   text,
  title        text,
  lang         text DEFAULT 'fr',
  start_ms     int  NOT NULL,
  end_ms       int  NOT NULL,
  text         text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('french', coalesce(text, ''))) STORED,
  CONSTRAINT transcript_segments_job_id_start_ms_key UNIQUE (job_id, start_ms)
);

CREATE INDEX IF NOT EXISTS transcript_segments_fts_idx
  ON public.transcript_segments USING gin (fts);
CREATE INDEX IF NOT EXISTS transcript_segments_job_id_idx
  ON public.transcript_segments (job_id);
CREATE INDEX IF NOT EXISTS transcript_segments_video_key_idx
  ON public.transcript_segments (video_key);

ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transcript_segments"
  ON public.transcript_segments;
CREATE POLICY "Users can view own transcript_segments"
  ON public.transcript_segments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.clip_jobs j
      WHERE j.id = transcript_segments.job_id
        AND j.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.transcript_segments FROM PUBLIC;
REVOKE ALL ON public.transcript_segments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.transcript_segments FROM authenticated;
GRANT SELECT ON public.transcript_segments TO authenticated;
GRANT ALL ON public.transcript_segments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.transcript_segments_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.search_transcript_segments(p_query text)
RETURNS TABLE (
  video_key text,
  title text,
  source_url text,
  start_ms int,
  end_ms int,
  text text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ts.video_key,
    ts.title,
    ts.source_url,
    ts.start_ms,
    ts.end_ms,
    ts.text,
    ts_rank_cd(ts.fts, websearch_to_tsquery('french', p_query))::real AS rank
  FROM public.transcript_segments ts
  WHERE length(trim(coalesce(p_query, ''))) > 0
    AND ts.fts @@ websearch_to_tsquery('french', p_query)
  ORDER BY rank DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.search_transcript_segments(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_transcript_segments(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_transcript_segments(text) TO service_role;
