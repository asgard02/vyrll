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
  Timer,
  Layers,
  Clapperboard,
  Wand2,
  Headphones,
  Infinity,
  Rocket,
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
    text: "Plus de tests d’hooks, moins de temps en timeline.",
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
    title: "Colle l’URL",
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
    a: "Oui. Tu colles l’URL d’une VOD ou d’un contenu compatible ; le flux est traité comme une vidéo source pour en extraire des clips.",
  },
  {
    q: "Combien de temps ça prend ?",
    a: "Ça dépend de la durée de la vidéo et de la file. En pratique, compte quelques minutes pour une vidéo classique — tu suis l’avancement depuis ton espace.",
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

const KARAOKE_LINES = [
  "LE MOMENT QUI FAIT",
  "ARRÊTER LE SCROLL",
  "— EN 5 SECONDES —",
];

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
      ([e]) => {
        if (e.isIntersecting) tryPlay();
      },
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
      {/* phone frame */}
      <div className="relative mx-auto w-[260px] sm:w-[300px] md:w-[340px]">
        {/* glow */}
        <div className="pointer-events-none absolute -inset-6 rounded-[48px] bg-[#9b6dff]/10 blur-2xl" />

        {/* outer shell */}
        <div className="relative rounded-[36px] border-4 border-[#2a2a30] bg-[#0c0c0e] shadow-[0_0_80px_rgba(155,109,255,0.18)]">
          {/* notch */}
          <div className="absolute left-1/2 top-3 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0c0c0e] ring-2 ring-[#2a2a30]" />

          {/* screen — 9:16 */}
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
            {/* mute button */}
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="pointer-events-auto absolute right-3 top-8 flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white hover:bg-black/70"
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>

            {/* Vyrll badge */}
            <div className="pointer-events-none absolute left-3 top-8 rounded-full bg-[#9b6dff]/90 px-2 py-0.5">
              <span className="font-mono text-[9px] font-bold text-white">Vyrll</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] text-zinc-500">
        Clip exporté en 9:16 — prêt pour TikTok, Reels, Shorts
      </p>
    </div>
  );
}

function LandingDemoYoutube({ videoId }: { videoId: string }) {
  const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&playsinline=1&modestbranding=1&rel=0`;

  return (
    <div className="flex w-full flex-col items-center">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-[#1a1a1e] bg-[#0a0a0c] shadow-[0_0_60px_rgba(155,109,255,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#1a1a1e] bg-[#0c0c0e] px-3 py-2">
          <Link2 className="size-3.5 shrink-0 text-red-400/90" aria-hidden />
          <span className="truncate font-mono text-[10px] text-zinc-400">
            youtube.com/watch?v={videoId}
          </span>
          <span className="ml-auto font-mono text-[9px] text-[#9b6dff]">source</span>
        </div>
        <div className="relative aspect-video bg-black">
          <iframe
            className="absolute inset-0 size-full"
            src={embedSrc}
            title="Démo — lecture source YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
      <p className="mt-4 max-w-lg text-center font-mono text-[11px] text-zinc-500">
        Lecture depuis YouTube — source 16:9 originale
      </p>
    </div>
  );
}

function LandingDemoVideo() {
  const customMp4 =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_LANDING_DEMO_VIDEO_URL : undefined;
  const ytOverride =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_LANDING_DEMO_YOUTUBE_ID : undefined;

  const videoId = ytOverride || CLIP_DEMO.videoId;

  if (customMp4) {
    return <LandingDemoMp4 src={customMp4} />;
  }

  return <LandingDemoYoutube videoId={videoId} />;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#0f0f12] last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-zinc-200 hover:text-white transition-colors"
      >
        <span>{q}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <p className="pb-4 text-sm text-zinc-500 leading-relaxed">{a}</p>}
    </div>
  );
}

function UrlForm({
  onSubmit,
  className = "",
}: {
  onSubmit: (url: string) => void;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      onSubmit("");
      return;
    }
    if (!isValidVideoUrl(trimmed)) {
      setError("URL YouTube ou Twitch invalide");
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="group relative rounded-2xl bg-gradient-to-r from-[#2dd4bf]/20 via-[#9b6dff]/20 to-[#9b6dff]/20 p-px transition-all hover:from-[#2dd4bf]/35 hover:via-[#9b6dff]/35 hover:to-[#9b6dff]/35 focus-within:from-[#2dd4bf]/50 focus-within:via-[#9b6dff]/40 focus-within:to-[#9b6dff]/50 shadow-[0_0_30px_-8px_rgba(155,109,255,0.15)] hover:shadow-[0_0_40px_-6px_rgba(155,109,255,0.25)]">
        <div className="flex flex-col sm:flex-row gap-2 rounded-[15px] bg-[#0a0a0c] p-2">
          <div className="flex-1 relative min-w-0">
            <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="Lien YouTube ou Twitch…"
              className="w-full h-12 pl-11 pr-4 rounded-xl bg-transparent text-[15px] text-white placeholder-zinc-600 outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            className="h-12 px-6 rounded-xl bg-[#9b6dff] text-white text-sm font-semibold hover:bg-[#b894ff] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shrink-0"
          >
            <Scissors className="size-4" />
            Générer
          </button>
        </div>
      </div>
      {error && (
        <p className="font-mono text-xs text-[#ff3b3b] mt-2" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default function LandingPage() {
  const router = useRouter();
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
    const duration = 2000;
    const start = 2647;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
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
            entry.target.classList.add(
              "animate-in",
              "fade-in",
              "slide-in-from-bottom-4",
              "duration-700"
            );
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
    if (url) {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("vyrll_pending_url", url);
      }
    }
    router.push("/register");
  };

  const navScrolled = scrollY > 40;
  const heroGlowOpacity = Math.max(0, 1 - scrollY / 400);

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-x-hidden font-[family-name:var(--font-dm-sans)]">
      <div
        className="fixed inset-0 pointer-events-none z-[100] opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] pointer-events-none z-0 transition-opacity duration-500"
        style={{
          opacity: heroGlowOpacity,
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(155,109,255,0.18) 0%, transparent 70%)",
        }}
      />

      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-14 transition-all duration-300 ${
          navScrolled ? "bg-[#080809]/93 backdrop-blur-[12px] border-b border-[#111]" : ""
        }`}
      >
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8 shrink-0" />
          <span className="font-[family-name:var(--font-syne)] font-bold text-white">
            Vyrll
          </span>
          <span className="font-mono text-[10px] text-[#9b6dff] px-1.5 py-0.5 rounded border border-[#9b6dff]/30 bg-[#9b6dff]/5">
            BETA
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm">
          <a href="#produit" className="text-zinc-400 hover:text-white transition-colors">
            Produit
          </a>
          <a href="#pour-qui" className="text-zinc-400 hover:text-white transition-colors">
            Pour qui
          </a>
          <a href="#pricing" className="text-zinc-400 hover:text-white transition-colors">
            Tarifs
          </a>
          <a href="#faq" className="text-zinc-400 hover:text-white transition-colors">
            FAQ
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:inline text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Connexion
          </Link>
          <Link
            href="/register"
            className="text-sm font-medium px-4 py-2.5 rounded-xl bg-[#9b6dff] text-[#080809] hover:bg-[#b894ff] transition-colors"
          >
            Créer un compte
          </Link>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero */}
        <section className="pt-28 sm:pt-32 pb-16 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex flex-col lg:flex-row lg:items-center lg:gap-12">
              <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#9b6dff]/20 bg-[#9b6dff]/5 px-3 py-1 mb-5">
                  <span className="size-1.5 rounded-full bg-[#2dd4bf] animate-pulse" />
                  <span className="font-mono text-[11px] text-[#9b6dff]">
                    {counter.toLocaleString("fr-FR")} clips générés cette semaine
                  </span>
                </div>

                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl lg:text-[2.75rem] leading-[1.15] text-white mb-4">
                  Colle une URL,{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#2dd4bf] to-[#9b6dff]">
                    récupère tes clips.
                  </span>
                </h1>

                <p className="font-mono text-sm text-zinc-400 leading-relaxed max-w-md mb-8">
                  Vyrll détecte les moments forts de tes vidéos YouTube & Twitch, recadre en 9:16
                  et ajoute les sous-titres — prêt à poster en quelques minutes.
                </p>

                <UrlForm onSubmit={handleUrlSubmit} className="w-full max-w-[520px]" />

                <div className="flex items-center gap-4 mt-5">
                  <div className="flex -space-x-2">
                    {BETA_CREATORS.map((p) => (
                      <div
                        key={p.name}
                        className="size-7 rounded-full flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-white text-[10px] ring-2 ring-[#080809]"
                        style={{
                          background: `linear-gradient(135deg, hsl(${p.hue},45%,35%), hsl(${p.hue},55%,22%))`,
                        }}
                        aria-hidden
                      >
                        {p.name[0]}
                      </div>
                    ))}
                  </div>
                  <p className="font-mono text-[11px] text-zinc-500">
                    Utilisé par <span className="text-zinc-400">des créateurs</span> en bêta
                  </p>
                </div>
              </div>

              <div className="shrink-0 mt-12 lg:mt-0 flex justify-center lg:justify-end">
                <div className="relative">
                  <div className="w-[280px] sm:w-[320px] aspect-video rounded-xl border border-[#1a1a1e] bg-[#0a0a0c] overflow-hidden shadow-2xl -rotate-2 -translate-x-3">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#0f0f12] bg-[#0c0c0e]">
                      <div className="size-1.5 rounded-full bg-zinc-600" />
                      <div className="size-1.5 rounded-full bg-zinc-600" />
                      <div className="size-1.5 rounded-full bg-zinc-600" />
                      <span className="ml-1.5 font-mono text-[8px] text-zinc-600 truncate">
                        youtube.com
                      </span>
                    </div>
                    <img
                      src={getYouTubeThumbnailUrl(CLIP_DEMO.videoId)}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const next = getYouTubeThumbnailFallback((e.target as HTMLImageElement).src);
                        if (next) (e.target as HTMLImageElement).src = next;
                      }}
                    />
                  </div>
                  <div className="absolute -bottom-6 -right-4 sm:-right-8 w-[110px] sm:w-[130px] aspect-[9/16] rounded-xl border border-[#9b6dff]/40 bg-black overflow-hidden shadow-[0_0_50px_rgba(155,109,255,0.2)] rotate-[3deg] z-10">
                    <img
                      src={getYouTubeThumbnailUrl(CLIP_DEMO.videoId)}
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
                      <span className="font-mono text-[7px] text-[#2dd4bf] bg-black/60 px-1 py-0.5 rounded">
                        9:16
                      </span>
                    </div>
                  </div>
                  <div className="absolute top-1/2 right-[60px] sm:right-[70px] -translate-y-1/2 z-20">
                    <span className="font-mono text-lg text-[#9b6dff]/60">→</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Étapes — compact */}
        <section className="px-6 pb-6">
          <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-6 text-left"
                >
                  <span className="text-xs font-medium text-[#9b6dff]/80 mb-3 block">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-[#9b6dff]/10 p-2">
                      <Icon className="size-5 text-[#9b6dff]" aria-hidden />
                    </div>
                    <div>
                      <h2 className="font-[family-name:var(--font-syne)] font-semibold text-white text-base mb-1">
                        {s.title}
                      </h2>
                      <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Produit : démo */}
        <section
          id="produit"
          ref={(el) => {
            sectionRefs.current["produit"] = el;
          }}
          className="py-20 px-6 border-t border-[#0f0f12]"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-white text-center mb-3">
              Aperçu du flux
            </h2>
            <p className="text-center text-zinc-500 max-w-lg mx-auto mb-10">
              Comme dans l’app : une source large, puis tes exports prêts pour les réseaux.
            </p>
            <LandingDemoVideo />
          </div>
        </section>

        {/* Pour qui */}
        <section
          id="pour-qui"
          ref={(el) => {
            sectionRefs.current["pour-qui"] = el;
          }}
          className="py-20 px-6 bg-[#060607]/50"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-white text-center mb-3">
              Pour qui c’est fait
            </h2>
            <p className="text-center text-zinc-500 max-w-lg mx-auto mb-12">
              Un flux simple, pensé pour ceux qui publient souvent en vertical.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {POUR_QUI.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-6 flex gap-4"
                  >
                    <div className="shrink-0 size-12 rounded-xl bg-[#9b6dff]/10 flex items-center justify-center">
                      <Icon className="size-5 text-[#9b6dff]" aria-hidden />
                    </div>
                    <div>
                      <h3 className="font-[family-name:var(--font-syne)] font-semibold text-white text-base mb-1">
                        {item.title}
                      </h3>
                      <p className="text-sm text-zinc-500 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        {/* Fonctionnalités */}
        <section
          id="fonctionnalites"
          ref={(el) => {
            sectionRefs.current["fonctionnalites"] = el;
          }}
          className="py-20 px-6 border-t border-[#0f0f12]/80"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-white text-center mb-3">
              Tout est inclus
            </h2>
            <p className="text-center text-zinc-500 max-w-lg mx-auto mb-12">
              Pas de plugins, pas de timeline — tu colles le lien, tu récupères tes fichiers.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: Sparkles, title: "Détection IA", desc: "Les moments forts sont repérés automatiquement dans ta vidéo." },
                { icon: Scissors, title: "Recadrage auto", desc: "9:16 ou 1:1 — le sujet reste centré, pas de crop aléatoire." },
                { icon: Download, title: "Sous-titres stylés", desc: "Karaoké, Highlight ou Minimal — intégrés dans le MP4." },
                { icon: Mic2, title: "Transcription Whisper", desc: "L’audio est transcrit avec Whisper — même sur les vidéos longues." },
                { icon: TrendingUp, title: "Mode Auto ou Manuel", desc: "L’IA choisit le meilleur moment, ou tu places le curseur toi-même." },
                { icon: Users, title: "YouTube & Twitch", desc: "VOD, replay, vidéo longue — colle le lien, le reste est géré." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-6 flex flex-col gap-3"
                  >
                    <div className="size-10 rounded-xl bg-[#9b6dff]/10 flex items-center justify-center">
                      <Icon className="size-5 text-[#9b6dff]" aria-hidden />
                    </div>
                    <h3 className="font-[family-name:var(--font-syne)] font-semibold text-white text-base">
                      {item.title}
                    </h3>
                    <p className="text-sm text-zinc-500 leading-relaxed">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Tarifs */}
        <section
          id="pricing"
          ref={(el) => {
            sectionRefs.current["pricing"] = el;
          }}
          className="py-24 px-6 bg-[#060607]/30"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-white text-center mb-3">
              Tarifs
            </h2>
            <p className="text-sm text-zinc-500 text-center max-w-lg mx-auto mb-10 leading-relaxed">
              Estimation indicative (~20 min de vidéo source, ~3 clips par lancement). Le quota technique est rappelé
              sous le prix.
            </p>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-6 sm:p-8">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Gratuit
                </h3>
                <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                  Pour tester → 3 clips pour découvrir
                </p>
                <div className="mb-6">
                  <p className="text-2xl font-semibold text-[#9b6dff]">0€</p>
                  <p className="font-mono text-xs text-zinc-600 mt-1.5">(30 min de quota)</p>
                </div>
                <ul className="space-y-3 text-sm text-zinc-400 mb-8">
                  <li className="flex items-start gap-3">
                    <Sparkles className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>{PLAN_CLIP_QUOTA_LEAD.free}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Smartphone className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Clips 9:16 &amp; 1:1 avec sous-titres IA</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <TrendingUp className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Score viral par clip</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Frame className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Formats prêts pour TikTok / Reels / Shorts</span>
                  </li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-xl bg-white/[0.06] text-white text-sm font-medium text-center hover:bg-white/[0.1] transition-colors"
                >
                  Tester
                </Link>
              </div>

              <div
                className="rounded-2xl border border-[#9b6dff]/35 bg-[#0d110e] p-6 sm:p-8 relative overflow-hidden"
                style={{ boxShadow: "inset 0 2px 0 0 #9b6dff" }}
              >
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Creator
                </h3>
                <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                  Pour les créateurs sérieux → ~20 clips prêts à poster par mois
                </p>
                <div className="mb-6">
                  <p className="text-2xl font-semibold text-[#9b6dff]">9€/mois</p>
                  <p className="font-mono text-xs text-zinc-600 mt-1.5">(2h30 de quota / mois)</p>
                </div>
                <ul className="space-y-3 text-sm text-zinc-400 mb-8">
                  <li className="flex items-start gap-3">
                    <Sparkles className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>{PLAN_CLIP_QUOTA_LEAD.creator}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Timer className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Plus de quota vidéo source</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Layers className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Tout du plan Gratuit</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Clapperboard className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Projets clips sauvegardés</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Wand2 className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Transforme ta vidéo en clips verticaux</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Download className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Téléchargement des fichiers clip</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Headphones className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Réponse en moins de 24h</span>
                  </li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-xl bg-[#9b6dff] text-[#080809] text-sm font-semibold text-center hover:bg-[#b894ff] transition-colors"
                >
                  Passer Creator →
                </Link>
              </div>

              <div className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-6 sm:p-8">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Studio
                </h3>
                <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                  T&apos;as plus d&apos;excuses → ~60 clips prêts à poster par mois
                </p>
                <div className="mb-6">
                  <p className="text-2xl font-semibold text-[#9b6dff]">29€/mois</p>
                  <p className="font-mono text-xs text-zinc-600 mt-1.5">(6h40 de quota / mois)</p>
                </div>
                <ul className="space-y-3 text-sm text-zinc-400 mb-8">
                  <li className="flex items-start gap-3">
                    <Sparkles className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>{PLAN_CLIP_QUOTA_LEAD.studio}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Infinity className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Quota vidéo source maximal</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Layers className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Tout du plan Creator</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Rocket className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Tu testes avant tout le monde</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Headphones className="size-4 text-[#9b6dff] shrink-0 mt-0.5" />
                    <span>Réponse en moins de 24h</span>
                  </li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-xl bg-white/[0.06] text-white text-sm font-medium text-center hover:bg-white/[0.1] transition-colors"
                >
                  Choisir Studio
                </Link>
              </div>
            </div>
            <p className="text-center mt-10">
              <Link
                href="/plans"
                className="text-sm text-[#9b6dff] hover:text-[#b894ff] transition-colors"
              >
                Comparer toutes les options →
              </Link>
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          ref={(el) => {
            sectionRefs.current["faq"] = el;
          }}
          className="py-20 px-6 border-t border-[#0f0f12]"
        >
          <div className="max-w-xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl sm:text-3xl text-white text-center mb-8">
              Questions fréquentes
            </h2>
            <div className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e] px-6">
              {FAQ_ITEMS.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section
          ref={(el) => {
            sectionRefs.current["cta"] = el;
          }}
          className="py-20 px-6 border-t border-[#0f0f12]"
        >
          <div className="max-w-lg mx-auto text-center">
            <h2 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white mb-2">
              Lance ta première génération
            </h2>
            <p className="text-sm text-zinc-500 mb-8">
              Compte gratuit avec 30 min de vidéo pour tester.
            </p>
            <UrlForm onSubmit={handleUrlSubmit} />
            <Link
              href="/register"
              className="inline-block mt-6 text-sm text-[#9b6dff] hover:text-[#b894ff] transition-colors"
            >
              Ou inscris-toi sans URL →
            </Link>
          </div>
        </section>

        <footer className="py-10 px-6 border-t border-[#0f0f12]">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-[family-name:var(--font-syne)] font-bold text-white">Vyrll</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500">
              <Link href="/plans" className="hover:text-zinc-300 transition-colors">
                Plans
              </Link>
              <Link href="/login" className="hover:text-zinc-300 transition-colors">
                Connexion
              </Link>
              <Link href="/register" className="hover:text-zinc-300 transition-colors">
                Inscription
              </Link>
            </div>
            <p className="text-xs text-zinc-600 text-center sm:text-right">© 2026 Vyrll</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
