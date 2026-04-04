-- Migration 014: Nouveau système de pricing (crédits + plans free/creator/studio)
-- 1 crédit = 1 minute de vidéo source traitée

-- Renommer clips_used / clips_limit → credits_used / credits_limit
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'clips_used'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN clips_used TO credits_used;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'clips_limit'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN clips_limit TO credits_limit;
  END IF;
END $$;

-- Ajouter credits_used / credits_limit si absents (nouvelle install)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits_used INT NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits_limit INT NOT NULL DEFAULT 30;

-- Migrer les anciens plans vers les nouveaux AVANT d'ajouter la contrainte
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
UPDATE public.profiles SET plan = 'creator' WHERE plan = 'pro';
UPDATE public.profiles SET plan = 'studio' WHERE plan = 'unlimited';

-- Puis ajouter la nouvelle contrainte
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'creator', 'studio'));

-- Valeurs par défaut selon le plan
-- free: credits_limit=30, analyses_limit=5
-- creator: credits_limit=150, analyses_limit=20
-- studio: credits_limit=400, analyses_limit=-1 (illimité)
UPDATE public.profiles SET credits_limit = 30, analyses_limit = 5 WHERE plan = 'free';
UPDATE public.profiles SET credits_limit = 150, analyses_limit = 20 WHERE plan = 'creator';
UPDATE public.profiles SET credits_limit = 400, analyses_limit = -1 WHERE plan = 'studio';

-- Remplacer increment_clips_used par increment_credits_used
DROP FUNCTION IF EXISTS public.increment_clips_used(UUID);

CREATE OR REPLACE FUNCTION public.increment_credits_used(p_user_id UUID, p_credits INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET credits_used = credits_used + p_credits
  WHERE id = p_user_id;
END;
$$;

-- Valeurs par défaut pour les nouveaux profils (handle_new_user)
ALTER TABLE public.profiles ALTER COLUMN analyses_limit SET DEFAULT 5;

-- Ajouter source_duration_seconds à clip_jobs (pour calcul des crédits à la fin)
ALTER TABLE public.clip_jobs ADD COLUMN IF NOT EXISTS source_duration_seconds INT;
