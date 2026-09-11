"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  AUTH_ERROR,
  AUTH_HEADING,
  AUTH_INPUT,
  AUTH_LABEL,
  AUTH_SUB,
  AUTH_SUBMIT,
  AUTH_TOGGLE,
} from "@/components/auth/auth-styles";

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useTranslations("auth.resetPassword");
  const tCommon = useTranslations("common");
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) setExpired(true);
      setReady(true);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError(t("errors.passwordRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("errors.passwordMinLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setExpired(true);
          return;
        }
        setError(
          typeof data?.error === "string" ? data.error : t("errors.updateFailed")
        );
        return;
      }
      setDone(true);
    } catch {
      setError(tCommon("networkError"));
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-[#fdfff0]/50" />
      </div>
    );
  }

  if (done) {
    return (
      <>
        <CheckCircle2 className="mb-5 size-8 text-[#a78bfa]" strokeWidth={1.75} />
        <h1 className={AUTH_HEADING}>{t("successTitle")}</h1>
        <p className={AUTH_SUB}>{t("successBody")}</p>
        <button
          type="button"
          onClick={() => {
            router.push("/dashboard");
            router.refresh();
          }}
          className={`${AUTH_SUBMIT} mt-8`}
        >
          {t("continue")}
        </button>
      </>
    );
  }

  if (expired) {
    return (
      <>
        <h1 className={AUTH_HEADING}>{t("expiredTitle")}</h1>
        <p className={AUTH_SUB}>{t("expiredBody")}</p>
        <Link href="/forgot-password" className={`${AUTH_SUBMIT} mt-8`}>
          {t("requestNew")}
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
          <label htmlFor="new-password" className={AUTH_LABEL}>
            {t("newPassword")}
          </label>
          <PasswordInput
            id="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder={t("newPassword")}
            showLabel={tCommon("showPassword")}
            hideLabel={tCommon("hidePassword")}
            className={AUTH_INPUT}
            toggleClassName={AUTH_TOGGLE}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className={AUTH_LABEL}>
            {t("confirmPassword")}
          </label>
          <PasswordInput
            id="confirm-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder={t("confirmPassword")}
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
    </>
  );
}
