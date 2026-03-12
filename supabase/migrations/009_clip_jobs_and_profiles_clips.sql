-- Quotas clips sur profiles (0 free, 10 pro, 50 unlimited)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clips_used INT NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clips_limit INT NOT NULL DEFAULT 0;

-- Table clip_jobs
CREATE TABLE IF NOT EXISTS public.clip_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  duration INT NOT NULL CHECK (duration IN (30, 60, 90)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  error TEXT,
  clips JSONB NOT NULL DEFAULT '[]',
  backend_job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clip_jobs_user_id ON public.clip_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_clip_jobs_created_at ON public.clip_jobs(created_at DESC);

ALTER TABLE public.clip_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own clip_jobs" ON public.clip_jobs;
CREATE POLICY "Users can view own clip_jobs"
  ON public.clip_jobs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own clip_jobs" ON public.clip_jobs;
CREATE POLICY "Users can insert own clip_jobs"
  ON public.clip_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own clip_jobs" ON public.clip_jobs;
CREATE POLICY "Users can update own clip_jobs"
  ON public.clip_jobs FOR UPDATE
  USING (auth.uid() = user_id);

-- Incrémenter clips_used (appelé quand un job passe à done)
CREATE OR REPLACE FUNCTION public.increment_clips_used(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET clips_used = clips_used + 1
  WHERE id = p_user_id;
END;
$$;
