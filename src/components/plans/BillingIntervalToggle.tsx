"use client";

import { useTranslations } from "next-intl";
import {
  ANNUAL_DISCOUNT_PERCENT,
  type BillingInterval,
  type PlansOfferView,
} from "@/lib/stripe-plans";

function pillClass(app: boolean) {
  return app
    ? "border-border bg-muted/60"
    : "border-[#e5e5e7] bg-[#f5f5f7]";
}

function selectedClass(app: boolean) {
  return app
    ? "bg-background text-foreground shadow-sm"
    : "bg-white text-[#1d1d1f] shadow-sm";
}

function idleClass(app: boolean) {
  return app
    ? "text-muted-foreground hover:text-foreground"
    : "text-[#1d1d1f]/55 hover:text-[#1d1d1f]";
}

export function BillingIntervalToggle({
  value,
  onChange,
  variant = "marketing",
  showEnterprise = false,
  savePercent,
}: {
  value: PlansOfferView;
  onChange: (offer: PlansOfferView) => void;
  variant?: "marketing" | "app";
  showEnterprise?: boolean;
  /** Exact discount for this plan. Omit to show “up to” the max annual cut. */
  savePercent?: number;
}) {
  const t = useTranslations("plans.billing");
  const app = variant === "app";
  const intervals: BillingInterval[] = ["month", "year"];
  const yearBadge =
    savePercent != null
      ? t("saveBadge", { percent: savePercent })
      : t("saveBadgeUpTo", { percent: ANNUAL_DISCOUNT_PERCENT });

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div
        role="radiogroup"
        aria-label={t("ariaLabel")}
        className={`inline-flex rounded-full border p-1 ${pillClass(app)}`}
      >
        {intervals.map((interval) => {
          const selected = value === interval;
          return (
            <button
              key={interval}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(interval)}
              className={`inline-flex items-center rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                selected ? selectedClass(app) : idleClass(app)
              }`}
            >
              {interval === "year" ? t("yearly") : t("monthly")}
              {interval === "year" ? (
                <span
                  className={`ml-1.5 text-[11px] font-bold ${
                    app ? "text-primary" : "text-[#6d28d9]"
                  }`}
                >
                  {yearBadge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {showEnterprise ? (
        <div className={`inline-flex rounded-full border p-1 ${pillClass(app)}`}>
          <button
            type="button"
            aria-pressed={value === "enterprise"}
            onClick={() => onChange("enterprise")}
            className={`inline-flex items-center rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              value === "enterprise" ? selectedClass(app) : idleClass(app)
            }`}
          >
            {t("enterprise")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
