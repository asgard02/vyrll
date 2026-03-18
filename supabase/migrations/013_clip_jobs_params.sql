-- Paramètres de génération des clips (pour affichage détail, ex. en dev)
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS style TEXT DEFAULT 'karaoke';

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS duration_min INT;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS duration_max INT;
