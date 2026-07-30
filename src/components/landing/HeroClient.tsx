"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Link2, Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import { isValidVideoUrl } from "@/lib/youtube";

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
  variant = "light",
  placeholderOverride,
  buttonLabelOverride,
}: {
  onSubmit: (url: string) => void;
  className?: string;
  size?: "default" | "large";
  variant?: "light" | "dark";
  placeholderOverride?: string;
  buttonLabelOverride?: string;
}) {
  const t = useTranslations("landing.hero");
  const placeholders = t.raw("placeholders") as Record<string, string>;
  // Mémoïsé : sinon un nouveau tableau est recréé à chaque rendu, ce qui
  // réinitialise en boucle l'effet du typewriter (dépendance instable) et
  // bloque l'animation après les 1-2 premiers caractères.
  const examples = useMemo(
    () =>
      placeholderOverride
        ? [placeholderOverride]
        : [placeholders.youtube, placeholders.twitch, placeholders.paste, placeholders.short],
    [placeholderOverride, placeholders.youtube, placeholders.twitch, placeholders.paste, placeholders.short]
  );

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const typedPh = useTypewriterPlaceholder(!url && !placeholderOverride, examples);
  const phDisplay = placeholderOverride && !url ? placeholderOverride : typedPh;
  const dark = variant === "dark";

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
      <div
        className={`flex flex-col gap-2 rounded-full p-1.5 transition-all max-sm:rounded-3xl sm:flex-row ${
          dark
            ? "border border-white/12 bg-white/8 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] focus-within:border-white/20 focus-within:ring-4 focus-within:ring-white/5"
            : "border border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] focus-within:border-[#d2d2d7] focus-within:ring-4 focus-within:ring-primary/8"
        }`}
      >
        <div className="relative min-w-0 flex-1">
          <Link2
            className={`pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 ${
              dark ? "text-white/40" : "text-[#1d1d1f]/40"
            }`}
          />
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder=""
            autoComplete="url"
            className={`w-full rounded-full bg-transparent outline-none pl-11 pr-4 ${
              dark ? "text-white placeholder:text-white/40" : "text-[#1d1d1f]"
            } ${size === "large" ? "h-13 text-base" : "h-11 text-[15px]"}`}
          />
          {!url && (
            <span
              aria-hidden
              className={`pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 select-none ${
                dark ? "text-white/40" : "text-[#1d1d1f]/40"
              } ${size === "large" ? "text-base" : "text-[15px]"}`}
            >
              {phDisplay}
              {!placeholderOverride && (
                <span
                  className={`ml-px inline-block h-[1em] w-[1.5px] animate-blink align-middle ${
                    dark ? "bg-white/40" : "bg-[#1d1d1f]/30"
                  }`}
                />
              )}
            </span>
          )}
        </div>
        <button
          type="submit"
          className={`flex shrink-0 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-all active:scale-[0.98] max-sm:rounded-2xl ${
            size === "large" ? "h-13" : "h-11"
          } ${
            dark
              ? "bg-white text-[#1d1d1f] hover:bg-white/90"
              : "bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] text-white shadow-[0_4px_14px_-4px_rgba(124,58,237,0.5)] hover:opacity-90"
          }`}
        >
          {!dark && <Scissors className="size-4" />}
          {buttonLabelOverride ?? t("generate")}
        </button>
      </div>
      {error && (
        <p className={`mt-2 font-mono text-xs ${dark ? "text-red-300" : "text-destructive"}`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function HeroUrlForm({
  className,
  size,
  variant,
  placeholderOverride,
  buttonLabelOverride,
}: {
  className?: string;
  size?: "default" | "large";
  variant?: "light" | "dark";
  placeholderOverride?: string;
  buttonLabelOverride?: string;
}) {
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

  return (
    <UrlForm
      onSubmit={handleSubmit}
      className={className}
      size={size}
      variant={variant}
      placeholderOverride={placeholderOverride}
      buttonLabelOverride={buttonLabelOverride}
    />
  );
}

export function PageAnimations() {
  useEffect(() => {
    const stagger = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); stagger.unobserve(e.target); } }),
      { threshold: 0.08, rootMargin: "-20px 0px" }
    );
    document.querySelectorAll(".stagger-parent").forEach((el) => stagger.observe(el));

    // Use explicit 0%→100% fade-up (globals.css) instead of Tailwind animate-in /
    // fade-in: those only define a 0% keyframe and Safari often leaves opacity /
    // translate stuck after the animation.
    const fade = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("lp-fade-in");
          fade.unobserve(e.target);
        }
      }),
      { threshold: 0.1, rootMargin: "-40px 0px" }
    );
    document.querySelectorAll("[data-animate]").forEach((el) => fade.observe(el));

    return () => { stagger.disconnect(); fade.disconnect(); };
  }, []);

  return null;
}
