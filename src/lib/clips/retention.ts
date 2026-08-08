/** Rétention clips free : purge auto après N jours (aligné backend-clips). */
export const FREE_CLIP_RETENTION_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function clipRetentionDays(
  plan: string | null | undefined
): number | null {
  if (plan === "creator" || plan === "studio" || plan === "paid") return null;
  return FREE_CLIP_RETENTION_DAYS;
}

export function clipExpiresAt(
  createdAt: string | Date | null | undefined,
  plan: string | null | undefined
): string | null {
  const days = clipRetentionDays(plan);
  if (days == null || !createdAt) return null;
  const created =
    createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return new Date(created.getTime() + days * MS_PER_DAY).toISOString();
}

export function isClipExpired(
  createdAt: string | Date | null | undefined,
  plan: string | null | undefined,
  now: Date = new Date()
): boolean {
  const expires = clipExpiresAt(createdAt, plan);
  if (!expires) return false;
  return new Date(expires).getTime() <= now.getTime();
}

/** Libellé court pour l’UI (à passer via i18n côté composant). */
export function clipExpiryRemainingMs(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return t - now.getTime();
}
