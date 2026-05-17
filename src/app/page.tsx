import Link from "next/link";
import {
  Link2, Scissors, Sparkles, Download, Mic2, TrendingUp,
  Users, Briefcase, Check, Star, ArrowRight, Zap, Clock,
  X as XIcon, type LucideIcon,
} from "lucide-react";
import { PLAN_CLIP_QUOTA_LEAD } from "@/lib/plan";
import { StickyNav } from "@/components/landing/StickyNav";
import { HeroUrlForm, HeroCounter, PageAnimations } from "@/components/landing/HeroClient";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { LandingDemoVideo } from "@/components/landing/LandingDemoVideo";

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

const PLATFORMS = ["TikTok", "YouTube Shorts", "Instagram Reels", "Snapchat", "LinkedIn"];

const POUR_QUI: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mic2, title: "Créateurs & streamers", text: "Tes lives et VOD deviennent des Shorts sans refaire un montage." },
  { icon: Users, title: "Podcasteurs", text: "Les meilleurs extraits parlés, recadrés et sous-titrés pour les réseaux." },
  { icon: TrendingUp, title: "Growth & social", text: "Plus de tests d'hooks, moins de temps en timeline." },
  { icon: Briefcase, title: "Petites agences", text: "Un flux simple : URL → clips livrables pour tes clients." },
];

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Link2, title: "Colle l'URL", desc: "YouTube ou Twitch : VOD, replay ou long format." },
  { icon: Sparkles, title: "IA & montage", desc: "Moments forts, recadrage 9:16 / 1:1 et sous-titres animés." },
  { icon: Download, title: "Export", desc: "Télécharge et poste sur TikTok, Reels ou Shorts." },
];

const STATS = [
  { value: "2 847", suffix: "+", label: "clips générés cette semaine" },
  { value: "< 5", suffix: " min", label: "temps de génération moyen" },
  { value: "5", suffix: "", label: "styles de sous-titres" },
  { value: "0€", suffix: "", label: "pour commencer" },
];

const BEFORE_STEPS = [
  { time: "~15 min", label: "Trouver le bon moment" },
  { time: "~25 min", label: "Couper et recadrer" },
  { time: "~30 min", label: "Ajouter les sous-titres" },
  { time: "~10 min", label: "Exporter et convertir" },
];

const AFTER_STEPS = [
  "Colle le lien YouTube ou Twitch",
  "L'IA détecte et monte automatiquement",
  "Télécharge tes clips prêts à poster",
];

const BENTO_FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Sparkles, title: "Détection IA des moments forts", desc: "Whisper transcrit l'audio, GPT repère les moments qui vont faire scroller — accroche, tension, révélation. Chaque clip reçoit un score viral avant même que tu ne le regardes." },
  { icon: Scissors, title: "Recadrage 9:16 auto", desc: "Le sujet reste centré, même sur une VOD de 2h." },
  { icon: Mic2, title: "Sous-titres Whisper", desc: "Karaoké, Highlight, Minimal — intégrés dans le MP4." },
  { icon: TrendingUp, title: "Score viral", desc: "Chaque clip reçoit une note prédictive." },
  { icon: Zap, title: "Mode Auto ou Manuel", desc: "L'IA choisit, ou tu places le curseur toi-même." },
  { icon: Link2, title: "YouTube & Twitch", desc: "VODs, replays, vidéos longues — colle le lien." },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground overflow-x-hidden font-[family-name:var(--font-dm-sans)]">

      {/* Background blobs — absolute (not fixed) pour éviter les bugs de repaint Safari */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full bg-violet-500/5 blur-[140px] will-change-transform" />
        <div className="absolute top-1/3 -left-60 w-[600px] h-[600px] rounded-full bg-indigo-500/4 blur-[120px] will-change-transform" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-violet-400/4 blur-[100px] will-change-transform" />
      </div>

      <StickyNav />
      <PageAnimations />

      <main className="relative z-10">

        {/* ── Hero ── */}
        <section className="pt-28 sm:pt-36 pb-16 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col items-center text-center">
              <div
                className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 mb-6"
                style={{ animation: "fade-up 0.6s ease-out both" }}
              >
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-[11px] text-primary font-medium">
                  <HeroCounter /> clips générés cette semaine
                </span>
              </div>

              <h1
                className="font-[family-name:var(--font-syne)] font-extrabold text-5xl sm:text-6xl lg:text-[4rem] xl:text-[4.5rem] leading-[1.05] text-foreground mb-5 max-w-3xl"
                style={{ animation: "fade-up 0.6s ease-out 0.1s both" }}
              >
                Colle une URL,{" "}
                <span className="text-transparent bg-clip-text bg-[linear-gradient(110deg,#7c3aed_25%,#a78bfa_50%,#6366f1_75%)] text-shimmer">
                  récupère tes clips.
                </span>
              </h1>

              <p
                className="text-lg text-muted-foreground leading-relaxed max-w-md mb-8"
                style={{ animation: "fade-up 0.6s ease-out 0.2s both" }}
              >
                Upcut détecte les moments forts de tes vidéos YouTube & Twitch, recadre en 9:16
                et ajoute les sous-titres — prêt à poster en quelques minutes.
              </p>

              <div style={{ animation: "fade-up 0.6s ease-out 0.3s both" }} className="w-full max-w-[540px]">
                <HeroUrlForm />
              </div>

              <p
                className="font-mono text-[11px] text-muted-foreground mt-2.5"
                style={{ animation: "fade-up 0.6s ease-out 0.4s both" }}
              >
                Gratuit · Aucune carte bancaire requise
              </p>

              <div
                className="flex items-center gap-4 mt-7"
                style={{ animation: "fade-up 0.6s ease-out 0.5s both" }}
              >
                <div className="flex -space-x-2">
                  {BETA_CREATORS.map((p) => (
                    <div
                      key={p.name}
                      className="size-8 rounded-full flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-white text-[11px] ring-2 ring-[#fafafa]"
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
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Utilisé par <span className="text-foreground font-medium">des créateurs</span> en bêta
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Plateformes — marquee ── */}
        <section className="py-8 px-6 border-y border-border bg-white/60 overflow-hidden">
          <div className="max-w-5xl mx-auto">
            <p className="text-center font-mono text-[11px] text-muted-foreground uppercase tracking-widest mb-5">
              Tes clips sont prêts pour
            </p>
          </div>
          <div className="overflow-hidden">
            <div className="flex marquee-track">
              {[0, 1].map((set) => (
                <div key={set} className="flex shrink-0 items-center gap-12 pr-12" aria-hidden={set === 1}>
                  {PLATFORMS.map((p) => (
                    <span key={`${set}-${p}`} className="font-[family-name:var(--font-syne)] font-bold text-sm text-muted-foreground/50 whitespace-nowrap">
                      {p}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 3 étapes ── */}
        <section className="py-20 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground mb-3">Aussi simple que ça</h2>
              <p className="text-muted-foreground max-w-md mx-auto">Pas de plugin, pas de compte pro, pas de timeline à maîtriser.</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-6 relative stagger-parent">
              <div className="hidden sm:block absolute top-10 left-[calc(33%+1.5rem)] right-[calc(33%+1.5rem)] h-px bg-gradient-to-r from-border via-primary/30 to-border" />
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.title} className="stagger-item relative rounded-2xl border border-border bg-white p-7 text-left shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-1 transition-all">
                    <div className="absolute top-4 right-5 font-[family-name:var(--font-syne)] font-black text-[4.5rem] text-[#f4f4f5] select-none leading-none pointer-events-none">{i + 1}</div>
                    <div className="relative">
                      <div className="size-11 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                        <Icon className="size-5 text-primary" aria-hidden />
                      </div>
                      <h3 className="font-[family-name:var(--font-syne)] font-bold text-foreground text-lg mb-2">{s.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Avant / Après ── */}
        <section className="py-20 px-6 border-t border-border bg-white/60">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground mb-3">Le montage, sans et avec Upcut</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">Un clip TikTok à la main, c'est entre 1h et 1h30 de travail. Avec Upcut : moins de 5 minutes.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-6 stagger-parent">
              <div className="stagger-item rounded-2xl border border-[#2a2a2a] bg-[#18181b] p-7 flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="size-9 rounded-lg bg-red-500/15 flex items-center justify-center">
                    <Clock className="size-4 text-red-400" />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-syne)] font-bold text-white text-base">Sans Upcut</p>
                    <p className="font-mono text-[10px] text-zinc-500">Montage manuel</p>
                  </div>
                  <div className="ml-auto">
                    <span className="font-mono text-sm font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-lg">~1h30</span>
                  </div>
                </div>
                <div className="space-y-2.5 flex-1">
                  {BEFORE_STEPS.map((step, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                      <div className="size-6 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                        <XIcon className="size-3 text-red-400" />
                      </div>
                      <span className="text-sm text-zinc-300 flex-1">{step.label}</span>
                      <span className="font-mono text-[11px] text-zinc-500 shrink-0">{step.time}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs text-zinc-600 italic">Et encore, si tu maîtrises déjà Premiere ou CapCut…</p>
              </div>
              <div className="stagger-item rounded-2xl border-2 border-primary/25 bg-white p-7 flex flex-col shadow-[0_4px_32px_rgba(124,58,237,0.08)] relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-indigo-500" />
                <div className="flex items-center gap-3 mb-6">
                  <div className="size-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                    <Zap className="size-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-syne)] font-bold text-foreground text-base">Avec Upcut</p>
                    <p className="font-mono text-[10px] text-muted-foreground">IA + automatique</p>
                  </div>
                  <div className="ml-auto">
                    <span className="font-mono text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">~5 min</span>
                  </div>
                </div>
                <div className="space-y-2.5 flex-1">
                  {AFTER_STEPS.map((step, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[#fafafa] border border-border">
                      <div className="size-6 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                        <Check className="size-3 text-emerald-600" />
                      </div>
                      <span className="text-sm text-foreground">{step}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 p-4 rounded-xl bg-primary/5 border border-primary/15">
                  <p className="text-sm text-foreground font-medium">3 clips 9:16 · sous-titres · score viral · téléchargement direct</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Démo produit ── */}
        <section id="produit" className="py-20 px-6 border-t border-border" data-animate>
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">Aperçu du flux</h2>
            <p className="text-center text-muted-foreground max-w-lg mx-auto mb-10">Comme dans l'app : une source large, puis tes exports prêts pour les réseaux.</p>
            <LandingDemoVideo />
          </div>
        </section>

        {/* ── Features Bento ── */}
        <section className="py-20 px-6 border-t border-border bg-white/60">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground mb-3">Tout est inclus</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">Pas de plugins, pas de timeline — tu colles le lien, tu récupères tes fichiers.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-parent">
              <div className="stagger-item sm:col-span-2 lg:col-span-2 lg:row-span-2 rounded-2xl border border-border bg-white p-8 flex flex-col gap-5 shadow-sm hover:shadow-lg hover:border-primary/25 transition-all group relative overflow-hidden">
                <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-violet-500/3 via-transparent to-indigo-500/3" />
                <div className="relative flex items-start justify-between">
                  <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-6 text-primary" />
                  </div>
                  <span className="font-mono text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">IA</span>
                </div>
                <div className="relative">
                  <h3 className="font-[family-name:var(--font-syne)] font-bold text-foreground text-xl sm:text-2xl mb-3">{BENTO_FEATURES[0].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm sm:text-base">{BENTO_FEATURES[0].desc}</p>
                </div>
                <div className="relative flex flex-wrap gap-2 mt-auto">
                  {["Transcription Whisper", "Score viral", "Découpe intelligente"].map((tag) => (
                    <span key={tag} className="font-mono text-[10px] text-muted-foreground bg-[#f4f4f5] border border-border px-2.5 py-1 rounded-full">{tag}</span>
                  ))}
                </div>
              </div>
              {BENTO_FEATURES.slice(1).map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="stagger-item rounded-2xl border border-border bg-white p-6 flex flex-col gap-3 shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 transition-all">
                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-5 text-primary" aria-hidden />
                    </div>
                    <h3 className="font-[family-name:var(--font-syne)] font-semibold text-foreground text-base">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Stats ── */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 stagger-parent">
            {STATS.map((stat, i) => (
              <div key={i} className="stagger-item rounded-2xl border border-border bg-white p-6 text-center shadow-sm hover:shadow-md hover:border-primary/20 transition-all">
                <p className="font-[family-name:var(--font-syne)] font-black text-3xl sm:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-indigo-500 mb-1.5 leading-tight">
                  {stat.value}{stat.suffix}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Témoignages ── */}
        <section className="py-20 px-6 border-t border-border bg-white/60">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground mb-3">Ce qu'ils en disent</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">Des créateurs en bêta qui l'utilisent chaque semaine.</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-5 stagger-parent">
              {TESTIMONIALS.map((t) => (
                <div key={t.name} className="stagger-item rounded-2xl border border-border bg-white p-6 flex flex-col gap-4 shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-1 transition-all">
                  <div className="text-[#e4e4e7] font-serif text-5xl leading-none select-none -mb-2">&ldquo;</div>
                  <div className="flex">
                    {[...Array(5)].map((_, i) => <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed flex-1">&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center gap-3 pt-3 border-t border-border">
                    <div
                      className="size-9 rounded-full flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-white text-sm shrink-0"
                      style={{ background: `linear-gradient(135deg, hsl(${t.hue},55%,45%), hsl(${t.hue},65%,32%))` }}
                    >
                      {t.name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pour qui ── */}
        <section id="pour-qui" className="py-20 px-6 border-t border-border">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground mb-3">Pour qui c'est fait</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">Un flux simple, pensé pour ceux qui publient souvent en vertical.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 stagger-parent">
              {POUR_QUI.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="stagger-item rounded-2xl border border-border bg-white p-6 flex gap-4 shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 transition-all">
                    <div className="shrink-0 size-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-5 text-primary" aria-hidden />
                    </div>
                    <div>
                      <h3 className="font-[family-name:var(--font-syne)] font-semibold text-foreground text-base mb-1.5">{item.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Tarifs ── */}
        <section id="pricing" className="py-24 px-6 bg-white border-t border-border">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14" data-animate>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-3xl sm:text-4xl text-foreground mb-3">Tarifs</h2>
              <p className="text-sm text-muted-foreground">~20 min de vidéo source · ~3 clips par lancement</p>
            </div>
            <div className="grid md:grid-cols-3 gap-5 items-stretch stagger-parent">
              <div className="stagger-item rounded-2xl border border-border bg-white p-8 flex flex-col hover:shadow-md hover:border-primary/20 transition-all">
                <div className="mb-6">
                  <h3 className="font-[family-name:var(--font-syne)] font-bold text-lg text-foreground mb-1">Gratuit</h3>
                  <p className="text-sm text-muted-foreground">Pour tester, sans engagement</p>
                </div>
                <div className="mb-8">
                  <span className="text-4xl font-bold text-foreground">0€</span>
                  <p className="text-xs text-muted-foreground mt-1.5">30 min de quota</p>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground mb-8 flex-1">
                  {[PLAN_CLIP_QUOTA_LEAD.free, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Formats TikTok / Reels / Shorts"].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full py-3 rounded-xl border border-border text-foreground text-sm font-medium text-center hover:bg-[#f4f4f5] transition-colors">
                  Tester gratuitement
                </Link>
              </div>

              <div className="stagger-item rounded-2xl p-[2px] animated-border-wrap shadow-[0_8px_40px_rgba(124,58,237,0.12)]">
                <div className="rounded-[calc(1rem-2px)] bg-white p-8 flex flex-col h-full relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-indigo-500" />
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <h3 className="font-[family-name:var(--font-syne)] font-bold text-lg text-foreground mb-1">Creator</h3>
                      <p className="text-sm text-muted-foreground">Pour les créateurs sérieux</p>
                    </div>
                    <span className="text-[11px] font-semibold text-primary bg-primary/8 border border-primary/15 px-2.5 py-1 rounded-full shrink-0">Populaire</span>
                  </div>
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-primary">9€</span>
                      <span className="text-sm text-muted-foreground">/mois</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">2h30 de quota / mois</p>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground mb-8 flex-1">
                    {[PLAN_CLIP_QUOTA_LEAD.creator, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Formats TikTok / Reels / Shorts"].map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="size-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" prefetch={true} className="block w-full py-3 rounded-xl bg-primary text-white text-sm font-semibold text-center hover:bg-primary/90 transition-colors">
                    Passer Creator
                  </Link>
                </div>
              </div>

              <div className="stagger-item rounded-2xl border border-border bg-white p-8 flex flex-col hover:shadow-md hover:border-primary/20 transition-all">
                <div className="mb-6">
                  <h3 className="font-[family-name:var(--font-syne)] font-bold text-lg text-foreground mb-1">Studio</h3>
                  <p className="text-sm text-muted-foreground">Pour scaler sa présence</p>
                </div>
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground">29€</span>
                    <span className="text-sm text-muted-foreground">/mois</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">6h40 de quota / mois</p>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground mb-8 flex-1">
                  {[PLAN_CLIP_QUOTA_LEAD.studio, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Accès anticipé aux nouvelles features"].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full py-3 rounded-xl border border-border text-foreground text-sm font-medium text-center hover:bg-[#f4f4f5] transition-colors">
                  Choisir Studio
                </Link>
              </div>
            </div>
            <p className="text-center mt-10">
              <Link href="/plans" prefetch={true} className="text-sm text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1">
                Comparer toutes les options <ArrowRight className="size-3.5" />
              </Link>
            </p>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="py-20 px-6 border-t border-border" data-animate>
          <div className="max-w-xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-8">Questions fréquentes</h2>
            <FaqAccordion />
          </div>
        </section>

        {/* ── CTA Final ── */}
        <section className="py-24 px-6 border-t border-border" data-animate>
          <div className="max-w-2xl mx-auto text-center relative">
            <div className="pointer-events-none absolute -inset-16 rounded-full bg-primary/6 blur-3xl animate-[glow-pulse_4s_ease-in-out_infinite]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 mb-6">
                <Zap className="size-3 text-primary" />
                <span className="font-mono text-[11px] text-primary font-medium">Gratuit pour commencer</span>
              </div>
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-3xl sm:text-4xl lg:text-5xl text-foreground mb-4 leading-tight">
                Lance ta première{" "}
                <span className="text-transparent bg-clip-text bg-[linear-gradient(110deg,#7c3aed_25%,#a78bfa_50%,#6366f1_75%)] text-shimmer">génération</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto">Compte gratuit avec 30 min de vidéo. Aucune carte bancaire.</p>
              <HeroUrlForm className="max-w-[540px] mx-auto" size="large" />
              <Link href="/register" prefetch={true} className="inline-flex items-center gap-1.5 mt-5 text-sm text-primary hover:text-primary/80 transition-colors">
                Ou inscris-toi sans URL <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="py-10 px-6 border-t border-border bg-white/60">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-[family-name:var(--font-syne)] font-bold text-foreground">Upcut</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <Link href="/plans" prefetch={true} className="hover:text-foreground transition-colors">Plans</Link>
              <Link href="/login" prefetch={true} className="hover:text-foreground transition-colors">Connexion</Link>
              <Link href="/register" prefetch={true} className="hover:text-foreground transition-colors">Inscription</Link>
            </div>
            <p className="text-xs text-muted-foreground text-center sm:text-right">© 2026 Upcut</p>
          </div>
        </footer>

      </main>
    </div>
  );
}
