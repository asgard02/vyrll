-- Annual subscriptions still refresh quota monthly (invoice.paid only fires yearly).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_interval TEXT,
  ADD COLUMN IF NOT EXISTS quota_reset_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_billing_interval_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

CREATE INDEX IF NOT EXISTS profiles_annual_quota_reset_idx
  ON public.profiles (quota_reset_at)
  WHERE plan IN ('creator', 'studio') AND billing_interval = 'year';
