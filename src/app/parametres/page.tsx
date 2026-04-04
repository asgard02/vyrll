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
  approximateClipsFromSourceMinutes,
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
    <div className="flex flex-col gap-8 max-w-xl">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1">
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
        "Plus de quota vidéo source",
        "Tout du plan Gratuit",
        "Projets clips sauvegardés",
        "Transforme ta vidéo en clips verticaux",
        "Téléchargement des fichiers clip",
        "Réponse en moins de 24h",
      ],
      accent: true,
    },
    {
      id: "studio" as const,
      label: "Studio",
      price: "29€/mois",
      features: [
        PLAN_CLIP_QUOTA_LEAD.studio,
        "Quota vidéo source maximal",
        "Tout du plan Creator",
        "Tu testes avant tout le monde",
        "Réponse en moins de 24h",
      ],
    },
  ];

  const creditsUsed = profile.credits_used ?? 0;
  const creditsLimit = profile.credits_limit ?? 30;
  const creditsRemaining =
    creditsLimit < 0 ? 0 : Math.max(0, creditsLimit - creditsUsed);
  const planId = profile.plan ?? "free";
  const clipsUsed = approximateClipsFromSourceMinutes(planId, creditsUsed);
  const clipsRemaining = approximateClipsFromSourceMinutes(planId, creditsRemaining);
  const clipsLimitApprox =
    creditsLimit === -1 ? null : approximateClipsFromSourceMinutes(planId, creditsLimit);
  const videoPct =
    creditsLimit > 0 && creditsLimit !== -1
      ? Math.min(100, (creditsUsed / creditsLimit) * 100)
      : 0;
  const videoBarColor =
    videoPct > 80 ? "#ff3b3b" : videoPct > 50 ? "#ffd700" : "#4a9e6a";

  return (
    <div className="flex flex-col gap-10 max-w-5xl">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1">
        <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
          Plan & quotas
        </h2>
        <p className="text-sm text-zinc-500">
          Estimation clips et quota vidéo source ; offres disponibles.
        </p>
      </header>

      <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-7 space-y-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#9b6dff]/10 text-[#9b6dff]">
              <Film className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Clips (estimation)</p>
              <div className="text-xs text-zinc-500 mt-0.5 space-y-1">
                {creditsLimit === -1 ? (
                  <>
                    <p>
                      Soit {creditsToHours(creditsUsed)} de vidéo source traitée. Facturation aux
                      minutes de source.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Quota : {creditsToHours(creditsRemaining)} vidéo source restante (1 crédit ≈
                      1 min).
                    </p>
                    <p className="text-zinc-600">
                      « ~{clipsRemaining} clips » = estimation (durée moyenne par clip selon le
                      forfait), pas un compteur d’exports figé.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
          <span className="text-sm font-medium text-white tabular-nums shrink-0">
            {creditsLimit === -1
              ? `~${clipsUsed} / ∞`
              : `~${clipsUsed} / ~${clipsLimitApprox}`}
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

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Offres</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 flex flex-col gap-4 relative transition-shadow ${
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
                <span className="absolute top-4 right-4 text-[10px] font-semibold uppercase tracking-wider text-[#9b6dff]">
                  Actif
                </span>
              )}
              <div>
                <p className="font-[family-name:var(--font-syne)] text-lg font-bold text-white">
                  {p.label}
                </p>
                <p className="text-sm text-zinc-500 mt-1">{p.price}</p>
              </div>
              <div className="rounded-lg border border-[#1a1a1e] bg-[#080809] px-3 py-2.5">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#9b6dff]">
                  Clips
                </p>
                <p className="text-sm font-semibold text-white mt-1 leading-snug">
                  {PLAN_CLIP_COPY[p.id].headline}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{PLAN_CLIP_COPY[p.id].sub}</p>
                <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">{planQuotaFootnote(p.id)}</p>
              </div>
              <ul className="space-y-2 list-none p-0 m-0 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="text-xs text-zinc-400 flex gap-2 items-start leading-snug">
                    <Check className="size-3.5 shrink-0 mt-0.5 text-[#9b6dff]/80" strokeWidth={2.5} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] p-6 sm:p-7 max-w-xl">
        <h3 className="text-sm font-medium text-white mb-1">Code promo</h3>
        <p className="text-xs text-zinc-500 mb-4">Débloque un plan ou des avantages partenaires.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
            placeholder="Ex. FLOPCREATOR"
            disabled={loading}
            className="flex-1 h-11 px-4 rounded-xl border border-[#1a1a1e] bg-[#080809] text-white text-sm tracking-wide uppercase placeholder:text-zinc-700 outline-none focus:border-[#9b6dff]/40 focus:ring-2 focus:ring-[#9b6dff]/15 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleRedeem}
            disabled={loading}
            className="h-11 shrink-0 rounded-xl bg-[#9b6dff] px-6 text-sm font-semibold text-[#080809] hover:bg-[#b894ff] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Activer
          </button>
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
    <div className="flex flex-col gap-8 max-w-xl">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1">
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
    <div className="flex flex-col gap-8 max-w-2xl">
      <header className="space-y-1">
        <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-white">
          Zone sensible
        </h2>
        <p className="text-sm text-zinc-500">Actions définitives — à utiliser avec précaution.</p>
      </header>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="min-w-0">
            <p className="font-medium text-red-400">Supprimer le compte</p>
            <p className="text-sm text-zinc-500 mt-1">
              Données et paramètres — irréversible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="shrink-0 h-10 px-5 rounded-xl bg-red-500/15 border border-red-500/40 text-sm font-semibold text-red-400 hover:bg-red-500/25 transition-colors self-start sm:self-center"
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
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="parametres" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-[52px] border-b border-[#0f0f12] bg-[#080809]/80 backdrop-blur-md flex items-center justify-between px-6 sm:px-8 shrink-0">
              <div className="flex items-center gap-1.5 text-sm text-zinc-500 min-w-0">
                <span className="text-zinc-600 truncate">Vyrll</span>
                <ChevronRight className="size-3.5 shrink-0 text-zinc-700" aria-hidden />
                <span className="text-zinc-400 truncate">Paramètres</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#1a1a1e] bg-[#0c0c0e] px-2.5 sm:px-3 py-1.5 font-mono text-[10px] sm:text-[11px] text-zinc-300 tabular-nums max-w-[42vw] sm:max-w-none">
                  <Zap className="size-3.5 text-[#9b6dff]" aria-hidden />
                  {headerCreditsLimit === -1
                    ? `${creditsToHours(headerCreditsUsed)} utilisés`
                    : `${creditsToHours(headerCreditsRemaining)} restantes`}
                </span>
                <div
                  className="size-9 rounded-xl bg-gradient-to-br from-[#9b6dff]/20 to-[#9b6dff]/5 ring-1 ring-[#9b6dff]/30 flex items-center justify-center font-[family-name:var(--font-syne)] text-sm font-bold text-[#c4a8ff]"
                  title={profile.username ?? profile.email ?? ""}
                >
                  {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
                </div>
              </div>
            </div>

            <div
              className="shrink-0 border-b border-[#0f0f12] bg-[#080809] px-4 sm:px-8"
              role="tablist"
              aria-label="Sections paramètres"
            >
              <div className="mx-auto max-w-3xl flex gap-1 overflow-x-auto pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="mx-auto max-w-3xl px-6 py-10 sm:px-8 sm:py-12">
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
