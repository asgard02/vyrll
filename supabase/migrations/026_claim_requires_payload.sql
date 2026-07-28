-- Only claim jobs that have a usable payload (url or upload keys)

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

  UPDATE public.clip_backend_jobs
  SET
    status = 'pending',
    claimed_by = NULL,
    claimed_at = NULL,
    updated_at = NOW()
  WHERE status = 'processing'
    AND claimed_at IS NOT NULL
    AND claimed_at < NOW() - INTERVAL '2 hours'
    AND (
      (COALESCE(payload->>'source', '') = 'upload'
        AND (COALESCE(payload->>'upload_id', '') <> '' OR COALESCE(payload->>'upload_r2_key', '') <> ''))
      OR COALESCE(payload->>'url', '') <> ''
    );

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
