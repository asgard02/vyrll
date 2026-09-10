"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useProfile } from "@/lib/profile-context";
import { APP_MANAGE_PLAN_HREF } from "@/lib/app-hrefs";
import { studioVsCreatorFactorLabel } from "@/lib/plan";
import { BillingIntervalToggle } from "@/components/plans/BillingIntervalToggle";
import { EnterprisePlanBlock } from "@/components/plans/EnterprisePlanBlock";
import { PlanPriceRow } from "@/components/plans/PlanPriceRow";
import {
  annualDiscountPercent,
  formatPlanPriceEur,
  monthlyEquivalentEur,
  chargedPriceEur,
  STRIPE_PLAN_PRICES_EUR,
  type BillingInterval,
  type PaidPlanId,
  type PlansOfferView,
} from "@/lib/stripe-plans";
import {
  planCardClass,
  planTone,
  type PlansContentVariant,
} from "@/components/plans/plan-tone";

const PLANS = [
  {
    id: "free" as const,
    periodKey: null as "month" | null,
    accent: false,
    badgeKey: null as "popular" | "studioMultiplier" | null,
  },
  {
    id: "creator" as const,
    periodKey: "month" as const,
    accent: true,
    badgeKey: "popular" as const,
  },
  {
    id: "studio" as const,
    periodKey: "month" as const,
    accent: false,
    badgeKey: "studioMultiplier" as const,
  },
];

type Plan = (typeof PLANS)[number];
export type { PlansContentVariant };

function planHref(
  plan: Plan,
  variant: PlansContentVariant,
  isCurrent: boolean,
  interval: BillingInterval
): string {
  if (isCurrent) {
    return "/dashboard";
  }
  if (plan.id === "free") {
    return variant === "app" ? "/parametres?tab=plan" : "/register";
  }
  const yearly = interval === "year" ? "?interval=year" : "";
  return `/checkout/${plan.id}${yearly}`;
}

function PlanCard({
  plan,
  currentPlan,
  variant,
  interval,
}: {
  plan: Plan;
  currentPlan: string | null;
  variant: PlansContentVariant;
  interval: BillingInterval;
}) {
  const t = useTranslations("plans");
  const tBilling = useTranslations("plans.billing");
  const locale = useLocale();
  const isCurrent = currentPlan === plan.id;
  const features = t.raw(`cards.${plan.id}.features`) as string[];
  const ui = planTone(variant);
  const href = planHref(plan, variant, isCurrent, interval);
  const factor = studioVsCreatorFactorLabel(locale);
  const showStudioValue = plan.id === "studio";
  const paidId = plan.id === "creator" || plan.id === "studio" ? plan.id : null;
  const displayPrice = paidId
    ? formatPlanPriceEur(monthlyEquivalentEur(paidId, interval), locale)
    : "0";
  const listPrice = paidId
    ? formatPlanPriceEur(STRIPE_PLAN_PRICES_EUR[paidId], locale)
    : "";
  const yearlyTotal = paidId
    ? formatPlanPriceEur(chargedPriceEur(paidId as PaidPlanId, "year"), locale)
    : "";
  const yearlyList = paidId
    ? formatPlanPriceEur(STRIPE_PLAN_PRICES_EUR[paidId] * 12, locale)
    : "";

  const accentCta = ui.cut ? ui.ctaAccent : ui.ctaMarketing;

  return (
    <div className={planCardClass(variant, plan.accent, showStudioValue)}>
      {plan.accent && (
        <div className={`h-1 w-full ${ui.cut ? "bg-[#fdfff0]" : ui.app ? "bg-primary" : "bg-[#6d28d9]"}`} />
      )}

      {(plan.badgeKey || isCurrent) && (
        <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
          {plan.badgeKey === "popular" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ui.badge}`}
            >
              <Sparkles className="size-2.5" />
              {t("badge.popular")}
            </span>
          )}
          {plan.badgeKey === "studioMultiplier" && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ui.badgeSoft}`}
            >
              {t("badge.studioMultiplier", { factor })}
            </span>
          )}
          {isCurrent && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${ui.badgeSoft}`}
            >
              {t("badge.yourPlan")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3 className={`mb-1 font-[family-name:var(--font-syne)] text-xl font-bold ${ui.ink}`}>
            {t(`names.${plan.id}`)}
          </h3>
          <p className={`text-sm leading-relaxed ${ui.muted}`}>
            {t(`cards.${plan.id}.tagline`)}
          </p>
        </div>

        <div className={`mb-6 border-b pb-6 ${ui.hairline}`}>
          <PlanPriceRow
            current={displayPrice}
            was={paidId && interval === "year" ? listPrice : null}
            insteadOf={
              paidId && interval === "year"
                ? tBilling("insteadOf", { price: listPrice })
                : null
            }
            period={plan.periodKey ? t("page.perMonth") : "€"}
            saveLabel={
              paidId && interval === "year"
                ? tBilling("saveBadge", {
                    percent: annualDiscountPercent(paidId),
                  })
                : null
            }
            billed={
              paidId && interval === "year"
                ? {
                    was: yearlyList,
                    copy: tBilling("billedYearly", { price: yearlyTotal }),
                  }
                : null
            }
            accent={plan.accent}
            variant={variant}
          />
          <p className={`mt-2 text-[13px] font-medium ${ui.ink}`}>
            {t(`cards.${plan.id}.quota`)}
          </p>
          {showStudioValue && (
            <p className={`mt-1.5 text-[12px] font-semibold ${ui.offer}`}>
              {t("badge.studioVsCreator", { factor })}
            </p>
          )}
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  plan.accent || showStudioValue ? ui.checkOnBg : ui.checkOffBg
                }`}
              >
                <Check
                  className={`size-2.5 ${
                    plan.accent || showStudioValue ? ui.checkOn : ui.checkOff
                  }`}
                  strokeWidth={3}
                />
              </div>
              <span className={`text-sm leading-snug ${ui.ink}`}>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href={href}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            plan.accent ? accentCta : showStudioValue ? ui.ctaStudio : ui.ctaIdle
          }`}
        >
          {isCurrent ? t("badge.yourPlan") : t(`cards.${plan.id}.cta`)}
          {!isCurrent && <ArrowRight className="size-4" />}
        </Link>
      </div>
    </div>
  );
}

const COMPARISON_ROWS = [
  { featureKey: "clips916", free: true, creator: true, studio: true },
  { featureKey: "aiSubtitles", free: true, creator: true, studio: true },
  { featureKey: "viralScore", free: true, creator: true, studio: true },
  { featureKey: "formats", free: true, creator: true, studio: true },
  {
    featureKey: "sourceQuota",
    free: "sourceQuotaFree",
    creator: "sourceQuotaCreator",
    studio: "sourceQuotaStudio",
  },
  {
    featureKey: "exportQuality",
    free: "exportQualityFree",
    creator: "exportQualityPaid",
    studio: "exportQualityPaid",
  },
  { featureKey: "processingPriority", free: false, creator: true, studio: true },
  { featureKey: "subtitleEditor", free: false, creator: true, studio: true },
  { featureKey: "earlyAccess", free: false, creator: false, studio: true },
] as const;

function Cell({
  value,
  variant,
}: {
  value: boolean | string;
  variant: PlansContentVariant;
}) {
  const ui = planTone(variant);
  if (typeof value === "boolean") {
    return value ? (
      <Check className={`mx-auto size-4 ${ui.offer}`} strokeWidth={2.5} />
    ) : (
      <span className={ui.cut ? "text-[#fdfff0]/25" : ui.app ? "text-muted-foreground/40" : "text-[#1d1d1f]/25"}>
        —
      </span>
    );
  }
  return <span className={`text-xs font-medium ${ui.ink}`}>{value}</span>;
}

export function PlansMarketingContent({
  variant = "marketing",
  embed = false,
}: {
  variant?: PlansContentVariant;
  embed?: boolean;
}) {
  const { profile } = useProfile();
  const t = useTranslations("plans");
  const ui = planTone(variant);
  const [offer, setOffer] = useState<PlansOfferView>("month");
  const billingInterval: BillingInterval = offer === "year" ? "year" : "month";
  const showChrome = !embed;

  return (
    <div
      className={
        embed
          ? ""
          : ui.app
            ? "px-4 py-8 sm:px-6 sm:py-10"
            : "px-6 py-16 sm:py-20"
      }
    >
      <div className="mx-auto max-w-5xl">
        {showChrome ? (
          <div className={`text-center ${ui.app ? "mb-10" : "mb-14"}`}>
            <div
              className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${ui.heroBadge}`}
            >
              <Sparkles className="size-3.5" />
              {t("page.heroBadge")}
            </div>
            <h1
              className={`mb-4 font-[family-name:var(--font-syne)] font-extrabold tracking-tight ${
                ui.app
                  ? "text-3xl text-foreground sm:text-4xl"
                  : ui.cut
                    ? "text-4xl text-[#fdfff0] sm:text-5xl"
                    : "text-4xl text-[#1d1d1f] sm:text-5xl"
              }`}
            >
              {(() => {
                const affordable = t("page.affordable");
                const full = t("page.heroTitle", { affordable });
                const prefix = full.slice(0, full.lastIndexOf(affordable));
                return (
                  <>
                    {prefix}
                    <span className={ui.offer}>{affordable}</span>
                  </>
                );
              })()}
            </h1>
            <p className={`mx-auto max-w-lg text-sm leading-relaxed ${ui.muted}`}>
              {t("page.heroSubtitle")}
            </p>
          </div>
        ) : null}

        <div className={`flex justify-center ${embed || ui.app ? "mb-8" : "mb-10"}`}>
          <BillingIntervalToggle
            value={offer}
            onChange={setOffer}
            variant={variant}
            showEnterprise
          />
        </div>

        <div className={`grid gap-5 md:grid-cols-3 ${embed ? "" : ui.app ? "mb-12" : "mb-16"}`}>
          {offer === "enterprise" ? (
            <div className="md:col-start-2">
              <EnterprisePlanBlock variant={variant} />
            </div>
          ) : (
            PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentPlan={profile?.plan ?? null}
                variant={variant}
                interval={billingInterval}
              />
            ))
          )}
        </div>

        {showChrome && offer !== "enterprise" ? (
        <section
          className={`mb-10 overflow-hidden rounded-2xl border ${
            ui.cut
              ? "border-[#212121] bg-[#181616]"
              : ui.app
                ? "border-border bg-card shadow-sm"
                : "border-[#e5e5e7] bg-white shadow-sm"
          }`}
        >
          <div className={`border-b px-6 py-5 ${ui.hairline}`}>
            <h2 className={`font-[family-name:var(--font-syne)] text-lg font-bold ${ui.ink}`}>
              {t("page.comparisonTitle")}
            </h2>
            <p className={`mt-0.5 text-sm ${ui.mutedSoft}`}>{t("page.comparisonSubtitle")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${ui.hairline}`}>
                  <th className={`p-4 text-left text-xs font-semibold uppercase tracking-wider ${ui.muted}`}>
                    {t("page.tableFeature")}
                  </th>
                  <th className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${ui.muted}`}>
                    {t("names.free")}
                  </th>
                  <th className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${ui.tableCreatorHead}`}>
                    {t("names.creator")}
                  </th>
                  <th className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${ui.muted}`}>
                    {t("names.studio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={i} className={`border-b last:border-0 ${ui.tableRow}`}>
                    <td className={`p-4 text-sm ${ui.ink}`}>
                      {t(`comparison.${row.featureKey}`)}
                    </td>
                    <td className="p-4 text-center">
                      <Cell
                        variant={variant}
                        value={
                          typeof row.free === "string"
                            ? t(`comparison.${row.free}`)
                            : row.free
                        }
                      />
                    </td>
                    <td className={`p-4 text-center ${ui.tableCreatorCell}`}>
                      <Cell
                        variant={variant}
                        value={
                          typeof row.creator === "string"
                            ? t(`comparison.${row.creator}`)
                            : row.creator
                        }
                      />
                    </td>
                    <td className="p-4 text-center">
                      <Cell
                        variant={variant}
                        value={
                          typeof row.studio === "string"
                            ? t(`comparison.${row.studio}`)
                            : row.studio
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        {showChrome && ui.app ? (
          <div className="mx-auto max-w-md text-center">
            <p className="font-[family-name:var(--font-syne)] text-lg font-bold text-foreground">
              {t("page.ctaTitle")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t("page.ctaSubtitle")}</p>
            <Link
              href={APP_MANAGE_PLAN_HREF}
              className="mt-5 inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {t("page.manageInSettings")}
            </Link>
          </div>
        ) : showChrome ? (
          <div className="mx-auto max-w-md text-center">
            <p className={`font-[family-name:var(--font-syne)] text-xl font-bold ${ui.ink}`}>
              {t("page.ctaTitle")}
            </p>
            <p className={`mt-2 text-sm ${ui.muted}`}>{t("page.ctaSubtitle")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className={`inline-flex items-center justify-center rounded-xl px-5 py-3 text-[14px] font-semibold transition-colors ${
                  ui.cut
                    ? ui.ctaAccent
                    : "bg-[#6d28d9] text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] hover:bg-[#5b21b6]"
                }`}
              >
                {t("page.startFree")}
              </Link>
              <Link
                href="/login"
                className={`inline-flex items-center justify-center rounded-xl border px-5 py-3 text-[14px] font-semibold transition-colors ${
                  ui.cut
                    ? "border-[#2a2a2a] text-[#fdfff0]/70 hover:border-[#fdfff0]/25 hover:text-[#fdfff0]"
                    : "border-[#e5e5e7] text-[#1d1d1f]/70 hover:border-[#1d1d1f]/20 hover:text-[#1d1d1f]"
                }`}
              >
                {t("page.login")}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
