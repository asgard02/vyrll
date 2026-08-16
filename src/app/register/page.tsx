"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { AuthDivider, GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ArrowLeft, Sparkles, AlertCircle } from "lucide-react";
import {
  authPathWithPending,
  dashboardPathWithPending,
  readClipUrlParam,
  setPendingClipUrl,
} from "@/lib/pending-clip-url";

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
  const [loginHref, setLoginHref] = useState("/login");

  useEffect(() => {
    const fromQuery = readClipUrlParam(window.location.search);
    if (fromQuery) setPendingClipUrl(fromQuery);
    setLoginHref(authPathWithPending("/login"));
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
      const next = dashboardPathWithPending();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
          data: { username: username.trim() || undefined },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      const u = data.user;
      const hasSession = Boolean(data.session);
      if (u && !u.email_confirmed_at) {
        router.push(`/verify-email?registered=1&email=${encodeURIComponent(email)}`);
        router.refresh();
        return;
      }
      if (!hasSession) {
        router.push(`/verify-email?registered=1&email=${encodeURIComponent(email)}`);
        router.refresh();
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError(t("errors.signupFailed"));
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
              {t("subtitle")}
            </p>
          </div>

          <GoogleAuthButton onError={setError} disabled={loading} />
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
              <label htmlFor="username" className="sr-only">{tCommon("username")}</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder={tCommon("username")}
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
                minLength={6}
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
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
              className="mt-1 w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                t("submitLoading")
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  {t("submit")}
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("hasAccount")}{" "}
            <Link href={loginHref} className="text-primary font-medium hover:text-primary/80 transition-colors">
              {t("loginLink")}
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
