-- Acceptation checkout (accès immédiat) et rappels de reconduction annuelle.
-- Écriture réservée au service role. RLS sans policy : anon et authenticated n'ont pas d'accès.

CREATE TABLE IF NOT EXISTS public.checkout_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL,
  plan TEXT NOT NULL,
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS checkout_consents_user_id_idx
  ON public.checkout_consents (user_id);

ALTER TABLE public.checkout_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_consents TO service_role;

CREATE TABLE IF NOT EXISTS public.renewal_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_subscription_id, period_end)
);

CREATE INDEX IF NOT EXISTS renewal_reminders_user_id_idx
  ON public.renewal_reminders (user_id);

ALTER TABLE public.renewal_reminders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.renewal_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.renewal_reminders TO service_role;
