/**
 * Crédits clips : ~1 crédit par minute de **vidéo source** traitée en auto ;
 * en manuel, facturation sur la **durée d’extrait** demandée (plafonnée).
 */

export type ClipBillingInput = {
  /** Durée totale de la vidéo source (s), depuis yt-dlp. */
  sourceDurationSec: number;
  /** Plafond demandé pour le clip = duration_max choisi (s). Sert au mode manuel. */
  durationMaxSec: number;
  mode?: "auto" | "manual" | null;
  /** En manuel : début du segment (s). */
  startTimeSec?: number | null;
};

/** Secondes facturables pour un job. */
export function billableClipSeconds(input: ClipBillingInput): number {
  const cap = Math.max(1, Math.round(input.durationMaxSec));
  const src = Math.max(0, Math.round(input.sourceDurationSec));

  if (input.mode === "manual" && input.startTimeSec != null) {
    const start = Math.max(0, Math.round(input.startTimeSec));
    if (src <= 0) return cap;
    const remaining = Math.max(0, src - start);
    return Math.min(cap, remaining);
  }

  if (input.mode === "manual") {
    if (src > 0) return Math.min(cap, src);
    return cap;
  }

  // Auto : on facture la durée source entière (le plafond d’extrait ne réduit pas la facturation).
  if (src > 0) return src;
  return cap;
}

export function creditsForClipJob(input: ClipBillingInput): number {
  const sec = billableClipSeconds(input);
  if (sec <= 0) return 0;
  return Math.ceil(sec / 60);
}

/** Quota à la création du job en mode auto : transcription sur toute la source (~1 crédit / min). */
export function creditsForAutoMode(source_duration_seconds: number): number {
  const s = Math.max(0, Number(source_duration_seconds));
  return Math.max(1, Math.ceil(s / 60));
}
