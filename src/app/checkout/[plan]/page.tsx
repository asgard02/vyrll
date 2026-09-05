"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Lock,
  RefreshCw,
  Receipt,
  Zap,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useProfile } from "@/lib/profile-context";
import { STRIPE_PLAN_PRICES_EUR } from "@/lib/stripe-plans";

const PLAN_KEYS = ["creator", "studio"] as const;
type PlanKey = (typeof PLAN_KEYS)[number];

const PLAN_META: Record<
  PlanKey,
  { price: number; color: string; badgeKey: "popular" | null }
> = {
  creator: { price: STRIPE_PLAN_PRICES_EUR.creator, color: "text-primary", badgeKey: "popular" },
  studio: { price: STRIPE_PLAN_PRICES_EUR.studio, color: "text-foreground", badgeKey: null },
};

const TRUST_KEYS = [
  { icon: Lock, labelKey: "trustSecure", subKey: "trustSecureSub" },
  { icon: RefreshCw, labelKey: "trustCancel", subKey: "trustCancelSub" },
  { icon: Receipt, labelKey: "trustVat", subKey: "trustVatSub" },
] as const;

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: planKey } = use(params);
  const { profile } = useProfile();
  const t = useTranslations("plans.checkout");
  const tNames = useTranslations("plans.names");
  const tCards = useTranslations("plans.cards");
  const tBadge = useTranslations("plans.badge");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = PLAN_META[planKey as PlanKey];
  const stripeReady = Boolean(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
  );

  if (!meta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{t("notFound")}</p>
          <Link href="/plans" className="text-sm text-primary hover:text-primary/80">
            {t("seePlans")}
          </Link>
        </div>
      </div>
    );
  }

  const planName = tNames(planKey as PlanKey);
  const features = t.raw(`${planKey}Features`) as string[];
  const included = t(`${planKey}Included`);
  const tagline = tCards(`${planKey}.tagline`);
  const clips = tCards(`${planKey}.clips`);
  const quota = tCards(`${planKey}.quota`);
  const alreadyOnPlan = profile?.plan === planKey;

  async function startCheckout() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        setError(
          typeof data?.error === "string" ? data.error : t("paymentError")
        );
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError(t("paymentError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/plans"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("backToPlans")}
          </Link>
          <img src="/logo.svg" alt="Upcut" className="size-7" />
          <div className="w-24" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
          <div className="space-y-8">
            <div>
              <div className="mb-3 flex items-center gap-2">
                {meta.badgeKey && (
                  <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-white">
                    {tBadge(meta.badgeKey)}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  {t("planLabel", { name: planName })}
                </span>
              </div>
              <h1 className="text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.025em] text-foreground">
                {t("upgradeTitle", { name: "" }).replace("{name}", "").trimEnd()}{" "}
                <span className="text-primary">{planName}</span>
              </h1>
              <p className="mt-2 text-[15px] text-muted-foreground">{tagline}</p>
            </div>

            <div className="rounded-2xl border border-border bg-background p-6">
              <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("includedSection")}
              </p>
              <ul className="space-y-3 text-[14px] text-muted-foreground">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-border pt-4">
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Zap className="size-3.5 text-primary" />
                  {included}
                </p>
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
              {TRUST_KEYS.map(({ icon: Icon, labelKey, subKey }) => (
                <div
                  key={labelKey}
                  className="flex items-start gap-3 bg-background p-4"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{t(labelKey)}</p>
                    <p className="text-[12px] text-muted-foreground">{t(subKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-2xl border border-border bg-background p-6">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("summary")}
              </p>
              <h2 className="text-[17px] font-medium text-foreground">
                {t("planLabel", { name: planName })}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{tagline}</p>

              <div className="mt-6 space-y-2 border-t border-border pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("planLabel", { name: planName })}
                  </span>
                  <span className="font-medium text-foreground">
                    {meta.price} €/mois
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("vat")}</span>
                  <span className="text-muted-foreground">{t("vatIncluded")}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
                  <span className="text-foreground">Total</span>
                  <div className="text-right">
                    <span className="text-[22px] font-medium tracking-[-0.03em] text-foreground">{meta.price} €</span>
                    <span className="ml-1 text-xs font-normal text-muted-foreground">/mois</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-border px-4 py-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">{t("estimatedClips")}</span>
                  <span className="font-medium text-foreground">{clips}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">{t("videoQuota")}</span>
                  <span className="font-medium text-foreground">{quota}</span>
                </div>
              </div>

              <div className="mt-6">
                {alreadyOnPlan ? (
                  <div className="rounded-full border border-border py-3 text-center">
                    <p className="text-sm font-medium text-muted-foreground">{t("alreadyOnPlan")}</p>
                  </div>
                ) : stripeReady ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={startCheckout}
                      disabled={loading || !profile}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Lock className="size-3.5" />
                      )}
                      {t("pay", { price: meta.price })}
                    </button>
                    {!profile && (
                      <p className="text-center text-[11px] text-muted-foreground">
                        <Link href="/login" className="text-primary hover:underline">
                          {t("loginRequired")}
                        </Link>
                      </p>
                    )}
                    {error && (
                      <p className="text-center text-[12px] text-destructive">{error}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border bg-muted text-[14px] font-medium text-muted-foreground">
                      <Lock className="size-3.5" />
                      {t("paymentSoon")}
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                      {t("stripeConfig")}
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-4 text-center text-[11px] text-muted-foreground">
                {t("footerNote")}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
