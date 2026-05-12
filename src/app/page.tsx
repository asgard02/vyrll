"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Link2,
  Scissors,
  Sparkles,
  Download,
  Mic2,
  TrendingUp,
  ChevronDown,
  Check,
  Star,
  ArrowRight,
  Zap,
  Play,
  Clock,
  Rocket,
} from "lucide-react";
import { isValidVideoUrl, getYouTubeThumbnailUrl, getYouTubeThumbnailFallback } from "@/lib/youtube";

/* ─── constants ─────────────────────────────────────────────── */

const CLIP_DEMO_VIDEO_ID = "yhB3BgJyGl8";

const STATS = [
  { value: "15 min", label: "Pour avoir tes premiers clips" },
  { value: "9:16", label: "Format vertical natif" },
  { value: "100%", label: "Auto — sans montage manuel" },
];

const STEPS = [
  {
    icon: Link2,
    step: "01",
    title: "Colle ton URL",
    desc: "YouTube ou Twitch. Vidéo longue, VOD, podcast, stream — n'importe quel format.",
  },
  {
    icon: Sparkles,
    step: "02",
    title: "L'IA choisit les moments forts",
    desc: "Transcription Whisper + détection des pics d'énergie. Elle taille dans le gras, garde l'essentiel.",
  },
  {
    icon: Download,
    step: "03",
    title: "Télécharge et poste",
    desc: "Clip 9:16 avec sous-titres animés, recadrage intelligent. Prêt pour TikTok, Reels, Shorts.",
  },
];

const FEATURES = [
  { icon: Mic2,        title: "Transcription Whisper",       desc: "Sous-titres précis, même sur 2h de stream." },
  { icon: Scissors,    title: "Recadrage face-tracking",     desc: "Le sujet reste centré. Toujours." },
  { icon: TrendingUp,  title: "Score viral par clip",        desc: "Savoir lequel poster en premier." },
  { icon: Sparkles,    title: "Styles de sous-titres",       desc: "Karaoké, Highlight, Minimal — dans le MP4." },
  { icon: Clock,       title: "Durées au choix",             desc: "15 s, 30 s, 60 s selon la plateforme cible." },
  { icon: Rocket,      title: "Sans timeline",               desc: "Zéro logiciel. Zéro montage. URL → clips." },
];

const TESTIMONIALS = [
  {
    name: "Théo M.",
    role: "Streamer · 12k abonnés",
    text: "En 10 minutes j'avais 3 clips prêts à poster. Je n'aurais jamais fait ça aussi vite à la main.",
    hue: "217",
    stars: 5,
  },
  {
    name: "Léa D.",
    role: "YouTubeuse · 48k abonnés",
    text: "Le recadrage auto est bluffant — le sujet reste toujours centré, même sur une VOD de 2h.",
    hue: "280",
    stars: 5,
  },
  {
    name: "Karim B.",
    role: "Coach sportif en ligne",
    text: "Je publie 5× plus sur TikTok depuis Vyrll. Mes Reels ont explosé ce mois-ci.",
    hue: "32",
    stars: 5,
  },
];

const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    price: "0",
    period: "",
    quota: "30 min à vie",
    clips: "~3 clips",
    features: ["Clips 9:16 & 1:1", "Sous-titres IA", "Score viral", "Formats TikTok / Reels / Shorts"],
    cta: "Commencer gratuitement",
    href: "/register",
    accent: false,
  },
  {
    id: "creator",
    name: "Creator",
    price: "14",
    period: "€/mois",
    quota: "2h30 / mois",
    clips: "~20 clips",
    badge: "Populaire",
    features: ["~20 clips / mois", "Tout du plan Gratuit", "Priorité de traitement"],
    cta: "Passer Creator",
    href: "/checkout/creator",
    accent: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "29",
    period: "€/mois",
    quota: "6h40 / mois",
    clips: "~60 clips",
    features: ["~60 clips / mois", "Tout du plan Creator", "Accès early features"],
    cta: "Choisir Studio",
    href: "/checkout/studio",
    accent: false,
  },
];

const FAQ_ITEMS = [
  { q: "Ça marche avec Twitch aussi ?", a: "Oui. VOD, replays ou tout contenu compatible. Le flux est traité comme une vidéo source pour en extraire des clips." },
  { q: "Combien de temps ça prend ?", a: "Quelques minutes pour une vidéo classique — tu suis l'avancement en temps réel depuis ton espace." },
  { q: "Les sous-titres sont inclus ?", a: "Oui. Transcription Whisper + sous-titres stylés directement brûlés dans le MP4 exporté." },
  { q: "Comment sont comptés mes crédits ?", a: "1 crédit = 1 minute de vidéo source traitée. Ton quota restant est visible en permanence dans ton profil." },
  { q: "Puis-je annuler mon abonnement ?", a: "Oui, à tout moment depuis les paramètres. Aucun engagement, aucune pénalité." },
];

const PLATFORMS = ["TikTok", "YouTube Shorts", "Instagram Reels", "Snapchat", "LinkedIn"];

/* ─── helpers ────────────────────────────────────────────────── */

function youtubeEmbedSrc(id: string) {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1&modestbranding=1&rel=0`;
}

/* ─── components ─────────────────────────────────────────────── */

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
      >
        <span>{q}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="pb-5 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  );
}

const URL_PLACEHOLDER_EXAMPLES = [
  "youtube.com/watch?v=dQw4w9WgXcQ",
  "twitch.tv/videos/123456789",
  "Colle ton lien ici…",
  "youtu.be/dQw4w9WgXcQ",
];

function UrlBar({ onSubmit, size = "md" }: { onSubmit: (url: string) => void; size?: "md" | "lg" }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phDisplay, setPhDisplay] = useState("");
  const phStateRef = useRef({ exIdx: 0, charIdx: 0, phase: "typing" as "typing" | "pausing" | "deleting" });
  const phTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phTimerRef.current) clearTimeout(phTimerRef.current);
    const tick = () => {
      const st = phStateRef.current;
      if (st.phase === "typing") {
        const target = URL_PLACEHOLDER_EXAMPLES[st.exIdx];
        st.charIdx++;
        setPhDisplay(target.slice(0, st.charIdx));
        if (st.charIdx >= target.length) { st.phase = "pausing"; phTimerRef.current = setTimeout(tick, 2000); }
        else { phTimerRef.current = setTimeout(tick, 72); }
      } else if (st.phase === "pausing") {
        st.phase = "deleting";
        phTimerRef.current = setTimeout(tick, 42);
      } else {
        st.charIdx--;
        setPhDisplay(URL_PLACEHOLDER_EXAMPLES[st.exIdx].slice(0, st.charIdx));
        if (st.charIdx <= 0) {
          st.exIdx = (st.exIdx + 1) % URL_PLACEHOLDER_EXAMPLES.length;
          st.phase = "typing";
          phTimerRef.current = setTimeout(tick, 380);
        } else { phTimerRef.current = setTimeout(tick, 42); }
      }
    };
    phTimerRef.current = setTimeout(tick, 500);
    return () => { if (phTimerRef.current) clearTimeout(phTimerRef.current); };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) { onSubmit(""); return; }
    if (!isValidVideoUrl(v)) { setError("URL YouTube ou Twitch invalide"); return; }
    setError(null);
    onSubmit(v);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`mx-auto flex gap-2 rounded-2xl border border-border bg-white p-1.5 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all ${size === "lg" ? "max-w-xl" : "max-w-lg"}`}>
        <div className="relative flex-1 min-w-0">
          <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder=""
            className={`w-full pl-10 pr-3 bg-transparent text-foreground outline-none ${size === "lg" ? "h-12 text-[15px]" : "h-11 text-sm"}`}
          />
          {!url && (
            <span aria-hidden className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 select-none text-sm text-muted-foreground/55">
              {phDisplay}
              <span className="ml-px inline-block w-[1.5px] h-[1em] align-middle bg-muted-foreground/40 animate-[blink_1s_step-end_infinite]" />
            </span>
          )}
        </div>
        <button
          type="submit"
          className={`shrink-0 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center gap-2 ${size === "lg" ? "px-6 h-12" : "px-5 h-11"}`}
        >
          <Scissors className="size-4" />
          Générer
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </form>
  );
}

/* ─── page ───────────────────────────────────────────────────── */

export default function LandingPage() {
  const router = useRouter();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSubmit = (url: string) => {
    if (url) sessionStorage.setItem("vyrll_pending_url", url);
    router.push("/register");
  };

  const navScrolled = scrollY > 20;

  return (
    <div className="min-h-screen bg-white text-foreground overflow-x-hidden">

      {/* ── NAV ───────────────────────────────────────────────── */}
      <nav className={`fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-16 transition-all duration-300 ${navScrolled ? "bg-white/95 backdrop-blur-md border-b border-border shadow-sm" : ""}`}>
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="font-display font-bold text-foreground text-lg">Vyrll</span>
          <span className="font-mono text-[10px] text-primary px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5">BETA</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          {[["#produit","Produit"],["#pour-qui","Pour qui"],["#pricing","Tarifs"],["#faq","FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-foreground transition-colors">{label}</a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
            Connexion
          </Link>
          <Link href="/register" className="text-sm font-semibold px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors">
            Démarrer gratuitement
          </Link>
        </div>
      </nav>

      <main>

        {/* ── HERO ──────────────────────────────────────────────── */}
        <section className="relative pt-32 pb-24 px-6 overflow-hidden">
          {/* Background */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.07]"
              style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)" }} />
          </div>

          <div className="mx-auto max-w-5xl text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-8">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-xs text-primary font-medium">Tes vidéos YouTube & Twitch → clips viraux en 15 min</span>
            </div>

            <h1 className="font-display font-extrabold text-5xl sm:text-6xl lg:text-7xl leading-[1.05] text-foreground mb-6">
              Transforme tes longues<br />
              vidéos en{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(135deg, #7c3aed, #6366f1)" }}>
                  clips viraux
                </span>
                <span className="absolute -inset-1 -z-10 rounded-lg opacity-10" style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }} />
              </span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
              Colle une URL. L'IA détecte les meilleurs moments,
              recadre en 9:16 et brûle les sous-titres.
              Prêt à poster en quelques minutes.
            </p>

            <div className="flex flex-col items-center gap-4">
              <UrlBar onSubmit={handleSubmit} size="lg" />
              <p className="text-xs text-muted-foreground">Gratuit · Aucune carte bancaire · 30 min de quota offerts</p>
            </div>

            {/* Social proof */}
            <div className="flex items-center justify-center gap-6 mt-10">
              <div className="flex -space-x-2">
                {["T","L","K","S"].map((l, i) => (
                  <div key={i} className="size-8 rounded-full ring-2 ring-white flex items-center justify-center text-white text-xs font-bold font-display"
                    style={{ background: `hsl(${[217,280,32,160][i]},55%,45%)` }}>
                    {l}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex">{[...Array(5)].map((_,i) => <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />)}</div>
                <span className="text-xs text-muted-foreground font-medium">Utilisé par des créateurs en bêta</span>
              </div>
            </div>
          </div>

          {/* Product mockup */}
          <div className="mx-auto mt-16 max-w-5xl relative">
            <div className="rounded-2xl border border-border bg-white shadow-[0_8px_60px_rgba(0,0,0,0.1)] overflow-hidden">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/40">
                <div className="flex gap-1.5">
                  <div className="size-3 rounded-full bg-red-400/70" />
                  <div className="size-3 rounded-full bg-yellow-400/70" />
                  <div className="size-3 rounded-full bg-green-400/70" />
                </div>
                <div className="flex-1 mx-4 h-6 rounded-lg bg-white border border-border flex items-center px-3 gap-2">
                  <div className="size-3 rounded-full bg-muted" />
                  <span className="font-mono text-[11px] text-muted-foreground">app.vyrll.io/dashboard</span>
                </div>
              </div>
              {/* App preview */}
              <div className="grid grid-cols-[200px_1fr] min-h-[360px]">
                {/* Fake sidebar */}
                <div className="border-r border-border bg-white p-4 space-y-1">
                  <div className="h-8 rounded-lg bg-muted/50 mb-6" />
                  {["Accueil", "Projets", "Paramètres"].map((item, i) => (
                    <div key={item} className={`h-10 rounded-lg flex items-center px-3 gap-3 ${i === 0 ? "bg-primary/10" : ""}`}>
                      <div className={`size-4 rounded ${i === 0 ? "bg-primary/40" : "bg-muted"}`} />
                      <span className={`text-xs font-medium ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>{item}</span>
                    </div>
                  ))}
                </div>
                {/* Fake dashboard */}
                <div className="p-6 bg-[#fafafa]">
                  <div className="mb-4">
                    <div className="h-5 w-40 rounded bg-foreground/10 mb-1.5" />
                    <div className="h-3 w-64 rounded bg-muted" />
                  </div>
                  {/* URL input mockup */}
                  <div className="rounded-xl border border-border bg-white p-4 mb-4 shadow-sm">
                    <div className="flex gap-3">
                      <div className="flex-1 h-10 rounded-lg border border-border bg-[#fafafa] flex items-center px-3 gap-2">
                        <div className="size-3.5 rounded-full bg-muted" />
                        <span className="text-xs text-muted-foreground/60">youtube.com/watch?v=…</span>
                      </div>
                      <div className="h-10 w-32 rounded-lg flex items-center justify-center gap-2" style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}>
                        <Scissors className="size-3.5 text-white" />
                        <span className="text-xs font-semibold text-white">Générer</span>
                      </div>
                    </div>
                  </div>
                  {/* Clip cards mockup */}
                  <div className="grid grid-cols-3 gap-3">
                    {[85, 78, 91].map((score, i) => (
                      <div key={i} className="rounded-xl border border-border bg-white p-3 shadow-sm">
                        <div className="aspect-[9/16] rounded-lg bg-gradient-to-b from-muted to-muted/40 mb-2 relative overflow-hidden">
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Play className="size-6 text-muted-foreground/30" />
                          </div>
                          <div className="absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: score > 85 ? "#22c55e" : score > 75 ? "#f59e0b" : "#94a3b8", color: "white" }}>
                            {score}
                          </div>
                        </div>
                        <div className="h-2 w-full rounded bg-muted mb-1.5" />
                        <div className="h-2 w-3/4 rounded bg-muted/60" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PLATFORMS ─────────────────────────────────────────── */}
        <section className="py-10 border-y border-border bg-muted/30">
          <div className="mx-auto max-w-5xl px-6">
            <p className="text-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-6">
              Tes clips sont prêts pour
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
              {PLATFORMS.map((p) => (
                <span key={p} className="font-display font-bold text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── STATS ─────────────────────────────────────────────── */}
        <section className="py-20 px-6">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-3 gap-8 text-center">
            {STATS.map((s) => (
              <div key={s.value}>
                <p className="font-display font-extrabold text-4xl text-primary mb-1">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────── */}
        <section id="produit" className="py-20 px-6 bg-muted/30 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Comment ça marche</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-foreground">
                De l'URL au clip en 3 étapes
              </h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-6 relative">
              {/* Connector line */}
              <div className="hidden sm:block absolute top-[52px] left-[calc(16.67%+24px)] right-[calc(16.67%+24px)] h-px border-t border-dashed border-primary/30 -z-0" />
              {STEPS.map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.step} className="relative flex flex-col items-center text-center z-10">
                    <div className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-white shadow-sm" style={{ boxShadow: "0 4px 20px rgba(124,58,237,0.1)" }}>
                      <Icon className="size-6 text-primary" />
                    </div>
                    <span className="font-mono text-[10px] font-bold text-primary/50 mb-2">{s.step}</span>
                    <h3 className="font-display font-bold text-base text-foreground mb-2">{s.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────────────────── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Fonctionnalités</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-foreground mb-3">
                Tout ce qu'il faut. Rien de plus.
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Pas de timeline, pas de plugins, pas de compte Premiere Pro. URL → clips.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="rounded-2xl border border-border bg-white p-6 hover:border-primary/20 hover:shadow-md transition-all group">
                    <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/8 group-hover:bg-primary/12 transition-colors">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <h3 className="font-display font-semibold text-foreground mb-1.5">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── POUR QUI ─────────────────────────────────────────── */}
        <section id="pour-qui" className="py-20 px-6 bg-muted/30 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Pour qui</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-foreground">
                Tu publies du contenu vidéo ?<br />C'est pour toi.
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              {[
                { emoji: "🎮", title: "Créateurs & streamers",   desc: "Tes VOD et replays deviennent des Shorts sans refaire un montage." },
                { emoji: "🎙️", title: "Podcasteurs",              desc: "Les meilleurs extraits parlés, recadrés et sous-titrés pour les réseaux." },
                { emoji: "📈", title: "Social media managers",    desc: "Plus de tests d'hooks, moins de temps en timeline." },
                { emoji: "🏢", title: "Petites agences",          desc: "URL → clips livrables. Pour tous tes clients, tout le temps." },
              ].map((item) => (
                <div key={item.title} className="flex gap-5 rounded-2xl border border-border bg-white p-6 shadow-sm hover:shadow-md hover:border-primary/20 transition-all">
                  <span className="text-3xl shrink-0 mt-0.5">{item.emoji}</span>
                  <div>
                    <h3 className="font-display font-semibold text-foreground mb-1.5">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TESTIMONIALS ─────────────────────────────────────── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Témoignages</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-foreground">
                Ils publient plus. En moins de temps.
              </h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {TESTIMONIALS.map((t) => (
                <div key={t.name} className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-6 shadow-sm hover:shadow-md transition-all">
                  <div className="flex gap-0.5">
                    {[...Array(t.stars)].map((_,i) => <Star key={i} className="size-4 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed flex-1">"{t.text}"</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-border">
                    <div className="size-9 rounded-full flex items-center justify-center font-display font-bold text-white text-sm shrink-0"
                      style={{ background: `hsl(${t.hue},55%,45%)` }}>
                      {t.name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────────── */}
        <section id="pricing" className="py-24 px-6 bg-muted/30 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">Tarifs</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-foreground mb-3">
                Simple et transparent
              </h2>
              <p className="text-muted-foreground">Sans frais cachés. Sans engagement.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              {PLANS.map((plan) => (
                <div key={plan.id} className={`relative flex flex-col rounded-2xl border bg-white transition-shadow ${
                  plan.accent
                    ? "border-primary/30 shadow-[0_0_0_1px_rgba(124,58,237,0.12),0_8px_32px_rgba(124,58,237,0.12)]"
                    : "border-border shadow-sm hover:shadow-md"
                }`}>
                  {plan.accent && (
                    <div className="h-1 w-full rounded-t-2xl" style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }} />
                  )}
                  {plan.badge && (
                    <div className="absolute right-4 top-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
                        <Sparkles className="size-2.5" />
                        {plan.badge}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-7">
                    <p className="font-display text-lg font-bold text-foreground mb-1">{plan.name}</p>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className={`font-display text-4xl font-extrabold tabular-nums ${plan.accent ? "text-primary" : "text-foreground"}`}>
                        {plan.price}
                      </span>
                      {plan.period
                        ? <span className="text-muted-foreground">{plan.period}</span>
                        : <span className="text-muted-foreground">€</span>
                      }
                    </div>
                    <div className="flex items-center gap-2 mb-6 pb-6 border-b border-border">
                      <span className="rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{plan.clips}</span>
                      <span className="text-[11px] text-muted-foreground/60">·</span>
                      <span className="text-[11px] text-muted-foreground">{plan.quota}</span>
                    </div>
                    <ul className="mb-8 flex-1 space-y-3">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${plan.accent ? "bg-primary/15" : "bg-muted"}`}>
                            <Check className={`size-2.5 ${plan.accent ? "text-primary" : "text-muted-foreground"}`} strokeWidth={3} />
                          </div>
                          <span className="text-sm text-foreground">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={plan.href}
                      className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all ${
                        plan.accent
                          ? "bg-primary text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] hover:bg-primary/90 hover:shadow-[0_4px_16px_rgba(124,58,237,0.45)] active:scale-[0.98]"
                          : "bg-muted text-foreground hover:bg-muted/80 border border-border"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="size-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center mt-8">
              <Link href="/plans" className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
                Voir la comparaison détaillée <ArrowRight className="size-3.5" />
              </Link>
            </p>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section id="faq" className="py-20 px-6 border-t border-border">
          <div className="mx-auto max-w-2xl">
            <div className="text-center mb-12">
              <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">FAQ</p>
              <h2 className="font-display font-bold text-3xl text-foreground">Questions fréquentes</h2>
            </div>
            <div className="rounded-2xl border border-border bg-white px-6 shadow-sm">
              {FAQ_ITEMS.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ─────────────────────────────────────────── */}
        <section className="py-24 px-6 border-t border-border overflow-hidden relative">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-[0.06]"
              style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }} />
          </div>
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
              <Zap className="size-3.5 text-primary" />
              <span className="font-mono text-xs text-primary font-medium">Gratuit pour commencer</span>
            </div>
            <h2 className="font-display font-bold text-4xl sm:text-5xl text-foreground mb-4 leading-tight">
              Ton premier clip<br />en moins de 15 minutes
            </h2>
            <p className="text-muted-foreground mb-10 max-w-md mx-auto">
              30 minutes de quota offertes. Aucune carte bancaire.
            </p>
            <div className="flex justify-center">
              <UrlBar onSubmit={handleSubmit} size="lg" />
            </div>
            <Link href="/register" className="inline-flex items-center gap-1.5 mt-5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Ou créer un compte sans URL <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────── */}
        <footer className="py-12 px-6 border-t border-border bg-muted/30">
          <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-display font-bold text-foreground">Vyrll</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <Link href="/plans" className="hover:text-foreground transition-colors">Plans</Link>
              <Link href="/login" className="hover:text-foreground transition-colors">Connexion</Link>
              <Link href="/register" className="hover:text-foreground transition-colors">Inscription</Link>
            </div>
            <p className="text-xs text-muted-foreground">© 2026 Vyrll</p>
          </div>
        </footer>

      </main>
    </div>
  );
}
