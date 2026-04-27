"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";
import { Mail } from "lucide-react";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";

  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          void supabase.auth.signOut();
        }
        router.replace("/login");
        return;
      }
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.email_confirmed_at) {
        router.replace("/dashboard");
        return;
      }
      setEmail(user.email ?? null);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
        },
      });
      if (error) {
        setResendErr(error.message);
        return;
      }
      setResendMsg("Un nouveau lien t’a été envoyé.");
    } catch {
      setResendErr("Impossible d’envoyer l’email.");
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="font-mono text-xs text-zinc-500">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] text-center">
        <div className="flex justify-center mb-6">
          <div className="size-14 rounded-2xl bg-card border border-border flex items-center justify-center">
            <Mail className="size-7 text-primary" />
          </div>
        </div>
        <h1 className="font-display font-bold text-2xl text-white mb-2">
          Vérifie ton email
        </h1>
        <p className="font-mono text-xs text-zinc-500 mb-6 leading-relaxed">
          {registered
            ? "Un lien de confirmation vient d’être envoyé."
            : "Tu dois confirmer ton adresse avant d’accéder à l’app."}
          {email ? (
            <>
              <br />
              <span className="text-zinc-400">{email}</span>
            </>
          ) : null}
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendLoading || !email}
            className="w-full h-12 rounded-xl bg-accent-gradient text-primary-foreground font-mono text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendLoading ? "Envoi…" : "Renvoyer l’email"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full h-11 rounded-xl border border-border bg-transparent text-zinc-400 font-mono text-xs hover:text-white hover:border-zinc-600 transition-colors"
          >
            Se déconnecter
          </button>
        </div>

        {resendMsg && (
          <p className="mt-4 font-mono text-xs text-emerald-400" role="status">
            {resendMsg}
          </p>
        )}
        {resendErr && (
          <p className="mt-4 font-mono text-xs text-destructive" role="alert">
            {resendErr}
          </p>
        )}

        <p className="mt-10 font-mono text-xs text-zinc-600">
          Après avoir cliqué sur le lien dans l’email, tu seras redirigé vers le
          tableau de bord.
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
          <p className="font-mono text-xs text-zinc-500">Chargement…</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
