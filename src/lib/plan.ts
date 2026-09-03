import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47, type Locale } from "@/i18n/config";

/** Quotas crédits : 1 crédit ≈ 1 min de vidéo source par job (voir `clip-credits.ts`). */
export const PLAN_CREDITS = {
  /** Nouveaux free uniquement — les free déjà à 30 en DB restent à 30. */
  freeLifetime: 10,
  /** 5 h / mois */
  creatorMonthly: 300,
  /** 12 h / mois */
  studioMonthly: 720,
} as const;

/** Multiplicateur Studio vs Creator (720 / 300 = 2,4). */
export function studioVsCreatorFactor(): number {
  return PLAN_CREDITS.studioMonthly / PLAN_CREDITS.creatorMonthly;
}

/** @deprecated Prefer studioVsCreatorFactor() — le label est juste le chiffre. */
export function studioVsCreatorFactorLabel(locale?: string): string {
  const n = PLAN_CREDITS.studioMonthly / PLAN_CREDITS.creatorMonthly;
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString(locale === "en" ? "en-US" : "fr-FR", {
    maximumFractionDigits: 1,
  });
}

export type PlanId = "free" | "creator" | "studio";

/** Plafond crédits pour un plan (fallback si `profiles.credits_limit` absent). */
export function creditsLimitForPlan(plan: string | null | undefined): number {
  if (plan === "creator") return PLAN_CREDITS.creatorMonthly;
  if (plan === "studio") return PLAN_CREDITS.studioMonthly;
  return PLAN_CREDITS.freeLifetime;
}

/** Édition + régénération des sous-titres : Creator & Studio uniquement. */
export function canRegenerateSubtitles(plan: string | null | undefined): boolean {
  return plan === "creator" || plan === "studio";
}

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
 * Free : hard-cap 3 · Creator/Studio : jusqu'à 10.
 */
export function clipsMaxForSourceSeconds(
  effectiveSec: number,
  plan: string | null | undefined = "free"
): number {
  const s = Math.max(0, Number(effectiveSec));
  let n = 1;
  if (s < 120) n = 1;
  else if (s < 300) n = 2;
  else if (s < 420) n = 3;
  else if (s < 900) n = 4;
  else if (s < 1800) n = 6;
  else n = 10;
  const paid = plan === "creator" || plan === "studio" || plan === "paid";
  return Math.min(n, paid ? 10 : 3);
}

/**
 * Estimation marketing : quota brûlé en vidéos de `chunkMinutes` (défaut 30 → 10 clips/job).
 * Ex. 90 min → 3×30 min → 30 clips ; 270 min → 9×30 min → 90 clips.
 */
export function approximateClipsFromSourceMinutes(
  minutes: number,
  chunkMinutes: number = 30,
  plan: string | null | undefined = "studio"
): number {
  const m = Math.max(0, Math.round(minutes));
  if (m <= 0) return 0;
  const chunk = Math.max(1, Math.round(chunkMinutes));
  const fullJobs = Math.floor(m / chunk);
  const rem = m % chunk;
  let total = fullJobs * clipsMaxForSourceSeconds(chunk * 60, plan);
  if (rem > 0) total += clipsMaxForSourceSeconds(rem * 60, plan);
  return total;
}

/** Legacy constants — prefer usePlanClipQuotaLead() in client components */
export const PLAN_CLIP_QUOTA_LEAD = {
  free: "10 min de vidéo à vie",
  creator: "5 h de vidéo / mois",
  studio: "12 h de vidéo / mois",
} as const;

export const PLAN_CLIP_COPY = {
  free: {
    headline: "10 min de vidéo pour découvrir",
    sub: "9:16, 1:1, sous-titres IA, score viral",
  },
  creator: {
    headline: "5 h de vidéo source par mois",
    sub: "Volume mensuel, tout le pack Gratuit inclus",
  },
  studio: {
    headline: "12 h de vidéo source par mois",
    sub: "Plus du double de Creator — pour scaler",
  },
} as const;

export function isPaidPlan(plan: string | undefined): boolean {
  return plan === "creator" || plan === "studio";
}

export type CreditsStatus = "ok" | "low" | "exhausted" | "unlimited";

/** Seuil : ≤20 % restants ou ≤5 crédits — alerte avant le mur. */
export const LOW_CREDITS_RATIO = 0.2;
export const LOW_CREDITS_ABSOLUTE = 5;

export function getCreditsRemaining(used: number, limit: number): number {
  if (limit < 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - used);
}

export function getCreditsStatus(used: number, limit: number): CreditsStatus {
  if (limit < 0) return "unlimited";
  if (limit === 0 || used >= limit) return "exhausted";
  const remaining = limit - used;
  if (remaining <= LOW_CREDITS_ABSOLUTE || remaining / limit <= LOW_CREDITS_RATIO) {
    return "low";
  }
  return "ok";
}

/** Plan suggéré pour l’upgrade (null = déjà au plafond Studio). */
export function nextPlanForUpgrade(
  plan: string | null | undefined
): "creator" | "studio" | null {
  if (plan === "studio") return null;
  if (plan === "creator") return "studio";
  return "creator";
}

/** @deprecated Prefer approximateClipsFromSourceMinutes(minutes) based on clipsMaxProduction. */
export function sourceMinutesPerClipEquiv(_plan?: string): number {
  return 3; // ≥30 min source → 10 clips ≈ 3 min/clip
}

export function getLocaleBcp47(locale?: string): string {
  return localeToBcp47((locale === "en" ? "en" : "fr") as Locale);
}
