-- Sépare mode auto/manual (clip_mode) du layout split/normal (render_mode).
-- credits_quoted = montant validé au start, utilisé au billing si la fenêtre manque.

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS clip_mode TEXT;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS credits_quoted INT;

-- Backfill : jobs manuels connus via fenêtre timeline ou ancien render_mode = 'manual'
UPDATE public.clip_jobs
SET clip_mode = 'manual'
WHERE clip_mode IS NULL
  AND (
    search_window_start_sec IS NOT NULL
    OR search_window_end_sec IS NOT NULL
    OR render_mode = 'manual'
  );

UPDATE public.clip_jobs
SET clip_mode = 'auto'
WHERE clip_mode IS NULL;

-- Anciens jobs encore marqués render_mode = 'manual' : layout inconnu jusqu'au prochain poll ;
-- on laisse 'manual' en place pour le fallback billing legacy, mais clip_mode est la source de vérité.

ALTER TABLE public.clip_jobs
  DROP CONSTRAINT IF EXISTS clip_jobs_clip_mode_check;

ALTER TABLE public.clip_jobs
  ADD CONSTRAINT clip_jobs_clip_mode_check
  CHECK (clip_mode IS NULL OR clip_mode IN ('auto', 'manual'));
