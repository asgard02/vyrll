-- Fenêtre timeline (mode manuel) pour facturation et affichage
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS search_window_start_sec INT;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS search_window_end_sec INT;
