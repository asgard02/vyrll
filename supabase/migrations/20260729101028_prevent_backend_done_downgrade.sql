CREATE OR REPLACE FUNCTION public.prevent_clip_backend_status_downgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'done'
     AND NEW.status IN ('pending', 'processing') THEN
    NEW.status := 'done';
    NEW.progress := 100;
    NEW.error := NULL;
    IF jsonb_array_length(COALESCE(OLD.clips, '[]'::jsonb)) > 0 THEN
      NEW.clips := OLD.clips;
    END IF;
    IF OLD.source_duration_seconds IS NOT NULL THEN
      NEW.source_duration_seconds := COALESCE(
        NEW.source_duration_seconds,
        OLD.source_duration_seconds
      );
    END IF;
    NEW.claimed_by := NULL;
    NEW.claimed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_clip_backend_downgrade ON public.clip_backend_jobs;

CREATE TRIGGER trg_prevent_clip_backend_downgrade
BEFORE UPDATE OF status, progress, clips, error
ON public.clip_backend_jobs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_clip_backend_status_downgrade();

UPDATE public.clip_backend_jobs cb
SET
  status = 'done',
  progress = 100,
  error = NULL,
  clips = cj.clips,
  claimed_by = NULL,
  claimed_at = NULL,
  updated_at = NOW()
FROM public.clip_jobs cj
WHERE cj.backend_job_id = cb.backend_job_id
  AND cj.status = 'done'
  AND cb.status = 'processing'
  AND jsonb_array_length(COALESCE(cj.clips, '[]'::jsonb)) > 0;;
