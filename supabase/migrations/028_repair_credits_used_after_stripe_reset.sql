-- Repair Jow (social@jow.fr): clip job was billed (10) but profiles.credits_used
-- stayed 0 after Stripe checkout.session.completed always reset usage.
-- Broader "sum all billed jobs" sync is unsafe after monthly invoice resets.

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
WHERE p.id = '87f8f5d0-8626-4139-a7e5-db942cecd14a';
