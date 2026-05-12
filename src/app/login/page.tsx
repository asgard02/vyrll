"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth_callback") {
      setError(
        "Le lien de confirmation est invalide ou expiré. Connecte-toi ou renvoie un email depuis la page de vérification."
      );
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (data.user && !data.user.email_confirmed_at) {
        router.push("/verify-email");
        router.refresh();
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Login error:", err);
      setError("Erreur de connexion.");
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
              Connexion
            </h1>
            <p className="text-sm text-muted-foreground text-center">
              Accède à ton espace de création
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
              <label htmlFor="password" className="sr-only">Mot de passe</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Mot de passe"
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
                "Connexion..."
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  Se connecter
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Pas de compte ?{" "}
            <Link href="/register" className="text-primary font-medium hover:text-primary/80 transition-colors">
              S&apos;inscrire gratuitement
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
