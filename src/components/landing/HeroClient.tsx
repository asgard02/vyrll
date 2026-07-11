"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Link2, Scissors } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isValidVideoUrl } from "@/lib/youtube";
import { formatLocaleNumber } from "@/lib/utils";

/** Typewriter placeholder — same effect as dashboard. */
function useTypewriterPlaceholder(active: boolean, examples: readonly string[]) {
  const [display, setDisplay] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ exIdx: 0, charIdx: 0, phase: "typing" as "typing" | "pausing" | "deleting" });

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!active) { setDisplay(""); return; }
    const st = stateRef.current;
    st.exIdx = 0; st.charIdx = 0; st.phase = "typing";
    const tick = () => {
      const target = examples[st.exIdx];
      if (st.phase === "typing") {
        st.charIdx++;
        setDisplay(target.slice(0, st.charIdx));
        if (st.charIdx >= target.length) { st.phase = "pausing"; timerRef.current = setTimeout(tick, 2000); }
        else { timerRef.current = setTimeout(tick, 72); }
      } else if (st.phase === "pausing") {
        st.phase = "deleting"; tick();
      } else {
        st.charIdx = Math.max(0, st.charIdx - 1);
        setDisplay(target.slice(0, st.charIdx));
        if (st.charIdx <= 0) {
          st.exIdx = (st.exIdx + 1) % examples.length;
          st.phase = "typing";
          timerRef.current = setTimeout(tick, 380);
        } else { timerRef.current = setTimeout(tick, 42); }
      }
    };
    timerRef.current = setTimeout(tick, 500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [active, examples]);

  return display;
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
  const t = useTranslations("landing.hero");
  const placeholders = t.raw("placeholders") as Record<string, string>;
  const examples = [placeholders.youtube, placeholders.twitch, placeholders.paste, placeholders.short] as const;

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const phDisplay = useTypewriterPlaceholder(!url, examples);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { onSubmit(""); return; }
    if (!isValidVideoUrl(trimmed)) {
      setError(t("invalidUrl"));
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex flex-col sm:flex-row gap-2 rounded-full border border-[#e5e5e7] bg-white p-1.5 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] focus-within:border-[#d2d2d7] focus-within:ring-4 focus-within:ring-primary/8 transition-all max-sm:rounded-3xl">
        <div className="flex-1 relative min-w-0">
          <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-[#1d1d1f]/40 pointer-events-none" />
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder=""
            autoComplete="url"
            className={`w-full pl-11 pr-4 rounded-full bg-transparent text-[#1d1d1f] outline-none ${size === "large" ? "h-13 text-base" : "h-11 text-[15px]"}`}
          />
          {!url && (
            <span
              aria-hidden
              className={`pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 select-none text-[#1d1d1f]/40 ${size === "large" ? "text-base" : "text-[15px]"}`}
            >
              {phDisplay}
              <span className="ml-px inline-block w-[1.5px] h-[1em] align-middle bg-[#1d1d1f]/30 animate-blink" />
            </span>
          )}
        </div>
        <button
          type="submit"
          className={`${size === "large" ? "h-13" : "h-11"} px-6 rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] text-white text-sm font-semibold shadow-[0_4px_14px_-4px_rgba(124,58,237,0.5)] hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shrink-0 max-sm:rounded-2xl`}
        >
          <Scissors className="size-4" />
          {t("generate")}
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
  const locale = useLocale();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = 2847, start = 2647, startTime = Date.now();
    const tick = () => {
      const progress = Math.min((Date.now() - startTime) / 2000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatLocaleNumber(Math.round(start + (target - start) * eased), locale);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [locale]);

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
