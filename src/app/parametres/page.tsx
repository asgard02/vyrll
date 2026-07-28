"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  User,
  Zap,
  Lock,
  AlertTriangle,
  Loader2,
  Check,
  X,
  ChevronRight,
  Globe,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { LocaleSelector } from "@/components/i18n/LocaleSelector";
import { useProfile } from "@/lib/profile-context";
import { createClient } from "@/lib/supabase/client";
import { creditsToHours, formatLocaleDate } from "@/lib/utils";
import { PLAN_CREDITS, formatSourceMinutes } from "@/lib/plan";

type TabId = "compte" | "plan" | "securite" | "danger" | "langue";
type PlanId = "free" | "creator" | "studio";

const PLAN_RANK: Record<PlanId, number> = { free: 0, creator: 1, studio: 2 };

const UPGRADE_PLANS = [
  {
    id: "free" as const,
    price: "0",
    periodKey: null as "month" | null,
    accent: false,
    badgeKey: null as "popular" | null,
  },
  {
    id: "creator" as const,
    price: "17",
    periodKey: "month" as const,
    accent: true,
    badgeKey: "popular" as const,
  },
  {
    id: "studio" as const,
    price: "39",
    periodKey: "month" as const,
    accent: false,
    badgeKey: null as "popular" | null,
  },
];

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
          ? "bg-destructive/10 border border-[#ff3b3b]/60 text-destructive"
          : "bg-primary/10 border border-primary/60 text-primary"
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
  const locale = useLocale();
  const t = useTranslations("settings.account");
  const tCommon = useTranslations("common");
  const [username, setUsername] = useState(profile.username ?? "");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const handleSave = async () => {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) {
      setToast({ message: t("usernameMin"), type: "error" });
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
        setToast({ message: data.error ?? tCommon("error"), type: "error" });
      } else {
        onRefresh();
        setToast({ message: t("usernameUpdated"), type: "success" });
      }
    } catch {
      setToast({ message: tCommon("networkError"), type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const memberSince = formatLocaleDate(new Date(), locale, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1 text-center">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="rounded-2xl border border-input bg-card p-6 sm:p-8 ">
        <div className="flex items-center gap-5 pb-8 border-b border-input">
          <div className="size-16 shrink-0 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/30 flex items-center justify-center font-display text-2xl font-bold text-primary">
            {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-foreground truncate">
              {profile.username || tCommon("user")}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("memberSince", { date: memberSince })}
            </p>
          </div>
        </div>

        <div className="pt-8 space-y-6">
          <div className="space-y-2">
            <label htmlFor="pseudo" className="text-sm font-medium text-muted-foreground">
              {t("pseudo")}
            </label>
            <input
              id="pseudo"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-input bg-background text-foreground text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
            <p className="text-xs text-muted-foreground/70">{t("pseudoHint")}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-muted-foreground">
              {tCommon("email")}
            </label>
            <input
              id="email"
              type="text"
              value={profile.email ?? ""}
              readOnly
              className="w-full h-11 px-4 rounded-xl border border-input bg-background/60 text-muted-foreground text-sm cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground/70">{t("emailHint")}</p>
          </div>
        </div>

        <div className="pt-8 mt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="h-11 w-full sm:w-auto min-w-[200px] rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {tCommon("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsUpgradeCard({
  plan,
  currentPlan,
  onManageBilling,
  portalLoading,
}: {
  plan: (typeof UPGRADE_PLANS)[number];
  currentPlan: string;
  onManageBilling: () => void;
  portalLoading: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("settings.plan");
  const tPlans = useTranslations("plans");
  const tBadge = useTranslations("plans.badge");
  const isCurrent = currentPlan === plan.id;
  const currentRank = PLAN_RANK[(currentPlan as PlanId) in PLAN_RANK ? (currentPlan as PlanId) : "free"];
  const targetRank = PLAN_RANK[plan.id];
  const isUpgrade = targetRank > currentRank;
  const isDowngrade = targetRank < currentRank;
  const features = tPlans.raw(`cards.${plan.id}.features`) as string[];
  const credits =
    plan.id === "free"
      ? PLAN_CREDITS.freeLifetime
      : plan.id === "creator"
        ? PLAN_CREDITS.creatorMonthly
        : PLAN_CREDITS.studioMonthly;
  const duration = formatSourceMinutes(credits, locale);

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border transition-shadow ${
        plan.accent
          ? "border-primary/30 bg-white shadow-[0_0_0_1px_rgba(124,58,237,0.15),0_8px_32px_rgba(124,58,237,0.12)]"
          : "border-border bg-white shadow-sm"
      } ${isCurrent ? "ring-1 ring-primary/30" : ""}`}
    >
      {plan.accent && (
        <div
          className="h-1 w-full"
          style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }}
        />
      )}

      {(plan.badgeKey || isCurrent) && (
        <div className="absolute right-4 top-4 flex gap-2">
          {plan.badgeKey && !isCurrent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
              <Sparkles className="size-2.5" />
              {tBadge(plan.badgeKey)}
            </span>
          )}
          {isCurrent && (
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              {tBadge("yourPlan")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-bold text-foreground mb-1">
            {tPlans(`names.${plan.id}`)}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tPlans(`cards.${plan.id}.tagline`)}
          </p>
        </div>

        <div className="mb-5 pb-5 border-b border-border">
          <div className="flex items-baseline gap-1">
            <span
              className={`font-display text-4xl font-extrabold tabular-nums ${
                plan.accent ? "text-primary" : "text-foreground"
              }`}
            >
              {plan.price}
            </span>
            <span className="text-sm text-muted-foreground">
              {plan.periodKey ? t("pricePerMonth") : "€"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {tPlans(`cards.${plan.id}.clips`)}
            </span>
            <span className="text-[11px] text-muted-foreground/60">·</span>
            <span className="text-[11px] text-muted-foreground">
              {tPlans(`cards.${plan.id}.quota`)}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            {tPlans(`quotaFootnote.${plan.id}`, {
              credits,
              duration,
            })}
          </p>
        </div>

        <ul className="mb-6 flex-1 space-y-2.5">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  plan.accent ? "bg-primary/15" : "bg-muted"
                }`}
              >
                <Check
                  className={`size-2.5 ${plan.accent ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={3}
                />
              </div>
              <span className="text-sm text-foreground leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        {isCurrent ? (
          <div className="flex w-full items-center justify-center rounded-xl border border-primary/20 bg-primary/5 py-3 text-sm font-semibold text-primary">
            {t("currentPlanCta")}
          </div>
        ) : isUpgrade ? (
          <Link
            href={`/checkout/${plan.id}`}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all ${
              plan.accent
                ? "bg-primary text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] hover:bg-primary/90"
                : "bg-muted text-foreground border border-border hover:border-primary/20"
            }`}
          >
            {tPlans(`cards.${plan.id}.cta`)}
            <ArrowRight className="size-4" />
          </Link>
        ) : isDowngrade ? (
          <button
            type="button"
            onClick={onManageBilling}
            disabled={portalLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {portalLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("manageToChange")}
          </button>
        ) : null}
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
  const searchParams = useSearchParams();
  const t = useTranslations("settings.plan");
  const [portalLoading, setPortalLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (searchParams.get("checkout") !== "success") return;
    setToast({ message: t("checkoutSuccess"), type: "success" });
    onRefresh();
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [searchParams, t, onRefresh]);

  const openBillingPortal = async () => {
    setPortalLoading(true);
    setToast(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        setToast({
          message:
            typeof data?.error === "string" ? data.error : t("manageBillingError"),
          type: "error",
        });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setToast({ message: t("manageBillingError"), type: "error" });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setPortalLoading(false);
    }
  };

  const isPaid = profile.plan === "creator" || profile.plan === "studio";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <header className="space-y-1">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>
        {isPaid && (
          <button
            type="button"
            onClick={openBillingPortal}
            disabled={portalLoading}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {portalLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("manageBilling")}
          </button>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {UPGRADE_PLANS.map((plan) => (
          <SettingsUpgradeCard
            key={plan.id}
            plan={plan}
            currentPlan={profile.plan ?? "free"}
            onManageBilling={openBillingPortal}
            portalLoading={portalLoading}
          />
        ))}
      </div>
    </div>
  );
}

function TabSecurite() {
  const t = useTranslations("settings.security");
  const tCommon = useTranslations("common");
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
      setToast({ message: t("passwordMismatch"), type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (newPwd.length < 8) {
      setToast({ message: t("passwordMin"), type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) {
        setToast({ message: error.message ?? tCommon("error"), type: "error" });
      } else {
        setCurrent("");
        setNewPwd("");
        setConfirm("");
        setToast({ message: t("passwordUpdated"), type: "success" });
      }
    } catch {
      setToast({ message: tCommon("networkError"), type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1 text-center">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="rounded-2xl border border-input bg-card p-6 sm:p-8 space-y-6 ">
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">{tCommon("password")}</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="w-full h-11 px-4 rounded-xl border border-input bg-background text-foreground text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">{t("newPassword")}</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            className="w-full h-11 px-4 rounded-xl border border-input bg-background text-foreground text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">{t("confirmPassword")}</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={`w-full h-11 px-4 rounded-xl bg-background text-foreground text-sm outline-none transition-colors ${
              mismatch
                ? "border border-red-500/50 ring-2 ring-red-500/10"
                : match
                  ? "border border-primary/40 ring-2 ring-[#9b6dff]/10"
                  : "border border-input focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            }`}
          />
          {mismatch && (
            <p className="text-xs text-red-400">{t("passwordMismatch")}</p>
          )}
        </div>

        <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="h-11 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 w-fit"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t("changePassword")}
          </button>
          <p className="text-xs text-muted-foreground/70">{t("passwordMin")}</p>
        </div>
      </div>
    </div>
  );
}

function TabDanger() {
  const t = useTranslations("settings.danger");
  const tCommon = useTranslations("common");
  const [confirm, setConfirm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDeleteAccount = async () => {
    if (confirm.toLowerCase() !== "supprimer mon compte") return;
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
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
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="min-w-0">
            <p className="font-medium text-red-400">{t("deleteTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("deleteDescription")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="h-10 shrink-0 self-center rounded-xl border border-red-500/40 bg-red-500/15 px-5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/25 sm:self-center"
          >
            {tCommon("delete")}
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-[999]">
          <div className="rounded-2xl border border-[#ff3b3b]/40 bg-card p-8 max-w-[440px] w-[90%] flex flex-col gap-5">
            <div>
              <p className="font-display font-bold text-destructive text-lg mb-1.5">
                {t("deleteDialogTitle")}
              </p>
              <p className="font-mono text-sm text-muted-foreground">
                {t("deleteDialogDescription")}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs text-muted-foreground">
                {t("deleteConfirm")}
              </label>
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="supprimer mon compte"
                className="h-11 px-4 rounded-lg border border-[#ff3b3b]/40 bg-background text-foreground font-mono text-sm outline-none placeholder-muted-foreground"
              />
            </div>
            <div className="flex gap-2.5 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setConfirm("");
                }}
                className="h-10 px-4 rounded-lg border border-input text-muted-foreground font-mono text-sm hover:bg-muted transition-colors"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={confirm.toLowerCase() !== "supprimer mon compte" || loading}
                className="h-10 px-4 rounded-lg bg-destructive text-foreground font-mono text-sm font-bold hover:bg-destructive/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {t("deleteButton")}
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
  const locale = useLocale();
  const tTabs = useTranslations("settings.tabs");
  const tCommon = useTranslations("common");
  const tSidebar = useTranslations("layout.sidebar");
  const tHeader = useTranslations("layout.header");
  const tabParam = searchParams.get("tab");
  const validTabs: TabId[] = ["compte", "plan", "securite", "danger", "langue"];
  const initialTab =
    tabParam && validTabs.includes(tabParam as TabId)
      ? (tabParam as TabId)
      : "compte";
  const [tab, setTab] = useState<TabId>(initialTab);
  const { profile, refresh } = useProfile();

  const tabs = [
    { id: "compte" as const, label: tTabs("account"), icon: User },
    { id: "plan" as const, label: tTabs("plan"), icon: Zap },
    { id: "securite" as const, label: tTabs("security"), icon: Lock },
    { id: "langue" as const, label: tTabs("language"), icon: Globe },
    { id: "danger" as const, label: tTabs("danger"), icon: AlertTriangle },
  ];

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && validTabs.includes(t as TabId)) {
      setTab(t as TabId);
    }
  }, [searchParams]);

  const goTab = (id: TabId) => {
    setTab(id);
    router.replace(`/parametres?tab=${id}`, { scroll: false });
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
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
      case "langue":
        return <LocaleSelector />;
      case "danger":
        return <TabDanger />;
      default:
        return null;
    }
  };

  return (
    <AppShell activeItem="parametres">
        <main className="flex w-full flex-1 flex-col">
          <div className="flex w-full flex-col">
            <div className="shrink-0 border-b border-border bg-background/80 px-6 backdrop-blur-md sm:px-8">
              <div className="mx-auto flex h-[52px] w-full max-w-7xl items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="truncate text-muted-foreground/70">{tCommon("brand")}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-muted-foreground">{tSidebar("settings")}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="inline-flex max-w-[42vw] items-center gap-2 rounded-full border border-input bg-card px-2.5 py-1.5 font-mono text-[10px] text-foreground tabular-nums sm:max-w-none sm:px-3 sm:text-[11px]">
                    <Zap className="size-3.5 text-primary" aria-hidden />
                    {headerCreditsLimit === -1
                      ? tHeader("creditsUsed", { count: headerCreditsUsed })
                      : tHeader("quotaRemaining", {
                          hours: creditsToHours(headerCreditsRemaining, locale),
                        })}
                  </span>
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#9b6dff]/20 to-primary/5 font-display text-sm font-bold text-primary ring-1 ring-primary/30"
                    title={profile.username ?? profile.email ?? ""}
                  >
                    {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="shrink-0 border-b border-border bg-background px-6 sm:px-8"
              role="tablist"
              aria-label={tSidebar("settings")}
            >
              <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {tabs.map((t) => {
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
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className={`size-4 ${active ? "text-primary" : "opacity-70"}`} strokeWidth={active ? 2.25 : 2} />
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
    </AppShell>
  );
}

export default function ParametresPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      }
    >
      <ParametresContent />
    </Suspense>
  );
}
