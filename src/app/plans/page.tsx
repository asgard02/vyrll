"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/layout/AppShell";
import { useProfile } from "@/lib/profile-context";

const PLANS = [
  {
    id: "free" as const,
    price: "0",
    period: "",
    href: "/register",
    accent: false,
    badgeKey: null as "popular" | null,
  },
  {
    id: "creator" as const,
    price: "17",
    period: "€/mois",
    href: "/checkout/creator",
    accent: true,
    badgeKey: "popular" as const,
  },
  {
    id: "studio" as const,
    price: "35",
    period: "€/mois",
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
      className={`relative flex flex-col rounded-2xl border transition-shadow ${
        plan.accent
          ? "border-primary/30 bg-white shadow-[0_0_0_1px_rgba(124,58,237,0.15),0_8px_32px_rgba(124,58,237,0.12)]"
          : "border-border bg-white shadow-sm hover:shadow-md"
      }`}
    >
      {plan.accent && (
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }}
        />
      )}

      {(plan.badgeKey || isCurrent) && (
        <div className="absolute right-4 top-4 flex gap-2">
          {plan.badgeKey && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
              <Sparkles className="size-2.5" />
              {t(`badge.${plan.badgeKey}`)}
            </span>
          )}
          {isCurrent && (
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              {t("badge.yourPlan")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3 className="font-display text-xl font-bold text-foreground mb-1">
            {t(`names.${plan.id}`)}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t(`cards.${plan.id}.tagline`)}
          </p>
        </div>

        <div className="mb-6 pb-6 border-b border-border">
          <div className="flex items-baseline gap-1">
            <span
              className={`font-display text-5xl font-extrabold tabular-nums ${plan.accent ? "text-primary" : "text-foreground"}`}
            >
              {plan.price}
            </span>
            {plan.period ? (
              <span className="text-base text-muted-foreground">{plan.period}</span>
            ) : (
              <span className="text-base text-muted-foreground">€</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(`cards.${plan.id}.clips`)}
            </span>
            <span className="text-[11px] text-muted-foreground/60">·</span>
            <span className="text-[11px] text-muted-foreground">
              {t(`cards.${plan.id}.quota`)}
            </span>
          </div>
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${plan.accent ? "bg-primary/15" : "bg-muted"}`}
              >
                <Check
                  className={`size-2.5 ${plan.accent ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={3}
                />
              </div>
              <span className="text-sm text-foreground leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href={plan.href}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            plan.accent
              ? "bg-primary text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] hover:bg-primary/90 hover:shadow-[0_4px_16px_rgba(124,58,237,0.45)] active:scale-[0.98]"
              : "bg-muted text-foreground hover:bg-muted/80 border border-border hover:border-primary/20"
          }`}
        >
          {t(`cards.${plan.id}.cta`)}
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
  { featureKey: "earlyAccess", free: false, creator: false, studio: true },
] as const;

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="size-4 text-primary mx-auto" strokeWidth={2.5} />
    ) : (
      <span className="text-muted-foreground/40">—</span>
    );
  }
  return <span className="text-xs font-medium text-foreground">{value}</span>;
}

export default function PlansPage() {
  const { profile } = useProfile();
  const t = useTranslations("plans");

  return (
    <AppShell activeItem="accueil">
      <main className="flex-1 px-6 py-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              {t("page.heroBadge")}
            </div>
            <h1 className="font-display text-4xl font-extrabold text-foreground sm:text-5xl mb-4">
              {(() => {
                const affordable = t("page.affordable");
                const full = t("page.heroTitle", { affordable });
                const prefix = full.slice(0, full.lastIndexOf(affordable));
                return (
                  <>
                    {prefix}
                    <span className="text-primary">{affordable}</span>
                  </>
                );
              })()}
            </h1>
            <p className="mx-auto max-w-lg text-sm text-muted-foreground leading-relaxed">
              {t("page.heroSubtitle")}
            </p>
          </div>

          <div className="mb-16 grid gap-5 md:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} currentPlan={profile?.plan ?? null} />
            ))}
          </div>

          <section className="mb-14 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="border-b border-border px-6 py-5">
              <h2 className="font-display text-lg font-bold text-foreground">
                {t("page.comparisonTitle")}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("page.comparisonSubtitle")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("page.tableFeature")}
                    </th>
                    <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("names.free")}
                    </th>
                    <th className="bg-primary/5 p-4 text-center text-xs font-semibold uppercase tracking-wider text-primary">
                      {t("names.creator")}
                    </th>
                    <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("names.studio")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-4 text-sm text-foreground">
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
                      <td className="bg-primary/5 p-4 text-center">
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

          {profile && (
            <div className="rounded-2xl border border-border bg-white px-8 py-6 text-center shadow-sm">
              <p className="text-sm text-muted-foreground mb-3">{t("page.promoHint")}</p>
              <Link
                href="/parametres?tab=plan"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {t("page.goToSettings")}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
