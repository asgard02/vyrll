"use client";

import Link from "next/link";
import {
  ArrowRight,
  Frame,
  Layers,
  Rocket,
  Smartphone,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useProfile } from "@/lib/profile-context";
import { PLAN_CLIP_QUOTA_LEAD } from "@/lib/plan";
const PLANS = [
  {
    id: "free" as const,
    name: "Gratuit",
    tagline: "Pour tester → 3 clips pour découvrir",
    quotaSecondary: "(30 min de quota)",
    price: "0€",
    period: "",
    features: [
      { text: PLAN_CLIP_QUOTA_LEAD.free, icon: Sparkles },
      { text: "Clips 9:16 & 1:1 avec sous-titres IA", icon: Smartphone },
      { text: "Score viral par clip", icon: TrendingUp },
      { text: "Formats prêts pour TikTok / Reels / Shorts", icon: Frame },
    ],
    cta: "Tester gratuitement",
    href: "/register",
    accent: false,
  },
  {
    id: "creator" as const,
    name: "Creator",
    tagline: "Pour les créateurs sérieux → ~20 clips prêts à poster par mois",
    quotaSecondary: "(2h30 de quota / mois)",
    price: "9",
    period: "€/mois",
    features: [
      { text: PLAN_CLIP_QUOTA_LEAD.creator, icon: Sparkles },
      { text: "Tout du plan Gratuit", icon: Layers },
    ],
    cta: "Passer Creator",
    href: "/parametres?tab=plan",
    accent: true,
  },
  {
    id: "studio" as const,
    name: "Studio",
    tagline: "T'as plus d'excuses → ~60 clips prêts à poster par mois",
    quotaSecondary: "(6h40 de quota / mois)",
    price: "29",
    period: "€/mois",
    features: [
      { text: PLAN_CLIP_QUOTA_LEAD.studio, icon: Sparkles },
      { text: "Tout du plan Creator", icon: Layers },
      { text: "Tu testes avant tout le monde", icon: Rocket },
    ],
    cta: "Passer Studio",
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
          ? "bg-[#9b6dff]/5 border-[#9b6dff]/40"
          : "bg-[#0c0c0e] border-[#0f0f12]"
      }`}
      style={
        plan.accent
          ? { boxShadow: "inset 0 2px 0 0 rgba(155, 109, 255, 0.4)" }
          : undefined
      }
    >
      {isCurrent && (
        <span className="absolute top-4 right-4 font-mono text-[10px] font-bold tracking-wider px-2 py-1 rounded bg-accent-gradient text-[#080809] border border-[#9b6dff]/40">
          TON PLAN
        </span>
      )}

      <div className="mb-6">
        <h3 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white mb-1">
          {plan.name}
        </h3>
        <p className="font-mono text-sm text-zinc-500 leading-relaxed">{plan.tagline}</p>
      </div>

      <div className="mb-8">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-4xl font-bold text-[#9b6dff]">
            {plan.price}
          </span>
          <span className="font-mono text-lg text-zinc-500">{plan.period}</span>
        </div>
        <p className="font-mono text-xs text-zinc-600 mt-1.5">{plan.quotaSecondary}</p>
      </div>

      <ul className="space-y-4 flex-1 mb-8">
        {plan.features.map((f, i) => {
          const Icon = f.icon;
          return (
            <li
              key={i}
              className="flex items-start gap-3 font-mono text-sm text-zinc-300"
            >
              <Icon className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
              {f.text}
            </li>
          );
        })}
      </ul>

      <Link
        href={plan.href}
        className={`w-full py-3.5 rounded-xl font-mono text-sm font-bold text-center transition-all flex items-center justify-center gap-2 ${
          plan.accent
            ? "bg-accent-gradient text-[#080809] hover:opacity-90"
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
            <div className="text-center mb-16">
              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-4xl sm:text-5xl text-white mb-3">
                Découvrir les plans
              </h1>
              <p className="font-mono text-zinc-500 max-w-xl mx-auto text-sm leading-relaxed">
                Estimation indicative (~20 min de vidéo source, ~3 clips par lancement). Le quota technique est rappelé
                sous le prix de chaque offre.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mb-16">
              {PLANS.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  currentPlan={profile?.plan ?? null}
                />
              ))}
            </div>

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
                      <th className="text-center p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider bg-[#9b6dff]/5">
                        Creator
                      </th>
                      <th className="text-center p-4 font-mono text-xs text-zinc-500 uppercase tracking-wider">
                        Studio
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-sm">
                    {[
                      ["Clips 9:16 & 1:1", "✓", "✓", "✓"],
                      ["Sous-titres IA", "✓", "✓", "✓"],
                      ["Score viral par clip", "✓", "✓", "✓"],
                      ["Crédits vidéo source (min.)", "30 à vie", "150 / mois", "400 / mois"],
                      ["Nouveautés en avant-première", "—", "—", "✓"],
                    ].map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-[#0f0f12]/50 hover:bg-[#0d0d0f]/50"
                      >
                        <td className="p-4 text-zinc-300">{row[0]}</td>
                        <td className="p-4 text-center text-zinc-500">{row[1]}</td>
                        <td className="p-4 text-center bg-[#9b6dff]/5">
                          <span
                            className={row[2] === "✓" ? "text-[#9b6dff]" : "text-zinc-500"}
                          >
                            {row[2]}
                          </span>
                        </td>
                        <td className="p-4 text-center text-zinc-500">
                          <span
                            className={
                              row[3] === "✓" || row[3] === "Illimitées"
                                ? "text-[#9b6dff]"
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

            {profile && (
              <section className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] p-8 text-center">
                <p className="font-mono text-sm text-zinc-500 mb-4">
                  Tu as un code promo ? Active-le dans tes paramètres.
                </p>
                <Link
                  href="/parametres?tab=plan"
                  className="inline-flex items-center gap-2 font-mono text-sm font-medium text-[#9b6dff] hover:text-[#9b6dff]/80 transition-colors"
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
