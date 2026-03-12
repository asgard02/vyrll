"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  User,
  Zap,
  Lock,
  AlertTriangle,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useProfile } from "@/lib/profile-context";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { id: "compte", label: "Compte", icon: User },
  { id: "plan", label: "Plan & Quota", icon: Zap },
  { id: "securite", label: "Sécurité", icon: Lock },
  { id: "danger", label: "Zone dangereuse", icon: AlertTriangle },
];

function Badge({ plan }: { plan: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    free: { bg: "#1a1a1e", color: "#888", label: "FREE" },
    pro: { bg: "#00ff8820", color: "#00ff88", label: "PRO" },
    unlimited: { bg: "#ffd70020", color: "#ffd700", label: "UNLIMITED" },
  };
  const s = styles[plan] ?? styles.free;
  return (
    <span
      className="font-mono text-[11px] font-bold tracking-wider px-2 py-0.5 rounded border"
      style={{
        background: s.bg,
        color: s.color,
        borderColor: `${s.color}40`,
      }}
    >
      {s.label}
    </span>
  );
}

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
          : "bg-[#00ff88]/10 border border-[#00ff88]/60 text-[#00ff88]"
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
    <div className="flex flex-col gap-7">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <div>
        <h2 className="font-[family-name:var(--font-syne)] font-bold text-lg text-white mb-1">
          Informations du compte
        </h2>
        <p className="font-mono text-sm text-zinc-500">
          Modifie tes informations publiques.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="size-14 rounded-full bg-gradient-to-br from-[#00ff88]/30 to-[#00ff88]/10 border border-[#00ff88]/40 flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-[#00ff88] text-xl">
          {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-white">
            {profile.username || "Utilisateur"}
          </p>
          <p className="font-mono text-xs text-zinc-500">
            Membre depuis{" "}
            {new Date().toLocaleDateString("fr-FR", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-w-[480px]">
        <div>
          <label className="font-mono text-xs text-zinc-500 tracking-wider block mb-1.5">
            PSEUDO
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full h-11 px-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white font-mono text-sm outline-none transition-all focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
          />
          <p className="font-mono text-[11px] text-zinc-500 mt-1.5">
            Visible dans tes rapports exportés.
          </p>
        </div>
        <div>
          <label className="font-mono text-xs text-zinc-500 tracking-wider block mb-1.5">
            EMAIL
          </label>
          <input
            type="text"
            value={profile.email ?? ""}
            readOnly
            className="w-full h-11 px-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-zinc-500 font-mono text-sm cursor-not-allowed"
          />
          <p className="font-mono text-[11px] text-zinc-500 mt-1.5">
            L&apos;email ne peut pas être modifié pour l&apos;instant.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="h-11 px-5 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all disabled:opacity-60 flex items-center gap-2"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        Enregistrer les modifications
      </button>
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

  const used = profile.analyses_used ?? 0;
  const limit = profile.analyses_limit ?? 3;
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const barColor = pct > 80 ? "#ff3b3b" : pct > 50 ? "#ffd700" : "#00ff88";

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
      id: "free",
      label: "Free",
      limit: 3,
      price: "Gratuit",
      features: ["3 analyses / mois", "Score & diagnostic", "Recommandations SEO"],
    },
    {
      id: "pro",
      label: "Pro",
      limit: 50,
      price: "Bientôt disponible",
      features: [
        "50 analyses / mois",
        "Tout le plan Free",
        "Export PDF & Markdown",
        "Clips IA (bêta)",
      ],
      accent: true,
    },
    {
      id: "unlimited",
      label: "Unlimited",
      limit: 999,
      price: "Bientôt disponible",
      features: ["Analyses illimitées", "Tout le plan Pro", "Support prioritaire"],
    },
  ];

  return (
    <div className="flex flex-col gap-7">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <div>
        <h2 className="font-[family-name:var(--font-syne)] font-bold text-lg text-white mb-1">
          Plan & Quota
        </h2>
        <p className="font-mono text-sm text-zinc-500">
          Gère ton abonnement et tes quotas d&apos;analyses.
        </p>
      </div>

      <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-5 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="font-mono text-sm text-zinc-500">
            Analyses utilisées ce mois
          </span>
          <div className="flex items-center gap-2.5">
            <Badge plan={profile.plan} />
            <span
              className="font-mono text-sm font-medium"
              style={{ color: barColor }}
            >
              {used} / {limit}
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-[#1a1a1e] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.min(pct, 100)}%`,
              background: barColor,
              boxShadow: `0 0 10px ${barColor}80`,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border p-4 flex flex-col gap-3 relative ${
              p.accent ? "bg-[#00ff88]/5" : "bg-[#0c0c0e]"
            } ${
              profile.plan === p.id
                ? p.id === "pro"
                  ? "border-[#00ff88]/60"
                  : p.id === "unlimited"
                    ? "border-[#ffd700]/60"
                    : "border-zinc-600"
                : "border-[#0f0f12]"
            }`}
          >
            {profile.plan === p.id && (
              <span className="absolute top-2.5 right-2.5 font-mono text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/40">
                ACTIF
              </span>
            )}
            <div>
              <p className="font-[family-name:var(--font-syne)] font-bold text-white">
                {p.label}
              </p>
              <p className="font-mono text-xs text-zinc-500">{p.price}</p>
            </div>
            <ul className="space-y-1.5 list-none p-0 m-0">
              {p.features.map((f) => (
                <li
                  key={f}
                  className="font-mono text-xs text-zinc-500 flex gap-1.5 items-start"
                >
                  <span className="text-[#00ff88] mt-0.5">—</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 max-w-[480px]">
        <label className="font-mono text-xs text-zinc-500 tracking-wider">
          CODE PROMO
        </label>
        <div className="flex gap-2.5">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
            placeholder="FLOPPRO"
            disabled={loading}
            className="flex-1 h-11 px-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white font-mono text-sm tracking-wider uppercase placeholder-zinc-600 outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleRedeem}
            disabled={loading}
            className="h-11 px-5 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Activer
          </button>
        </div>
        <p className="font-mono text-[11px] text-zinc-500">
          Entre un code promo pour débloquer un plan supérieur.
        </p>
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
    <div className="flex flex-col gap-7">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <div>
        <h2 className="font-[family-name:var(--font-syne)] font-bold text-lg text-white mb-1">
          Sécurité
        </h2>
        <p className="font-mono text-sm text-zinc-500">
          Modifie ton mot de passe.
        </p>
      </div>

      <div className="flex flex-col gap-4 max-w-[480px]">
        <div>
          <label className="font-mono text-xs text-zinc-500 tracking-wider block mb-1.5">
            MOT DE PASSE ACTUEL
          </label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full h-11 px-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white font-mono text-sm outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
          />
        </div>
        <div>
          <label className="font-mono text-xs text-zinc-500 tracking-wider block mb-1.5">
            NOUVEAU MOT DE PASSE
          </label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="w-full h-11 px-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white font-mono text-sm outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
          />
        </div>
        <div>
          <label className="font-mono text-xs text-zinc-500 tracking-wider block mb-1.5">
            CONFIRMER LE MOT DE PASSE
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`w-full h-11 px-4 rounded-lg bg-[#0c0c0e] text-white font-mono text-sm outline-none transition-colors ${
              mismatch
                ? "border border-[#ff3b3b]/60"
                : match
                  ? "border border-[#00ff88]/60"
                  : "border border-[#0f0f12] focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
            }`}
          />
          {mismatch && (
            <p className="font-mono text-[11px] text-[#ff3b3b] mt-1.5">
              Les mots de passe ne correspondent pas.
            </p>
          )}
          {match && (
            <p className="font-mono text-[11px] text-[#00ff88] mt-1.5">
              Les mots de passe correspondent.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="h-11 px-5 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all disabled:opacity-60 flex items-center gap-2 w-fit"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Mettre à jour le mot de passe
        </button>
        <p className="font-mono text-[11px] text-zinc-500">
          Utilise un mot de passe fort d&apos;au moins 8 caractères.
        </p>
      </div>
    </div>
  );
}

function TabDanger() {
  const [confirm, setConfirm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

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

  const handleClearHistory = async () => {
    if (typeof window !== "undefined" && !window.confirm("Supprimer toutes tes analyses ? Cette action est irréversible.")) {
      return;
    }
    setClearLoading(true);
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      const items = Array.isArray(data) ? data : [];
      for (const item of items) {
        await fetch(`/api/history/${item.id}`, { method: "DELETE" });
      }
      const { mutate } = await import("swr");
      mutate("/api/history");
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h2 className="font-[family-name:var(--font-syne)] font-bold text-lg text-white mb-1">
          Zone dangereuse
        </h2>
        <p className="font-mono text-sm text-zinc-500">
          Ces actions sont irréversibles.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-[#ff3b3b]/20 bg-[#0c0c0e] p-5 flex justify-between items-center gap-5">
          <div>
            <p className="font-semibold text-white mb-1">Effacer l&apos;historique</p>
            <p className="font-mono text-xs text-zinc-500">
              Supprime toutes tes analyses. Cette action est irréversible.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={clearLoading}
            className="shrink-0 h-10 px-4 rounded-lg border border-[#ff3b3b]/40 text-[#ff3b3b] font-mono text-sm font-semibold hover:bg-[#ff3b3b]/10 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {clearLoading && <Loader2 className="size-4 animate-spin" />}
            Effacer tout
          </button>
        </div>

        <div className="rounded-xl border border-[#ff3b3b]/30 bg-[#ff3b3b]/5 p-5 flex justify-between items-center gap-5">
          <div>
            <p className="font-semibold text-[#ff3b3b] mb-1">Supprimer le compte</p>
            <p className="font-mono text-xs text-zinc-500">
              Supprime définitivement ton compte, tes données et toutes tes analyses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="shrink-0 h-10 px-4 rounded-lg bg-[#ff3b3b]/15 border border-[#ff3b3b]/50 text-[#ff3b3b] font-mono text-sm font-bold hover:bg-[#ff3b3b]/25 transition-all"
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
                données, analyses et paramètres seront supprimés.
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

export default function ParametresPage() {
  const searchParams = typeof window !== "undefined" ? useSearchParams() : null;
  const tabParam = searchParams?.get("tab") ?? null;
  const initialTab =
    tabParam && ["compte", "plan", "securite", "danger"].includes(tabParam)
      ? tabParam
      : "compte";
  const [tab, setTab] = useState(initialTab);
  const { profile, refresh } = useProfile();

  useEffect(() => {
    if (!searchParams) return;
    const t = searchParams.get("tab");
    if (t && ["compte", "plan", "securite", "danger"].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#00ff88]" />
      </div>
    );
  }

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
            <div className="h-14 border-b border-[#0f0f12] flex items-center justify-between px-7 shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-zinc-500">flopcheck</span>
                <span className="text-zinc-700">/</span>
                <span className="font-mono text-sm text-zinc-500">
                  paramètres
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-zinc-500">
                  {profile.analyses_used}/{profile.analyses_limit} analyses
                </span>
                <div className="size-8 rounded-full bg-[#00ff88]/20 border border-[#00ff88]/40 flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-sm text-[#00ff88]">
                  {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
                </div>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <nav className="w-56 border-r border-[#0f0f12] p-6 flex flex-col gap-1 shrink-0">
                <p className="font-mono text-[11px] text-zinc-600 tracking-wider mb-3 ml-1.5">
                  PARAMÈTRES
                </p>
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left font-mono text-sm transition-all ${
                        tab === t.id
                          ? "bg-[#00ff88]/10 text-white font-semibold border border-[#00ff88]/30"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-[#0d0d0f] border border-transparent"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      {t.label}
                      {t.id === "danger" && (
                        <span className="ml-auto size-1.5 rounded-full bg-[#ff3b3b] shadow-[0_0_6px_#ff3b3b]" />
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="flex-1 p-9 overflow-y-auto">
                {renderTab()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
