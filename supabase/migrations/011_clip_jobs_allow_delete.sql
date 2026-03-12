-- Autoriser l'utilisateur à supprimer ses propres clip_jobs (RLS manquait FOR DELETE)
DROP POLICY IF EXISTS "Users can delete own clip_jobs" ON public.clip_jobs;
CREATE POLICY "Users can delete own clip_jobs"
  ON public.clip_jobs FOR DELETE
  USING (auth.uid() = user_id);
