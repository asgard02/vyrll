"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { AuthDivider, GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import {
  AUTH_ERROR,
  AUTH_HEADING,
  AUTH_INPUT,
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_SUB,
  AUTH_SUBMIT,
  AUTH_TOGGLE,
} from "@/components/auth/auth-styles";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Loader2, AlertCircle } from "lucide-react";
import {
  isShareNextPath,
  readClientNextPath,
  withNextParam,
} from "@/lib/auth-next-path";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("auth.register");
  const tCommon = useTranslations("common");
  const tLanding = useTranslations("landing.hero");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState("/dashboard");

  useEffect(() => {
    setNextPath(readClientNextPath());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) { setError(t("errors.emailRequired")); return; }
    if (!password) { setError(t("errors.passwordRequired")); return; }
    if (password.length < 6) { setError(t("errors.passwordMinLength")); return; }

    setLoading(true);

    try {
      const supabase = createClient();
      // Must match the browser origin (PKCE cookie). Do NOT prefer SITE_URL —
      // a stale NEXT_PUBLIC_SITE_URL breaks confirmation links / session exchange.
      const origin = window.location.origin;
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
          data: { username: username.trim() || undefined },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      const verifyHref = withNextParam(
        `/verify-email?registered=1&email=${encodeURIComponent(email)}`,
        nextPath
      );
      const u = data.user;
      const hasSession = Boolean(data.session);
      if (u && !u.email_confirmed_at) {
        router.push(verifyHref);
        router.refresh();
        return;
      }
      if (!hasSession) {
        router.push(verifyHref);
        router.refresh();
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError(t("errors.signupFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className={AUTH_HEADING}>{t("title")}</h1>
      <p className={AUTH_SUB}>
        {isShareNextPath(nextPath) ? t("shareSubtitle") : t("subtitle")}
      </p>

      <div className="mt-8">
        <GoogleAuthButton onError={setError} disabled={loading} nextPath={nextPath} />
        <AuthDivider />

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className={AUTH_LABEL}>{tCommon("email")}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={tCommon("email")}
              className={AUTH_INPUT}
            />
          </div>

          <div>
            <label htmlFor="username" className={AUTH_LABEL}>{tCommon("username")}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder={tCommon("username")}
              className={AUTH_INPUT}
            />
          </div>

          <div>
            <label htmlFor="password" className={AUTH_LABEL}>{tCommon("password")}</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder={t("passwordPlaceholder")}
              showLabel={tCommon("showPassword")}
              hideLabel={tCommon("hidePassword")}
              className={AUTH_INPUT}
              toggleClassName={AUTH_TOGGLE}
            />
          </div>

          {error && (
            <div className={AUTH_ERROR} role="alert">
              <AlertCircle className="mt-px size-4 shrink-0 text-[#fca5a5]" />
              <p className="text-[13px] leading-relaxed text-[#fca5a5]">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className={AUTH_SUBMIT}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("submitLoading")}
              </>
            ) : (
              t("submit")
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-[14px] text-[#fdfff0]/45">
        {t("hasAccount")}{" "}
        <Link href={withNextParam("/login", nextPath)} className={AUTH_LINK}>
          {t("loginLink")}
        </Link>
      </p>
      <p className="mt-8 text-center font-mono text-[12px] text-[#fdfff0]/35">
        {tLanding("freeNoCard")}
      </p>
    </>
  );
}
