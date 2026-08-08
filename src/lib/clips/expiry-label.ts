import {
  FREE_CLIP_RETENTION_DAYS,
  clipExpiresAt,
  clipExpiryRemainingMs,
} from "@/lib/clips/retention";

export { FREE_CLIP_RETENTION_DAYS, clipExpiresAt };

export type ExpiryLabelKind =
  | { kind: "hours"; hours: number }
  | { kind: "tomorrow" }
  | { kind: "days"; days: number }
  | { kind: "soon" }
  | null;

/** Détermine le type de libellé d’expiration pour i18n. */
export function getExpiryLabelKind(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): ExpiryLabelKind {
  const remaining = clipExpiryRemainingMs(expiresAt, now);
  if (remaining == null) return null;
  if (remaining <= 0) return { kind: "soon" };
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours <= 24) return { kind: "hours", hours };
  if (hours <= 48) return { kind: "tomorrow" };
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  return { kind: "days", days };
}
