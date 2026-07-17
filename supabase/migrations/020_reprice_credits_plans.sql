-- Migration 020: Recalibrage quotas crédits (marge / prix)
-- free: 30 à vie (inchangé)
-- creator: 150 → 90 min/mois (~1h30)
-- studio: 400 → 210 min/mois (~3h30)

UPDATE public.profiles
SET credits_limit = 90
WHERE plan = 'creator';

UPDATE public.profiles
SET credits_limit = 210
WHERE plan = 'studio';
