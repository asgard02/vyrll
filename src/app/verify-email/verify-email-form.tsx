"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";
import { RotateCcw } from "lucide-react";
import { safeNextPath, withNextParam } from "@/lib/auth-next-path";
import {
  AUTH_GHOST,
  AUTH_HEADING,
  AUTH_SUB,
  AUTH_SUBMIT,
} from "@/components/auth/auth-styles";

export function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth.verifyEmail");
  const registered = searchParams.get("registered") === "1";
  const emailFromUrl = searchParams.get("email");
  const nextPath = safeNextPath(searchParams.get("next"));

  const [email, setEmail] = useState<string | null>(emailFromUrl);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    if (emailFromUrl) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) {
        if (isInvalidRefreshTokenError(error)) void supabase.auth.signOut({ scope: "local" });
        router.replace(withNextParam("/login", nextPath));
        return;
      }
      if (!user) { router.replace(withNextParam("/login", nextPath)); return; }
      if (user.email_confirmed_at) { router.replace(nextPath); return; }
      setEmail(user.email ?? null);
    });
  }, [router, emailFromUrl, nextPath]);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email_confirmed_at) {
        router.replace(nextPath);
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, nextPath]);

  const handleResend = async () => {
    if (!email) return;
    setResendMsg(null);
    setResendErr(null);
    setResendLoading(true);
    try {
      const supabase = createClient();
      // Same browser origin as signup — required for PKCE code exchange.
      const origin = window.location.origin;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) { setResendErr(error.message); return; }
      setResendMsg(t("resendSuccess"));
    } catch {
      setResendErr(t("resendFailed"));
    } finally {
      setResendLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace(withNextParam("/login", nextPath));
    router.refresh();
  };

  return (
    <>
      <h1 className={AUTH_HEADING}>{t("title")}</h1>
      <p className={AUTH_SUB}>
        {registered ? t("subtitleRegistered") : t("subtitleUnconfirmed")}
      </p>

      {email && (
        <p className="mt-6 truncate rounded-full border border-[var(--lp-hairline)] bg-white px-5 py-3 text-[14px] text-[var(--lp-ink)]">
          {email}
        </p>
      )}

      <p className="mt-5 text-[14px] leading-relaxed text-[var(--lp-ink-80)]">
        {t.rich("instructions", {
          confirmLink: (chunks) => (
            <span className="font-medium text-[var(--lp-ink)]">{chunks}</span>
          ),
        })}
      </p>

      <div className="mt-8 space-y-2.5">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendLoading || !email}
          className={AUTH_SUBMIT}
        >
          <RotateCcw className={`size-3.5 ${resendLoading ? "animate-spin" : ""}`} />
          {resendLoading ? t("resendLoading") : t("resend")}
        </button>
        <button type="button" onClick={handleSignOut} className={AUTH_GHOST}>
          {t("useOtherEmail")}
        </button>
      </div>

      {resendMsg && (
        <p className="mt-4 text-center text-[13px] font-medium text-[var(--lp-ink)]" role="status">
          {resendMsg}
        </p>
      )}
      {resendErr && (
        <p className="mt-4 text-center text-[13px] text-destructive" role="alert">
          {resendErr}
        </p>
      )}

      <p className="mt-8 text-center font-mono text-[12px] text-[var(--lp-ink-80)]">
        {t("spamHint")}
      </p>
    </>
  );
}
