"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, X, Zap } from "lucide-react";
import { useProfile } from "@/lib/profile-context";
import {
  getCreditsRemaining,
  getCreditsStatus,
  nextPlanForUpgrade,
  creditsLimitForPlan,
} from "@/lib/plan";

const DISMISS_KEY = "vyrll:low-credits-dismissed";

type DismissState = {
  plan: string;
  used: number;
  limit: number;
};

function readDismiss(): DismissState | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DismissState;
    if (
      typeof parsed?.plan !== "string" ||
      typeof parsed?.used !== "number" ||
      typeof parsed?.limit !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDismiss(state: DismissState) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function LowCreditsBanner() {
  const { profile } = useProfile();
  const t = useTranslations("layout.lowCredits");
  const tPlans = useTranslations("plans.names");
  const [dismissed, setDismissed] = useState(true);

  const used = profile?.credits_used ?? 0;
  const plan = profile?.plan ?? "free";
  const limit = profile?.credits_limit ?? creditsLimitForPlan(plan);
  const status = getCreditsStatus(used, limit);
  const remaining = getCreditsRemaining(used, limit);
  const nextPlan = nextPlanForUpgrade(plan);
  const show = Boolean(profile) && (status === "low" || status === "exhausted");

  useEffect(() => {
    if (!show) {
      setDismissed(true);
      return;
    }
    const prev = readDismiss();
    // Réaffiche si le plan/quota a changé, ou si l’usage a encore baissé.
    const stillDismissed =
      prev != null &&
      prev.plan === plan &&
      prev.limit === limit &&
      used <= prev.used;
    setDismissed(stillDismissed);
  }, [show, plan, limit, used]);

  if (!show || dismissed) return null;

  const message =
    status === "exhausted"
      ? nextPlan
        ? t("exhaustedUpgrade", { nextPlan: tPlans(nextPlan) })
        : t("exhaustedStudio")
      : nextPlan
        ? t("lowUpgrade", { count: remaining, nextPlan: tPlans(nextPlan) })
        : t("lowStudio", { count: remaining });

  const ctaHref = nextPlan ? "/plans" : "/parametres?tab=plan";
  const ctaLabel = nextPlan
    ? t("ctaUpgrade", { nextPlan: tPlans(nextPlan) })
    : t("ctaManage");

  const onDismiss = () => {
    writeDismiss({ plan, used, limit });
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 border-b px-4 py-2.5 ${
        status === "exhausted"
          ? "border-destructive/25 bg-destructive/10"
          : "border-amber-500/25 bg-amber-500/10"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 sm:flex-none">
        {status === "exhausted" ? (
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Zap className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <p
          className={`text-center text-[11px] font-medium leading-snug sm:text-left ${
            status === "exhausted"
              ? "text-destructive"
              : "text-amber-800 dark:text-amber-200"
          }`}
        >
          {message}{" "}
          <Link
            href={ctaHref}
            className="underline underline-offset-2 hover:opacity-80"
          >
            {ctaLabel}
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={`shrink-0 rounded-md p-1 transition-colors ${
          status === "exhausted"
            ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
            : "text-amber-700/70 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300/70 dark:hover:text-amber-200"
        }`}
        aria-label={t("dismiss")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
