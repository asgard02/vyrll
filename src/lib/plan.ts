import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47, type Locale } from "@/i18n/config";

/** Quotas crédits : 1 crédit ≈ 1 min de vidéo source par job (voir `clip-credits.ts`). */
export const PLAN_CREDITS = {
  freeLifetime: 30,
  creatorMonthly: 150,
  studioMonthly: 400,
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

/** Legacy constants — prefer usePlanClipQuotaLead() in client components */
export const PLAN_CLIP_QUOTA_LEAD = {
  free: "~3 clips à vie",
  creator: "~20 clips / mois",
  studio: "~60 clips / mois",
} as const;

export const PLAN_CLIP_COPY = {
  free: {
    headline: "~3 clips pour découvrir",
    sub: "9:16, 1:1, sous-titres IA, score viral",
  },
  creator: {
    headline: "~20 clips prêts à poster par mois",
    sub: "Volume mensuel, tout le pack Gratuit inclus",
  },
  studio: {
    headline: "~60 clips prêts à poster par mois",
    sub: "Tout Creator, nouveautés en avant-première",
  },
} as const;

export function isPaidPlan(plan: string | undefined): boolean {
  return plan === "creator" || plan === "studio";
}

export function sourceMinutesPerClipEquiv(plan: string | undefined): number {
  if (plan === "free") return 10;
  if (plan === "creator") return 7.5;
  if (plan === "studio") return 400 / 60;
  return 20 / 3;
}

export function approximateClipsFromSourceMinutes(
  plan: string | undefined,
  minutes: number
): number {
  const m = Math.max(0, minutes);
  const div = sourceMinutesPerClipEquiv(plan);
  if (div <= 0) return 0;
  return Math.max(0, Math.round(m / div));
}

export function getLocaleBcp47(locale?: string): string {
  return localeToBcp47((locale === "en" ? "en" : "fr") as Locale);
}
