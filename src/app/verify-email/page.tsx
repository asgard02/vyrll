"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";
import { ArrowLeft, Mail, RotateCcw } from "lucide-react";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth.verifyEmail");
  const tCommon = useTranslations("common");
  const registered = searchParams.get("registered") === "1";
  const emailFromUrl = searchParams.get("email");

  const [email, setEmail] = useState<string | null>(emailFromUrl);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    if (emailFromUrl) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) {
        if (isInvalidRefreshTokenError(error)) void supabase.auth.signOut();
        router.replace("/login");
        return;
      }
      if (!user) { router.replace("/login"); return; }
      if (user.email_confirmed_at) { router.replace("/dashboard"); return; }
      setEmail(user.email ?? null);
    });
  }, [router, emailFromUrl]);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email_confirmed_at) {
        router.replace("/dashboard");
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const handleResend = async () => {
    if (!email) return;
    setResendMsg(null);
    setResendErr(null);
    setResendLoading(true);
    try {
      const supabase = createClient();
      const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
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
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="relative min-h-screen bg-[#fafafa] flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      {/* Background blobs */}
      <div
        className="pointer-events-none absolute -top-32 -left-32 size-[500px] rounded-full opacity-[0.07]"
        style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-20 size-[400px] rounded-full opacity-[0.05]"
        style={{ background: "radial-gradient(circle, #6366f1, transparent 70%)" }}
        aria-hidden
      />

      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {tCommon("back")}
      </Link>

      <div className="w-full max-w-[380px]">
        <div className="bg-white rounded-2xl border border-border shadow-sm px-8 py-10">

          {/* Icon + heading */}
          <div className="flex flex-col items-center mb-8">
            <div className="size-14 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mb-5">
              <Mail className="size-6 text-primary" strokeWidth={1.75} />
            </div>
            <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground text-center mb-2">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              {registered ? t("subtitleRegistered") : t("subtitleUnconfirmed")}
            </p>
          </div>

          {/* Email badge */}
          {email && (
            <div className="mb-6 flex items-center justify-center gap-2 bg-[#fafafa] border border-border rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-foreground truncate">{email}</span>
            </div>
          )}

          {/* Instructions */}
          <p className="text-xs text-muted-foreground text-center mb-6 leading-relaxed">
            {t.rich("instructions", {
              confirmLink: (chunks) => (
                <span className="font-medium text-foreground">{chunks}</span>
              ),
            })}
          </p>

          {/* Actions */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || !email}
              className="w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <RotateCcw className={`size-3.5 ${resendLoading ? "animate-spin" : ""}`} />
              {resendLoading ? t("resendLoading") : t("resend")}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full h-10 rounded-xl border border-border bg-transparent text-muted-foreground text-xs font-medium hover:text-foreground hover:border-zinc-300 transition-colors"
            >
              {t("useOtherEmail")}
            </button>
          </div>

          {resendMsg && (
            <p className="mt-4 text-xs text-emerald-600 text-center font-medium" role="status">
              {resendMsg}
            </p>
          )}
          {resendErr && (
            <p className="mt-4 text-xs text-destructive text-center" role="alert">
              {resendErr}
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
          {t("spamHint")}
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
          <div className="size-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
