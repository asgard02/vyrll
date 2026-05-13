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
  Users,
  Briefcase,
  ChevronDown,
  Volume2,
  VolumeX,
  Smartphone,
  Frame,
  Layers,
  Rocket,
  Check,
  Star,
  ArrowRight,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  isValidVideoUrl,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import { PLAN_CLIP_QUOTA_LEAD } from "@/lib/plan";

const BETA_CREATORS = [
  { name: "Théo", niche: "Gaming", subs: "12k abonnés", hue: "217" },
  { name: "Léa", niche: "Vlog", subs: "48k abonnés", hue: "280" },
  { name: "Karim", niche: "Sport", subs: "6k abonnés", hue: "32" },
  { name: "Sarah", niche: "Podcast", subs: "22k abonnés", hue: "160" },
];

const TESTIMONIALS = [
  {
    name: "Théo M.",
    role: "Streamer · 12k abonnés",
    text: "En 10 minutes j'avais 3 clips prêts à poster. Je n'aurais jamais fait ça aussi vite à la main.",
    hue: "217",
  },
  {
    name: "Léa D.",
    role: "YouTubeuse · 48k abonnés",
    text: "Le recadrage auto est bluffant — le sujet reste toujours centré, même sur une VOD de 2h.",
    hue: "280",
  },
  {
    name: "Karim B.",
    role: "Coach sportif en ligne",
    text: "Je publie 5x plus sur TikTok depuis Vyrll. Mes Reels ont explosé ce mois-ci.",
    hue: "32",
  },
];

const PLATFORMS = [
  { name: "TikTok", color: "#010101" },
  { name: "YouTube Shorts", color: "#FF0000" },
  { name: "Instagram Reels", color: "#C13584" },
  { name: "Snapchat", color: "#FFFC00" },
  { name: "LinkedIn", color: "#0A66C2" },
];

const POUR_QUI = [
  {
    icon: Mic2,
    title: "Créateurs & streamers",
    text: "Tes lives et VOD deviennent des Shorts sans refaire un montage.",
  },
  {
    icon: Users,
    title: "Podcasteurs",
    text: "Les meilleurs extraits parlés, recadrés et sous-titrés pour les réseaux.",
  },
  {
    icon: TrendingUp,
    title: "Growth & social",
    text: "Plus de tests d'hooks, moins de temps en timeline.",
  },
  {
    icon: Briefcase,
    title: "Petites agences",
    text: "Un flux simple : URL → clips livrables pour tes clients.",
  },
];

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Link2,
    title: "Colle l'URL",
    desc: "YouTube ou Twitch : VOD, replay ou long format.",
  },
  {
    icon: Sparkles,
    title: "IA & montage",
    desc: "Moments forts, recadrage 9:16 / 1:1 et sous-titres animés.",
  },
  {
    icon: Download,
    title: "Export",
    desc: "Télécharge et poste sur TikTok, Reels ou Shorts.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Ça marche avec Twitch aussi ?",
    a: "Oui. Tu colles l'URL d'une VOD ou d'un contenu compatible ; le flux est traité comme une vidéo source pour en extraire des clips.",
  },
  {
    q: "Combien de temps ça prend ?",
    a: "Ça dépend de la durée de la vidéo et de la file. En pratique, compte quelques minutes pour une vidéo classique — tu suis l'avancement depuis ton espace.",
  },
  {
    q: "Les sous-titres sont inclus ?",
    a: "Oui. Transcription + sous-titres stylés sur les clips exportés, pour coller aux habitudes TikTok / Reels / Shorts.",
  },
  {
    q: "Comment fonctionne le temps vidéo ?",
    a: "On compte environ 1 minute de vidéo source par minute de quota. Ton temps restant est visible dans ton profil selon ton plan.",
  },
  {
    q: "Puis-je annuler mon abonnement ?",
    a: "Oui. Tu gères ton plan depuis les paramètres ; le gratuit reste sans engagement.",
  },
];

const CLIP_DEMO = {
  videoId: "yhB3BgJyGl8",
  subtitlePreview: "SOUS-TITRE STYLÉ",
};

function youtubeEmbedSrc(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&playsinline=1&modestbranding=1&rel=0`;
}

function LandingDemoMp4({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);

  const tryPlay = () => {
    const v = ref.current;
    if (!v || document.hidden) return;
    void v.play().catch(() => {});
  };

  useEffect(() => {
    const v = ref.current;
    const root = wrapRef.current;
    if (!v || !root) return;

    const onVis = () => tryPlay();
    const onFocus = () => tryPlay();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);

    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) tryPlay(); },
      { threshold: 0.12, rootMargin: "80px 0px" }
    );
    io.observe(root);

    v.addEventListener("loadeddata", tryPlay);
    v.addEventListener("stalled", tryPlay);
    v.addEventListener("waiting", tryPlay);
    tryPlay();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      io.disconnect();
      v.removeEventListener("loadeddata", tryPlay);
      v.removeEventListener("stalled", tryPlay);
      v.removeEventListener("waiting", tryPlay);
    };
  }, [src]);

  return (
    <div ref={wrapRef} className="flex flex-col items-center w-full">
      <div className="relative mx-auto w-[260px] sm:w-[300px] md:w-[340px]">
        <div className="pointer-events-none absolute -inset-6 rounded-[48px] bg-primary/10 blur-2xl" />
        <div className="relative rounded-[36px] border-4 border-[#2a2a30] bg-[#0c0c0e] shadow-[0_20px_80px_rgba(124,58,237,0.2)]">
          <div className="absolute left-1/2 top-3 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0c0c0e] ring-2 ring-[#2a2a30]" />
          <div className="relative overflow-hidden rounded-[32px]" style={{ aspectRatio: "9/16" }}>
            <video
              ref={ref}
              className="absolute inset-0 size-full object-cover"
              src={src}
              autoPlay
              muted={muted}
              loop
              playsInline
              preload="auto"
              controls={false}
              aria-label="Exemple de clip exporté par Vyrll"
            />
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="pointer-events-auto absolute right-3 top-8 flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white hover:bg-black/70"
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
            <div className="pointer-events-none absolute left-3 top-8 rounded-full bg-primary/90 px-2 py-0.5">
              <span className="font-mono text-[9px] font-bold text-white">Vyrll</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] text-muted-foreground">
        Clip exporté en 9:16 — prêt pour TikTok, Reels, Shorts
      </p>
    </div>
  );
}

function LandingDemoYoutube({ videoId }: { videoId: string }) {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
          <Link2 className="size-3.5 shrink-0 text-red-400/90" aria-hidden />
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            youtube.com/watch?v={videoId}
          </span>
          <span className="ml-auto font-mono text-[9px] text-primary">source</span>
        </div>
        <div className="relative aspect-video bg-black">
          <iframe
            className="absolute inset-0 size-full"
            src={youtubeEmbedSrc(videoId)}
            title="Démo — lecture source YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
      <p className="mt-4 max-w-lg text-center font-mono text-[11px] text-muted-foreground">
        Lecture depuis YouTube — source 16:9 originale
      </p>
    </div>
  );
}

function LandingDemoVideo() {
  const envMp4 =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_LANDING_DEMO_VIDEO_URL : undefined;
  const customMp4 = envMp4 !== undefined ? envMp4 : "/demo.mp4";
  const ytOverride =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_LANDING_DEMO_YOUTUBE_ID : undefined;
  const videoId = ytOverride || CLIP_DEMO.videoId;
  if (customMp4) return <LandingDemoMp4 src={customMp4} />;
  return <LandingDemoYoutube videoId={videoId} />;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
      >
        <span>{q}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  );
}

function UrlForm({
  onSubmit,
  className = "",
  size = "default",
}: {
  onSubmit: (url: string) => void;
  className?: string;
  size?: "default" | "large";
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { onSubmit(""); return; }
    if (!isValidVideoUrl(trimmed)) {
      setError("URL YouTube ou Twitch invalide");
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex flex-col sm:flex-row gap-2 rounded-2xl border border-border bg-white p-1.5 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        <div className="flex-1 relative min-w-0">
          <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder="Lien YouTube ou Twitch…"
            className={`w-full pl-11 pr-4 rounded-xl bg-transparent text-foreground placeholder-muted-foreground outline-none ${size === "large" ? "h-13 text-base" : "h-11 text-[15px]"}`}
          />
        </div>
        <button
          type="submit"
          className="h-11 px-6 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shrink-0"
        >
          <Scissors className="size-4" />
          Générer
        </button>
      </div>
      {error && (
        <p className="font-mono text-xs text-destructive mt-2" role="alert">{error}</p>
      )}
    </form>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const demoVideoId =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_LANDING_DEMO_YOUTUBE_ID) ||
    CLIP_DEMO.videoId;
  const [scrollY, setScrollY] = useState(0);
  const [counter, setCounter] = useState(2647);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const target = 2847;
    const start = 2647;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / 2000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCounter(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in", "fade-in", "slide-in-from-bottom-4", "duration-700");
          }
        });
      },
      { threshold: 0.1, rootMargin: "-40px 0px" }
    );
    const refs = Object.values(sectionRefs.current).filter(Boolean) as HTMLElement[];
    refs.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleUrlSubmit = (url: string) => {
    if (url && typeof window !== "undefined") {
      sessionStorage.setItem("vyrll_pending_url", url);
    }
    router.push("/register");
  };

  const navScrolled = scrollY > 40;

  return (
    <div className="min-h-screen bg-white text-foreground overflow-x-hidden font-[family-name:var(--font-dm-sans)]">

      {/* Background blobs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/2 -left-60 w-[500px] h-[500px] rounded-full bg-indigo-500/4 blur-[100px]" />
      </div>

      {/* Nav */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-14 transition-all duration-300 ${
          navScrolled ? "bg-white/95 backdrop-blur-md border-b border-border shadow-sm" : ""
        }`}
      >
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8 shrink-0" />
          <span className="font-[family-name:var(--font-syne)] font-bold text-foreground">Vyrll</span>
          <span className="font-mono text-[10px] text-primary px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5">
            BETA
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm">
          {["#produit", "#pour-qui", "#pricing", "#faq"].map((href, i) => (
            <a
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {["Produit", "Pour qui", "Tarifs", "FAQ"][i]}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground transition-colors">
            Connexion
          </Link>
          <Link
            href="/register"
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            Créer un compte
          </Link>
        </div>
      </nav>

      <main className="relative z-10">

        {/* ── Hero ── */}
        <section className="pt-28 sm:pt-36 pb-16 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex flex-col lg:flex-row lg:items-center lg:gap-16">

              {/* Left */}
              <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 mb-6">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-mono text-[11px] text-primary font-medium">
                    {counter.toLocaleString("fr-FR")} clips générés cette semaine
                  </span>
                </div>

                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-4xl sm:text-5xl lg:text-[3.25rem] leading-[1.1] text-foreground mb-5">
                  Colle une URL,{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-indigo-500">
                    récupère tes clips.
                  </span>
                </h1>

                <p className="text-base text-muted-foreground leading-relaxed max-w-md mb-8">
                  Vyrll détecte les moments forts de tes vidéos YouTube & Twitch, recadre en 9:16
                  et ajoute les sous-titres — prêt à poster en quelques minutes.
                </p>

                <UrlForm onSubmit={handleUrlSubmit} className="w-full max-w-[520px]" />

                <p className="font-mono text-[11px] text-muted-foreground mt-2.5">
                  Gratuit · Aucune carte bancaire requise
                </p>

                <div className="flex items-center gap-4 mt-6">
                  <div className="flex -space-x-2">
                    {BETA_CREATORS.map((p) => (
                      <div
                        key={p.name}
                        className="size-7 rounded-full flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-white text-[10px] ring-2 ring-white"
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

              {/* Right — product mockup */}
              <div className="shrink-0 mt-14 lg:mt-0 flex justify-center lg:justify-end">
                <div className="relative">
                  <div className="w-[280px] sm:w-[320px] flex flex-col rounded-xl border border-border bg-white overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.1)] -rotate-2 -translate-x-3 aspect-video">
                    <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-muted">
                      <div className="size-2 rounded-full bg-red-400/70" />
                      <div className="size-2 rounded-full bg-yellow-400/70" />
                      <div className="size-2 rounded-full bg-green-400/70" />
                      <span className="ml-1.5 font-mono text-[8px] text-muted-foreground truncate">
                        youtube.com
                      </span>
                    </div>
                    <div className="relative min-h-0 flex-1 bg-black">
                      <iframe
                        className="absolute inset-0 size-full"
                        src={youtubeEmbedSrc(demoVideoId)}
                        title="Aperçu vidéo source"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  </div>
                  <div className="absolute -bottom-6 -right-4 sm:-right-8 w-[110px] sm:w-[130px] aspect-[9/16] rounded-xl border-2 border-primary/30 bg-black overflow-hidden shadow-[0_12px_50px_rgba(124,58,237,0.25)] rotate-[3deg] z-10">
                    <img
                      src={getYouTubeThumbnailUrl(demoVideoId)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover scale-125"
                      onError={(e) => {
                        const next = getYouTubeThumbnailFallback((e.target as HTMLImageElement).src);
                        if (next) (e.target as HTMLImageElement).src = next;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                    <div className="absolute bottom-0 left-0 right-0 p-2">
                      <p className="font-[family-name:var(--font-syne)] font-extrabold text-white text-[9px] sm:text-[10px] uppercase tracking-wide text-center leading-tight">
                        {CLIP_DEMO.subtitlePreview}
                      </p>
                    </div>
                    <div className="absolute top-2 right-2">
                      <span className="font-mono text-[7px] text-emerald-400 bg-black/60 px-1 py-0.5 rounded">9:16</span>
                    </div>
                  </div>
                  <div className="absolute top-1/2 right-[60px] sm:right-[70px] -translate-y-1/2 z-20">
                    <span className="font-mono text-xl text-primary/40">→</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Plateformes compatibles ── */}
        <section className="py-8 px-6 border-y border-border bg-muted/40">
          <div className="max-w-5xl mx-auto">
            <p className="text-center font-mono text-[11px] text-muted-foreground uppercase tracking-widest mb-6">
              Tes clips sont prêts pour
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8">
              {PLATFORMS.map((p) => (
                <span
                  key={p.name}
                  className="font-[family-name:var(--font-syne)] font-bold text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Étapes ── */}
        <section className="py-16 px-6">
          <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  className="rounded-2xl border border-border bg-white p-6 text-left shadow-sm hover:shadow-md hover:border-primary/20 transition-all"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-4 text-primary" aria-hidden />
                    </div>
                    <span className="font-mono text-[11px] font-bold text-primary/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h2 className="font-[family-name:var(--font-syne)] font-semibold text-foreground text-base mb-1.5">
                    {s.title}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Démo produit ── */}
        <section
          id="produit"
          ref={(el) => { sectionRefs.current["produit"] = el; }}
          className="py-20 px-6 border-t border-border bg-muted/30"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">
              Aperçu du flux
            </h2>
            <p className="text-center text-muted-foreground max-w-lg mx-auto mb-10">
              Comme dans l'app : une source large, puis tes exports prêts pour les réseaux.
            </p>
            <LandingDemoVideo />
          </div>
        </section>

        {/* ── Témoignages ── */}
        <section
          ref={(el) => { sectionRefs.current["temoignages"] = el; }}
          className="py-20 px-6 border-t border-border"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">
              Ce qu'ils en disent
            </h2>
            <p className="text-center text-muted-foreground max-w-lg mx-auto mb-12">
              Des créateurs en bêta qui l'utilisent chaque semaine.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {TESTIMONIALS.map((t) => (
                <div
                  key={t.name}
                  className="rounded-2xl border border-border bg-white p-6 flex flex-col gap-4 shadow-sm hover:shadow-md hover:border-primary/20 transition-all"
                >
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed flex-1">"{t.text}"</p>
                  <div className="flex items-center gap-3 pt-2 border-t border-border">
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
        <section
          id="pour-qui"
          ref={(el) => { sectionRefs.current["pour-qui"] = el; }}
          className="py-20 px-6 bg-muted/30 border-t border-border"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">
              Pour qui c'est fait
            </h2>
            <p className="text-center text-muted-foreground max-w-lg mx-auto mb-12">
              Un flux simple, pensé pour ceux qui publient souvent en vertical.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {POUR_QUI.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-border bg-white p-6 flex gap-4 shadow-sm hover:shadow-md hover:border-primary/20 transition-all"
                  >
                    <div className="shrink-0 size-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-5 text-primary" aria-hidden />
                    </div>
                    <div>
                      <h3 className="font-[family-name:var(--font-syne)] font-semibold text-foreground text-base mb-1">
                        {item.title}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Fonctionnalités ── */}
        <section
          id="fonctionnalites"
          ref={(el) => { sectionRefs.current["fonctionnalites"] = el; }}
          className="py-20 px-6 border-t border-border"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">
              Tout est inclus
            </h2>
            <p className="text-center text-muted-foreground max-w-lg mx-auto mb-12">
              Pas de plugins, pas de timeline — tu colles le lien, tu récupères tes fichiers.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: Sparkles, title: "Détection IA", desc: "Les moments forts sont repérés automatiquement dans ta vidéo." },
                { icon: Scissors, title: "Recadrage auto", desc: "9:16 ou 1:1 — le sujet reste centré, pas de crop aléatoire." },
                { icon: Download, title: "Sous-titres stylés", desc: "Karaoké, Highlight ou Minimal — intégrés dans le MP4." },
                { icon: Mic2, title: "Transcription Whisper", desc: "L'audio est transcrit avec Whisper — même sur les vidéos longues." },
                { icon: TrendingUp, title: "Mode Auto ou Manuel", desc: "L'IA choisit le meilleur moment, ou tu places le curseur toi-même." },
                { icon: Users, title: "YouTube & Twitch", desc: "VOD, replay, vidéo longue — colle le lien, le reste est géré." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-border bg-white p-6 flex flex-col gap-3 shadow-sm hover:shadow-md hover:border-primary/20 transition-all"
                  >
                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-5 text-primary" aria-hidden />
                    </div>
                    <h3 className="font-[family-name:var(--font-syne)] font-semibold text-foreground text-base">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Tarifs ── */}
        <section
          id="pricing"
          ref={(el) => { sectionRefs.current["pricing"] = el; }}
          className="py-24 px-6 bg-muted/30 border-t border-border"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-3">
              Tarifs
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-lg mx-auto mb-10 leading-relaxed">
              Estimation indicative (~20 min de vidéo source, ~3 clips par lancement).
            </p>
            <div className="grid md:grid-cols-3 gap-6">

              {/* Free */}
              <div className="rounded-2xl border border-border bg-white p-6 sm:p-8 shadow-sm">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-foreground mb-1">Gratuit</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">Pour tester → 3 clips pour découvrir</p>
                <div className="mb-6">
                  <p className="text-3xl font-bold text-foreground">0€</p>
                  <p className="font-mono text-xs text-muted-foreground mt-1">(30 min de quota)</p>
                </div>
                <ul className="space-y-3 text-sm text-muted-foreground mb-8">
                  {[PLAN_CLIP_QUOTA_LEAD.free, "Clips 9:16 & 1:1 avec sous-titres IA", "Score viral par clip", "Formats TikTok / Reels / Shorts"].map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" className="block w-full py-3 rounded-xl border border-border text-foreground text-sm font-medium text-center hover:bg-muted transition-colors">
                  Tester gratuitement
                </Link>
              </div>

              {/* Creator — highlighted */}
              <div className="rounded-2xl border-2 border-primary bg-white p-6 sm:p-8 relative overflow-hidden shadow-[0_4px_24px_rgba(124,58,237,0.15)]">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-indigo-500" />
                <div className="absolute top-4 right-4">
                  <span className="font-mono text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                    Populaire
                  </span>
                </div>
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-foreground mb-1">Creator</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">Pour les créateurs sérieux → ~20 clips prêts à poster</p>
                <div className="mb-6">
                  <p className="text-3xl font-bold text-primary">9€<span className="text-lg font-medium text-muted-foreground">/mois</span></p>
                  <p className="font-mono text-xs text-muted-foreground mt-1">(2h30 de quota / mois)</p>
                </div>
                <ul className="space-y-3 text-sm text-muted-foreground mb-8">
                  {[PLAN_CLIP_QUOTA_LEAD.creator, "Tout du plan Gratuit"].map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" className="block w-full py-3 rounded-xl bg-primary text-white text-sm font-semibold text-center hover:bg-primary/90 transition-colors">
                  Passer Creator →
                </Link>
              </div>

              {/* Studio */}
              <div className="rounded-2xl border border-border bg-white p-6 sm:p-8 shadow-sm">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-foreground mb-1">Studio</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">T'as plus d'excuses → ~60 clips prêts à poster par mois</p>
                <div className="mb-6">
                  <p className="text-3xl font-bold text-foreground">29€<span className="text-lg font-medium text-muted-foreground">/mois</span></p>
                  <p className="font-mono text-xs text-muted-foreground mt-1">(6h40 de quota / mois)</p>
                </div>
                <ul className="space-y-3 text-sm text-muted-foreground mb-8">
                  {[PLAN_CLIP_QUOTA_LEAD.studio, "Tout du plan Creator", "Tu testes avant tout le monde"].map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" className="block w-full py-3 rounded-xl border border-border text-foreground text-sm font-medium text-center hover:bg-muted transition-colors">
                  Choisir Studio
                </Link>
              </div>
            </div>
            <p className="text-center mt-10">
              <Link href="/plans" className="text-sm text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1">
                Comparer toutes les options <ArrowRight className="size-3.5" />
              </Link>
            </p>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section
          id="faq"
          ref={(el) => { sectionRefs.current["faq"] = el; }}
          className="py-20 px-6 border-t border-border"
        >
          <div className="max-w-xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-foreground text-center mb-8">
              Questions fréquentes
            </h2>
            <div className="rounded-2xl border border-border bg-white px-6 shadow-sm">
              {FAQ_ITEMS.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA Final ── */}
        <section
          ref={(el) => { sectionRefs.current["cta"] = el; }}
          className="py-24 px-6 border-t border-border"
        >
          <div className="max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 mb-6">
              <Zap className="size-3 text-primary" />
              <span className="font-mono text-[11px] text-primary font-medium">Gratuit pour commencer</span>
            </div>
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-3xl sm:text-4xl text-foreground mb-3">
              Lance ta première génération
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Compte gratuit avec 30 min de vidéo. Aucune carte bancaire.
            </p>
            <UrlForm onSubmit={handleUrlSubmit} className="max-w-[520px] mx-auto" size="large" />
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 mt-5 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Ou inscris-toi sans URL <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="py-10 px-6 border-t border-border bg-muted/30">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-[family-name:var(--font-syne)] font-bold text-foreground">Vyrll</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <Link href="/plans" className="hover:text-foreground transition-colors">Plans</Link>
              <Link href="/login" className="hover:text-foreground transition-colors">Connexion</Link>
              <Link href="/register" className="hover:text-foreground transition-colors">Inscription</Link>
            </div>
            <p className="text-xs text-muted-foreground text-center sm:text-right">© 2026 Vyrll</p>
          </div>
        </footer>

      </main>
    </div>
  );
}
