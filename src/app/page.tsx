import Link from "next/link";
import {
  Link2, Scissors, Sparkles, Download, Mic2, TrendingUp,
  Users, Briefcase, Check, Star, ArrowRight, Zap,
  type LucideIcon,
} from "lucide-react";
import { SiTiktok, SiYoutube, SiInstagram, SiSnapchat } from "react-icons/si";
import { PLAN_CLIP_QUOTA_LEAD } from "@/lib/plan";
import { StickyNav } from "@/components/landing/StickyNav";
import { HeroUrlForm, HeroCounter, PageAnimations } from "@/components/landing/HeroClient";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { LandingDemoVideo } from "@/components/landing/LandingDemoVideo";
import { PhoneArc } from "@/components/landing/PhoneArc";

// ── Data ──────────────────────────────────────────────────────────────────────

const BETA_CREATORS = [
  { name: "Théo", hue: "217" },
  { name: "Léa", hue: "280" },
  { name: "Karim", hue: "32" },
  { name: "Sarah", hue: "160" },
];

const TESTIMONIALS = [
  { name: "Théo M.", role: "Streamer · 12k abonnés", text: "En 10 minutes j'avais 3 clips prêts à poster. Je n'aurais jamais fait ça aussi vite à la main.", hue: "217" },
  { name: "Léa D.", role: "YouTubeuse · 48k abonnés", text: "Le recadrage auto est bluffant — le sujet reste toujours centré, même sur une VOD de 2h.", hue: "280" },
  { name: "Karim B.", role: "Coach sportif en ligne", text: "Je publie 5x plus sur TikTok depuis Upcut. Mes Reels ont explosé ce mois-ci.", hue: "32" },
];

const PAIN_ROWS: {
  num: string;
  title: string;
  desc: string;
  visual: "time" | "tools" | "reach";
}[] = [
  { num: "01", title: "1h30 pour un seul clip", desc: "Trouver le bon moment, couper, recadrer en 9:16, sous-titrer, exporter. Et recommencer pour le suivant.", visual: "time" },
  { num: "02", title: "Des outils faits pour les monteurs", desc: "Premiere, After Effects, CapCut… des heures d'apprentissage avant de sortir un clip propre.", visual: "tools" },
  { num: "03", title: "Publier moins, c'est toucher moins", desc: "L'algorithme récompense la régularité. Chaque semaine sans clips est une semaine de reach perdue.", visual: "reach" },
];

const TIME_BARS = [
  { w: "42%", label: "Trouver le moment", time: "15 min", d: "0ms", waveD: "4.2s", amp: "-3px" },
  { w: "62%", label: "Couper & recadrer", time: "25 min", d: "600ms", waveD: "4.8s", amp: "-4px" },
  { w: "72%", label: "Sous-titrer", time: "30 min", d: "1200ms", waveD: "5.4s", amp: "-4px" },
  { w: "34%", label: "Exporter", time: "10 min", d: "1800ms", waveD: "6s", amp: "-5px" },
];

const TOOL_CHIPS = [
  { label: "Premiere Pro", r: "-3deg", d: "0s" },
  { label: "Recadrage 9:16", r: "2deg", d: "-0.9s" },
  { label: "After Effects", r: "-1deg", d: "-1.8s" },
  { label: "Sous-titres", r: "3deg", d: "-2.7s" },
  { label: "CapCut", r: "-2deg", d: "-3.6s" },
  { label: "Encodage", r: "4deg", d: "-4.5s" },
  { label: "Timeline", r: "-3deg", d: "-5.4s" },
];

const REACH_BARS = [22, 28, 18, 26, 20, 24, 19, 23, 17, 25, 21, 27];

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Link2, title: "Colle l'URL", desc: "YouTube ou Twitch : VOD, replay ou long format." },
  { icon: Sparkles, title: "IA & montage", desc: "Moments forts, recadrage 9:16 / 1:1 et sous-titres animés." },
  { icon: Download, title: "Export", desc: "Télécharge et poste sur TikTok, Reels ou Shorts." },
];

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Scissors, title: "Recadrage 9:16 auto", desc: "Le sujet reste centré, même sur une VOD de 2h." },
  { icon: Mic2, title: "Sous-titres Whisper", desc: "Karaoké, Highlight, Minimal — intégrés dans le MP4." },
  { icon: TrendingUp, title: "Score viral", desc: "Chaque clip reçoit une note prédictive." },
  { icon: Zap, title: "Mode Auto ou Manuel", desc: "L'IA choisit, ou tu places le curseur toi-même." },
  { icon: Link2, title: "YouTube & Twitch", desc: "VODs, replays, vidéos longues — colle le lien." },
];

const POUR_QUI: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mic2, title: "Créateurs & streamers", text: "Tes lives et VOD deviennent des Shorts sans refaire un montage." },
  { icon: Users, title: "Podcasteurs", text: "Les meilleurs extraits parlés, recadrés et sous-titrés pour les réseaux." },
  { icon: TrendingUp, title: "Growth & social", text: "Plus de tests d'hooks, moins de temps en timeline." },
  { icon: Briefcase, title: "Petites agences", text: "Un flux simple : URL → clips livrables pour tes clients." },
];

const STATS = [
  { value: "2 847+", label: "clips générés cette semaine" },
  { value: "< 5 min", label: "temps de génération moyen" },
  { value: "5", label: "styles de sous-titres" },
  { value: "0€", label: "pour commencer" },
];

const PLATFORMS = [
  { name: "TikTok", Icon: SiTiktok },
  { name: "YouTube Shorts", Icon: SiYoutube },
  { name: "Instagram Reels", Icon: SiInstagram },
  { name: "Snapchat", Icon: SiSnapchat },
];

// ── Blocs ─────────────────────────────────────────────────────────────────────

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-key">
      {children}
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
        <path d="M3,9 C25,4 45,10 62,6 C80,2 100,8 117,4" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] ${
        dark
          ? "border border-white/15 bg-white/8 text-[#c4b5fd]"
          : "border border-[#7c3aed]/15 bg-[#f4f0ff] text-[#5b21b6]"
      }`}
    >
      {children}
    </span>
  );
}

function PainVisual({ kind }: { kind: "time" | "tools" | "reach" }) {
  if (kind === "time") {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-3 p-7">
        {TIME_BARS.map((bar) => (
          <div key={bar.label} className="flex items-center gap-3">
            <div
              className="lp-time-bar flex h-8 shrink-0 items-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-r from-white/14 to-white/6 px-3.5"
              style={{ width: bar.w, "--d": bar.d, "--wave-d": bar.waveD, "--wave-amp": bar.amp } as React.CSSProperties}
            >
              <span className="truncate text-[11.5px] font-semibold text-white/75">{bar.label}</span>
            </div>
            <span className="whitespace-nowrap font-mono text-[10px] text-white/40">{bar.time}</span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "tools") {
    return (
      <div className="flex h-full w-full flex-wrap content-center items-center justify-center gap-2.5 p-8">
        {TOOL_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className="lp-chip inline-block rounded-full border border-white/12 bg-white/8 px-3.5 py-1.5 text-[12px] font-semibold text-white/70"
            style={{ "--r": chip.r, "--idle-d": chip.d } as React.CSSProperties}
          >
            {chip.label}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="relative flex h-full w-full items-end gap-1.5 p-8 pb-10">
      {REACH_BARS.map((h, i) => (
        <div
          key={i}
          className="lp-reach-bar flex-1 rounded-t-sm bg-white/15"
          style={{ height: `${h}%`, "--pulse-d": `${4 + (i % 5) * 0.6}s`, "--pulse-off": `${(i % 7) * 0.35}s` } as React.CSSProperties}
        />
      ))}
      <div className="pointer-events-none absolute inset-x-8 bottom-10 top-8">
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="size-full">
          <path d="M0,55 C20,52 35,45 55,30 C70,19 85,10 100,4" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute -top-1 right-0 rounded-full bg-[#7c3aed] px-2 py-0.5 font-mono text-[9px] font-bold text-white">avec Upcut</span>
        <span className="absolute -bottom-4 left-0 rounded-full border border-white/12 bg-white/8 px-2 py-0.5 font-mono text-[9px] font-bold text-white/55">sans Upcut</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-[family-name:var(--font-dm-sans)] text-[#1d1d1f]">
      <StickyNav />
      <PageAnimations />

      <main className="relative">

        {/* ── Hero ── */}
        <section className="px-6 pb-4 pt-16 text-center sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <div
              className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e7] bg-[#f5f5f7] px-3.5 py-1.5"
              style={{ animation: "fade-up 0.6s ease-out both" }}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="font-mono text-[11px] font-medium text-[#1d1d1f]/70">
                <HeroCounter /> clips générés cette semaine
              </span>
            </div>

            <h1
              className="mx-auto mt-6 max-w-[820px] font-[family-name:var(--font-syne)] text-[clamp(34px,5.2vw,60px)] font-extrabold leading-[1.06] tracking-[-0.03em]"
              style={{ animation: "fade-up 0.6s ease-out 0.1s both" }}
            >
              Colle une URL, récupère{" "}
              <Key>tes clips</Key>.
            </h1>

            <p
              className="mx-auto mt-6 max-w-[560px] text-[clamp(15px,1.4vw,18px)] leading-normal text-[#1d1d1f]/60"
              style={{ animation: "fade-up 0.6s ease-out 0.2s both" }}
            >
              Upcut détecte les moments forts de tes vidéos YouTube &amp; Twitch, recadre en 9:16
              et ajoute les sous-titres — prêt à poster en quelques minutes.
            </p>

            <div className="mx-auto mt-8 w-full max-w-[540px]" style={{ animation: "fade-up 0.6s ease-out 0.3s both" }}>
              <HeroUrlForm />
              <p className="mt-3 font-mono text-[11px] text-[#1d1d1f]/40">
                Gratuit · Aucune carte bancaire requise
              </p>
            </div>

            <div
              className="mt-7 flex items-center justify-center gap-4"
              style={{ animation: "fade-up 0.6s ease-out 0.4s both" }}
            >
              <div className="flex -space-x-2">
                {BETA_CREATORS.map((p) => (
                  <div
                    key={p.name}
                    className="flex size-8 items-center justify-center rounded-full font-[family-name:var(--font-syne)] text-[11px] font-bold text-white ring-2 ring-white"
                    style={{ background: `linear-gradient(135deg, hsl(${p.hue},55%,45%), hsl(${p.hue},65%,32%))` }}
                    aria-hidden
                  >
                    {p.name[0]}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="size-3 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="font-mono text-[11px] text-[#1d1d1f]/50">
                  Utilisé par <span className="font-medium text-[#1d1d1f]">des créateurs</span> en bêta
                </p>
              </div>
            </div>
          </div>

          <div style={{ animation: "fade-up 0.8s ease-out 0.45s both" }}>
            <PhoneArc />
          </div>

          {/* Plateformes */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3" style={{ animation: "fade-up 0.6s ease-out 0.55s both" }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1d1d1f]/35">Prêt pour</span>
            {PLATFORMS.map(({ name, Icon }) => (
              <span key={name} className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f]/55">
                <Icon className="size-3.5" />
                {name}
              </span>
            ))}
          </div>
        </section>

        {/* ── Pain (bloc sombre) ── */}
        <section className="px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-[1100px] rounded-[40px] bg-[#141416] px-6 py-20 sm:px-12">
            <div className="mx-auto max-w-[880px]">
              <div className="mb-14 text-center" data-animate>
                <Eyebrow dark>Le problème</Eyebrow>
                <h2 className="mt-5 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em] text-white">
                  Le montage manuel te coûte <span className="text-[#a78bfa]">cher</span>
                </h2>
              </div>
              <div className="space-y-4">
                {PAIN_ROWS.map((row) => (
                  <div
                    key={row.num}
                    data-animate
                    className="grid overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.04] md:grid-cols-2"
                  >
                    <div className="p-8 sm:p-10">
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-[#7c3aed] font-mono text-[11px] font-bold text-white">{row.num}</span>
                      <h3 className="mt-4 font-[family-name:var(--font-syne)] text-xl font-bold text-white sm:text-2xl">{row.title}</h3>
                      <p className="mt-3 text-[15px] leading-relaxed text-white/55">{row.desc}</p>
                    </div>
                    <div className="min-h-[190px] border-t border-white/8 md:border-l md:border-t-0">
                      <PainVisual kind={row.visual} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Comment ça marche ── */}
        <section id="comment-ca-marche" className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-24 scroll-mt-24">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>La solution</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                Aussi simple que ça.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-[#1d1d1f]/60">
                Pas de plugin, pas de compte pro, pas de timeline à maîtriser.
              </p>
            </div>
            <div className="stagger-parent relative grid gap-5 sm:grid-cols-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.title}
                    className="stagger-item relative rounded-[24px] border border-[#e5e5e7] bg-white p-7 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-all hover:-translate-y-1 hover:shadow-[0_12px_40px_-16px_rgba(28,28,30,0.16)]"
                  >
                    <div className="pointer-events-none absolute right-5 top-4 select-none font-[family-name:var(--font-syne)] text-[4rem] font-black leading-none text-[#1d1d1f]/5">
                      {i + 1}
                    </div>
                    <div className="relative">
                      <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-[#f4f0ff]">
                        <Icon className="size-5 text-[#7c3aed]" aria-hidden />
                      </div>
                      <h3 className="mb-2 font-[family-name:var(--font-syne)] text-lg font-bold">{s.title}</h3>
                      <p className="text-sm leading-relaxed text-[#1d1d1f]/60">{s.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Démo + fonctionnalités ── */}
        <section id="fonctionnalites" className="border-t border-[#e5e5e7] px-6 py-24 scroll-mt-24">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>Fonctionnalités</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                Tout est inclus.
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[#1d1d1f]/60">
                Tu colles le lien, tu récupères tes fichiers — le reste, c&apos;est Upcut.
              </p>
            </div>

            <div className="grid items-start gap-10 md:grid-cols-[340px_1fr] md:gap-14">
              <div data-animate className="mx-auto w-full max-w-[340px] md:sticky md:top-28">
                <LandingDemoVideo />
              </div>
              <div className="stagger-parent grid gap-4 sm:grid-cols-2">
                <div className="stagger-item rounded-[24px] border border-[#e5e5e7] bg-[#f4f0ff] p-6 sm:col-span-2">
                  <div className="flex items-start justify-between">
                    <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                      <Sparkles className="size-5 text-[#7c3aed]" />
                    </div>
                    <span className="rounded-full border border-[#7c3aed]/20 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-[#7c3aed]">IA</span>
                  </div>
                  <h3 className="mb-2 font-[family-name:var(--font-syne)] text-lg font-bold">Détection IA des moments forts</h3>
                  <p className="text-sm leading-relaxed text-[#1d1d1f]/60">
                    Whisper transcrit l&apos;audio, GPT repère les moments qui vont faire scroller — accroche, tension,
                    révélation. Chaque clip reçoit un score viral avant même que tu ne le regardes.
                  </p>
                </div>
                {FEATURES.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={feature.title}
                      className="stagger-item rounded-[24px] border border-[#e5e5e7] bg-white p-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-16px_rgba(28,28,30,0.16)]"
                    >
                      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-[#f4f0ff]">
                        <Icon className="size-5 text-[#7c3aed]" aria-hidden />
                      </div>
                      <h3 className="mb-1.5 font-[family-name:var(--font-syne)] text-[15px] font-semibold">{feature.title}</h3>
                      <p className="text-sm leading-relaxed text-[#1d1d1f]/60">{feature.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Stats ── */}
        <section className="border-t border-[#e5e5e7] px-6 py-14">
          <div className="mx-auto grid max-w-[980px] grid-cols-2 gap-y-10 md:grid-cols-4" data-animate>
            {STATS.map((stat, i) => (
              <div key={i} className="text-center">
                <p className="font-[family-name:var(--font-syne)] text-3xl font-black tracking-tight text-[#1d1d1f] sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-xs text-[#1d1d1f]/50">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Témoignages ── */}
        <section className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-24">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>Ils l&apos;utilisent</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                Ce qu&apos;ils en disent.
              </h2>
            </div>
            <div className="stagger-parent grid gap-5 sm:grid-cols-3">
              {TESTIMONIALS.map((t) => (
                <div
                  key={t.name}
                  className="stagger-item flex flex-col gap-4 rounded-[24px] border border-[#e5e5e7] bg-white p-7 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]"
                >
                  <div className="flex">
                    {[...Array(5)].map((_, i) => <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="flex-1 text-[15px] leading-relaxed text-[#1d1d1f]/80">&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center gap-3 border-t border-[#e5e5e7] pt-4">
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-syne)] text-sm font-bold text-white"
                      style={{ background: `linear-gradient(135deg, hsl(${t.hue},55%,45%), hsl(${t.hue},65%,32%))` }}
                    >
                      {t.name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-[11px] text-[#1d1d1f]/50">{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pour qui */}
            <div className="stagger-parent mt-16 grid gap-4 sm:grid-cols-2">
              {POUR_QUI.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="stagger-item flex gap-4 rounded-[24px] border border-[#e5e5e7] bg-white p-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4f0ff]">
                      <Icon className="size-5 text-[#7c3aed]" aria-hidden />
                    </div>
                    <div>
                      <h3 className="mb-1 font-[family-name:var(--font-syne)] text-[15px] font-semibold">{item.title}</h3>
                      <p className="text-sm leading-relaxed text-[#1d1d1f]/60">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Tarifs ── */}
        <section id="tarifs" className="border-t border-[#e5e5e7] px-6 py-24 scroll-mt-24">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>Tarifs</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                Simple, sans surprise.
              </h2>
              <p className="mt-3 text-sm text-[#1d1d1f]/50">~20 min de vidéo source · ~3 clips par lancement</p>
            </div>
            <div className="stagger-parent grid items-stretch gap-5 md:grid-cols-3">
              {/* Gratuit */}
              <div className="stagger-item flex flex-col rounded-[28px] border border-[#e5e5e7] bg-white p-8 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                <div className="mb-6">
                  <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">Gratuit</h3>
                  <p className="text-sm text-[#1d1d1f]/50">Pour tester, sans engagement</p>
                </div>
                <div className="mb-8">
                  <span className="text-4xl font-bold">0€</span>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">30 min de quota</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[PLAN_CLIP_QUOTA_LEAD.free, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Formats TikTok / Reels / Shorts"].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full border border-[#d2d2d7] py-3 text-center text-sm font-medium transition-colors hover:bg-[#f5f5f7]">
                  Tester gratuitement
                </Link>
              </div>

              {/* Creator */}
              <div className="stagger-item relative flex flex-col rounded-[28px] border-2 border-[#7c3aed] bg-white p-8 shadow-[0_12px_40px_-16px_rgba(124,58,237,0.35)]">
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">Creator</h3>
                    <p className="text-sm text-[#1d1d1f]/50">Pour les créateurs sérieux</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#7c3aed] px-2.5 py-1 text-[11px] font-semibold text-white">Populaire</span>
                </div>
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-[#7c3aed]">17€</span>
                    <span className="text-sm text-[#1d1d1f]/50">/mois</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">2h30 de quota / mois</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[PLAN_CLIP_QUOTA_LEAD.creator, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Formats TikTok / Reels / Shorts"].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] py-3 text-center text-sm font-semibold text-white shadow-[0_4px_14px_-4px_rgba(124,58,237,0.5)] transition-opacity hover:opacity-90">
                  Passer Creator
                </Link>
              </div>

              {/* Studio */}
              <div className="stagger-item flex flex-col rounded-[28px] border border-[#e5e5e7] bg-white p-8 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                <div className="mb-6">
                  <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">Studio</h3>
                  <p className="text-sm text-[#1d1d1f]/50">Pour scaler sa présence</p>
                </div>
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">35€</span>
                    <span className="text-sm text-[#1d1d1f]/50">/mois</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">6h40 de quota / mois</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[PLAN_CLIP_QUOTA_LEAD.studio, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Accès anticipé aux nouvelles features"].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full border border-[#d2d2d7] py-3 text-center text-sm font-medium transition-colors hover:bg-[#f5f5f7]">
                  Choisir Studio
                </Link>
              </div>
            </div>
            <p className="mt-10 text-center">
              <Link href="/plans" prefetch={true} className="inline-flex items-center gap-1 text-sm text-[#7c3aed] transition-colors hover:text-[#5b21b6]">
                Comparer toutes les options <ArrowRight className="size-3.5" />
              </Link>
            </p>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-24 scroll-mt-24" data-animate>
          <div className="mx-auto max-w-xl">
            <div className="mb-10 text-center">
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                Tes questions fréquentes.
              </h2>
            </div>
            <FaqAccordion />
          </div>
        </section>

        {/* ── CTA Final ── */}
        <section className="border-t border-[#e5e5e7] px-6 py-28" data-animate>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-[family-name:var(--font-syne)] text-[clamp(30px,4.4vw,52px)] font-extrabold leading-[1.08] tracking-[-0.03em]">
              Colle un lien. <Key>Poste plus</Key>.
            </h2>
            <p className="mx-auto mb-9 mt-5 max-w-md text-lg text-[#1d1d1f]/60">
              Compte gratuit avec 30 min de vidéo. Aucune carte bancaire.
            </p>
            <HeroUrlForm className="mx-auto max-w-[540px]" size="large" />
            <Link href="/register" prefetch={true} className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#7c3aed] transition-colors hover:text-[#5b21b6]">
              Ou inscris-toi sans URL <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-10">
          <div className="mx-auto flex max-w-[980px] flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-[family-name:var(--font-syne)] font-bold">Upcut</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-[#1d1d1f]/60">
              <Link href="/plans" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">Plans</Link>
              <Link href="/login" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">Connexion</Link>
              <Link href="/register" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">Inscription</Link>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[#1d1d1f]/50">
              <Link href="/mentions-legales" className="transition-colors hover:text-[#1d1d1f]">Mentions légales</Link>
              <Link href="/confidentialite" className="transition-colors hover:text-[#1d1d1f]">Confidentialité</Link>
              <Link href="/cgu" className="transition-colors hover:text-[#1d1d1f]">CGU</Link>
              <span>© 2026 Upcut</span>
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}
