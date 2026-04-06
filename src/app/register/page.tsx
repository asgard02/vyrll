"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft } from "lucide-react";

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
    <div className="min-h-screen bg-[#080809] flex flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-2 font-mono text-xs text-zinc-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Retour
      </Link>

      <div className="w-full max-w-[360px]">
        <img src="/logo.svg" alt="Vyrll" className="size-10 mb-8 mx-auto" />
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white text-center mb-1">
          Inscription
        </h1>
        <p className="font-mono text-xs text-zinc-500 text-center mb-8">
          Crée ton compte pour commencer
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="Email"
              className="w-full h-12 px-4 rounded-xl border border-[#0f0f12] bg-[#0c0c0e] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#9b6dff]/50 focus:ring-1 focus:ring-[#9b6dff]/30"
            />
          </div>

          <div>
            <label htmlFor="username" className="sr-only">
              Nom d&apos;utilisateur
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Nom d&apos;utilisateur"
              className="w-full h-12 px-4 rounded-xl border border-[#0f0f12] bg-[#0c0c0e] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#9b6dff]/50 focus:ring-1 focus:ring-[#9b6dff]/30"
            />
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Mot de passe (min. 6 caractères)"
              className="w-full h-12 px-4 rounded-xl border border-[#0f0f12] bg-[#0c0c0e] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#9b6dff]/50 focus:ring-1 focus:ring-[#9b6dff]/30"
            />
          </div>

          {error && (
            <p className="font-mono text-xs text-[#ff3b3b]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-accent-gradient text-[#080809] font-mono text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Inscription..." : "S'inscrire"}
          </button>
        </form>

        <p className="mt-8 text-center font-mono text-xs text-zinc-500">
          Déjà un compte ?{" "}
          <Link href="/login" className="text-[#9b6dff] hover:text-[#9b6dff]/80 transition-colors">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
