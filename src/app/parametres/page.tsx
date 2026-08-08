"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  User,
  Zap,
  Lock,
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useProfile } from "@/lib/profile-context";
import { createClient } from "@/lib/supabase/client";
import { creditsToHours, formatLocaleDate } from "@/lib/utils";
import { PLAN_CREDITS, formatSourceMinutes } from "@/lib/plan";

type BillingSubscription = {
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
};

type TabId = "compte" | "plan" | "mot-de-passe" | "langue";
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
          ? "border-primary bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_12px_32px_-14px_rgba(109,40,217,0.28)]"
          : "border-border bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)]"
      } ${isCurrent ? "ring-1 ring-primary/25" : ""}`}
    >
      {plan.accent && (
        <div className="h-1 w-full bg-primary" />
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
                ? "bg-primary text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-primary/90"
                : "border border-border bg-muted text-foreground hover:border-border"
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
  const locale = useLocale();
  const t = useTranslations("settings.plan");
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const isPaid = profile.plan === "creator" || profile.plan === "studio";

  const loadSubscription = async () => {
    if (!isPaid) {
      setSubscription(null);
      return;
    }
    setSubscriptionLoading(true);
    try {
      const res = await fetch("/api/stripe/subscription", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.subscription) {
        setSubscription(data.subscription as BillingSubscription);
      } else {
        setSubscription(null);
      }
    } catch {
      setSubscription(null);
    } finally {
      setSubscriptionLoading(false);
    }
  };

  useEffect(() => {
    void loadSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when plan changes
  }, [isPaid, profile.plan]);

  useEffect(() => {
    if (searchParams.get("checkout") !== "success") return;
    setToast({ message: t("checkoutSuccess"), type: "success" });
    onRefresh();
    void loadSubscription();
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, t, onRefresh]);

  const formatPeriodEnd = (unix: number | null) => {
    if (!unix) return "—";
    return formatLocaleDate(new Date(unix * 1000), locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

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

  const confirmCancel = async () => {
    setCancelLoading(true);
    setToast(null);
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.subscription) {
        setToast({
          message: typeof data?.error === "string" ? data.error : t("cancelError"),
          type: "error",
        });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      const next = data.subscription as BillingSubscription;
      setSubscription(next);
      setCancelDialogOpen(false);
      setToast({
        message: t("cancelSuccess", {
          date: formatPeriodEnd(next.currentPeriodEnd),
        }),
        type: "success",
      });
      setTimeout(() => setToast(null), 5000);
    } catch {
      setToast({ message: t("cancelError"), type: "error" });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setCancelLoading(false);
    }
  };

  const resumeSubscription = async () => {
    setResumeLoading(true);
    setToast(null);
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.subscription) {
        setToast({
          message: typeof data?.error === "string" ? data.error : t("resumeError"),
          type: "error",
        });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      setSubscription(data.subscription as BillingSubscription);
      setToast({ message: t("resumeSuccess"), type: "success" });
      setTimeout(() => setToast(null), 4000);
    } catch {
      setToast({ message: t("resumeError"), type: "error" });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setResumeLoading(false);
    }
  };

  const cancelScheduled = Boolean(subscription?.cancelAtPeriodEnd);

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={portalLoading || cancelLoading || resumeLoading}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {portalLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("manageBilling")}
            </button>
            {subscriptionLoading ? (
              <span className="inline-flex h-10 items-center px-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </span>
            ) : cancelScheduled ? (
              <button
                type="button"
                onClick={() => void resumeSubscription()}
                disabled={resumeLoading || portalLoading}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {resumeLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("resumeSubscription")}
              </button>
            ) : subscription ? (
              <button
                type="button"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelLoading || portalLoading}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-background px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
              >
                {t("cancelSubscription")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {isPaid && cancelScheduled && subscription?.currentPeriodEnd ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {t("cancelScheduled", {
            date: formatPeriodEnd(subscription.currentPeriodEnd),
          })}
        </p>
      ) : null}

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

      <ConfirmDialog
        open={cancelDialogOpen}
        title={t("cancelDialogTitle")}
        description={t("cancelDialogDescription")}
        confirmLabel={t("cancelDialogConfirm")}
        cancelLabel={t("cancelDialogCancel")}
        onConfirm={confirmCancel}
        onCancel={() => {
          if (!cancelLoading) setCancelDialogOpen(false);
        }}
        loading={cancelLoading}
        variant="danger"
      />
    </div>
  );
}

function TabMotDePasse() {
  const t = useTranslations("settings.password");
  const tCommon = useTranslations("common");
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasEmailIdentity, setHasEmailIdentity] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const match = Boolean(newPwd && confirm && newPwd === confirm);
  const mismatch = Boolean(newPwd && confirm && newPwd !== confirm);
  const confirmPhrase = t("deleteConfirmPhrase");
  const deleteReady =
    deleteConfirm.trim().toLowerCase() === confirmPhrase.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        const identities = data.user?.identities ?? [];
        setHasEmailIdentity(
          identities.length === 0 ||
            identities.some((i) => i.provider === "email")
        );
      } catch {
        if (!cancelled) setHasEmailIdentity(true);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (!newPwd || !confirm) return;
    if (hasEmailIdentity && !current) return;
    if (newPwd !== confirm) {
      setToast({ message: t("passwordMismatch"), type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (newPwd.length < 6) {
      setToast({ message: t("passwordMin"), type: "error" });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: newPwd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({
          message:
            typeof data?.error === "string"
              ? data.error
              : t("currentPasswordWrong"),
          type: "error",
        });
      } else {
        setCurrent("");
        setNewPwd("");
        setConfirm("");
        setHasEmailIdentity(true);
        setToast({ message: t("passwordUpdated"), type: "success" });
      }
    } catch {
      setToast({ message: tCommon("networkError"), type: "error" });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteReady) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(
          typeof data?.error === "string" ? data.error : t("deleteError")
        );
        return;
      }
      window.location.href = "/";
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const canSubmitPassword =
    Boolean(newPwd) &&
    Boolean(confirm) &&
    match &&
    newPwd.length >= 6 &&
    (!hasEmailIdentity || Boolean(current));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-10">
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <header className="space-y-1 text-center">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="rounded-2xl border border-input bg-card p-6 sm:p-8 space-y-6">
        {!authReady ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {!hasEmailIdentity ? (
              <p className="text-sm text-muted-foreground">{t("oauthOnlyHint")}</p>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  {t("currentPassword")}
                </label>
                <PasswordInput
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  showLabel={tCommon("showPassword")}
                  hideLabel={tCommon("hidePassword")}
                  className="w-full h-11 px-4 rounded-xl border border-input bg-background text-foreground text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {t("newPassword")}
              </label>
              <PasswordInput
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                autoComplete="new-password"
                showLabel={tCommon("showPassword")}
                hideLabel={tCommon("hidePassword")}
                className="w-full h-11 px-4 rounded-xl border border-input bg-background text-foreground text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {t("confirmPassword")}
              </label>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                showLabel={tCommon("showPassword")}
                hideLabel={tCommon("hidePassword")}
                className={`w-full h-11 px-4 rounded-xl bg-background text-foreground text-sm outline-none transition-colors ${
                  mismatch
                    ? "border border-red-500/50 ring-2 ring-red-500/10"
                    : match
                      ? "border border-primary/40 ring-2 ring-primary/10"
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
                onClick={() => void handleSave()}
                disabled={loading || !canSubmitPassword}
                className="h-11 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 w-fit"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {hasEmailIdentity ? t("changePassword") : t("setPassword")}
              </button>
              <p className="text-xs text-muted-foreground/70">{t("passwordMin")}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-5 rounded-2xl border border-red-500/25 bg-red-500/4 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="min-w-0">
          <p className="font-medium text-red-400">{t("deleteTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("deleteDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDeleteError(null);
            setShowDeleteModal(true);
          }}
          className="h-10 shrink-0 self-center rounded-xl border border-red-500/40 bg-red-500/15 px-5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/25"
        >
          {tCommon("delete")}
        </button>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-999 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="flex w-[90%] max-w-110 flex-col gap-5 rounded-2xl border border-destructive/40 bg-card p-8">
            <div>
              <p className="mb-1.5 font-display text-lg font-bold text-destructive">
                {t("deleteDialogTitle")}
              </p>
              <p className="font-mono text-sm text-muted-foreground">
                {t("deleteDialogDescription", { phrase: confirmPhrase })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs text-muted-foreground">
                {t("deleteConfirmLabel")}
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-11 rounded-lg border border-destructive/40 bg-background px-4 font-mono text-sm text-foreground outline-none"
              />
            </div>
            {deleteError ? (
              <p className="font-mono text-xs text-destructive">{deleteError}</p>
            ) : null}
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (deleteLoading) return;
                  setShowDeleteModal(false);
                  setDeleteConfirm("");
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="h-10 rounded-lg border border-input px-4 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={!deleteReady || deleteLoading}
                className="flex h-10 items-center gap-2 rounded-lg bg-destructive px-4 font-mono text-sm font-bold text-white transition-all hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteLoading && <Loader2 className="size-4 animate-spin" />}
                {deleteLoading ? t("deleting") : t("deleteButton")}
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
  const normalizeTab = (raw: string | null): TabId | null => {
    if (!raw) return null;
    if (raw === "securite" || raw === "danger" || raw === "password") {
      return "mot-de-passe";
    }
    if (
      raw === "compte" ||
      raw === "plan" ||
      raw === "mot-de-passe" ||
      raw === "langue"
    ) {
      return raw;
    }
    return null;
  };
  const initialTab = normalizeTab(tabParam) ?? "compte";
  const [tab, setTab] = useState<TabId>(initialTab);
  const { profile, refresh } = useProfile();

  const tabs = [
    { id: "compte" as const, label: tTabs("account"), icon: User },
    { id: "plan" as const, label: tTabs("plan"), icon: Zap },
    { id: "mot-de-passe" as const, label: tTabs("password"), icon: Lock },
    { id: "langue" as const, label: tTabs("language"), icon: Globe },
  ];

  useEffect(() => {
    const next = normalizeTab(searchParams.get("tab"));
    if (next) setTab(next);
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
      case "mot-de-passe":
        return <TabMotDePasse />;
      case "langue":
        return <LocaleSelector />;
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
