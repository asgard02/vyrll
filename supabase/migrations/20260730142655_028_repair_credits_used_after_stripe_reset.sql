-- Repair profiles where clip jobs were billed but credits_used was wiped
UPDATE public.profiles p
SET credits_used = GREATEST(
  COALESCE(p.credits_used, 0),
  COALESCE((
    SELECT SUM(j.credits_billed_amount)::INT
    FROM public.clip_jobs j
    WHERE j.user_id = p.id
      AND j.credits_billed_at IS NOT NULL
  ), 0)
)
WHERE COALESCE(p.credits_used, 0) < COALESCE((
  SELECT SUM(j.credits_billed_amount)::INT
  FROM public.clip_jobs j
  WHERE j.user_id = p.id
    AND j.credits_billed_at IS NOT NULL
), 0);;
