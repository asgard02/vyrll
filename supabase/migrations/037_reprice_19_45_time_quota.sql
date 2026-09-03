-- Creator 19 € / 5 h (300 min), Studio 45 € / 12 h (720 min).
-- Bump existing paid quotas; keep credits_used (temps déjà consommé).
-- Catch leftover limits from 014 / 020.

UPDATE public.profiles
SET credits_limit = 300
WHERE plan = 'creator'
  AND credits_limit IN (90, 150);

UPDATE public.profiles
SET credits_limit = 720
WHERE plan = 'studio'
  AND credits_limit IN (210, 270, 400);
