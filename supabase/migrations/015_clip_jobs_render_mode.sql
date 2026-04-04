-- Mode de rendu et confiance split pour calibration des seuils
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS render_mode TEXT DEFAULT 'auto';

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS split_confidence REAL;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS start_time_sec INTEGER;
