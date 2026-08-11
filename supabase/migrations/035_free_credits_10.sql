-- Free freemium: nouveaux comptes → 10 crédits à vie (1 crédit = 1 min source).
-- Les free déjà à 30 gardent 30 (pas de backfill).
-- Aligné sur PLAN_CREDITS.freeLifetime dans src/lib/plan.ts.

ALTER TABLE public.profiles
  ALTER COLUMN credits_limit SET DEFAULT 10;
