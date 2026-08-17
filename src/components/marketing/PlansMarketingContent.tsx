"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useProfile } from "@/lib/profile-context";
import { APP_MANAGE_PLAN_HREF } from "@/lib/app-hrefs";
import { studioVsCreatorFactorLabel } from "@/lib/plan";

const PLANS = [
  {
    id: "free" as const,
    price: "0",
    periodKey: null as "month" | null,
    accent: false,
    badgeKey: null as "popular" | "studioMultiplier" | null,
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
    badgeKey: "studioMultiplier" as const,
  },
];

type Plan = (typeof PLANS)[number];
export type PlansContentVariant = "marketing" | "app";

function planHref(plan: Plan, variant: PlansContentVariant, isCurrent: boolean): string {
  if (isCurrent) {
    return variant === "app" ? "/dashboard" : "/dashboard";
  }
  if (plan.id === "free") {
    return variant === "app" ? "/parametres?tab=plan" : "/register";
  }
  return `/checkout/${plan.id}`;
}

function PlanCard({
  plan,
  currentPlan,
  variant,
}: {
  plan: Plan;
  currentPlan: string | null;
  variant: PlansContentVariant;
}) {
  const t = useTranslations("plans");
  const locale = useLocale();
  const isCurrent = currentPlan === plan.id;
  const features = t.raw(`cards.${plan.id}.features`) as string[];
  const app = variant === "app";
  const href = planHref(plan, variant, isCurrent);
  const factor = studioVsCreatorFactorLabel(locale);
  const showStudioValue = plan.id === "studio";

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border transition-shadow ${
        app
          ? plan.accent
            ? "border-primary/40 bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_12px_32px_-14px_rgba(109,40,217,0.28)]"
            : showStudioValue
              ? "border-primary/25 bg-card shadow-sm hover:border-primary/40"
              : "border-border bg-card shadow-sm hover:border-input"
          : plan.accent
            ? "border-[#6d28d9]/40 bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_12px_32px_-14px_rgba(109,40,217,0.28)]"
            : showStudioValue
              ? "border-[#6d28d9]/25 bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_8px_24px_-10px_rgba(109,40,217,0.12)] hover:shadow-[0_8px_24px_-10px_rgba(28,28,30,0.12)]"
              : "border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)] hover:shadow-[0_8px_24px_-10px_rgba(28,28,30,0.12)]"
      }`}
    >
      {plan.accent && (
        <div className={`h-1 w-full ${app ? "bg-primary" : "bg-[#6d28d9]"}`} />
      )}

      {(plan.badgeKey || isCurrent) && (
        <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
          {plan.badgeKey === "popular" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${
                app ? "bg-primary" : "bg-[#6d28d9]"
              }`}
            >
              <Sparkles className="size-2.5" />
              {t("badge.popular")}
            </span>
          )}
          {plan.badgeKey === "studioMultiplier" && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                app
                  ? "bg-primary/10 text-primary ring-1 ring-primary/25"
                  : "bg-[#f3eefc] text-[#6d28d9] ring-1 ring-[#6d28d9]/20"
              }`}
            >
              {t("badge.studioMultiplier", { factor })}
            </span>
          )}
          {isCurrent && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                app
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-[#6d28d9]/30 bg-[#f3eefc] text-[#6d28d9]"
              }`}
            >
              {t("badge.yourPlan")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3
            className={`mb-1 font-[family-name:var(--font-syne)] text-xl font-bold ${
              app ? "text-foreground" : "text-[#1d1d1f]"
            }`}
          >
            {t(`names.${plan.id}`)}
          </h3>
          <p
            className={`text-sm leading-relaxed ${
              app ? "text-muted-foreground" : "text-[#1d1d1f]/55"
            }`}
          >
            {t(`cards.${plan.id}.tagline`)}
          </p>
        </div>

        <div
          className={`mb-6 border-b pb-6 ${
            app ? "border-border" : "border-[#e5e5e7]"
          }`}
        >
          <div className="flex items-baseline gap-1">
            <span
              className={`font-[family-name:var(--font-syne)] text-5xl font-extrabold tabular-nums ${
                plan.accent
                  ? app
                    ? "text-primary"
                    : "text-[#6d28d9]"
                  : app
                    ? "text-foreground"
                    : "text-[#1d1d1f]"
              }`}
            >
              {plan.price}
            </span>
            {plan.periodKey ? (
              <span
                className={`text-base ${
                  app ? "text-muted-foreground" : "text-[#1d1d1f]/50"
                }`}
              >
                {t("page.perMonth")}
              </span>
            ) : (
              <span
                className={`text-base ${
                  app ? "text-muted-foreground" : "text-[#1d1d1f]/50"
                }`}
              >
                €
              </span>
            )}
          </div>
          <p
            className={`mt-2 text-[13px] font-medium ${
              app ? "text-foreground" : "text-[#1d1d1f]"
            }`}
          >
            {t(`cards.${plan.id}.quota`)}
          </p>
          {showStudioValue && (
            <p
              className={`mt-1.5 text-[12px] font-semibold ${
                app ? "text-primary" : "text-[#6d28d9]"
              }`}
            >
              {t("badge.studioVsCreator", { factor })}
            </p>
          )}
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  plan.accent || showStudioValue
                    ? app
                      ? "bg-primary/15"
                      : "bg-[#6d28d9]/15"
                    : app
                      ? "bg-muted"
                      : "bg-[#f5f5f7]"
                }`}
              >
                <Check
                  className={`size-2.5 ${
                    plan.accent || showStudioValue
                      ? app
                        ? "text-primary"
                        : "text-[#6d28d9]"
                      : app
                        ? "text-muted-foreground"
                        : "text-[#1d1d1f]/45"
                  }`}
                  strokeWidth={3}
                />
              </div>
              <span
                className={`text-sm leading-snug ${
                  app ? "text-foreground" : "text-[#1d1d1f]"
                }`}
              >
                {f}
              </span>
            </li>
          ))}
        </ul>

        <Link
          href={href}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            plan.accent
              ? "bg-[#6d28d9] text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-[#5b21b6] active:scale-[0.99]"
              : showStudioValue
                ? app
                  ? "border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border border-[#6d28d9]/30 bg-[#f3eefc] text-[#6d28d9] hover:bg-[#ebe4fa]"
                : app
                  ? "border border-border bg-muted text-foreground hover:border-input"
                  : "border border-[#e5e5e7] bg-[#f5f5f7] text-[#1d1d1f] hover:border-[#1d1d1f]/20"
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
  const app = variant === "app";
  if (typeof value === "boolean") {
    return value ? (
      <Check
        className={`mx-auto size-4 ${app ? "text-primary" : "text-[#6d28d9]"}`}
        strokeWidth={2.5}
      />
    ) : (
      <span className={app ? "text-muted-foreground/40" : "text-[#1d1d1f]/25"}>
        —
      </span>
    );
  }
  return (
    <span
      className={`text-xs font-medium ${
        app ? "text-foreground" : "text-[#1d1d1f]"
      }`}
    >
      {value}
    </span>
  );
}

export function PlansMarketingContent({
  variant = "marketing",
}: {
  variant?: PlansContentVariant;
}) {
  const { profile } = useProfile();
  const t = useTranslations("plans");
  const app = variant === "app";

  return (
    <div className={app ? "px-4 py-8 sm:px-6 sm:py-10" : "px-6 py-16 sm:py-20"}>
      <div className="mx-auto max-w-5xl">
        <div className={`text-center ${app ? "mb-10" : "mb-14"}`}>
          <div
            className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              app
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-[#6d28d9]/20 bg-[#f3eefc] text-[#5b21b6]"
            }`}
          >
            <Sparkles className="size-3.5" />
            {t("page.heroBadge")}
          </div>
          <h1
            className={`mb-4 font-[family-name:var(--font-syne)] font-extrabold tracking-tight ${
              app
                ? "text-3xl text-foreground sm:text-4xl"
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
                  <span className={app ? "text-primary" : "text-[#6d28d9]"}>
                    {affordable}
                  </span>
                </>
              );
            })()}
          </h1>
          <p
            className={`mx-auto max-w-lg text-sm leading-relaxed ${
              app ? "text-muted-foreground" : "text-[#1d1d1f]/55"
            }`}
          >
            {t("page.heroSubtitle")}
          </p>
        </div>

        <div className={`grid gap-5 md:grid-cols-3 ${app ? "mb-12" : "mb-16"}`}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlan={profile?.plan ?? null}
              variant={variant}
            />
          ))}
        </div>

        <section
          className={`mb-10 overflow-hidden rounded-2xl border shadow-sm ${
            app ? "border-border bg-card" : "border-[#e5e5e7] bg-white"
          }`}
        >
          <div
            className={`border-b px-6 py-5 ${
              app ? "border-border" : "border-[#e5e5e7]"
            }`}
          >
            <h2
              className={`font-[family-name:var(--font-syne)] text-lg font-bold ${
                app ? "text-foreground" : "text-[#1d1d1f]"
              }`}
            >
              {t("page.comparisonTitle")}
            </h2>
            <p
              className={`mt-0.5 text-sm ${
                app ? "text-muted-foreground" : "text-[#1d1d1f]/50"
              }`}
            >
              {t("page.comparisonSubtitle")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr
                  className={`border-b ${
                    app ? "border-border" : "border-[#e5e5e7]"
                  }`}
                >
                  <th
                    className={`p-4 text-left text-xs font-semibold uppercase tracking-wider ${
                      app ? "text-muted-foreground" : "text-[#1d1d1f]/45"
                    }`}
                  >
                    {t("page.tableFeature")}
                  </th>
                  <th
                    className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${
                      app ? "text-muted-foreground" : "text-[#1d1d1f]/45"
                    }`}
                  >
                    {t("names.free")}
                  </th>
                  <th
                    className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${
                      app
                        ? "bg-primary/8 text-primary"
                        : "bg-[#f3eefc]/60 text-[#6d28d9]"
                    }`}
                  >
                    {t("names.creator")}
                  </th>
                  <th
                    className={`p-4 text-center text-xs font-semibold uppercase tracking-wider ${
                      app ? "text-muted-foreground" : "text-[#1d1d1f]/45"
                    }`}
                  >
                    {t("names.studio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b last:border-0 ${
                      app
                        ? "border-border/70 hover:bg-muted/40"
                        : "border-[#e5e5e7]/70 hover:bg-[#f5f5f7]/50"
                    }`}
                  >
                    <td
                      className={`p-4 text-sm ${
                        app ? "text-foreground" : "text-[#1d1d1f]"
                      }`}
                    >
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
                    <td
                      className={`p-4 text-center ${
                        app ? "bg-primary/5" : "bg-[#f3eefc]/40"
                      }`}
                    >
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

        {app ? (
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
        ) : (
          <div className="mx-auto max-w-md text-center">
            <p className="font-[family-name:var(--font-syne)] text-xl font-bold text-[#1d1d1f]">
              {t("page.ctaTitle")}
            </p>
            <p className="mt-2 text-sm text-[#1d1d1f]/55">{t("page.ctaSubtitle")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-xl bg-[#6d28d9] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
              >
                {t("page.startFree")}
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-[#e5e5e7] px-5 py-3 text-[14px] font-semibold text-[#1d1d1f]/70 transition-colors hover:border-[#1d1d1f]/20 hover:text-[#1d1d1f]"
              >
                {t("page.login")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
