-- Free quota: 30 crédits à vie, aligné sur les profils existants
-- et PLAN_CREDITS.freeLifetime (src/lib/plan.ts).
-- Pas de backfill : les comptes déjà à 10 gardent 10.

ALTER TABLE public.profiles
  ALTER COLUMN credits_limit SET DEFAULT 30;
