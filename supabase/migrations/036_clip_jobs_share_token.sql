-- Lien de partage par projet (dossier de clips). Lookup via service_role uniquement.
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS share_token text;

CREATE UNIQUE INDEX IF NOT EXISTS clip_jobs_share_token_uidx
  ON public.clip_jobs (share_token)
  WHERE share_token IS NOT NULL;
