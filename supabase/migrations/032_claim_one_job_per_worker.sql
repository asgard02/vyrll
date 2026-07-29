-- Prevent one worker from owning multiple processing jobs (prod incident:
-- 6 replicas × ~3 claimed jobs each while MAX_CONCURRENT_JOBS=1).
-- Also reclaim stale processing heartbeats before taking the next pending job.

CREATE OR REPLACE FUNCTION public.claim_next_clip_backend_job(p_worker_id TEXT)
RETURNS public.clip_backend_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.clip_backend_jobs;
  worker text := trim(p_worker_id);
BEGIN
  IF worker IS NULL OR length(worker) = 0 THEN
    RAISE EXCEPTION 'p_worker_id required';
  END IF;

  -- Already busy: do not claim another row for this worker.
  IF EXISTS (
    SELECT 1
    FROM public.clip_backend_jobs
    WHERE status = 'processing'
      AND claimed_by = worker
  ) THEN
    RETURN NULL;
  END IF;

  -- Reclaim rows with no heartbeat for 40+ min (aligned with JOB_STALE_MS).
  UPDATE public.clip_backend_jobs
  SET
    status = 'pending',
    claimed_by = NULL,
    claimed_at = NULL,
    updated_at = NOW()
  WHERE status = 'processing'
    AND updated_at < NOW() - INTERVAL '40 minutes'
    AND (
      (COALESCE(payload->>'source', '') = 'upload'
        AND (COALESCE(payload->>'upload_id', '') <> '' OR COALESCE(payload->>'upload_r2_key', '') <> ''))
      OR COALESCE(payload->>'url', '') <> ''
    );

  UPDATE public.clip_backend_jobs j
  SET
    status = 'processing',
    claimed_by = worker,
    claimed_at = NOW(),
    updated_at = NOW(),
    error = NULL
  WHERE j.backend_job_id = (
    SELECT q.backend_job_id
    FROM public.clip_backend_jobs q
    WHERE q.status = 'pending'
      AND (
        (COALESCE(q.payload->>'source', '') = 'upload'
          AND (COALESCE(q.payload->>'upload_id', '') <> '' OR COALESCE(q.payload->>'upload_r2_key', '') <> ''))
        OR COALESCE(q.payload->>'url', '') <> ''
      )
    ORDER BY q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;
