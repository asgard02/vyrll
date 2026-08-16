"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { useProfile } from "@/lib/profile-context";
import {
  getCreditsStatus,
  nextPlanForUpgrade,
  creditsLimitForPlan,
} from "@/lib/plan";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";

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
  const nextPlan = nextPlanForUpgrade(plan);
  /** Header already shows remaining credits + Upgrade. Only interrupt when blocked. */
  const show = Boolean(profile) && status === "exhausted";

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

  const message = nextPlan
    ? t("exhaustedUpgrade", { nextPlan: tPlans(nextPlan) })
    : t("exhaustedStudio");

  const ctaHref = APP_PLANS_HREF;
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
      className="flex items-center justify-center gap-3 border-b border-destructive/25 bg-destructive/10 px-4 py-2.5"
    >
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 sm:flex-none">
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <p className="text-center text-[11px] font-medium leading-snug text-destructive sm:text-left">
          {message}{" "}
          <Link href={ctaHref} className="underline underline-offset-2 hover:opacity-80">
            {ctaLabel}
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label={t("dismiss")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
