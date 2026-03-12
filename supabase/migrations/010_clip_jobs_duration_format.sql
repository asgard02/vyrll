-- Étendre les durées autorisées pour les clips (15, 30, 45, 60, 90, 120)
-- Drop l'ancienne contrainte (nom possible selon version Postgres)
ALTER TABLE public.clip_jobs DROP CONSTRAINT IF EXISTS clip_jobs_duration_check;
ALTER TABLE public.clip_jobs DROP CONSTRAINT IF EXISTS clip_jobs_duration_check1;
ALTER TABLE public.clip_jobs
  ADD CONSTRAINT clip_jobs_duration_check
  CHECK (duration IN (15, 30, 45, 60, 90, 120));

-- Ajouter la colonne format (optionnel, pour affichage)
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS format TEXT DEFAULT '9:16';
