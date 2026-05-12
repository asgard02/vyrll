"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
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
        router.push("/verify-email?registered=1");
        router.refresh();
        return;
      }
      if (!hasSession) {
        router.push("/verify-email?registered=1");
        router.refresh();
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Erreur lors de l'inscription.");
    } finally {
      setLoading(false);
    }
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
        Retour
      </Link>

      <div className="w-full max-w-[380px]">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-border shadow-sm px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <img src="/logo.svg" alt="Vyrll" className="size-10 mb-4" />
            <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground text-center mb-1">
              Créer un compte
            </h1>
            <p className="text-sm text-muted-foreground text-center">
              Commence à créer des clips viraux gratuitement
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="email" className="sr-only">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="Email"
                className="w-full h-11 px-4 rounded-xl border border-border bg-[#fafafa] text-foreground placeholder:text-muted-foreground text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-white"
              />
            </div>

            <div>
              <label htmlFor="username" className="sr-only">Nom d&apos;utilisateur</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Nom d'utilisateur"
                className="w-full h-11 px-4 rounded-xl border border-border bg-[#fafafa] text-foreground placeholder:text-muted-foreground text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-white"
              />
            </div>

            <div>
              <label htmlFor="password" className="sr-only">Mot de passe</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="Mot de passe (min. 6 caractères)"
                className="w-full h-11 px-4 rounded-xl border border-border bg-[#fafafa] text-foreground placeholder:text-muted-foreground text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-white"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/5 border border-destructive/10 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                "Création du compte..."
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  Créer mon compte
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Déjà un compte ?{" "}
            <Link href="/login" className="text-primary font-medium hover:text-primary/80 transition-colors">
              Se connecter
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
          Gratuit · Aucune carte bancaire requise
        </p>
      </div>
    </div>
  );
}
