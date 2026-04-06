/**
 * Crédits clips :
 * - **Auto** : ~1 crédit / min sur la durée **source** (transcription complète).
 * - **Manuel** : ~1 crédit / min sur la **durée de la plage** timeline (fin − début), pas sur toute la vidéo.
 */

export type ClipBillingInput = {
  /** Durée totale de la vidéo source (s), depuis yt-dlp. */
  sourceDurationSec: number;
  /** Plafond demandé pour le clip = duration_max choisi (s). */
  durationMaxSec: number;
};

/** Secondes facturables pour un job (transcription sur toute la source quand connue). */
export function billableClipSeconds(input: ClipBillingInput): number {
  const cap = Math.max(1, Math.round(input.durationMaxSec));
  const src = Math.max(0, Math.round(input.sourceDurationSec));
  if (src > 0) return src;
  return cap;
}

export function creditsForClipJob(input: ClipBillingInput): number {
  const sec = billableClipSeconds(input);
  if (sec <= 0) return 0;
  return Math.ceil(sec / 60);
}

/** Quota en mode auto : ~1 crédit / min sur la durée source entière. */
export function creditsForAutoMode(source_duration_seconds: number): number {
  const s = Math.max(0, Number(source_duration_seconds));
  return Math.max(1, Math.ceil(s / 60));
}

/**
 * Quota en mode manuel : ~1 crédit / min sur la **plage** choisie (secondes),
 * pas sur la durée totale de la vidéo.
 */
export function creditsForManualWindow(windowDurationSec: number): number {
  const s = Math.max(0, Number(windowDurationSec));
  if (s <= 0) return 0;
  return Math.max(1, Math.ceil(s / 60));
}
