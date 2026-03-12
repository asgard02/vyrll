-- Statut pour analyses asynchrones (et clips futurs)
-- pending: créée, en attente de traitement
-- processing: en cours (optionnel, pour debug)
-- completed: terminée avec succès
-- failed: erreur (voir error_message)

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Les analyses existantes gardent status = 'completed' via le DEFAULT
