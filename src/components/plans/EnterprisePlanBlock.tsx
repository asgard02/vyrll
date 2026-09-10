"use client";

import { ArrowRight, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  ENTERPRISE_CLIPS_PER_MONTH,
  ENTERPRISE_CONTACT_EMAIL,
  STRIPE_ENTERPRISE_PRICE_EUR,
  formatPlanPriceEur,
} from "@/lib/stripe-plans";
import { planCardClass, planTone, type PlansContentVariant } from "@/components/plans/plan-tone";

export function EnterprisePlanBlock({
  variant = "marketing",
  layout = "card",
}: {
  variant?: PlansContentVariant;
  layout?: "card" | "embedded";
}) {
  const t = useTranslations("plans");
  const locale = useLocale();
  const ui = planTone(variant);
  const embedded = layout === "embedded";
  const features = t.raw("cards.enterprise.features") as string[];
  const subject = encodeURIComponent(t("cards.enterprise.mailSubject"));
  const body = encodeURIComponent(t("cards.enterprise.mailBody"));
  const href = `mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  const price = formatPlanPriceEur(STRIPE_ENTERPRISE_PRICE_EUR, locale);

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden ${
        embedded
          ? ui.cut
            ? "bg-[#181616]"
            : ui.app
              ? "bg-background"
              : "bg-white"
          : planCardClass(variant, false, true)
      }`}
    >
      <div className="absolute right-4 top-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ui.badgeSoft}`}
        >
          {t("badge.enterpriseVolume", { clips: ENTERPRISE_CLIPS_PER_MONTH })}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3 className={`mb-1 font-[family-name:var(--font-syne)] text-xl font-bold ${ui.ink}`}>
            {t("names.enterprise")}
          </h3>
          <p className={`text-sm leading-relaxed ${ui.muted}`}>
            {t("cards.enterprise.tagline")}
          </p>
        </div>

        <div className={`mb-6 border-b pb-6 ${ui.hairline}`}>
          <div className="flex items-baseline gap-1">
            <span
              className={`font-[family-name:var(--font-syne)] text-5xl font-extrabold tabular-nums ${ui.ink}`}
            >
              {price}
            </span>
            <span className={`text-base ${ui.mutedSoft}`}>{t("page.perMonth")}</span>
          </div>
          <p className={`mt-2 text-[13px] font-medium ${ui.ink}`}>
            {t("cards.enterprise.quota", { clips: ENTERPRISE_CLIPS_PER_MONTH })}
          </p>
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${ui.checkOnBg}`}
              >
                <Check className={`size-2.5 ${ui.checkOn}`} strokeWidth={3} />
              </div>
              <span className={`text-sm leading-snug ${ui.ink}`}>{feature}</span>
            </li>
          ))}
        </ul>

        <a
          href={href}
          className={`mt-auto flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${ui.ctaIdle}`}
        >
          {t("cards.enterprise.cta")}
          <ArrowRight className="size-4" />
        </a>
      </div>
    </article>
  );
}
