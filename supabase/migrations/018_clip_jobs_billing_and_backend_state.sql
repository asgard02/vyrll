-- Idempotent billing per clip job + persisted backend state snapshots

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS credits_billed_at TIMESTAMPTZ;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS credits_billed_amount INT;

CREATE TABLE IF NOT EXISTS public.clip_backend_jobs (
  backend_job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error TEXT,
  clips JSONB NOT NULL DEFAULT '[]',
  source_duration_seconds INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clip_backend_jobs_updated_at
  ON public.clip_backend_jobs(updated_at DESC);

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
