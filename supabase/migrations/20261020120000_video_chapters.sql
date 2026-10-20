-- Chapitres YouTube et résumé, une ligne par vidéo.
-- Lecture : affichage (anon et authenticated). Écriture : service role uniquement.

CREATE TABLE IF NOT EXISTS public.video_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  chapters jsonb NOT NULL,
  summary text NOT NULL,
  lang text,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_chapters_video_id_key UNIQUE (video_id)
);

COMMENT ON TABLE public.video_chapters IS
  'Chapitres YouTube et resume. Cle unique : video_id.';

ALTER TABLE public.video_chapters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "video_chapters_select"
  ON public.video_chapters;
CREATE POLICY "video_chapters_select"
  ON public.video_chapters
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.video_chapters FROM PUBLIC;
REVOKE ALL ON TABLE public.video_chapters FROM anon;
REVOKE ALL ON TABLE public.video_chapters FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.video_chapters FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.video_chapters FROM authenticated;
GRANT SELECT ON TABLE public.video_chapters TO anon, authenticated;
GRANT ALL ON TABLE public.video_chapters TO service_role;
