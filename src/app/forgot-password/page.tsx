"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  AUTH_ERROR,
  AUTH_HEADING,
  AUTH_INPUT,
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_SUB,
  AUTH_SUBMIT,
} from "@/components/auth/auth-styles";

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

  if (sentTo) {
    return (
      <>
        <CheckCircle2 className="mb-5 size-8 text-[#a78bfa]" strokeWidth={1.75} />
        <h1 className={AUTH_HEADING}>{t("successTitle")}</h1>
        <p className={AUTH_SUB}>{t("successBody", { email: sentTo })}</p>
        <Link href="/login" className={`${AUTH_SUBMIT} mt-8`}>
          {t("backToLogin")}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className={AUTH_HEADING}>{t("title")}</h1>
      <p className={AUTH_SUB}>{t("subtitle")}</p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className={AUTH_LABEL}>
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
            className={AUTH_INPUT}
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

      <p className="mt-6 text-center text-[14px]">
        <Link href="/login" className={AUTH_LINK}>
          {t("backToLogin")}
        </Link>
      </p>
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-[#fdfff0]/50" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
