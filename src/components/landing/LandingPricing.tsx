"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { BillingIntervalToggle } from "@/components/plans/BillingIntervalToggle";
import { studioVsCreatorFactorLabel } from "@/lib/plan";
import {
  chargedPriceEur,
  formatPlanPriceEur,
  monthlyEquivalentEur,
  STRIPE_PLAN_PRICES_EUR,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/stripe-plans";

type PlanId = "free" | PaidPlanId;

export function LandingPricing({ tone = "light" }: { tone?: "light" | "ink" }) {
  const t = useTranslations("landing");
  const tPlans = useTranslations("plans");
  const tBilling = useTranslations("plans.billing");
  const locale = useLocale();
  const studioFactor = studioVsCreatorFactorLabel(locale);
  const ink = tone === "ink";
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [active, setActive] = useState<PlanId>("creator");
  const yearly = interval === "year";
  const features = t.raw("pricing.features") as string[];

  const cards: {
    id: PlanId;
    features: string[];
    href: string;
  }[] = [
    {
      id: "free",
      features: [tPlans("clipQuotaLead.free"), t("pricing.free.clipsPerVideo"), ...features],
      href: "/register",
    },
    {
      id: "creator",
      features: [tPlans("clipQuotaLead.creator"), t("pricing.creator.clipsPerVideo"), ...features],
      href: "/register",
    },
    {
      id: "studio",
      features: [
        tPlans("clipQuotaLead.studio"),
        t("pricing.studio.clipsPerVideo"),
        ...features.slice(0, 3),
        t("pricing.studioFeature"),
      ],
      href: "/register",
    },
  ];

  return (
    <section
      id="tarifs"
      className={`scroll-mt-24 border-t px-6 py-24 ${ink ? "border-white/10" : "border-[#e5e5e7]"}`}
      onMouseLeave={() => setActive("creator")}
    >
      <div className="mx-auto max-w-[980px]">
        <div className="mb-8 text-center">
          <span
            className={`inline-flex items-center rounded-full px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] ${
              ink
                ? "border border-white/15 bg-white/8 text-[#c4b5fd]"
                : "border border-[#6d28d9]/15 bg-[#f3eefc] text-[#5b21b6]"
            }`}
          >
            {t("pricing.eyebrow")}
          </span>
          <h2
            className={`mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em] ${
              ink ? "text-white" : ""
            }`}
          >
            {t("pricing.title")}
          </h2>
          <p className={`mt-3 text-sm ${ink ? "text-white/50" : "text-[#1d1d1f]/50"}`}>
            {t("pricing.subtitle")}
          </p>
        </div>

        <div className="mb-8 flex justify-center">
          <BillingIntervalToggle
            value={interval}
            onChange={(offer) => {
              if (offer === "month" || offer === "year") setInterval(offer);
            }}
            variant={ink ? "cut" : "marketing"}
          />
        </div>

        <div className="grid items-stretch gap-5 md:grid-cols-3">
          {cards.map((card) => {
            const focused = active === card.id;
            const paid = card.id === "creator" || card.id === "studio" ? card.id : null;
            const price = paid
              ? `${formatPlanPriceEur(monthlyEquivalentEur(paid, interval), locale)}€`
              : t("pricing.free.price");
            const list = paid ? `${formatPlanPriceEur(STRIPE_PLAN_PRICES_EUR[paid], locale)}€` : "";
            return (
              <article
                key={card.id}
                onMouseEnter={() => setActive(card.id)}
                onFocus={() => setActive(card.id)}
                className={`flex flex-col rounded-[28px] border-2 p-8 transition duration-300 ease-out motion-safe:will-change-transform ${
                  focused
                    ? ink
                      ? "z-10 -translate-y-2 border-[#6d28d9] bg-white/[0.06] shadow-[0_22px_50px_-24px_rgba(109,40,217,0.65)]"
                      : "z-10 -translate-y-2 border-[#6d28d9] bg-white shadow-[0_22px_50px_-24px_rgba(109,40,217,0.45)]"
                    : ink
                      ? "border-white/12 bg-white/[0.03] text-white"
                      : "border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)]"
                } ${ink ? "text-white" : ""}`}
              >
                <div className="mb-6 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">
                      {t(`pricing.${card.id}.name`)}
                    </h3>
                    <p className={`text-sm ${ink ? "text-white/50" : "text-[#1d1d1f]/50"}`}>
                      {t(`pricing.${card.id}.tagline`)}
                    </p>
                  </div>
                  {card.id === "creator" ? (
                    <span className="shrink-0 rounded-full bg-[#6d28d9] px-2.5 py-1 text-[11px] font-semibold text-white">
                      {t("pricing.creator.popular")}
                    </span>
                  ) : null}
                  {card.id === "studio" ? (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        ink
                          ? "border border-white/20 text-white/80"
                          : "bg-[#f3eefc] text-[#6d28d9] ring-1 ring-[#6d28d9]/20"
                      }`}
                    >
                      {t("pricing.studio.multiplierBadge")}
                    </span>
                  ) : null}
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span
                      key={`${card.id}-${interval}`}
                      className={`text-4xl font-bold motion-safe:animate-[price-swap_0.32s_cubic-bezier(0.16,1,0.3,1)_both] ${
                        card.id === "creator" ? "text-[#6d28d9]" : ""
                      }`}
                    >
                      {price}
                    </span>
                    {paid ? (
                      <span className={`text-sm ${ink ? "text-white/50" : "text-[#1d1d1f]/50"}`}>
                        {t(`pricing.${card.id}.perMonth`)}
                      </span>
                    ) : null}
                  </div>
                  <p className={`mt-1.5 text-xs ${ink ? "text-white/50" : "text-[#1d1d1f]/50"}`}>
                    {t(`pricing.${card.id}.quota`)}
                  </p>
                  {yearly && paid ? (
                    <p className={`mt-1 text-xs ${ink ? "text-white/45" : "text-[#1d1d1f]/45"}`}>
                      <span className="line-through">{list}</span>
                      {" · "}
                      {tBilling("billedYearly", {
                        price: formatPlanPriceEur(chargedPriceEur(paid, "year"), locale),
                      })}
                    </p>
                  ) : null}
                  {card.id === "studio" ? (
                    <p className="mt-1 text-xs font-semibold text-[#6d28d9]">
                      {tPlans("badge.studioVsCreator", { factor: studioFactor })}
                    </p>
                  ) : null}
                </div>

                <ul className={`mb-8 flex-1 space-y-2.5 text-sm ${ink ? "text-white/55" : "text-[#1d1d1f]/60"}`}>
                  {card.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#6d28d9]" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={card.href}
                  prefetch
                  className={`block w-full rounded-full py-3 text-center text-sm transition-colors ${
                    focused && card.id !== "free"
                      ? "bg-[#6d28d9] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-[#5b21b6]"
                      : ink
                        ? "border border-white/25 font-medium text-white hover:bg-white/8"
                        : "border border-[#d2d2d7] font-medium hover:bg-[#f5f5f7]"
                  }`}
                >
                  {t(`pricing.${card.id}.cta`)}
                </Link>
              </article>
            );
          })}
        </div>

        <p className="mt-10 text-center">
          <Link
            href="/plans"
            prefetch
            className="inline-flex items-center gap-1 text-sm text-[#6d28d9] transition-colors hover:text-[#5b21b6]"
          >
            {t("pricing.compare")} <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </div>
    </section>
  );
}
