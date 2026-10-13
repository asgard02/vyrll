-- Une adresse qui a déjà eu un compte ne peut plus en ouvrir un autre.
-- Écriture réservée aux triggers auth. RLS sans policy : anon et authenticated n'ont pas d'accès.

CREATE TABLE IF NOT EXISTS public.retired_emails (
  email TEXT PRIMARY KEY,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.retired_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retired_emails FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_retired_auth_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_email TEXT;
  new_email TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_email := NULLIF(lower(btrim(COALESCE(OLD.email, ''))), '');
    IF old_email IS NOT NULL THEN
      INSERT INTO public.retired_emails (email)
      VALUES (old_email)
      ON CONFLICT (email) DO NOTHING;
    END IF;
    RETURN OLD;
  END IF;

  new_email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');

  IF TG_OP = 'UPDATE' THEN
    old_email := NULLIF(lower(btrim(COALESCE(OLD.email, ''))), '');
    IF old_email IS NOT NULL AND old_email IS DISTINCT FROM new_email THEN
      INSERT INTO public.retired_emails (email)
      VALUES (old_email)
      ON CONFLICT (email) DO NOTHING;
    END IF;
  END IF;

  IF new_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.retired_emails WHERE email = new_email
  ) THEN
    RAISE EXCEPTION 'retired_email'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS retired_emails_on_auth_delete ON auth.users;
CREATE TRIGGER retired_emails_on_auth_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_retired_auth_email();

DROP TRIGGER IF EXISTS retired_emails_on_auth_insert ON auth.users;
CREATE TRIGGER retired_emails_on_auth_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_retired_auth_email();

DROP TRIGGER IF EXISTS retired_emails_on_auth_email_update ON auth.users;
CREATE TRIGGER retired_emails_on_auth_email_update
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_retired_auth_email();

REVOKE ALL ON FUNCTION public.guard_retired_auth_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_retired_auth_email() TO supabase_auth_admin;

-- Message renvoyé tel quel par GoTrue au formulaire d'inscription.
CREATE OR REPLACE FUNCTION public.hook_reject_retired_email(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT;
BEGIN
  normalized := NULLIF(lower(btrim(COALESCE(event->'user'->>'email', ''))), '');
  IF normalized IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.retired_emails WHERE email = normalized
  ) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Cette adresse ne peut plus servir à créer un compte.',
        'http_code', 403
      )
    );
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.hook_reject_retired_email(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_reject_retired_email(JSONB) TO supabase_auth_admin;
