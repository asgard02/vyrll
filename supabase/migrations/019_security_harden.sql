-- Security harden: lock privileged profile/job columns, RPC ownership, backend jobs RLS

-- 1) profiles: authenticated may only update username (plan/credits/status via service_role only)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username) ON public.profiles TO authenticated;

-- 2) clip_jobs: authenticated cannot UPDATE (API uses service_role after ownership check)
REVOKE UPDATE ON public.clip_jobs FROM authenticated;

-- 3) Harden increment_credits_used
CREATE OR REPLACE FUNCTION public.increment_credits_used(p_user_id UUID, p_credits INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credits';
  END IF;

  UPDATE public.profiles
  SET credits_used = credits_used + p_credits
  WHERE id = p_user_id;
END;
$$;

-- 4) Harden charge_clip_job_once
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
  safe_credits INT := GREATEST(1, COALESCE(p_credits, 1));
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
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

  RETURN TRUE;
END;
$$;

-- 5) clip_backend_jobs: RLS on, no policies for anon/authenticated (service_role bypasses)
ALTER TABLE public.clip_backend_jobs ENABLE ROW LEVEL SECURITY;
