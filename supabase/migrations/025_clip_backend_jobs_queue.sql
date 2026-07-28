-- Shared job queue: payload for any worker + atomic claim (SKIP LOCKED)

ALTER TABLE public.clip_backend_jobs
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.clip_backend_jobs
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

ALTER TABLE public.clip_backend_jobs
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clip_backend_jobs_queue
  ON public.clip_backend_jobs (status, created_at ASC);

-- Reset stuck processing jobs (worker died / redeploy) so another replica can pick them up.
CREATE OR REPLACE FUNCTION public.claim_next_clip_backend_job(p_worker_id TEXT)
RETURNS public.clip_backend_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.clip_backend_jobs;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'p_worker_id required';
  END IF;

  -- Stale reclaim: processing with no heartbeat for 2h → pending again
  UPDATE public.clip_backend_jobs
  SET
    status = 'pending',
    claimed_by = NULL,
    claimed_at = NULL,
    updated_at = NOW()
  WHERE status = 'processing'
    AND claimed_at IS NOT NULL
    AND claimed_at < NOW() - INTERVAL '2 hours';

  UPDATE public.clip_backend_jobs j
  SET
    status = 'processing',
    claimed_by = trim(p_worker_id),
    claimed_at = NOW(),
    updated_at = NOW(),
    error = NULL
  WHERE j.backend_job_id = (
    SELECT q.backend_job_id
    FROM public.clip_backend_jobs q
    WHERE q.status = 'pending'
    ORDER BY q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_clip_backend_job(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_clip_backend_job(TEXT) TO service_role;
