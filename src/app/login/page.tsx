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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;

type LoginCode =
  | "email_required"
  | "email_invalid"
  | "password_required"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "send_failed"
  | "unavailable";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth.login");
  const tCommon = useTranslations("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [nextPath, setNextPath] = useState("/dashboard");

  useEffect(() => {
    setNextPath(readClientNextPath());
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error");
    if (authError === "auth_callback") {
      setError(t("errors.authCallback"));
    } else if (authError === "retired_email") {
      setError(t("errors.emailRetired"));
    }
  }, [t]);

  const goToVerifyEmail = (address: string) => {
    router.push(
      withNextParam(
        `/verify-email?email=${encodeURIComponent(address)}`,
        nextPath
      )
    );
    router.refresh();
  };

  const messageForCode = (raw: string): string => {
    switch (raw as LoginCode) {
      case "email_required":
        return t("errors.emailRequired");
      case "email_invalid":
        return t("errors.emailInvalid");
      case "password_required":
        return t("errors.passwordRequired");
      case "invalid_credentials":
        return t("errors.invalidCredentials");
      case "rate_limited":
        return t("errors.rateLimited");
      case "send_failed":
      case "unavailable":
      case "email_not_confirmed":
        return t("errors.sendFailed");
      default:
        return t("errors.connectionFailed");
    }
  };

  const readCredentials = (): { email: string; password: string } | null => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError(t("errors.emailRequired"));
      return null;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t("errors.emailInvalid"));
      return null;
    }
    if (!password) {
      setError(t("errors.passwordRequired"));
      return null;
    }
    return { email: trimmed, password };
  };

  const requestCode = async (address: string, currentPassword: string) => {
    const res = await fetch("/api/auth/login-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address, password: currentPassword }),
    });
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    if (data.code === "email_not_confirmed") {
      goToVerifyEmail(address);
      return "redirect" as const;
    }
    if (!res.ok) {
      setError(messageForCode(data.code ?? ""));
      return "error" as const;
    }
    return "ok" as const;
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const credentials = readCredentials();
    if (!credentials) return;

    setSending(true);
    try {
      const result = await requestCode(credentials.email, credentials.password);
      if (result !== "ok") return;
      setEmail(credentials.email);
      setCode("");
      setCodeSent(true);
    } catch (err) {
      console.error("[login] password:", err);
      setError(t("errors.connectionFailed"));
    } finally {
      setSending(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const address = email.trim().toLowerCase();
    const token = code.replace(/\D/g, "");
    if (token.length !== OTP_LENGTH) {
      setError(t("errors.codeRequired"));
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email: address,
        token,
        type: "email",
      });
      if (authError) {
        setError(t("errors.codeInvalid"));
        return;
      }
      if (!data.user?.email_confirmed_at) {
        goToVerifyEmail(address);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      console.error("[login] verify code:", err);
      setError(t("errors.connectionFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className={AUTH_HEADING}>{t("title")}</h1>
      <p className={AUTH_SUB}>
        {codeSent
          ? t("codeSent", { email })
          : isShareNextPath(nextPath)
            ? t("shareSubtitle")
            : t("subtitle")}
      </p>

      <div className="mt-8">
        <GoogleAuthButton onError={setError} disabled={loading || sending} nextPath={nextPath} />
        <AuthDivider />

        {!codeSent ? (
          <form onSubmit={handlePassword} noValidate className="space-y-4">
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
                  className="text-[13px] text-[var(--lp-ink-80)] transition-colors hover:text-[var(--lp-ink)]"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
            </div>
            {error && <LoginError message={error} />}
            <button type="submit" disabled={sending} className={AUTH_SUBMIT}>
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t("submitLoading")}
                </>
              ) : (
                t("submit")
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} noValidate className="space-y-4">
            <div>
              <label htmlFor="code" className={AUTH_LABEL}>{t("codeLabel")}</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
                required
                maxLength={OTP_LENGTH}
                pattern="[0-9]*"
                className={`${AUTH_INPUT} text-center tracking-[0.3em]`}
              />
            </div>
            {error && <LoginError message={error} />}
            <button type="submit" disabled={loading || sending} className={AUTH_SUBMIT}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t("verifyCodeLoading")}
                </>
              ) : (
                t("verifyCode")
              )}
            </button>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <button
                type="button"
                disabled={loading || sending}
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
                className="text-[var(--lp-ink-80)] transition-colors hover:text-[var(--lp-ink)] disabled:opacity-50"
              >
                {t("backToPassword")}
              </button>
              <button
                type="button"
                disabled={loading || sending}
                onClick={() => {
                  void (async () => {
                    setError(null);
                    const credentials = readCredentials();
                    if (!credentials) return;
                    setSending(true);
                    try {
                      const result = await requestCode(credentials.email, credentials.password);
                      if (result === "ok") setCode("");
                    } catch (err) {
                      console.error("[login] resend:", err);
                      setError(t("errors.connectionFailed"));
                    } finally {
                      setSending(false);
                    }
                  })();
                }}
                className="text-[var(--lp-accent)] transition-colors hover:text-[var(--lp-accent-deep)] disabled:opacity-50"
              >
                {sending ? t("resendCodeLoading") : t("resendCode")}
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-[14px] text-[var(--lp-ink-80)]">
        {t("noAccount")}{" "}
        <Link href={withNextParam("/register", nextPath)} className={AUTH_LINK}>
          {t("registerLink")}
        </Link>
      </p>
    </>
  );
}

function LoginError({ message }: { message: string }) {
  return (
    <div className={AUTH_ERROR} role="alert">
      <AlertCircle className="mt-px size-4 shrink-0" />
      <p className="text-[13px] leading-relaxed">{message}</p>
    </div>
  );
}
