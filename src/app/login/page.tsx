"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { isEmailNotConfirmedError } from "@/lib/supabase/auth-errors";
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

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth.login");
  const tCommon = useTranslations("common");
  const tLanding = useTranslations("landing.hero");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState("/dashboard");

  useEffect(() => {
    setNextPath(readClientNextPath());
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth_callback") {
      setError(t("errors.authCallback"));
    }
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) { setError(t("errors.emailRequired")); return; }
    if (!password) { setError(t("errors.passwordRequired")); return; }

    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        if (isEmailNotConfirmedError(authError)) {
          router.push(
            withNextParam(
              `/verify-email?email=${encodeURIComponent(email.trim())}`,
              nextPath
            )
          );
          router.refresh();
          return;
        }
        setError(authError.message);
        return;
      }

      if (data.user && !data.user.email_confirmed_at) {
        router.push(
          withNextParam(
            `/verify-email?email=${encodeURIComponent(email.trim())}`,
            nextPath
          )
        );
        router.refresh();
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch (err) {
      console.error("Login error:", err);
      setError(t("errors.connectionFailed"));
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
            <label htmlFor="password" className={AUTH_LABEL}>{tCommon("password")}</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder={tCommon("password")}
              showLabel={tCommon("showPassword")}
              hideLabel={tCommon("hidePassword")}
              className={AUTH_INPUT}
              toggleClassName={AUTH_TOGGLE}
            />
            <div className="mt-2.5 flex justify-end">
              <Link
                href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : "/forgot-password"}
                className="text-[13px] text-[#fdfff0]/45 transition-colors hover:text-[#fdfff0]"
              >
                {t("forgotPassword")}
              </Link>
            </div>
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
        {t("noAccount")}{" "}
        <Link href={withNextParam("/register", nextPath)} className={AUTH_LINK}>
          {t("registerLink")}
        </Link>
      </p>
      <p className="mt-8 text-center font-mono text-[12px] text-[#fdfff0]/35">
        {tLanding("freeNoCard")}
      </p>
    </>
  );
}
