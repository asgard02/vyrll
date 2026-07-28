-- Stripe billing fields on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_uidx
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx
  ON public.profiles (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
