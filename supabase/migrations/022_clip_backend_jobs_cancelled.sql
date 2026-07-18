-- Allow cancelled status when user deletes a job mid-processing
ALTER TABLE public.clip_backend_jobs
  DROP CONSTRAINT IF EXISTS clip_backend_jobs_status_check;

ALTER TABLE public.clip_backend_jobs
  ADD CONSTRAINT clip_backend_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'error', 'cancelled'));
