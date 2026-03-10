"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";

const EXAMPLES = [
  {
    id: "fugu",
    videoId: "QrqVKAPHZjM",
    channel: "SQUEEZIE",
    title: "QUI EST L'IMPOSTEUR ? (ft Mister V, Jonathan Cohen)",
    subscribers: "20M",
    views: "33,6M",
    score: 9,
    overperformed: true,
    verdict: "Ratio vues/abonnés de 1,68 — au-dessus de 1, excellente performance pour la niche entertainment. 33,6M vues pour 20M abonnés, vidéo longue (41 min). Invités populaires (Mister V, Joko) boostent l'engagement.",
    suggestedTitle: '"QUI MENT ? - Squeezie, Mister V et Joko (ft. Le Flambeau)"',
  },
  {
    id: "rick",
    videoId: "dQw4w9WgXcQ",
    channel: "Rick Astley",
    title: "Rick Astley - Never Gonna Give You Up",
    subscribers: "15M",
    views: "1.5B",
    score: 10,
    overperformed: true,
    verdict: "Vidéo iconique. Le titre court et mémorable + la thumbnail reconnaissable = combo parfait.",
    suggestedTitle: '"Never Gonna Give You Up - Official Video"',
  },
  {
    id: "first",
    videoId: "jNQXAC9IVRw",
    channel: "jawed",
    title: "Me at the zoo",
    subscribers: "3M",
    views: "300M",
    score: 8,
    overperformed: false,
    verdict: "Première vidéo YouTube. Simplicité et authenticité ont créé un moment historique.",
    suggestedTitle: '"Me at the zoo - The first YouTube video ever"',
  },
] as const;

const FEATURES = [
  { icon: "📊", title: "Score de performance réel", desc: "Ratio vues/abonnés dans le contexte de ta niche" },
  { icon: "✏️", title: "Titre optimisé par l'IA", desc: "Même langue, même style, CTR maximisé" },
  { icon: "🔍", title: "Audit SEO complet", desc: "Description, tags, mots-clés manquants" },
  { icon: "⏰", title: "Analyse du timing", desc: "Jour et créneau optimal pour ta niche" },
  { icon: "🖼️", title: "Tips thumbnail", desc: "Conseils basés sur la niche et le titre" },
  { icon: "💡", title: "Idée de prochaine vidéo", desc: "Basée sur ce qui a marché" },
];

function getScoreColor(score: number) {
  if (score >= 8) return "#00ff88";
  if (score >= 5) return "#ffaa00";
  return "#ff4444";
}

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
  const [activeExample, setActiveExample] = useState<(typeof EXAMPLES)[number]["id"]>("fugu");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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

      {/* Hero glow - disappears on scroll */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] pointer-events-none z-0 transition-opacity duration-500"
        style={{
          opacity: heroGlowOpacity,
          background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,255,136,0.15) 0%, transparent 70%)",
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
          <span className="font-[family-name:var(--font-syne)] font-bold text-white">flopcheck</span>
          <span className="font-mono text-[10px] text-[#00ff88] px-1.5 py-0.5 rounded border border-[#00ff88]/30 bg-[#00ff88]/5">
            BETA
          </span>
        </Link>
        <div className="hidden sm:flex items-center gap-8">
          <a href="#features" className="font-mono text-xs text-zinc-400 hover:text-white transition-colors">
            Features
          </a>
          <a href="#exemples" className="font-mono text-xs text-zinc-400 hover:text-white transition-colors">
            Exemples
          </a>
          <a href="#pricing" className="font-mono text-xs text-zinc-400 hover:text-white transition-colors">
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
        {/* Hero */}
        <section className="pt-32 pb-24 px-6 flex flex-col items-center">
          <div className="flex flex-col items-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#0f0f12] bg-[#0a0a0c] mb-8 font-mono text-xs text-zinc-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff88] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ff88]" />
              </span>
              Analysé par l&apos;IA · Résultats en 10 secondes
            </div>

            <h1
              className="font-[family-name:var(--font-syne)] font-extrabold text-5xl sm:text-6xl lg:text-[80px] leading-[1.05] text-center text-white mb-6"
              style={{ fontVariationSettings: '"wght" 800' }}
            >
              Ton contenu mérite
              <br />
              <span
                className="text-[#00ff88]"
                style={{ textShadow: "0 0 40px rgba(0,255,136,0.4)" }}
              >
                mieux que 200 vues.
              </span>
            </h1>

            <p className="text-lg text-[#444] max-w-[480px] text-center mb-10">
              Découvre pourquoi ta vidéo a floppé et reçois des recommandations concrètes pour la prochaine.
            </p>

            <form
              action="/register"
              method="GET"
              className="w-full max-w-[560px]"
            >
              <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-3 flex gap-2">
                <div className="flex-1 relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Collez une URL YouTube..."
                    readOnly
                    className="w-full h-12 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-sm outline-none focus:border-[#00ff88] focus:ring-1 focus:ring-[#00ff88]/50 transition-all cursor-pointer"
                    onClick={() => (window.location.href = "/register")}
                  />
                </div>
                <Link
                  href="/register"
                  className="h-12 px-6 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-medium hover:bg-[#00ff88]/90 active:scale-[0.98] transition-all flex items-center justify-center shrink-0"
                >
                  Analyser →
                </Link>
              </div>
            </form>

            <p className="font-mono text-xs text-[#2a2a2a] mt-4">
              3 analyses gratuites · Aucune CB requise
            </p>

            <div className="flex items-center gap-3 mt-10">
              <div className="flex -space-x-2">
                {["🎮", "📹", "🎬", "🔥", "⚡"].map((emoji, i) => (
                  <span
                    key={i}
                    className="w-9 h-9 rounded-full border-2 border-[#0a0a0c] bg-[#0d0d0f] flex items-center justify-center text-sm"
                  >
                    {emoji}
                  </span>
                ))}
              </div>
              <span className="font-mono text-xs text-zinc-500">
                +240 créateurs ont déjà analysé leurs vidéos
              </span>
            </div>
          </div>
        </section>

        {/* Exemples */}
        <section
          id="exemples"
          ref={(el) => { sectionRefs.current["exemples"] = el; }}
          className="py-24 px-6"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-white text-center mb-12">
              Ce que l&apos;IA détecte
            </h2>

            <div className="flex gap-2 mb-8 justify-center flex-wrap">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setActiveExample(ex.id)}
                  className={`font-mono text-xs px-4 py-2 rounded-lg border transition-all ${
                    activeExample === ex.id
                      ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/5"
                      : "border-[#0f0f12] text-zinc-500 hover:text-zinc-300 hover:border-[#1a1a1e]"
                  }`}
                >
                  {ex.channel}
                </button>
              ))}
            </div>

            <div className="relative min-h-[320px]">
              {EXAMPLES.filter((ex) => activeExample === ex.id).map((ex) => (
                <div
                  key={ex.id}
                  className="grid md:grid-cols-2 gap-8 items-start animate-in fade-in duration-300"
                >
                  <div className="rounded-xl overflow-hidden border border-[#0f0f12] bg-[#0a0a0c] group hover:border-[#1a1a1e] transition-all duration-300">
                    <div className="aspect-video relative overflow-hidden">
                      <img
                        src={`https://img.youtube.com/vi/${ex.videoId}/maxresdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="p-4">
                      <p className="font-[family-name:var(--font-syne)] font-bold text-white mb-1 line-clamp-2">
                        {ex.title}
                      </p>
                      <p className="font-mono text-xs text-zinc-500 mb-2">{ex.channel} · {ex.subscribers} abonnés</p>
                      <div className="flex items-center gap-3 font-mono text-xs text-zinc-500">
                        <span>{ex.views} vues</span>
                        <span
                          className="px-2 py-0.5 rounded font-medium"
                          style={{
                            color: getScoreColor(ex.score),
                            backgroundColor: `${getScoreColor(ex.score)}20`,
                          }}
                        >
Score {ex.score}/10
                        {ex.overperformed && " · overperformed"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-6 border-l-4 transition-colors"
                    style={{ borderLeftColor: getScoreColor(ex.score) }}
                  >
                    <p className="text-zinc-400 text-sm mb-4">{ex.verdict}</p>
                    <p className="font-mono text-xs text-zinc-500 mb-2">Titre suggéré par l&apos;IA</p>
                    <p className="text-[#00ff88] font-[family-name:var(--font-syne)] font-semibold">
                      {ex.suggestedTitle}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          ref={(el) => { sectionRefs.current["features"] = el; }}
          className="py-24 px-6"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-white text-center mb-16">
              Un diagnostic complet
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-6 hover:border-[#1a1a1e] hover:bg-[#0d0d0f] transition-all duration-300 group"
                >
                  <span className="text-2xl mb-3 block">{f.icon}</span>
                  <h3 className="font-[family-name:var(--font-syne)] font-bold text-white mb-2 group-hover:text-[#00ff88] transition-colors">
                    {f.title}
                  </h3>
                  <p className="font-mono text-xs text-zinc-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          ref={(el) => { sectionRefs.current["pricing"] = el; }}
          className="py-24 px-6"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-white text-center mb-16">
              Pricing
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-8 hover:border-[#1a1a1e] transition-all">
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                  Gratuit
                </h3>
                <p className="font-mono text-2xl text-[#00ff88] mb-6">0€</p>
                <ul className="space-y-3 font-mono text-sm text-zinc-400 mb-8">
                  <li>3 analyses par mois</li>
                  <li>Score + verdict</li>
                  <li>Titre optimisé</li>
                  <li>Tags suggérés</li>
                </ul>
                <Link
                  href="/register"
                  className="block w-full py-3 rounded-lg bg-[#111] text-white font-mono text-sm font-medium text-center hover:bg-[#1a1a1a] transition-all"
                >
                  Commencer gratuitement
                </Link>
              </div>

              <div
                className="rounded-xl border border-[#00ff8830] bg-[#0d110e] p-8 relative overflow-hidden hover:border-[#00ff8850] transition-all"
                style={{ boxShadow: "inset 0 2px 0 0 #00ff88" }}
              >
                <h3 className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                  Pro
                </h3>
                <p className="font-mono text-2xl text-[#00ff88] mb-6">9€/mois</p>
                <ul className="space-y-3 font-mono text-sm text-zinc-400 mb-8">
                  <li>Analyses illimitées</li>
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
                  Démarrer le Pro
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* CTA finale */}
        <section
          ref={(el) => { sectionRefs.current["cta"] = el; }}
          className="py-24 px-6"
        >
          <div className="max-w-[560px] mx-auto">
            <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-12 text-center">
              <img src="/logo.svg" alt="" className="size-16 mb-4 mx-auto" />
              <h2 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white mb-4">
                Arrête de poster dans le vide.
              </h2>
              <p className="text-zinc-500 text-sm mb-8">
                Rejoins les créateurs qui optimisent leurs vidéos avec l&apos;IA.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Analyser ma première vidéo →
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 px-6 border-t border-[#0f0f12]">
          <div className="max-w-5xl mx-auto flex items-center justify-center gap-2">
            <img src="/logo.svg" alt="" className="size-6" />
            <span className="font-[family-name:var(--font-syne)] font-bold text-white">flopcheck</span>
            <span className="font-mono text-xs text-zinc-500">·</span>
            <span className="font-mono text-xs text-zinc-500">2026 · fait par un créateur, pour les créateurs</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
