"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import {
  isValidYouTubeUrl,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";

const TICKER_ITEMS = [
  { channel: "MrBeast", title: "$1 vs $1,000,000 Hotel Room", score: 9, videoId: "iogcY_4xGjo" },
  { channel: "Squeezie", title: "QUI EST L'IMPOSTEUR ? (ft Mister V, Joko)", score: 8, videoId: "QrqVKAPHZjM" },
  { channel: "PewDiePie", title: "Minecraft Hardcore for 12 Hours", score: 7, videoId: "V-4sLymIv0M" },
  { channel: "Mister V", title: "LE RAP", score: 4, videoId: "8SzkEpm3_w8" },
  { channel: "Cyprien", title: "LES INSTAGRAMEUSES", score: 6, videoId: "VhzwnzLMV3U" },
  { channel: "MrBeast", title: "7 Days Stranded At Sea", score: 10, videoId: "yhB3BgJyGl8" },
  { channel: "Joyca", title: "24H DANS LE NOIR TOTAL ! (Version horreur)", score: 5, videoId: "xzlb9hbp9iI" },
  { channel: "Squeezie", title: "QUI EST L'IMPOSTEUR ? (ft Eric & Ramzy)", score: 3, videoId: "J1Z1A46FknM" },
  { channel: "Mark Rober", title: "World's Largest Jello Pool", score: 9, videoId: "5JUlNlGqnlw" },
  { channel: "Natoo", title: "ON DÉMÉNAGE !", score: 4, videoId: "syXPm4rHhis" },
];

const FLOOP_DEMO = {
  videoId: "yhB3BgJyGl8",
  title: "7 Jours perdus en mer",
  channel: "MrBeast",
  before: {
    title: "7 jours perdus en mer",
    score: 4,
    verdict: "Titre trop neutre. « 7 Days Stranded » — ok, mais pourquoi je cliquerais ? Le hook manque : la tension, la promesse. En scrollant, personne ne sait ce qui t'attend. Ajoute l'émotion dans le titre.",
  },
  after: {
    title: '"7 Jours Perdus en Mer — On a failli mourir"',
    quickwins: [
      "Titre = promesse + tension en 5 mots",
      "Thumbnail : situation extrême, émotion visible",
      "Le « pourquoi » doit être dans le titre",
    ],
  },
};

function getScoreColor(score: number) {
  if (score >= 8) return "#00ff88";
  if (score >= 5) return "#ffaa00";
  return "#ff4444";
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
    if (!isValidYouTubeUrl(trimmed)) {
      setError("URL YouTube invalide");
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-3 flex gap-2">
        <div className="flex-1 relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="Colle ton URL YouTube..."
            className="w-full h-12 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-sm outline-none focus:border-[#00ff88] focus:ring-1 focus:ring-[#00ff88]/50 transition-all"
          />
        </div>
        <button
          type="submit"
          className="h-12 px-6 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-medium hover:bg-[#00ff88]/90 active:scale-[0.98] transition-all flex items-center justify-center shrink-0"
        >
          Analyser →
        </button>
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

  // Animated counter on mount
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
        sessionStorage.setItem("flopcheck_pending_url", url);
      }
    }
    router.push("/register");
  };

  const navScrolled = scrollY > 40;
  const heroGlowOpacity = Math.max(0, 1 - scrollY / 400);

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-x-hidden">
      {/* Noise overlay */}
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
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,255,136,0.15) 0%, transparent 70%)",
        }}
      />

      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-14 transition-all duration-300 ${
          navScrolled ? "bg-[#080809]/93 backdrop-blur-[12px] border-b border-[#111]" : ""
        }`}
      >
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8 shrink-0" />
          <span className="font-[family-name:var(--font-syne)] font-bold text-white">
            flopcheck
          </span>
          <span className="font-mono text-[10px] text-[#00ff88] px-1.5 py-0.5 rounded border border-[#00ff88]/30 bg-[#00ff88]/5">
            BETA
          </span>
        </Link>
        <div className="hidden sm:flex items-center gap-8">
          <a
            href="#demo"
            className="font-mono text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Avant / Après
          </a>
          <a
            href="#pricing"
            className="font-mono text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="font-mono text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Connexion
          </Link>
          <Link
            href="/register"
            className="font-mono text-xs font-medium px-4 py-2 rounded-lg bg-[#00ff88] text-[#080809] hover:bg-[#00ff88]/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Commencer
          </Link>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero — Le coup de poing */}
        <section className="pt-32 pb-16 px-6 flex flex-col items-center">
          <div className="flex flex-col items-center max-w-2xl mx-auto">
            <h1
              className="font-[family-name:var(--font-syne)] font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.1] text-center text-white mb-10"
              style={{ fontVariationSettings: '"wght" 800' }}
            >
              Ta vidéo a fait un flop.
              <br />
              <span
                className="text-[#00ff88]"
                style={{ textShadow: "0 0 40px rgba(0,255,136,0.4)" }}
              >
                On te dit pourquoi en 30 secondes.
              </span>
            </h1>

            <UrlForm onSubmit={handleUrlSubmit} className="w-full max-w-[560px]" />
          </div>
        </section>

        {/* Social proof — compteur + ticker */}
        <section className="py-8 px-6">
          <div className="max-w-4xl mx-auto">
            <p className="font-mono text-center text-zinc-500 mb-6">
              <span className="text-[#00ff88] font-semibold tabular-nums">{counter.toLocaleString("fr-FR")}</span>{" "}
              vidéos analysées cette semaine
            </p>

            <div className="overflow-hidden border-y border-[#0f0f12] py-3">
              <div className="flex animate-ticker w-max">
                {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-6 shrink-0"
                  >
                    <img
                      src={getYouTubeThumbnailUrl(item.videoId)}
                      alt=""
                      className="w-32 h-[72px] rounded object-cover shrink-0"
                      onError={(e) => {
                        const next = getYouTubeThumbnailFallback(
                          (e.target as HTMLImageElement).src
                        );
                        if (next) (e.target as HTMLImageElement).src = next;
                      }}
                    />
                    <span
                      className="font-mono text-xs px-2 py-0.5 rounded font-medium shrink-0"
                      style={{
                        color: getScoreColor(item.score),
                        backgroundColor: `${getScoreColor(item.score)}20`,
                      }}
                    >
                      {item.score}/10
                    </span>
                    <span className="font-mono text-xs text-zinc-500 whitespace-nowrap">
                      {item.channel}
                    </span>
                    <span className="font-mono text-sm text-zinc-400 whitespace-nowrap">
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Before / After — démo visuelle */}
        <section
          id="demo"
          ref={(el) => {
            sectionRefs.current["demo"] = el;
          }}
          className="py-24 px-6"
        >
          <div className="max-w-5xl mx-auto">
            {/* Avant | Après — deux cartes côte à côte */}
            <div className="grid md:grid-cols-2 gap-6 mb-10">
              <div className="rounded-xl overflow-hidden border border-[#ff4444]/30 bg-[#0a0a0c]">
                <div className="px-4 pt-4 pb-2">
                  <span className="font-mono text-xs text-[#ff4444]">Avant</span>
                  <span className="font-mono text-xs text-zinc-500 ml-2">
                    Score {FLOOP_DEMO.before.score}/10
                  </span>
                </div>
                <div className="aspect-video relative overflow-hidden">
                  <img
                    src={getYouTubeThumbnailUrl(FLOOP_DEMO.videoId)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const next = getYouTubeThumbnailFallback(
                        (e.target as HTMLImageElement).src
                      );
                      if (next) (e.target as HTMLImageElement).src = next;
                    }}
                  />
                </div>
                <div className="p-4">
                  <p className="font-[family-name:var(--font-syne)] font-bold text-white line-clamp-2">
                    {FLOOP_DEMO.before.title}
                  </p>
                  <p className="font-mono text-xs text-zinc-500 mt-1">
                    {FLOOP_DEMO.channel}
                  </p>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden border border-[#00ff88]/40 bg-[#0a0a0c]">
                <div className="px-4 pt-4 pb-2">
                  <span className="font-mono text-xs text-[#00ff88]">Après</span>
                  <span className="font-mono text-xs text-zinc-500 ml-2">
                    Score 9/10
                  </span>
                </div>
                <div className="aspect-video relative overflow-hidden">
                  <img
                    src={getYouTubeThumbnailUrl(FLOOP_DEMO.videoId)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const next = getYouTubeThumbnailFallback(
                        (e.target as HTMLImageElement).src
                      );
                      if (next) (e.target as HTMLImageElement).src = next;
                    }}
                  />
                  <div className="absolute inset-0 bg-[#00ff88]/5" />
                </div>
                <div className="p-4">
                  <p className="text-[#00ff88] font-[family-name:var(--font-syne)] font-semibold line-clamp-2">
                    {FLOOP_DEMO.after.title}
                  </p>
                  <p className="font-mono text-xs text-zinc-500 mt-1">
                    {FLOOP_DEMO.channel}
                  </p>
                </div>
              </div>
            </div>

            {/* Diagnostic + Quick wins — bloc unique en dessous */}
            <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-6 md:p-8">
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">
                    Diagnostic
                  </h4>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {FLOOP_DEMO.before.verdict}
                  </p>
                </div>
                <div>
                  <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-wider mb-3">
                    Quick wins
                  </h4>
                  <ul className="space-y-2">
                    {FLOOP_DEMO.after.quickwins.map((w, i) => (
                      <li key={i} className="font-mono text-sm text-zinc-300 flex items-start gap-2">
                        <span className="text-[#00ff88] shrink-0">→</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing brutal */}
        <section
          id="pricing"
          ref={(el) => {
            sectionRefs.current["pricing"] = el;
          }}
          className="py-24 px-6"
        >
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-8">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Gratuit
                </h3>
                <p className="font-mono text-sm text-zinc-500 mb-4">
                  3 analyses pour tester
                </p>
                <p className="font-mono text-2xl text-[#00ff88] mb-6">0€</p>
                <ul className="space-y-2 font-mono text-xs text-zinc-400 mb-8">
                  <li>3 analyses / mois</li>
                  <li>Score + verdict</li>
                  <li>Titre optimisé par l&apos;IA</li>
                  <li>Tags suggérés</li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-lg bg-[#111] text-white font-mono text-sm font-medium text-center hover:bg-[#1a1a1a] transition-all"
                >
                  Tester
                </Link>
              </div>

              <div
                className="rounded-xl border border-[#00ff8830] bg-[#0d110e] p-8 relative overflow-hidden"
                style={{ boxShadow: "inset 0 2px 0 0 #00ff88" }}
              >
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Pro
                </h3>
                <p className="font-mono text-sm text-zinc-500 mb-4">
                  Pour les créateurs sérieux
                </p>
                <p className="font-mono text-2xl text-[#00ff88] mb-6">9€/mois</p>
                <ul className="space-y-2 font-mono text-xs text-zinc-400 mb-8">
                  <li>50 analyses / mois</li>
                  <li>Historique complet</li>
                  <li>Audit SEO avancé</li>
                  <li>Idée de prochaine vidéo</li>
                  <li>Tips thumbnail</li>
                  <li>Support prioritaire</li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold text-center hover:bg-[#00ff88]/90 transition-all"
                >
                  Passer Pro
                </Link>
              </div>

              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-8">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-1">
                  Unlimited
                </h3>
                <p className="font-mono text-sm text-zinc-500 mb-4">
                  T&apos;as plus d&apos;excuses
                </p>
                <p className="font-mono text-2xl text-[#00ff88] mb-6">29€/mois</p>
                <ul className="space-y-2 font-mono text-xs text-zinc-400 mb-8">
                  <li>Analyses illimitées</li>
                  <li>Tout du plan Pro</li>
                  <li>Export PDF / Markdown</li>
                  <li>Clips IA (bientôt)</li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-lg bg-[#111] text-white font-mono text-sm font-medium text-center hover:bg-[#1a1a1a] transition-all"
                >
                  Unlimited
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* CTA final — input URL répété */}
        <section
          ref={(el) => {
            sectionRefs.current["cta"] = el;
          }}
          className="py-24 px-6"
        >
          <div className="max-w-[560px] mx-auto">
            <p className="font-mono text-center text-zinc-500 mb-6">
              Tu veux tester ? Colle ton URL.
            </p>
            <UrlForm onSubmit={handleUrlSubmit} />
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 px-6 border-t border-[#0f0f12]">
          <div className="max-w-5xl mx-auto flex items-center justify-center gap-2">
            <img src="/logo.svg" alt="" className="size-6" />
            <span className="font-[family-name:var(--font-syne)] font-bold text-white">
              flopcheck
            </span>
            <span className="font-mono text-xs text-zinc-500">·</span>
            <span className="font-mono text-xs text-zinc-500">
              2026 · fait par un créateur, pour les créateurs
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
