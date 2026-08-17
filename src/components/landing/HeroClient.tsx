"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import { isValidVideoUrl } from "@/lib/youtube";
import { useTypewriterPlaceholder } from "@/lib/useTypewriterPlaceholder";
import { setPendingClipUrl } from "@/lib/pending-clip-url";

const ANALYZE_TOTAL_MS = 7000;
const ANALYZE_STEP_MS = 1400;

function UrlForm({
  onSubmit,
  className = "",
  size = "default",
  variant = "light",
  placeholderOverride,
  buttonLabelOverride,
  disabled = false,
}: {
  onSubmit: (url: string) => void;
  className?: string;
  size?: "default" | "large";
  variant?: "light" | "dark";
  placeholderOverride?: string;
  buttonLabelOverride?: string;
  disabled?: boolean;
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
  const typedPh = useTypewriterPlaceholder(!url && !placeholderOverride && !disabled, examples);
  const phDisplay = placeholderOverride && !url ? placeholderOverride : typedPh;
  const dark = variant === "dark";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
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
            disabled={disabled}
            className={`w-full rounded-full bg-transparent outline-none pl-11 pr-4 disabled:opacity-60 ${
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
          disabled={disabled}
          className={`flex shrink-0 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 max-sm:rounded-2xl ${
            size === "large" ? "h-13" : "h-11"
          } ${
            dark
              ? "bg-white text-[#1d1d1f] hover:bg-white/90"
              : "bg-[#6d28d9] text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-[#5b21b6]"
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

function AnalyzeOverlay({
  open,
  stepIndex,
  onSkip,
}: {
  open: boolean;
  stepIndex: number;
  onSkip: () => void;
}) {
  const t = useTranslations("landing.analyzeOverlay");
  const steps = t.raw("steps") as string[];

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-overlay-title"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#141416] px-7 py-8 text-white shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin text-[#a78bfa]" />
          <h2
            id="analyze-overlay-title"
            className="font-[family-name:var(--font-syne)] text-lg font-bold tracking-tight"
          >
            {t("title")}
          </h2>
        </div>
        <ul className="space-y-3">
          {steps.map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <li
                key={label}
                className={`flex items-center gap-3 text-sm transition-opacity ${
                  active ? "opacity-100" : done ? "opacity-50" : "opacity-30"
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    done || active
                      ? "bg-[#6d28d9] text-white"
                      : "border border-white/20 text-white/40"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={active ? "font-medium text-white" : "text-white/70"}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onSkip}
          className="mt-8 w-full rounded-full bg-white py-3 text-sm font-semibold text-[#1d1d1f] transition-colors hover:bg-white/90"
        >
          {t("cta")}
        </button>
      </div>
    </div>
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
  const [analyzing, setAnalyzing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    router.prefetch("/register");
    router.prefetch("/login");
  }, [router]);

  useEffect(() => {
    if (!analyzing) return;
    const steps = 5;
    const stepTimer = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps - 1));
    }, ANALYZE_STEP_MS);
    const doneTimer = window.setTimeout(() => {
      router.push("/register");
    }, ANALYZE_TOTAL_MS);
    return () => {
      window.clearInterval(stepTimer);
      window.clearTimeout(doneTimer);
    };
  }, [analyzing, router]);

  const goRegister = () => {
    router.push("/register");
  };

  const handleSubmit = (url: string) => {
    if (!url) {
      router.push("/register");
      return;
    }
    setPendingClipUrl(url);
    setStepIndex(0);
    setAnalyzing(true);
  };

  return (
    <>
      <UrlForm
        onSubmit={handleSubmit}
        className={className}
        size={size}
        variant={variant}
        placeholderOverride={placeholderOverride}
        buttonLabelOverride={buttonLabelOverride}
        disabled={analyzing}
      />
      <AnalyzeOverlay open={analyzing} stepIndex={stepIndex} onSkip={goRegister} />
    </>
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
