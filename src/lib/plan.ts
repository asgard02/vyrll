import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47, type Locale } from "@/i18n/config";

/** Quotas crédits : 1 crédit ≈ 1 min de vidéo source par job (voir `clip-credits.ts`). */
export const PLAN_CREDITS = {
  freeLifetime: 30,
  creatorMonthly: 90,
  studioMonthly: 210,
} as const;

/** Display source duration in minutes (e.g. 150 → "2 h 30 min" / "2 h 30 min"). */
export function formatSourceMinutes(minutes: number, locale?: string): string {
  const m = Math.max(0, Math.round(minutes));
  const loc = locale ?? "fr";
  if (m < 60) return loc === "en" ? `${m} min` : `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return loc === "en" ? `${h} h` : `${h} h`;
  return loc === "en" ? `${h} h ${rem} min` : `${h} h ${rem} min`;
}

/** @deprecated Use formatSourceMinutes with locale */
export const formatSourceMinutesFr = formatSourceMinutes;

export function usePlanClipQuotaLead() {
  const t = useTranslations("plans.clipQuotaLead");
  return {
    free: t("free"),
    creator: t("creator"),
    studio: t("studio"),
  };
}

export function usePlanClipCopy() {
  const t = useTranslations("plans.clipCopy");
  return {
    free: { headline: t("free.headline"), sub: t("free.sub") },
    creator: { headline: t("creator.headline"), sub: t("creator.sub") },
    studio: { headline: t("studio.headline"), sub: t("studio.sub") },
  };
}

export function planQuotaFootnote(
  planId: "free" | "creator" | "studio",
  locale?: string
): string {
  const c = PLAN_CREDITS;
  const loc = locale ?? "fr";
  const fmt = (credits: number, period: "free" | "creator" | "studio") => {
    const duration = formatSourceMinutes(credits, loc);
    if (period === "free") {
      return loc === "en"
        ? `${credits} lifetime credits · ${duration} source video · 1 credit = 1 min`
        : `${credits} crédits à vie · ${duration} vidéo source · 1 crédit = 1 min`;
    }
    return loc === "en"
      ? `${credits} credits/month · ${duration} source video · 1 credit = 1 min`
      : `${credits} crédits/mois · ${duration} vidéo source · 1 crédit = 1 min`;
  };
  if (planId === "free") return fmt(c.freeLifetime, "free");
  if (planId === "creator") return fmt(c.creatorMonthly, "creator");
  return fmt(c.studioMonthly, "studio");
}

export function usePlanQuotaFootnote(planId: "free" | "creator" | "studio"): string {
  const locale = useLocale();
  const t = useTranslations("plans.quotaFootnote");
  const c = PLAN_CREDITS;
  const credits =
    planId === "free" ? c.freeLifetime : planId === "creator" ? c.creatorMonthly : c.studioMonthly;
  const duration = formatSourceMinutes(credits, locale);
  return t(planId, { credits, duration });
}

/**
 * Plafond clips / job (prod) — miroir de `clipsMaxProduction` dans backend-clips/server.js.
 * <2 min→1 · 2–5→2 · 5–7→3 · 7–15→4 · 15–30→6 · ≥30→10
 */
export function clipsMaxForSourceSeconds(effectiveSec: number): number {
  const s = Math.max(0, Number(effectiveSec));
  if (s < 120) return 1;
  if (s < 300) return 2;
  if (s < 420) return 3;
  if (s < 900) return 4;
  if (s < 1800) return 6;
  return 10;
}

/**
 * Estimation marketing : quota brûlé en vidéos de `chunkMinutes` (défaut 30 → 10 clips/job).
 * Ex. 90 min → 3×30 min → 30 clips ; 210 min → 7×30 min → 70 clips.
 */
export function approximateClipsFromSourceMinutes(
  minutes: number,
  chunkMinutes: number = 30
): number {
  const m = Math.max(0, Math.round(minutes));
  if (m <= 0) return 0;
  const chunk = Math.max(1, Math.round(chunkMinutes));
  const fullJobs = Math.floor(m / chunk);
  const rem = m % chunk;
  let total = fullJobs * clipsMaxForSourceSeconds(chunk * 60);
  if (rem > 0) total += clipsMaxForSourceSeconds(rem * 60);
  return total;
}

/** Legacy constants — prefer usePlanClipQuotaLead() in client components */
export const PLAN_CLIP_QUOTA_LEAD = {
  free: "~10 clips à vie",
  creator: "~30 clips / mois",
  studio: "~70 clips / mois",
} as const;

export const PLAN_CLIP_COPY = {
  free: {
    headline: "~10 clips pour découvrir",
    sub: "9:16, 1:1, sous-titres IA, score viral",
  },
  creator: {
    headline: "~30 clips prêts à poster par mois",
    sub: "Volume mensuel, tout le pack Gratuit inclus",
  },
  studio: {
    headline: "~70 clips prêts à poster par mois",
    sub: "Tout Creator, nouveautés en avant-première",
  },
} as const;

export function isPaidPlan(plan: string | undefined): boolean {
  return plan === "creator" || plan === "studio";
}

/** @deprecated Prefer approximateClipsFromSourceMinutes(minutes) based on clipsMaxProduction. */
export function sourceMinutesPerClipEquiv(_plan?: string): number {
  return 3; // ≥30 min source → 10 clips ≈ 3 min/clip
}

export function getLocaleBcp47(locale?: string): string {
  return localeToBcp47((locale === "en" ? "en" : "fr") as Locale);
}
