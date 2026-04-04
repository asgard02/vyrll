/** Quotas crédits : 1 crédit ≈ 1 min de vidéo source par job (voir `clip-credits.ts`). */
export const PLAN_CREDITS = {
  freeLifetime: 30,
  creatorMonthly: 150,
  studioMonthly: 400,
} as const;

/** Affichage FR pour une durée en minutes (ex. 150 → « 2 h 30 min »). */
export function formatSourceMinutesFr(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h} h`;
  return `${h} h ${rem} min`;
}

/** Ligne courte avec le nombre de clips (ordre de grandeur, même base que les pitch tarifs). */
export const PLAN_CLIP_QUOTA_LEAD = {
  free: "~3 clips à vie",
  creator: "~20 clips / mois",
  studio: "~60 clips / mois",
} as const;

/** Textes « produit clips » communs aux pages tarifs / landing / paramètres. */
export const PLAN_CLIP_COPY = {
  free: {
    headline: "~3 clips pour découvrir",
    sub: "9:16, 1:1, sous-titres IA, score viral",
  },
  creator: {
    headline: "~20 clips prêts à poster par mois",
    sub: "Projets sauvegardés, téléchargement des fichiers",
  },
  studio: {
    headline: "~60 clips prêts à poster par mois",
    sub: "Priorité, nouveautés en avant-première",
  },
} as const;

/** Ligne quota discrète (facturation minutes source). */
export function planQuotaFootnote(planId: keyof typeof PLAN_CLIP_COPY): string {
  const c = PLAN_CREDITS;
  if (planId === "free") {
    return `${c.freeLifetime} crédits à vie · ${formatSourceMinutesFr(c.freeLifetime)} vidéo source · 1 crédit = 1 min`;
  }
  if (planId === "creator") {
    return `${c.creatorMonthly} crédits/mois · ${formatSourceMinutesFr(c.creatorMonthly)} vidéo source · 1 crédit = 1 min`;
  }
  return `${c.studioMonthly} crédits/mois · ${formatSourceMinutesFr(c.studioMonthly)} vidéo source · 1 crédit = 1 min`;
}

export function isPaidPlan(plan: string | undefined): boolean {
  return plan === "creator" || plan === "studio";
}

/**
 * Ordre de grandeur « clips prêts à poster » à partir des minutes de vidéo source,
 * aligné sur les pitch tarifs (30 min → ~3, 150 min → ~20, 400 min → ~60).
 */
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
