"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, Mail } from "lucide-react";

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const t = useTranslations("auth.forgotPassword");
  const tCommon = useTranslations("common");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = searchParams.get("email")?.trim() ?? "";
    if (fromQuery) setEmail(fromQuery);
    if (searchParams.get("error") === "invalid_link") {
      setError(t("invalidLink"));
    }
  }, [searchParams, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("errors.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("errors.emailInvalid"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(
          typeof data?.error === "string" ? data.error : t("errors.rateLimited")
        );
        return;
      }
      if (!res.ok) {
        setError(
          typeof data?.error === "string" ? data.error : t("errors.sendFailed")
        );
        return;
      }
      setSentTo(trimmed);
    } catch {
      setError(tCommon("networkError"));
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
        href="/login"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {tCommon("back")}
      </Link>

      <div className="relative w-full max-w-[380px]">
        <div className="rounded-2xl border border-border bg-white px-8 py-10 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_8px_24px_-10px_rgba(28,28,30,0.12)]">
          {sentTo ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="size-6" strokeWidth={1.75} />
              </div>
              <h1 className="font-[family-name:var(--font-syne)] mb-2 text-2xl font-bold text-foreground">
                {t("successTitle")}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("successBody", { email: sentTo })}
              </p>
              <Link
                href="/login"
                className="mt-8 flex h-11 w-full items-center justify-center rounded-xl bg-[#6d28d9] text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.45)] transition-colors hover:bg-[#5b21b6]"
              >
                {t("backToLogin")}
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8 flex flex-col items-center">
                <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[#6d28d9]/8 text-[#6d28d9]">
                  <Mail className="size-6" strokeWidth={1.75} />
                </div>
                <h1 className="font-[family-name:var(--font-syne)] mb-1 text-center text-2xl font-bold text-foreground">
                  {t("title")}
                </h1>
                <p className="text-center text-sm text-muted-foreground">
                  {t("subtitle")}
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-3">
                <div>
                  <label htmlFor="email" className="sr-only">
                    {tCommon("email")}
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder={tCommon("email")}
                    className="h-11 w-full rounded-xl border border-border bg-[#fafafa] px-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:bg-white focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                {error && (
                  <div
                    className="flex items-start gap-2.5 rounded-xl border border-destructive/15 bg-destructive/5 px-3.5 py-3"
                    role="alert"
                  >
                    <AlertCircle className="mt-px size-4 shrink-0 text-destructive" />
                    <p className="text-xs leading-relaxed text-destructive">{error}</p>
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
                <Link
                  href="/login"
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t("backToLogin")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
          <Loader2 className="size-5 animate-spin text-[#6d28d9]" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
