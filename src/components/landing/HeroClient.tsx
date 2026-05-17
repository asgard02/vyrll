"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Link2, Scissors } from "lucide-react";
import { isValidVideoUrl } from "@/lib/youtube";

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
      {error && <p className="font-mono text-xs text-destructive mt-2" role="alert">{error}</p>}
    </form>
  );
}

export function HeroUrlForm({ className, size }: { className?: string; size?: "default" | "large" }) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch("/register");
    router.prefetch("/login");
  }, [router]);

  const handleSubmit = (url: string) => {
    if (url && typeof window !== "undefined") {
      sessionStorage.setItem("upcut_pending_url", url);
    }
    router.push("/register");
  };

  return <UrlForm onSubmit={handleSubmit} className={className} size={size} />;
}

export function HeroCounter() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = 2847, start = 2647, startTime = Date.now();
    const tick = () => {
      const progress = Math.min((Date.now() - startTime) / 2000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * eased).toLocaleString("fr-FR");
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  return <span ref={ref}>2 647</span>;
}

export function PageAnimations() {
  useEffect(() => {
    const stagger = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); stagger.unobserve(e.target); } }),
      { threshold: 0.08, rootMargin: "-20px 0px" }
    );
    document.querySelectorAll(".stagger-parent").forEach((el) => stagger.observe(el));

    const fade = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("animate-in", "fade-in", "slide-in-from-bottom-4", "duration-700"); fade.unobserve(e.target); } }),
      { threshold: 0.1, rootMargin: "-40px 0px" }
    );
    document.querySelectorAll("[data-animate]").forEach((el) => fade.observe(el));

    return () => { stagger.disconnect(); fade.disconnect(); };
  }, []);

  return null;
}
