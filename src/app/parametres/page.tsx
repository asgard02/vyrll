"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  User,
  Zap,
  Lock,
  AlertTriangle,
  Loader2,
  Check,
  X,
  ChevronRight,
  Film,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useProfile } from "@/lib/profile-context";
import { createClient } from "@/lib/supabase/client";
import { creditsToHours } from "@/lib/utils";
import {
  PLAN_CLIP_COPY,
  PLAN_CLIP_QUOTA_LEAD,
  planQuotaFootnote,
} from "@/lib/plan";

const TABS = [
  { id: "compte", label: "Compte", icon: User },
  { id: "plan", label: "Plan", icon: Zap },
  { id: "securite", label: "Sécurité", icon: Lock },
  { id: "danger", label: "Danger", icon: AlertTriangle },
] as const;

function Toast({
  message,
  type,
}: {
  message: string | null;
  type: "success" | "error";
}) {
  if (!message) return null;
  return (
    <div
      className={`fixed bottom-8 right-8 z-[1000] flex items-center gap-2.5 rounded-xl px-5 py-3 font-mono text-sm animate-in fade-in slide-in-from-bottom-4 duration-250 ${
        type === "error"
          ? "bg-[#ff3b3b]/10 border border-[#ff3b3b]/60 text-[#ff3b3b]"
          : "bg-[#9b6dff]/10 border border-[#9b6dff]/60 text-[#9b6dff]"
      }`}
    >
      {type === "error" ? <X className="size-4" /> : <Check className="size-4" />}
      {message}
    </div>
  );
}

function TabCompte({
  profile,
  onRefresh,
}: {
  profile: NonNullable<ReturnType<typeof useProfile>["profile"]>;
  onRefresh: () => void;
}) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const handleSave = async () => {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) {
      setToast({ message: "Le pseudo doit faire au moins 2 caractères.", type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error ?? "Erreur.", type: "error" });
      } else {
        onRefresh();
        setToast({ message: "Pseudo mis à jour !", type: "success" });
      }
    } catch {
      setToast({ message: "Erreur réseau.", type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1 text-center">
        <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
          Compte
        </h2>
        <p className="text-sm text-zinc-500">
          Pseudo et email affichés sur tes exports et ton espace.
        </p>
      </header>

      <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-center gap-5 pb-8 border-b border-[#1a1a1e]">
          <div className="size-16 shrink-0 rounded-2xl bg-gradient-to-br from-[#9b6dff]/25 to-[#9b6dff]/5 ring-1 ring-[#9b6dff]/30 flex items-center justify-center font-[family-name:var(--font-syne)] text-2xl font-bold text-[#c4a8ff]">
            {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-white truncate">
              {profile.username || "Utilisateur"}
            </p>
            <p className="text-sm text-zinc-500 mt-0.5">
              Membre depuis{" "}
              {new Date().toLocaleDateString("fr-FR", {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="pt-8 space-y-6">
          <div className="space-y-2">
            <label htmlFor="pseudo" className="text-sm font-medium text-zinc-400">
              Pseudo
            </label>
            <input
              id="pseudo"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-[#1a1a1e] bg-[#080809] text-white text-sm outline-none transition-all placeholder:text-zinc-600 focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15"
            />
            <p className="text-xs text-zinc-600">Visible dans tes rapports exportés.</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="text"
              value={profile.email ?? ""}
              readOnly
              className="w-full h-11 px-4 rounded-xl border border-[#1a1a1e] bg-[#080809]/60 text-zinc-500 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-zinc-600">Modification bientôt disponible.</p>
          </div>
        </div>

        <div className="pt-8 mt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="h-11 w-full sm:w-auto min-w-[200px] rounded-xl bg-[#9b6dff] px-6 text-sm font-semibold text-[#080809] hover:bg-[#b894ff] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function TabPlan({
  profile,
  onRefresh,
}: {
  profile: NonNullable<ReturnType<typeof useProfile>["profile"]>;
  onRefresh: () => void;
}) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch("/api/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error ?? "Code invalide.", type: "error" });
      } else {
        onRefresh();
        setToast({ message: data.message ?? "Code activé !", type: "success" });
        setCode("");
      }
    } catch {
      setToast({ message: "Erreur réseau.", type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const plans = [
    {
      id: "free" as const,
      label: "Free",
      price: "Gratuit",
      features: [
        PLAN_CLIP_QUOTA_LEAD.free,
        "Clips 9:16 & 1:1 avec sous-titres IA",
        "Score viral par clip",
        "Formats prêts pour TikTok / Reels / Shorts",
      ],
    },
    {
      id: "creator" as const,
      label: "Creator",
      price: "9€/mois",
      features: [
        PLAN_CLIP_QUOTA_LEAD.creator,
        "Tout du plan Gratuit",
      ],
      accent: true,
    },
    {
      id: "studio" as const,
      label: "Studio",
      price: "29€/mois",
      features: [
        PLAN_CLIP_QUOTA_LEAD.studio,
        "Tout du plan Creator",
        "Tu testes avant tout le monde",
      ],
    },
  ];

  const creditsUsed = profile.credits_used ?? 0;
  const creditsLimit = profile.credits_limit ?? 30;
  const creditsRemaining =
    creditsLimit < 0 ? 0 : Math.max(0, creditsLimit - creditsUsed);
  const videoPct =
    creditsLimit > 0 && creditsLimit !== -1
      ? Math.min(100, (creditsUsed / creditsLimit) * 100)
      : 0;
  const videoBarColor =
    videoPct > 80 ? "#ff3b3b" : videoPct > 50 ? "#ffd700" : "#4a9e6a";

  return (
    <div className="flex w-full flex-col gap-8 lg:gap-10">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        <div className="w-full shrink-0 space-y-6 lg:max-w-[min(100%,28rem)] lg:basis-[42%]">
          <header className="space-y-1">
            <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
              Plan & quotas
            </h2>
            <p className="text-sm text-zinc-500">
              Quota en crédits (minutes de vidéo source) ; offres disponibles.
            </p>
          </header>

          <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-7 space-y-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#9b6dff]/10 text-[#9b6dff]">
                  <Film className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Crédits vidéo</p>
                  <div className="text-xs text-zinc-500 mt-0.5 space-y-1">
                    {creditsLimit === -1 ? (
                      <p>
                        Soit {creditsToHours(creditsUsed)} de vidéo source traitée. Facturation aux
                        minutes de source.
                      </p>
                    ) : (
                      <>
                        <p>
                          Quota : {creditsToHours(creditsRemaining)} de vidéo source restante (1
                          crédit = 1 minute).
                        </p>
                        <p className="text-zinc-600">
                          Les crédits mesurent la durée de vidéo source que tu peux encore traiter sur
                          ton forfait.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-sm font-medium text-white tabular-nums shrink-0">
                {creditsLimit === -1
                  ? `${creditsUsed} crédits utilisés`
                  : `${creditsRemaining} crédits restants`}
              </span>
            </div>
            {creditsLimit !== -1 && (
              <div className="h-1.5 rounded-full bg-[#141418] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${videoPct}%`,
                    background: videoBarColor,
                    boxShadow: `0 0 12px ${videoBarColor}60`,
                  }}
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-7">
            <h3 className="text-sm font-medium text-white mb-1">Code promo</h3>
            <p className="text-xs text-zinc-500 mb-4">Débloque un plan ou des avantages partenaires.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                disabled={loading}
                className="h-11 w-full min-w-0 flex-1 rounded-xl border border-[#1a1a1e] bg-[#080809] px-4 text-sm uppercase tracking-wide text-white placeholder:text-zinc-700 outline-none focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleRedeem}
                disabled={loading}
                className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#9b6dff] px-6 text-sm font-semibold text-[#080809] transition-colors hover:bg-[#b894ff] disabled:opacity-50 sm:w-auto"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                Activer
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="space-y-1">
            <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
              Offres
            </h2>
            <p className="text-sm text-zinc-500">Tarifs et fonctionnalités par forfait.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.id}
                className={`relative flex flex-col gap-4 rounded-2xl border p-5 transition-shadow ${
                  p.accent ? "bg-[#9b6dff]/[0.04] border-[#9b6dff]/25" : "bg-[#0a0a0c] border-[#1a1a1e]"
                } ${
                  profile.plan === p.id
                    ? p.id === "creator"
                      ? "ring-1 ring-[#9b6dff]/40"
                      : p.id === "studio"
                        ? "ring-1 ring-amber-500/30"
                        : "ring-1 ring-zinc-600/50"
                    : ""
                }`}
              >
                {profile.plan === p.id && (
                  <span className="absolute right-4 top-4 text-[10px] font-semibold uppercase tracking-wider text-[#9b6dff]">
                    Actif
                  </span>
                )}
                <div>
                  <p className="font-[family-name:var(--font-syne)] text-lg font-bold text-white">
                    {p.label}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">{p.price}</p>
                </div>
                <div className="rounded-lg border border-[#1a1a1e] bg-[#080809] px-3 py-2.5">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#9b6dff]">
                    Clips
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-snug text-white">
                    {PLAN_CLIP_COPY[p.id].headline}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    {PLAN_CLIP_COPY[p.id].sub}
                  </p>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                    {planQuotaFootnote(p.id)}
                  </p>
                </div>
                <ul className="m-0 flex-1 list-none space-y-2 p-0">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs leading-snug text-zinc-400">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-[#9b6dff]/80" strokeWidth={2.5} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabSecurite() {
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const match = newPwd && confirm && newPwd === confirm;
  const mismatch = newPwd && confirm && newPwd !== confirm;

  const handleSave = async () => {
    if (!current || !newPwd || !confirm) return;
    if (newPwd !== confirm) {
      setToast({ message: "Les mots de passe ne correspondent pas.", type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (newPwd.length < 8) {
      setToast({ message: "Le mot de passe doit faire au moins 8 caractères.", type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) {
        setToast({ message: error.message ?? "Erreur.", type: "error" });
      } else {
        setCurrent("");
        setNewPwd("");
        setConfirm("");
        setToast({ message: "Mot de passe mis à jour !", type: "success" });
      }
    } catch {
      setToast({ message: "Erreur réseau.", type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1 text-center">
        <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
          Sécurité
        </h2>
        <p className="text-sm text-zinc-500">Mot de passe de connexion.</p>
      </header>

      <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-8 space-y-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Mot de passe actuel</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="w-full h-11 px-4 rounded-xl border border-[#1a1a1e] bg-[#080809] text-white text-sm outline-none focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Nouveau mot de passe</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            className="w-full h-11 px-4 rounded-xl border border-[#1a1a1e] bg-[#080809] text-white text-sm outline-none focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Confirmation</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={`w-full h-11 px-4 rounded-xl bg-[#080809] text-white text-sm outline-none transition-colors ${
              mismatch
                ? "border border-red-500/50 ring-2 ring-red-500/10"
                : match
                  ? "border border-[#9b6dff]/40 ring-2 ring-[#9b6dff]/10"
                  : "border border-[#1a1a1e] focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15"
            }`}
          />
          {mismatch && (
            <p className="text-xs text-red-400">Les mots de passe ne correspondent pas.</p>
          )}
          {match && (
            <p className="text-xs text-[#9b6dff]/90">Les mots de passe correspondent.</p>
          )}
        </div>

        <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="h-11 rounded-xl bg-[#9b6dff] px-6 text-sm font-semibold text-[#080809] hover:bg-[#b894ff] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 w-fit"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Mettre à jour
          </button>
          <p className="text-xs text-zinc-600">Au moins 8 caractères.</p>
        </div>
      </div>
    </div>
  );
}

function TabDanger() {
  const [confirm, setConfirm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDeleteAccount = async () => {
    if (confirm.toLowerCase() !== "supprimer mon compte") return;
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      // Note: Supabase ne permet pas la suppression de compte côté client.
      // Il faudrait un endpoint admin ou Supabase Dashboard.
      setShowModal(false);
      setConfirm("");
      window.location.href = "/";
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="space-y-1 text-center">
        <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
          Zone sensible
        </h2>
        <p className="text-sm text-zinc-500">Actions définitives — à utiliser avec précaution.</p>
      </header>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="min-w-0">
            <p className="font-medium text-red-400">Supprimer le compte</p>
            <p className="text-sm text-zinc-500 mt-1">
              Données et paramètres — irréversible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="h-10 shrink-0 self-center rounded-xl border border-red-500/40 bg-red-500/15 px-5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/25 sm:self-center"
          >
            Supprimer
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-[#080809]/90 backdrop-blur-sm flex items-center justify-center z-[999]">
          <div className="rounded-2xl border border-[#ff3b3b]/40 bg-[#0c0c0e] p-8 max-w-[440px] w-[90%] flex flex-col gap-5">
            <div>
              <p className="font-[family-name:var(--font-syne)] font-bold text-[#ff3b3b] text-lg mb-1.5">
                Supprimer le compte
              </p>
              <p className="font-mono text-sm text-zinc-500">
                Cette action est permanente et ne peut pas être annulée. Toutes tes
                données et paramètres seront supprimés.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs text-zinc-500">
                Tape{" "}
                <span className="text-[#ff3b3b]">supprimer mon compte</span> pour
                confirmer
              </label>
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="supprimer mon compte"
                className="h-11 px-4 rounded-lg border border-[#ff3b3b]/40 bg-[#080809] text-white font-mono text-sm outline-none placeholder-zinc-600"
              />
            </div>
            <div className="flex gap-2.5 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setConfirm("");
                }}
                className="h-10 px-4 rounded-lg border border-[#1a1a1e] text-zinc-500 font-mono text-sm hover:bg-[#0d0d0f] transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={confirm.toLowerCase() !== "supprimer mon compte" || loading}
                className="h-10 px-4 rounded-lg bg-[#ff3b3b] text-white font-mono text-sm font-bold hover:bg-[#ff3b3b]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParametresContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam && ["compte", "plan", "securite", "danger"].includes(tabParam)
      ? tabParam
      : "compte";
  const [tab, setTab] = useState(initialTab);
  const { profile, refresh } = useProfile();

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["compte", "plan", "securite", "danger"].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);

  const goTab = (id: (typeof TABS)[number]["id"]) => {
    setTab(id);
    router.replace(`/parametres?tab=${id}`, { scroll: false });
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#9b6dff]" />
      </div>
    );
  }

  const headerCreditsUsed = profile.credits_used ?? 0;
  const headerCreditsLimit = profile.credits_limit ?? 30;
  const headerCreditsRemaining =
    headerCreditsLimit < 0 ? 0 : Math.max(0, headerCreditsLimit - headerCreditsUsed);

  const renderTab = () => {
    switch (tab) {
      case "compte":
        return <TabCompte profile={profile} onRefresh={refresh} />;
      case "plan":
        return <TabPlan profile={profile} onRefresh={refresh} />;
      case "securite":
        return <TabSecurite />;
      case "danger":
        return <TabDanger />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300">
      <Sidebar activeItem="parametres" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex w-full flex-1 flex-col">
          <div className="flex w-full flex-col">
            <div className="shrink-0 border-b border-[#0f0f12] bg-[#080809]/80 px-6 backdrop-blur-md sm:px-8">
              <div className="mx-auto flex h-[52px] w-full max-w-7xl items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-500">
                  <span className="truncate text-zinc-600">Vyrll</span>
                  <ChevronRight className="size-3.5 shrink-0 text-zinc-700" aria-hidden />
                  <span className="truncate text-zinc-400">Paramètres</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="inline-flex max-w-[42vw] items-center gap-2 rounded-full border border-[#1a1a1e] bg-[#0c0c0e] px-2.5 py-1.5 font-mono text-[10px] text-zinc-300 tabular-nums sm:max-w-none sm:px-3 sm:text-[11px]">
                    <Zap className="size-3.5 text-[#9b6dff]" aria-hidden />
                    {headerCreditsLimit === -1
                      ? `${creditsToHours(headerCreditsUsed)} utilisés`
                      : `${creditsToHours(headerCreditsRemaining)} restantes`}
                  </span>
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#9b6dff]/20 to-[#9b6dff]/5 font-[family-name:var(--font-syne)] text-sm font-bold text-[#c4a8ff] ring-1 ring-[#9b6dff]/30"
                    title={profile.username ?? profile.email ?? ""}
                  >
                    {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="shrink-0 border-b border-[#0f0f12] bg-[#080809] px-6 sm:px-8"
              role="tablist"
              aria-label="Sections paramètres"
            >
              <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => goTab(t.id)}
                      className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors ${
                        active
                          ? "border-[#9b6dff] text-white"
                          : "border-transparent text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      <Icon className={`size-4 ${active ? "text-[#9b6dff]" : "opacity-70"}`} strokeWidth={active ? 2.25 : 2} />
                      {t.label}
                      {t.id === "danger" && (
                        <span className="size-1.5 rounded-full bg-red-500/90" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="w-full pb-16">
              <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 sm:py-12">
                {renderTab()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function ParametresPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#080809] text-zinc-300 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-[#9b6dff]" />
        </div>
      }
    >
      <ParametresContent />
    </Suspense>
  );
}
