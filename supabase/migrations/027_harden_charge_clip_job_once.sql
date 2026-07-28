-- Harden billing RPCs: allow service_role (admin API), fail if profile row missing.
-- Prevents "job marked billed / credits_used unchanged" silent partial success.

CREATE OR REPLACE FUNCTION public.charge_clip_job_once(
  p_job_id UUID,
  p_user_id UUID,
  p_credits INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_updated INT := 0;
  profile_rows INT := 0;
  safe_credits INT := GREATEST(1, COALESCE(p_credits, 1));
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND auth.uid() = p_user_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credits';
  END IF;

  UPDATE public.clip_jobs
  SET credits_billed_at = NOW(),
      credits_billed_amount = safe_credits
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND credits_billed_at IS NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
  SET credits_used = credits_used + safe_credits
  WHERE id = p_user_id;

  GET DIAGNOSTICS profile_rows = ROW_COUNT;

  IF profile_rows = 0 THEN
    RAISE EXCEPTION 'Profile not found for billing';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_credits_used(p_user_id UUID, p_credits INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_rows INT := 0;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND auth.uid() = p_user_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credits';
  END IF;

  UPDATE public.profiles
  SET credits_used = credits_used + p_credits
  WHERE id = p_user_id;

  GET DIAGNOSTICS profile_rows = ROW_COUNT;

  IF profile_rows = 0 THEN
    RAISE EXCEPTION 'Profile not found for billing';
  END IF;
END;
$$;

-- Backfill free account where jobs were marked billed but credits_used stayed 0
UPDATE public.profiles p
SET credits_used = GREATEST(
  COALESCE(p.credits_used, 0),
  COALESCE((
    SELECT SUM(j.credits_billed_amount)
    FROM public.clip_jobs j
    WHERE j.user_id = p.id
      AND j.credits_billed_at IS NOT NULL
  ), 0)
)
WHERE p.id = 'd8b5fc15-08b6-4c01-b561-23a506c89171';
