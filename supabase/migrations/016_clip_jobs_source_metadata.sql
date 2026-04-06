-- Métadonnées source (chaîne + visuel) pour l’écran de chargement projet clip
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS channel_title TEXT;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS channel_thumbnail_url TEXT;
