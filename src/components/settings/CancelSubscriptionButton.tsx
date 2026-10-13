"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatLocaleDate } from "@/lib/utils";

type BillingSubscription = {
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
};

const cancelButtonClassName =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-destructive/30 bg-background px-4 text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";

function isPaidPlan(plan: string): boolean {
  return plan === "creator" || plan === "studio";
}

export function CancelSubscriptionButton({ plan }: { plan: string }) {
  const locale = useLocale();
  const t = useTranslations("settings.plan");
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isPaidPlan(plan)) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/stripe/subscription", {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data?.error === "string" ? data.error : t("loadSubscriptionError"));
          setSubscription(null);
          return;
        }
        setSubscription(
          data?.subscription ? (data.subscription as BillingSubscription) : null
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(t("loadSubscriptionError"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [plan, t, attempt]);

  if (!isPaidPlan(plan)) return null;

  const formatPeriodEnd = (unix: number | null) => {
    if (!unix) return "";
    return formatLocaleDate(new Date(unix * 1000), locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const confirmCancel = async () => {
    setCancelLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.subscription) {
        setError(typeof data?.error === "string" ? data.error : t("cancelError"));
        return;
      }
      setSubscription(data.subscription as BillingSubscription);
      setDialogOpen(false);
    } catch {
      setError(t("cancelError"));
    } finally {
      setCancelLoading(false);
    }
  };

  const scheduled = Boolean(subscription?.cancelAtPeriodEnd);

  return (
    <div className="mb-8 space-y-3">
      {loading ? (
        <button type="button" disabled className={cancelButtonClassName}>
          <Loader2 className="size-4 animate-spin" />
          {t("cancelSubscription")}
        </button>
      ) : scheduled && subscription?.currentPeriodEnd ? (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {t("cancelScheduled", {
            date: formatPeriodEnd(subscription.currentPeriodEnd),
          })}
        </p>
      ) : subscription ? (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={cancelLoading}
          className={cancelButtonClassName}
        >
          {t("cancelSubscription")}
        </button>
      ) : null}
      {error && !loading ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{error}</p>
          {!subscription ? (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="text-sm font-medium text-foreground underline"
            >
              {t("retrySubscription")}
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialogOpen}
        title={t("cancelDialogTitle")}
        description={t("cancelDialogDescription")}
        confirmLabel={t("cancelDialogConfirm")}
        cancelLabel={t("cancelDialogCancel")}
        onConfirm={confirmCancel}
        onCancel={() => {
          if (!cancelLoading) setDialogOpen(false);
        }}
        loading={cancelLoading}
        variant="danger"
      />
    </div>
  );
}
