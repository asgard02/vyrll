"use client";

import { ArrowRight, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  ENTERPRISE_CLIPS_PER_MONTH,
  ENTERPRISE_CONTACT_EMAIL,
  STRIPE_ENTERPRISE_PRICE_EUR,
  formatPlanPriceEur,
} from "@/lib/stripe-plans";

export function EnterprisePlanBlock({
  variant = "marketing",
  layout = "card",
}: {
  variant?: "marketing" | "app";
  layout?: "card" | "embedded";
}) {
  const t = useTranslations("plans");
  const locale = useLocale();
  const app = variant === "app";
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
          ? app
            ? "bg-background"
            : "bg-white"
          : app
            ? "rounded-2xl border border-primary/25 bg-card shadow-sm hover:border-primary/40"
            : "rounded-2xl border border-[#6d28d9]/25 bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_8px_24px_-10px_rgba(109,40,217,0.12)]"
      }`}
    >
      <div className="absolute right-4 top-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            app
              ? "bg-primary/10 text-primary ring-1 ring-primary/25"
              : "bg-[#f3eefc] text-[#6d28d9] ring-1 ring-[#6d28d9]/20"
          }`}
        >
          {t("badge.enterpriseVolume", { clips: ENTERPRISE_CLIPS_PER_MONTH })}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-7">
        <div className="mb-6">
          <h3
            className={`mb-1 font-[family-name:var(--font-syne)] text-xl font-bold ${
              app ? "text-foreground" : "text-[#1d1d1f]"
            }`}
          >
            {t("names.enterprise")}
          </h3>
          <p
            className={`text-sm leading-relaxed ${
              app ? "text-muted-foreground" : "text-[#1d1d1f]/55"
            }`}
          >
            {t("cards.enterprise.tagline")}
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
                app ? "text-foreground" : "text-[#1d1d1f]"
              }`}
            >
              {price}
            </span>
            <span
              className={`text-base ${
                app ? "text-muted-foreground" : "text-[#1d1d1f]/50"
              }`}
            >
              {t("page.perMonth")}
            </span>
          </div>
          <p
            className={`mt-2 text-[13px] font-medium ${
              app ? "text-foreground" : "text-[#1d1d1f]"
            }`}
          >
            {t("cards.enterprise.quota", { clips: ENTERPRISE_CLIPS_PER_MONTH })}
          </p>
        </div>

        <ul className="mb-8 flex-1 space-y-3">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  app ? "bg-primary/15" : "bg-[#6d28d9]/15"
                }`}
              >
                <Check
                  className={`size-2.5 ${app ? "text-primary" : "text-[#6d28d9]"}`}
                  strokeWidth={3}
                />
              </div>
              <span
                className={`text-sm leading-snug ${
                  app ? "text-foreground" : "text-[#1d1d1f]"
                }`}
              >
                {feature}
              </span>
            </li>
          ))}
        </ul>

        <a
          href={href}
          className={`mt-auto flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            app
              ? "border border-border bg-muted text-foreground hover:border-input"
              : "border border-[#e5e5e7] bg-[#f5f5f7] text-[#1d1d1f] hover:border-[#1d1d1f]/20"
          }`}
        >
          {t("cards.enterprise.cta")}
          <ArrowRight className="size-4" />
        </a>
      </div>
    </article>
  );
}
