"use client";

import { useTranslations } from "next-intl";
import {
  ANNUAL_DISCOUNT_PERCENT,
  type PlansOfferView,
} from "@/lib/stripe-plans";
import { planTone, type PlansContentVariant } from "@/components/plans/plan-tone";

export function BillingIntervalToggle({
  value,
  onChange,
  variant = "marketing",
  showEnterprise = false,
  savePercent,
}: {
  value: PlansOfferView;
  onChange: (offer: PlansOfferView) => void;
  variant?: PlansContentVariant;
  showEnterprise?: boolean;
  savePercent?: number;
}) {
  const t = useTranslations("plans.billing");
  const ui = planTone(variant);
  const intervals = ["month", "year"] as const;
  const yearBadge =
    savePercent != null
      ? t("saveBadge", { percent: savePercent })
      : t("saveBadgeUpTo", { percent: ANNUAL_DISCOUNT_PERCENT });

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div
        role="radiogroup"
        aria-label={t("ariaLabel")}
        className={`inline-flex rounded-full border p-1 ${ui.pill}`}
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
                selected ? ui.pillSelected : ui.pillIdle
              }`}
            >
              {interval === "year" ? t("yearly") : t("monthly")}
              {interval === "year" ? (
                <span className={`ml-1.5 text-[11px] font-bold ${ui.offer}`}>
                  {yearBadge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {showEnterprise ? (
        <div className={`inline-flex rounded-full border p-1 ${ui.pill}`}>
          <button
            type="button"
            aria-pressed={value === "enterprise"}
            onClick={() => onChange("enterprise")}
            className={`inline-flex items-center rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              value === "enterprise" ? ui.pillSelected : ui.pillIdle
            }`}
          >
            {t("enterprise")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
