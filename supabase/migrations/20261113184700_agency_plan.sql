-- Proposé, non appliqué.
-- Autorise le plan agency et aligne le défaut des nouveaux inscrits sur 60 crédits.
-- Ne modifie pas les credits_limit déjà en base.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'creator', 'studio', 'agency'));

ALTER TABLE public.profiles
  ALTER COLUMN credits_limit SET DEFAULT 60;
