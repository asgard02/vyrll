/**
 * Crédits clips :
 * - **Auto** : ~1 crédit / min sur la durée **source** (y compris VOD > 1h15).
 * - **Manuel** : ~1 crédit / min sur la **plage** timeline (fin − début).
 */

import { AUTO_MAX_SOURCE_SEC } from "@/lib/clip-manual-range";

/** Marge autour d’un moment (aligné SECTION_MARGIN_SEC backend). Conservé pour le worker. */
export const LONG_AUTO_MARGIN_SEC = 30;

export function isLongAutoEnabled(): boolean {
  // Bracket access: Next otherwise inlines process.env.LONG_AUTO_ENABLED at build
  // (undefined → 1h15 banner forever on prod even if Railway has the var).
  const v = String(process.env["LONG_AUTO_ENABLED"] ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

export function isLongAutoSource(sourceDurationSec: number): boolean {
  return Math.max(0, Number(sourceDurationSec) || 0) > AUTO_MAX_SOURCE_SEC;
}

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
 * Auto long : même décompte que l’auto court (durée source).
 * Le worker télécharge toujours audio + extraits (plafond RAM).
 */
export function creditsForLongAuto(input: {
  sourceDurationSec: number;
  durationMaxSec: number;
  plan?: string | null;
}): number {
  return creditsForAutoMode(input.sourceDurationSec);
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
