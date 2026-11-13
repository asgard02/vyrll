/**
 * Coût d'une action en crédits. 1 crédit = 1 minute, arrondi à la minute supérieure.
 * Une action future (montage) s'ajoute ici, sans nouveau compteur.
 */
export const CREDIT_ACTIONS = {
  clip_standard: { creditsPerMinute: 1 },
  subtitle_regenerate: { creditsPerMinute: 1 },
  recut: { creditsPerMinute: 1 },
} as const;

export type CreditAction = keyof typeof CREDIT_ACTIONS;

export function creditsForSeconds(action: CreditAction, seconds: number): number {
  const rate = CREDIT_ACTIONS[action].creditsPerMinute;
  const s = Math.max(0, Number(seconds) || 0);
  if (s <= 0 || rate <= 0) return 0;
  return Math.max(1, Math.ceil(s / 60) * rate);
}

export function insufficientCreditsMessage(needed: number, remaining: number): string {
  const cost = Math.max(0, Math.round(needed));
  const left = Math.max(0, Math.round(remaining));
  return `Il te faut ${cost} crédits, il t'en reste ${left}.`;
}

/** Même fenêtre que le cron des abonnements annuels. */
export const QUOTA_PERIOD_MS = 28 * 24 * 60 * 60 * 1000;

export function quotaResetDue(
  quotaResetAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!quotaResetAt) return true;
  const t = Date.parse(quotaResetAt);
  if (!Number.isFinite(t)) return true;
  return t <= now.getTime() - QUOTA_PERIOD_MS;
}
