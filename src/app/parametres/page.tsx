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
  Globe,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { LocaleSelector } from "@/components/i18n/LocaleSelector";
import { ConfirmDialog, ModalLayer, dialogPanelClassName } from "@/components/ui/ConfirmDialog";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useProfile } from "@/lib/profile-context";
import { createClient } from "@/lib/supabase/client";
import { cn, formatLocaleDate } from "@/lib/utils";
import { PLAN_CREDITS, formatSourceMinutes } from "@/lib/plan";
import { STRIPE_PLAN_PRICES_EUR } from "@/lib/stripe-plans";

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
    price: String(STRIPE_PLAN_PRICES_EUR.creator),
    periodKey: "month" as const,
    accent: true,
    badgeKey: "popular" as const,
  },
  {
    id: "studio" as const,
    price: String(STRIPE_PLAN_PRICES_EUR.studio),
    periodKey: "month" as const,
    accent: false,
    badgeKey: null as "popular" | null,
  },
];

const fieldClassName =
  "h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15";

const fieldMutedClassName =
  "h-11 w-full cursor-not-allowed rounded-xl border border-border bg-muted/40 px-3.5 text-sm text-muted-foreground";

const primaryButtonClassName =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";

const secondaryButtonClassName =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";

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
      role="status"
      className={cn(
        "fixed bottom-6 right-6 z-[1000] flex max-w-sm items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm shadow-[var(--shadow-card)]",
        type === "error"
          ? "border-destructive/30 text-destructive"
          : "border-border text-foreground",
      )}
    >
      {type === "error" ? (
        <X className="size-4 shrink-0" aria-hidden />
      ) : (
        <Check className="size-4 shrink-0 text-primary" aria-hidden />
      )}
      {message}
    </div>
  );
}

function SettingsSection({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col">
      <header
        className={cn(
          "mb-8",
          actions &&
            "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        )}
      >
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-[13px] font-medium text-foreground"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
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
    <SettingsSection title={t("title")} subtitle={t("subtitle")}>
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />
      <div className="grid gap-10 md:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] md:gap-12 lg:gap-16">
        <div className="flex items-center gap-4 md:items-start">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted font-display text-xl font-semibold text-foreground">
            {(profile.username ?? profile.email ?? "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">
              {profile.username || tCommon("user")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("memberSince", { date: memberSince })}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="pseudo" label={t("pseudo")} hint={t("pseudoHint")}>
              <input
                id="pseudo"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={fieldClassName}
              />
            </Field>
            <Field id="email" label={tCommon("email")} hint={t("emailHint")}>
              <input
                id="email"
                type="text"
                value={profile.email ?? ""}
                readOnly
                className={fieldMutedClassName}
              />
            </Field>
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {tCommon("save")}
            </button>
          </div>
        </div>
      </div>
    </SettingsSection>
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
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card p-6",
        isCurrent ? "border-primary/35 bg-primary/[0.03]" : "border-border",
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
            {tPlans(`names.${plan.id}`)}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {tPlans(`cards.${plan.id}.tagline`)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {plan.badgeKey && !isCurrent ? (
            <span className="text-[11px] font-medium text-primary">
              {tBadge(plan.badgeKey)}
            </span>
          ) : null}
          {isCurrent ? (
            <span className="text-[11px] font-medium text-primary">
              {tBadge("yourPlan")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-5 border-b border-border pb-5">
        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {plan.price}
          </span>
          <span className="text-sm text-muted-foreground">
            {plan.periodKey ? t("pricePerMonth") : "€"}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {tPlans(`cards.${plan.id}.clips`)}
          <span className="mx-1.5 text-muted-foreground/50">·</span>
          {tPlans(`cards.${plan.id}.quota`)}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {tPlans(`quotaFootnote.${plan.id}`, {
            credits,
            duration,
          })}
        </p>
      </div>

      <ul className="mb-6 flex-1 space-y-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check
              className="mt-0.5 size-3.5 shrink-0 text-primary"
              strokeWidth={2.5}
              aria-hidden
            />
            <span className="text-sm leading-snug text-foreground">{f}</span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <p className="py-2 text-center text-sm font-medium text-muted-foreground">
          {t("currentPlanCta")}
        </p>
      ) : isUpgrade ? (
        <Link
          href={`/checkout/${plan.id}`}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            plan.accent
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-border bg-background text-foreground hover:bg-muted",
          )}
        >
          {tPlans(`cards.${plan.id}.cta`)}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : isDowngrade ? (
        <button
          type="button"
          onClick={onManageBilling}
          disabled={portalLoading}
          className={cn(secondaryButtonClassName, "h-11 w-full")}
        >
          {portalLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("manageToChange")}
        </button>
      ) : null}
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

  const billingActions = isPaid ? (
    <>
      <button
        type="button"
        onClick={openBillingPortal}
        disabled={portalLoading || cancelLoading || resumeLoading}
        className={secondaryButtonClassName}
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
          className={secondaryButtonClassName}
        >
          {resumeLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("resumeSubscription")}
        </button>
      ) : subscription ? (
        <button
          type="button"
          onClick={() => setCancelDialogOpen(true)}
          disabled={cancelLoading || portalLoading}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-background px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {t("cancelSubscription")}
        </button>
      ) : null}
    </>
  ) : undefined;

  return (
    <SettingsSection
      title={t("title")}
      subtitle={t("subtitle")}
      actions={billingActions}
    >
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />

      {isPaid && cancelScheduled && subscription?.currentPeriodEnd ? (
        <p className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {t("cancelScheduled", {
            date: formatPeriodEnd(subscription.currentPeriodEnd),
          })}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
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
    </SettingsSection>
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

  useEffect(() => {
    if (!showDeleteModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteLoading) {
        setShowDeleteModal(false);
        setDeleteConfirm("");
        setDeleteError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDeleteModal, deleteLoading]);

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
    <SettingsSection title={t("title")} subtitle={t("subtitle")}>
      <Toast message={toast?.message ?? null} type={toast?.type ?? "success"} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:gap-16">
        <div className="space-y-5">
          {!authReady ? (
            <div className="flex py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {!hasEmailIdentity ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("oauthOnlyHint")}
                </p>
              ) : (
                <Field id="current-password" label={t("currentPassword")}>
                  <PasswordInput
                    id="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                    className={fieldClassName}
                  />
                </Field>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="new-password" label={t("newPassword")}>
                  <PasswordInput
                    id="new-password"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    autoComplete="new-password"
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                    className={fieldClassName}
                  />
                </Field>
                <Field
                  id="confirm-password"
                  label={t("confirmPassword")}
                  hint={mismatch ? undefined : t("passwordMin")}
                >
                  <PasswordInput
                    id="confirm-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                    className={cn(
                      fieldClassName,
                      mismatch &&
                        "border-destructive/50 focus-visible:border-destructive/50 focus-visible:ring-destructive/15",
                      match &&
                        "border-primary/40 focus-visible:border-primary/50 focus-visible:ring-primary/15",
                    )}
                  />
                  {mismatch ? (
                    <p className="text-xs text-destructive">{t("passwordMismatch")}</p>
                  ) : null}
                </Field>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={loading || !canSubmitPassword}
                  className={primaryButtonClassName}
                >
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  {hasEmailIdentity ? t("changePassword") : t("setPassword")}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border pt-8 lg:border-t-0 lg:pt-0">
          <p className="text-sm font-medium text-foreground">{t("deleteTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("deleteDescription")}
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className="mt-4 inline-flex h-10 items-center rounded-xl border border-destructive/30 bg-background px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {tCommon("delete")}
          </button>
        </div>
      </div>

      {showDeleteModal && (
        <ModalLayer
          onBackdrop={() => {
            if (deleteLoading) return;
            setShowDeleteModal(false);
            setDeleteConfirm("");
            setDeleteError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-desc"
            className={dialogPanelClassName}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h2
                id="delete-account-title"
                className="font-display text-lg font-semibold tracking-tight text-foreground"
              >
                {t("deleteDialogTitle")}
              </h2>
              <p
                id="delete-account-desc"
                className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
              >
                {t("deleteDialogDescription", { phrase: confirmPhrase })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="delete-confirm" className="text-[13px] font-medium text-foreground">
                {t("deleteConfirmLabel")}
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={cn(fieldClassName, "border-zinc-300 bg-zinc-200/80 dark:border-zinc-600 dark:bg-zinc-800")}
              />
            </div>
            {deleteError ? (
              <p className="text-xs text-destructive">{deleteError}</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  if (deleteLoading) return;
                  setShowDeleteModal(false);
                  setDeleteConfirm("");
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-transparent px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/80 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={!deleteReady || deleteLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteLoading && <Loader2 className="size-4 animate-spin" />}
                {deleteLoading ? t("deleting") : t("deleteButton")}
              </button>
            </div>
          </div>
        </ModalLayer>
      )}
    </SettingsSection>
  );
}

function ParametresContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tTabs = useTranslations("settings.tabs");
  const tLang = useTranslations("settings.language");
  const tSidebar = useTranslations("layout.sidebar");
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
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const renderTab = () => {
    switch (tab) {
      case "compte":
        return <TabCompte profile={profile} onRefresh={refresh} />;
      case "plan":
        return <TabPlan profile={profile} onRefresh={refresh} />;
      case "mot-de-passe":
        return <TabMotDePasse />;
      case "langue":
        return (
          <SettingsSection title={tLang("title")} subtitle={tLang("subtitle")}>
            <LocaleSelector />
          </SettingsSection>
        );
      default:
        return null;
    }
  };

  return (
    <AppShell activeItem="parametres">
      <main className="flex w-full flex-1 flex-col px-6 pb-16 pt-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            {tSidebar("settings")}
          </h1>

          <div className="mt-6 border-b border-border">
            <div
              role="tablist"
              aria-label={tSidebar("settings")}
              className="-mb-px flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {tabs.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => goTab(item.id)}
                      className={cn(
                        "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-primary font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn("size-4", active ? "text-primary" : "opacity-70")}
                        strokeWidth={active ? 2.25 : 2}
                        aria-hidden
                      />
                      {item.label}
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="mt-8 min-w-0 sm:mt-10">{renderTab()}</div>
        </div>
      </main>
    </AppShell>
  );
}

export default function ParametresPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      }
    >
      <ParametresContent />
    </Suspense>
  );
}
