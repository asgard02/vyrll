"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { isEmailNotConfirmedError } from "@/lib/supabase/auth-errors";
import { AuthDivider, GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f7f7f8] px-4 py-12">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,_rgba(109,40,217,0.08),_transparent_65%)]"
        aria-hidden
      />

      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {tCommon("back")}
      </Link>

      <div className="relative w-full max-w-[380px]">
        <div className="rounded-2xl border border-border bg-white px-8 py-10 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_8px_24px_-10px_rgba(28,28,30,0.12)]">
          <div className="flex flex-col items-center mb-8">
            <img src="/logo.svg" alt={tCommon("brand")} className="size-10 mb-4" />
            <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground text-center mb-1">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground text-center">
              {isShareNextPath(nextPath) ? t("shareSubtitle") : t("subtitle")}
            </p>
          </div>

          <GoogleAuthButton onError={setError} disabled={loading} nextPath={nextPath} />
          <AuthDivider />

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <div>
              <label htmlFor="email" className="sr-only">{tCommon("email")}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={tCommon("email")}
                className="w-full h-11 px-4 rounded-xl border border-border bg-[#fafafa] text-foreground placeholder:text-muted-foreground text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-white"
              />
            </div>

            <div>
              <label htmlFor="password" className="sr-only">{tCommon("password")}</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={tCommon("password")}
                showLabel={tCommon("showPassword")}
                hideLabel={tCommon("hidePassword")}
                className="w-full h-11 px-4 rounded-xl border border-border bg-[#fafafa] text-foreground placeholder:text-muted-foreground text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-white"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/5 border border-destructive/15 px-3.5 py-3" role="alert">
                <AlertCircle className="size-4 text-destructive shrink-0 mt-px" />
                <p className="text-xs text-destructive leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#6d28d9] text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.45)] transition-colors hover:bg-[#5b21b6] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
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

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href={withNextParam("/register", nextPath)} className="text-primary font-medium hover:text-primary/80 transition-colors">
              {t("registerLink")}
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
          {tLanding("freeNoCard")}
        </p>
      </div>
    </div>
  );
}
