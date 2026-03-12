-- Colonne updated_at pour limiter les re-analyses
ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Les analyses existantes gardent updated_at = NULL (jamais re-analysées)
-- Quand on UPDATE, on mettra updated_at = NOW()
