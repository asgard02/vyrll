-- Réanalyses activées via code promo (ne consomment pas le quota)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS reanalyses_enabled BOOLEAN NOT NULL DEFAULT false;
