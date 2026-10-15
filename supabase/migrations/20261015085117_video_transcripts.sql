-- Cache de la transcription Groq, une ligne par vidéo.
-- Clé : video_key, lang, fenêtre manuelle (deux colonnes), stt_version, groq_model.
-- transcript n'est pas dans la clé.
-- Lecture et écriture : service role uniquement. Aucune policy client.

CREATE TABLE IF NOT EXISTS public.video_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_key text NOT NULL,
  lang text NOT NULL DEFAULT 'auto',
  window_start_sec integer,
  window_end_sec integer,
  stt_version text NOT NULL,
  groq_model text NOT NULL,
  transcript jsonb NOT NULL,
  word_count integer NOT NULL DEFAULT 0,
  has_word_timestamps boolean NOT NULL DEFAULT false,
  word_ts_retry_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_transcripts_identity_key UNIQUE NULLS NOT DISTINCT (
    video_key,
    lang,
    window_start_sec,
    window_end_sec,
    stt_version,
    groq_model
  )
);

COMMENT ON TABLE public.video_transcripts IS
  'Cache STT Groq. Cle unique : video_key, lang, fenetre manuelle, stt_version, groq_model.';

ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_transcripts FROM PUBLIC;
REVOKE ALL ON TABLE public.video_transcripts FROM anon;
REVOKE ALL ON TABLE public.video_transcripts FROM authenticated;
GRANT ALL ON TABLE public.video_transcripts TO service_role;
