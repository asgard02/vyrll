"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Zap,
  Sparkles,
  Infinity,
  FileText,
  Scissors,
  BarChart3,
  Target,
  Shield,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useProfile } from "@/lib/profile-context";

const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    tagline: "Pour tester",
    price: "0€",
    period: "",
    analyses: 3,
    features: [
      { text: "3 analyses / mois", icon: Zap },
      { text: "Score & verdict détaillé", icon: Target },
      { text: "Diagnostic ratio vues/abonnés", icon: BarChart3 },
      { text: "Titre optimisé par l'IA", icon: Sparkles },
      { text: "Description SEO améliorée", icon: FileText },
      { text: "Tags suggérés", icon: Sparkles },
      { text: "Quick wins concrets", icon: Zap },
      { text: "Conseils timing & thumbnail", icon: Target },
    ],
    cta: "Tester gratuitement",
    href: "/register",
    accent: false,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Pour les créateurs sérieux",
    price: "9",
    period: "€/mois",
    analyses: 50,
    features: [
      { text: "50 analyses / mois", icon: Zap },
      { text: "Tout du plan Gratuit", icon: Check },
      { text: "Historique complet & filtres", icon: BarChart3 },
      { text: "Audit SEO avancé", icon: FileText },
      { text: "Idée de prochaine vidéo", icon: Sparkles },
      { text: "Tips thumbnail détaillés", icon: Target },
      { text: "Export PDF & Markdown", icon: FileText },
      { text: "Analytics & évolution", icon: BarChart3 },
      { text: "Clips IA (bêta)", icon: Scissors },
      { text: "Support prioritaire", icon: Shield },
    ],
    cta: "Passer Pro",
    href: "/parametres?tab=plan",
    accent: true,
  },
  {
    id: "unlimited",
    name: "Unlimited",
    tagline: "T'as plus d'excuses",
    price: "29",
    period: "€/mois",
    analyses: 999,
    features: [
      { text: "Analyses illimitées", icon: Infinity },
      { text: "Tout du plan Pro", icon: Check },
      { text: "Export PDF & Markdown", icon: FileText },
      { text: "Clips IA (bêta)", icon: Scissors },
      { text: "Support prioritaire", icon: Shield },
      { text: "Accès early aux nouvelles features", icon: Sparkles },
    ],
    cta: "Unlimited",
    href: "/parametres?tab=plan",
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
      className={`relative rounded-2xl border p-8 flex flex-col ${
        plan.accent
          ? "bg-[#00ff88]/5 border-[#00ff88]/40"
          : "bg-[#0c0c0e] border-[#0f0f12]"
      }`}
      style={
        plan.accent
          ? { boxShadow: "inset 0 2px 0 0 rgba(0,255,136,0.5)" }
          : undefined
      }
    >
      {isCurrent && (
        <span className="absolute top-4 right-4 font-mono text-[10px] font-bold tracking-wider px-2 py-1 rounded bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/40">
          TON PLAN
        </span>
      )}

      <div className="mb-6">
        <h3 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white mb-1">
          {plan.name}
        </h3>
        <p className="font-mono text-sm text-zinc-500">{plan.tagline}</p>
      </div>

      <div className="flex items-baseline gap-1 mb-8">
        <span className="font-mono text-4xl font-bold text-[#00ff88]">
          {plan.price}
        </span>
        <span className="font-mono text-lg text-zinc-500">{plan.period}</span>
      </div>

      <ul className="space-y-4 flex-1 mb-8">
        {plan.features.map((f, i) => {
          const Icon = f.icon;
          return (
            <li
              key={i}
              className="flex items-start gap-3 font-mono text-sm text-zinc-300"
            >
              <Icon className="size-4 text-[#00ff88] shrink-0 mt-0.5" />
              {f.text}
            </li>
          );
        })}
      </ul>

      <Link
        href={plan.href}
        className={`w-full py-3.5 rounded-xl font-mono text-sm font-bold text-center transition-all flex items-center justify-center gap-2 ${
          plan.accent
            ? "bg-[#00ff88] text-[#080809] hover:bg-[#00ff88]/90"
            : "bg-[#1a1a1e] text-white border border-[#0f0f12] hover:border-[#1a1a1e] hover:bg-[#0d0d0f]"
        }`}
      >
        {plan.cta}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

export default function PlansPage() {
  const { profile } = useProfile();

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="accueil" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 px-6 py-12">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="text-center mb-16">
              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-4xl sm:text-5xl text-white mb-4">
                Découvrir les plans
              </h1>
              <p className="font-mono text-zinc-500 max-w-xl mx-auto">
                Choisis le plan qui correspond à ta cadence de publication.
                Analyse tes vidéos, optimise tes titres, booste tes vues.
              </p>
            </div>

            {/* Plan cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-16">
              {PLANS.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  currentPlan={profile?.plan ?? null}
                />
              ))}
            </div>

            {/* Comparaison détaillée */}
            <section className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden mb-16">
              <div className="p-6 border-b border-[#0f0f12]">
                <h2 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white">
                  Comparaison des fonctionnalités
                </h2>
                <p className="font-mono text-sm text-zinc-500 mt-1">
                  Tout ce qui est inclus dans chaque plan
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#0f0f12]">
                      <th className="text-left p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider">
                        Fonctionnalité
                      </th>
                      <th className="text-center p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider">
                        Gratuit
                      </th>
                      <th className="text-center p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider bg-[#00ff88]/5">
                        Pro
                      </th>
                      <th className="text-center p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider">
                        Unlimited
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-sm">
                    {[
                      ["Analyses / mois", "3", "50", "Illimité"],
                      ["Score & verdict", "✓", "✓", "✓"],
                      ["Titre optimisé IA", "✓", "✓", "✓"],
                      ["Description SEO", "✓", "✓", "✓"],
                      ["Tags suggérés", "✓", "✓", "✓"],
                      ["Quick wins", "✓", "✓", "✓"],
                      ["Historique & filtres", "—", "✓", "✓"],
                      ["Analytics", "—", "✓", "✓"],
                      ["Export PDF / Markdown", "—", "✓", "✓"],
                      ["Idée prochaine vidéo", "✓", "✓", "✓"],
                      ["Clips IA (bêta)", "—", "✓", "✓"],
                      ["Support prioritaire", "—", "✓", "✓"],
                    ].map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-[#0f0f12]/50 hover:bg-[#0d0d0f]/50"
                      >
                        <td className="p-4 text-zinc-300">{row[0]}</td>
                        <td className="p-4 text-center text-zinc-500">
                          {row[1]}
                        </td>
                        <td className="p-4 text-center bg-[#00ff88]/5">
                          <span
                            className={
                              row[2] === "✓"
                                ? "text-[#00ff88]"
                                : "text-zinc-500"
                            }
                          >
                            {row[2]}
                          </span>
                        </td>
                        <td className="p-4 text-center text-zinc-500">
                          <span
                            className={
                              row[3] === "✓" || row[3] === "Illimité"
                                ? "text-[#00ff88]"
                                : "text-zinc-500"
                            }
                          >
                            {row[3]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Code promo */}
            {profile && (
              <section className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] p-8 text-center">
                <p className="font-mono text-sm text-zinc-500 mb-4">
                  Tu as un code promo ? Active-le dans tes paramètres.
                </p>
                <Link
                  href="/parametres?tab=plan"
                  className="inline-flex items-center gap-2 font-mono text-sm font-medium text-[#00ff88] hover:text-[#00ff88]/80 transition-colors"
                >
                  Aller aux paramètres
                  <ArrowRight className="size-4" />
                </Link>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
