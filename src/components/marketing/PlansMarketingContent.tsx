"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProfile } from "@/lib/profile-context";

const PLANS = [
  {
    id: "free" as const,
    price: "0",
    periodKey: null as "month" | null,
    href: "/register",
    accent: false,
    badgeKey: null as "popular" | null,
  },
  {
    id: "creator" as const,
    price: "17",
    periodKey: "month" as const,
    href: "/checkout/creator",
    accent: true,
    badgeKey: "popular" as const,
  },
  {
    id: "studio" as const,
    price: "39",
    periodKey: "month" as const,
    href: "/checkout/studio",
    accent: false,
    badgeKey: null as "popular" | null,
  },
];

type Plan = (typeof PLANS)[number];

function PlanCard({
  plan,
  currentPlan,
}: {
  plan: Plan;
  currentPlan: string | null;
}) {
  const t = useTranslations("plans");
  const isCurrent = currentPlan === plan.id;
  const features = t.raw(`cards.${plan.id}.features`) as string[];

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white transition-shadow ${
        plan.accent
          ? "border-[#6d28d9]/40 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_12px_32px_-14px_rgba(109,40,217,0.28)]"
          : "border-[#e5e5e7] shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)] hover:shadow-[0_8px_24px_-10px_rgba(28,28,30,0.12)]"
      }`}
    >
      {plan.accent && <div className="h-1 w-full bg-[#6d28d9]" />}

      {(plan.badgeKey || isCurrent) && (
        <div className="absolute right-4 top-4 flex gap-2">
          {plan.badgeKey && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#6d28d9] px-2.5 py-0.5 text-[11px] font-bold text-white">
              <Sparkles className="size-2.5" />
              {t(`badge.${plan.badgeKey}`)}
            </span>
          )}
          {isCurrent && (
            <span className="inline-flex items-center rounded-full border border-[#6d28d9]/30 bg-[#f3eefc] px-2.5 py-0.5 text-[11px] font-bold text-[#6d28d9]">
              {t("badge.yourPlan")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3 className="mb-1 font-[family-name:var(--font-syne)] text-xl font-bold text-[#1d1d1f]">
            {t(`names.${plan.id}`)}
          </h3>
          <p className="text-sm leading-relaxed text-[#1d1d1f]/55">
            {t(`cards.${plan.id}.tagline`)}
          </p>
        </div>

        <div className="mb-6 border-b border-[#e5e5e7] pb-6">
          <div className="flex items-baseline gap-1">
            <span
              className={`font-[family-name:var(--font-syne)] text-5xl font-extrabold tabular-nums ${
                plan.accent ? "text-[#6d28d9]" : "text-[#1d1d1f]"
              }`}
            >
              {plan.price}
            </span>
            {plan.periodKey ? (
              <span className="text-base text-[#1d1d1f]/50">
                {t("page.perMonth")}
              </span>
            ) : (
              <span className="text-base text-[#1d1d1f]/50">€</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-lg bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#1d1d1f]/55">
              {t(`cards.${plan.id}.clips`)}
            </span>
            <span className="text-[11px] text-[#1d1d1f]/35">·</span>
            <span className="text-[11px] text-[#1d1d1f]/50">
              {t(`cards.${plan.id}.quota`)}
            </span>
          </div>
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  plan.accent ? "bg-[#6d28d9]/15" : "bg-[#f5f5f7]"
                }`}
              >
                <Check
                  className={`size-2.5 ${
                    plan.accent ? "text-[#6d28d9]" : "text-[#1d1d1f]/45"
                  }`}
                  strokeWidth={3}
                />
              </div>
              <span className="text-sm leading-snug text-[#1d1d1f]">{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href={isCurrent ? "/dashboard" : plan.href}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            plan.accent
              ? "bg-[#6d28d9] text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-[#5b21b6] active:scale-[0.99]"
              : "border border-[#e5e5e7] bg-[#f5f5f7] text-[#1d1d1f] hover:border-[#1d1d1f]/20"
          }`}
        >
          {isCurrent ? t("badge.yourPlan") : t(`cards.${plan.id}.cta`)}
          <ArrowRight className="size-4" />
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
  { featureKey: "processingPriority", free: false, creator: true, studio: true },
  { featureKey: "subtitleEditor", free: false, creator: true, studio: true },
  { featureKey: "earlyAccess", free: false, creator: false, studio: true },
] as const;

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto size-4 text-[#6d28d9]" strokeWidth={2.5} />
    ) : (
      <span className="text-[#1d1d1f]/25">—</span>
    );
  }
  return (
    <span className="text-xs font-medium text-[#1d1d1f]">{value}</span>
  );
}

export function PlansMarketingContent() {
  const { profile } = useProfile();
  const t = useTranslations("plans");

  return (
    <div className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-14 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#6d28d9]/20 bg-[#f3eefc] px-3 py-1.5 text-xs font-semibold text-[#5b21b6]">
            <Sparkles className="size-3.5" />
            {t("page.heroBadge")}
          </div>
          <h1 className="mb-4 font-[family-name:var(--font-syne)] text-4xl font-extrabold tracking-tight text-[#1d1d1f] sm:text-5xl">
            {(() => {
              const affordable = t("page.affordable");
              const full = t("page.heroTitle", { affordable });
              const prefix = full.slice(0, full.lastIndexOf(affordable));
              return (
                <>
                  {prefix}
                  <span className="text-[#6d28d9]">{affordable}</span>
                </>
              );
            })()}
          </h1>
          <p className="mx-auto max-w-lg text-sm leading-relaxed text-[#1d1d1f]/55">
            {t("page.heroSubtitle")}
          </p>
        </div>

        <div className="mb-16 grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlan={profile?.plan ?? null}
            />
          ))}
        </div>

        <section className="mb-10 overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white shadow-sm">
          <div className="border-b border-[#e5e5e7] px-6 py-5">
            <h2 className="font-[family-name:var(--font-syne)] text-lg font-bold text-[#1d1d1f]">
              {t("page.comparisonTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-[#1d1d1f]/50">
              {t("page.comparisonSubtitle")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e7]">
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-[#1d1d1f]/45">
                    {t("page.tableFeature")}
                  </th>
                  <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-[#1d1d1f]/45">
                    {t("names.free")}
                  </th>
                  <th className="bg-[#f3eefc]/60 p-4 text-center text-xs font-semibold uppercase tracking-wider text-[#6d28d9]">
                    {t("names.creator")}
                  </th>
                  <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-[#1d1d1f]/45">
                    {t("names.studio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#e5e5e7]/70 last:border-0 hover:bg-[#f5f5f7]/50"
                  >
                    <td className="p-4 text-sm text-[#1d1d1f]">
                      {t(`comparison.${row.featureKey}`)}
                    </td>
                    <td className="p-4 text-center">
                      <Cell
                        value={
                          typeof row.free === "string"
                            ? t(`comparison.${row.free}`)
                            : row.free
                        }
                      />
                    </td>
                    <td className="bg-[#f3eefc]/40 p-4 text-center">
                      <Cell
                        value={
                          typeof row.creator === "string"
                            ? t(`comparison.${row.creator}`)
                            : row.creator
                        }
                      />
                    </td>
                    <td className="p-4 text-center">
                      <Cell
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
      </div>
    </div>
  );
}
