-- Titres et descriptions à poster, une ligne par clip.
-- Lecture : propriétaire du clip_job. Écriture : service role uniquement.

CREATE TABLE IF NOT EXISTS public.clip_publish_copy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.clip_jobs(id) ON DELETE CASCADE,
  clip_index integer NOT NULL,
  title text NOT NULL,
  description_tiktok text NOT NULL DEFAULT '',
  description_shorts text NOT NULL DEFAULT '',
  description_instagram text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  why text NOT NULL DEFAULT '',
  alt_hook text NOT NULL DEFAULT '',
  title_source text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clip_publish_copy_job_clip_key UNIQUE (job_id, clip_index),
  CONSTRAINT clip_publish_copy_title_source_check CHECK (title_source IN ('model', 'fallback')),
  CONSTRAINT clip_publish_copy_hashtags_max CHECK (cardinality(hashtags) <= 5)
);

COMMENT ON TABLE public.clip_publish_copy IS
  'Textes a poster par clip. Cle unique : job_id, clip_index.';

ALTER TABLE public.clip_publish_copy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own clip_publish_copy"
  ON public.clip_publish_copy;
CREATE POLICY "Users can view own clip_publish_copy"
  ON public.clip_publish_copy
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.clip_jobs j
      WHERE j.id = clip_publish_copy.job_id
        AND j.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.clip_publish_copy FROM PUBLIC;
REVOKE ALL ON TABLE public.clip_publish_copy FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.clip_publish_copy FROM authenticated;
GRANT SELECT ON TABLE public.clip_publish_copy TO authenticated;
GRANT ALL ON TABLE public.clip_publish_copy TO service_role;
