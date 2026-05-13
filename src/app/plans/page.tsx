"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useProfile } from "@/lib/profile-context";

const PLANS = [
  {
    id: "free" as const,
    name: "Gratuit",
    tagline: "Pour tester l'outil et voir ce que ça donne",
    price: "0",
    period: "",
    quota: "30 min de quota à vie",
    clips: "~3 clips",
    badge: null as string | null,
    features: [
      "~3 clips à vie",
      "Clips 9:16 & 1:1",
      "Sous-titres générés par IA",
      "Score viral par clip",
      "Formats prêts TikTok / Reels / Shorts",
    ],
    cta: "Commencer gratuitement",
    href: "/register",
    accent: false,
  },
  {
    id: "creator" as const,
    name: "Creator",
    tagline: "Pour les créateurs qui publient régulièrement",
    price: "14",
    period: "€/mois",
    quota: "2h30 de quota / mois",
    clips: "~20 clips / mois",
    badge: "Populaire" as string | null,
    features: [
      "~20 clips / mois",
      "Tout du plan Gratuit",
      "Priorité de traitement",
    ],
    cta: "Passer Creator",
    href: "/checkout/creator",
    accent: true,
  },
  {
    id: "studio" as const,
    name: "Studio",
    tagline: "Pour les agences et power users",
    price: "29",
    period: "€/mois",
    quota: "6h40 de quota / mois",
    clips: "~60 clips / mois",
    badge: null as string | null,
    features: [
      "~60 clips / mois",
      "Tout du plan Creator",
      "Accès aux nouvelles fonctions en avant-première",
    ],
    cta: "Passer Studio",
    href: "/checkout/studio",
    accent: false,
  },
];

function PlanCard({
  plan,
  currentPlan,
}: {
  plan: (typeof PLANS)[number];
  currentPlan: string | null;
}) {
  const isCurrent = currentPlan === plan.id;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border transition-shadow ${
        plan.accent
          ? "border-primary/30 bg-white shadow-[0_0_0_1px_rgba(124,58,237,0.15),0_8px_32px_rgba(124,58,237,0.12)]"
          : "border-border bg-white shadow-sm hover:shadow-md"
      }`}
    >
      {/* Top accent bar on featured plan */}
      {plan.accent && (
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }}
        />
      )}

      {/* Badge */}
      {(plan.badge || isCurrent) && (
        <div className="absolute right-4 top-4 flex gap-2">
          {plan.badge && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
              <Sparkles className="size-2.5" />
              {plan.badge}
            </span>
          )}
          {isCurrent && !plan.badge && (
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              Ton plan
            </span>
          )}
          {isCurrent && plan.badge && (
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              Ton plan
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-7">
        {/* Header */}
        <div className="mb-6">
          <h3 className="font-display text-xl font-bold text-foreground mb-1">{plan.name}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{plan.tagline}</p>
        </div>

        {/* Price */}
        <div className="mb-6 pb-6 border-b border-border">
          <div className="flex items-baseline gap-1">
            <span className={`font-display text-5xl font-extrabold tabular-nums ${plan.accent ? "text-primary" : "text-foreground"}`}>
              {plan.price}
            </span>
            {plan.period && (
              <span className="text-base text-muted-foreground">{plan.period}</span>
            )}
            {!plan.period && (
              <span className="text-base text-muted-foreground">€</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {plan.clips}
            </span>
            <span className="text-[11px] text-muted-foreground/60">·</span>
            <span className="text-[11px] text-muted-foreground">{plan.quota}</span>
          </div>
        </div>

        {/* Features */}
        <ul className="mb-8 flex-1 space-y-3">
          {plan.features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${plan.accent ? "bg-primary/15" : "bg-muted"}`}>
                <Check className={`size-2.5 ${plan.accent ? "text-primary" : "text-muted-foreground"}`} strokeWidth={3} />
              </div>
              <span className="text-sm text-foreground leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <Link
          href={plan.href}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all ${
            plan.accent
              ? "bg-primary text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] hover:bg-primary/90 hover:shadow-[0_4px_16px_rgba(124,58,237,0.45)] active:scale-[0.98]"
              : "bg-muted text-foreground hover:bg-muted/80 border border-border hover:border-primary/20"
          }`}
        >
          {plan.cta}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

const COMPARISON_ROWS = [
  { feature: "Clips 9:16 & 1:1", free: true, creator: true, studio: true },
  { feature: "Sous-titres IA", free: true, creator: true, studio: true },
  { feature: "Score viral par clip", free: true, creator: true, studio: true },
  { feature: "Formats TikTok / Reels / Shorts", free: true, creator: true, studio: true },
  { feature: "Quota source (min)", free: "30 à vie", creator: "150 / mois", studio: "400 / mois" },
  { feature: "Priorité de traitement", free: false, creator: true, studio: true },
  { feature: "Accès early features", free: false, creator: false, studio: true },
];

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

  return (
    <AppShell activeItem="accueil">
      <main className="flex-1 px-6 py-14">
        <div className="mx-auto max-w-5xl">

          {/* Hero */}
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              Sans frais cachés
            </div>
            <h1 className="font-display text-4xl font-extrabold text-foreground sm:text-5xl mb-4">
              Simple, transparent,{" "}
              <span className="text-primary">abordable</span>
            </h1>
            <p className="mx-auto max-w-lg text-sm text-muted-foreground leading-relaxed">
              Tous les plans incluent les sous-titres IA, le score viral et les formats
              prêts à poster — sans frais cachés.
            </p>
          </div>

          {/* Plans grid */}
          <div className="mb-16 grid gap-5 md:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} currentPlan={profile?.plan ?? null} />
            ))}
          </div>

          {/* Feature comparison table */}
          <section className="mb-14 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="border-b border-border px-6 py-5">
              <h2 className="font-display text-lg font-bold text-foreground">Comparaison détaillée</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Tout ce qui est inclus dans chaque plan</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fonctionnalité</th>
                    <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gratuit</th>
                    <th className="bg-primary/5 p-4 text-center text-xs font-semibold uppercase tracking-wider text-primary">Creator</th>
                    <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Studio</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="p-4 text-sm text-foreground">{row.feature}</td>
                      <td className="p-4 text-center"><Cell value={row.free} /></td>
                      <td className="bg-primary/5 p-4 text-center"><Cell value={row.creator} /></td>
                      <td className="p-4 text-center"><Cell value={row.studio} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Code promo */}
          {profile && (
            <div className="rounded-2xl border border-border bg-white px-8 py-6 text-center shadow-sm">
              <p className="text-sm text-muted-foreground mb-3">
                Tu as un code promo ? Active-le dans tes paramètres.
              </p>
              <Link
                href="/parametres?tab=plan"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Aller aux paramètres
                <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
