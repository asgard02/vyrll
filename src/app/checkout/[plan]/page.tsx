"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Lock,
  RefreshCw,
  Receipt,
  Sparkles,
  Zap,
  ExternalLink,
} from "lucide-react";
import { useProfile } from "@/lib/profile-context";

// ── À remplacer par vos URLs Lemon Squeezy ──────────────────────────────────
const LS_CHECKOUT_URLS: Record<string, string> = {
  creator: process.env.NEXT_PUBLIC_LS_CREATOR_URL ?? "",
  studio: process.env.NEXT_PUBLIC_LS_STUDIO_URL ?? "",
};
// ────────────────────────────────────────────────────────────────────────────

const PLANS = {
  creator: {
    name: "Creator",
    price: 14,
    period: "mois",
    tagline: "Pour les créateurs qui publient régulièrement",
    clips: "~20 clips / mois",
    quota: "2h30 de quota / mois",
    color: "text-primary",
    badge: "Populaire",
    features: [
      "~20 clips générés par mois",
      "Clips 9:16 & 1:1 avec sous-titres IA",
      "Score viral par clip",
      "Formats prêts TikTok / Reels / Shorts",
      "Priorité de traitement",
    ],
    included: "Tout du plan Gratuit inclus",
  },
  studio: {
    name: "Studio",
    price: 29,
    period: "mois",
    tagline: "Pour les agences et power users",
    clips: "~60 clips / mois",
    quota: "6h40 de quota / mois",
    color: "text-foreground",
    badge: null,
    features: [
      "~60 clips générés par mois",
      "Clips 9:16 & 1:1 avec sous-titres IA",
      "Score viral par clip",
      "Formats prêts TikTok / Reels / Shorts",
      "Priorité de traitement",
      "Accès aux nouvelles fonctions en avant-première",
    ],
    included: "Tout du plan Creator inclus",
  },
} as const;

type PlanKey = keyof typeof PLANS;

const TRUST_ITEMS = [
  { icon: Lock, label: "Paiement sécurisé", sub: "Crypté SSL via Lemon Squeezy" },
  { icon: RefreshCw, label: "Résiliation libre", sub: "Annulable à tout moment" },
  { icon: Receipt, label: "TVA incluse", sub: "Facture émise automatiquement" },
];

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: planKey } = use(params);
  const { profile } = useProfile();
  const plan = PLANS[planKey as PlanKey];
  const checkoutUrl = LS_CHECKOUT_URLS[planKey] ?? "";

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa]">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">Plan introuvable.</p>
          <Link href="/plans" className="text-sm text-primary hover:text-primary/80">
            Voir les plans →
          </Link>
        </div>
      </div>
    );
  }

  const alreadyOnPlan = profile?.plan === planKey;

  return (
    <div className="relative min-h-screen bg-[#fafafa] overflow-hidden">
      {/* Background blobs */}
      <div
        className="pointer-events-none absolute -top-40 -right-40 size-[600px] rounded-full opacity-[0.06]"
        style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-20 size-[400px] rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #6366f1, transparent 70%)" }}
        aria-hidden
      />

      {/* Header */}
      <header className="border-b border-border bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/plans" className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />
            Retour aux plans
          </Link>
          <img src="/logo.svg" alt="Vyrll" className="size-7" />
          <div className="w-24" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">

          {/* ── Left : plan details ── */}
          <div className="space-y-8">
            {/* Title */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                {plan.badge && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
                    <Sparkles className="size-2.5" />
                    {plan.badge}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">Plan {plan.name}</span>
              </div>
              <h1 className="font-display text-3xl font-extrabold text-foreground sm:text-4xl">
                Passer à{" "}
                <span className="text-primary">{plan.name}</span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
            </div>

            {/* What you get */}
            <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Ce qui est inclus
              </p>
              <ul className="space-y-3">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <Check className="size-2.5 text-primary" strokeWidth={3} />
                    </div>
                    <span className="text-sm text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-border pt-4">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap className="size-3.5 text-primary" />
                  {plan.included}
                </p>
              </div>
            </div>

            {/* Trust signals */}
            <div className="grid gap-4 sm:grid-cols-3">
              {TRUST_ITEMS.map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex items-start gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right : summary + CTA ── */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-white shadow-[0_4px_24px_rgba(124,58,237,0.1)]">
              {/* Top gradient bar */}
              <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }} />

              <div className="p-6">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Résumé
                </p>
                <h2 className="font-display text-xl font-bold text-foreground">Plan {plan.name}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{plan.tagline}</p>

                {/* Price breakdown */}
                <div className="mt-6 space-y-2 border-t border-border pt-5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Plan {plan.name}</span>
                    <span className="font-medium text-foreground">{plan.price} €/mois</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">TVA</span>
                    <span className="text-muted-foreground">Incluse</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-bold">
                    <span className="text-foreground">Total</span>
                    <div className="text-right">
                      <span className="text-lg text-primary">{plan.price} €</span>
                      <span className="ml-1 text-xs font-normal text-muted-foreground">/mois</span>
                    </div>
                  </div>
                </div>

                {/* Quota info */}
                <div className="mt-4 rounded-xl bg-muted/50 px-4 py-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Clips estimés</span>
                    <span className="font-semibold text-foreground">{plan.clips}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Quota vidéo</span>
                    <span className="font-semibold text-foreground">{plan.quota}</span>
                  </div>
                </div>

                {/* CTA */}
                <div className="mt-6">
                  {alreadyOnPlan ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 py-3 text-center">
                      <p className="text-sm font-semibold text-primary">Tu es déjà sur ce plan</p>
                    </div>
                  ) : checkoutUrl ? (
                    <a
                      href={`${checkoutUrl}${profile?.email ? `?checkout[email]=${encodeURIComponent(profile.email)}` : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-[0_2px_12px_rgba(124,58,237,0.4)] transition-all hover:bg-primary/90 hover:shadow-[0_4px_20px_rgba(124,58,237,0.5)] active:scale-[0.98]"
                    >
                      <Lock className="size-3.5" />
                      Payer {plan.price} €/mois
                      <ExternalLink className="size-3.5 opacity-70" />
                    </a>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-muted py-3.5 text-sm font-bold text-muted-foreground">
                        <Lock className="size-3.5" />
                        Paiement bientôt disponible
                      </div>
                      <p className="text-center text-[11px] text-muted-foreground">
                        Lemon Squeezy en cours de configuration
                      </p>
                    </div>
                  )}
                </div>

                <p className="mt-4 text-center text-[11px] text-muted-foreground">
                  Résiliation en un clic · Sans engagement · TVA incluse
                </p>
              </div>
            </div>

            {/* Already have a code */}
            <div className="mt-4 rounded-xl border border-border bg-white px-4 py-3 text-center shadow-sm">
              <p className="text-[12px] text-muted-foreground">
                Tu as un code promo ?{" "}
                <Link href="/parametres?tab=plan" className="font-medium text-primary hover:text-primary/80">
                  L&apos;activer ici
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
