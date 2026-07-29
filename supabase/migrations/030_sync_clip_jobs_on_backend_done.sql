-- Hard guarantee: when backend finishes, clip_jobs must follow.
-- Prevents STALE_JOB_TIMEOUT zombies if the worker dies after writing
-- clip_backend_jobs but before syncing clip_jobs (or if orphan reap races).

CREATE OR REPLACE FUNCTION public.sync_clip_job_from_backend_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' THEN
    UPDATE public.clip_jobs
    SET
      status = 'done',
      error = NULL,
      clips = COALESCE(NEW.clips, '[]'::jsonb),
      source_duration_seconds = COALESCE(
        NEW.source_duration_seconds,
        clip_jobs.source_duration_seconds
      )
    WHERE backend_job_id = NEW.backend_job_id
      AND status IN ('pending', 'processing', 'error');

  ELSIF NEW.status IN ('error', 'cancelled') THEN
    -- Never downgrade a successful clip_job; only sync failures while still open.
    UPDATE public.clip_jobs
    SET
      status = 'error',
      error = COALESCE(
        NULLIF(NEW.error, ''),
        CASE
          WHEN NEW.status = 'cancelled' THEN 'JOB_CANCELLED'
          ELSE 'PROCESSING_FAILED'
        END
      )
    WHERE backend_job_id = NEW.backend_job_id
      AND status IN ('pending', 'processing');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clip_job_from_backend ON public.clip_backend_jobs;

CREATE TRIGGER trg_sync_clip_job_from_backend
AFTER INSERT OR UPDATE OF status, clips, error, source_duration_seconds
ON public.clip_backend_jobs
FOR EACH ROW
WHEN (NEW.status IN ('done', 'error', 'cancelled'))
EXECUTE FUNCTION public.sync_clip_job_from_backend_row();

-- One-shot heal for any leftover desync at migration time.
UPDATE public.clip_jobs cj
SET
  status = 'done',
  error = NULL,
  clips = cb.clips,
  source_duration_seconds = COALESCE(cj.source_duration_seconds, cb.source_duration_seconds)
FROM public.clip_backend_jobs cb
WHERE cj.backend_job_id = cb.backend_job_id
  AND cb.status = 'done'
  AND cj.status IN ('pending', 'processing', 'error')
  AND jsonb_array_length(COALESCE(cb.clips, '[]'::jsonb)) > 0;
