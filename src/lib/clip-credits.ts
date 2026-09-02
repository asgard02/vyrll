/**
 * Crédits clips :
 * - **Auto court** (≤ 1h15) : ~1 crédit / min sur la durée **source**.
 * - **Auto long** (> 1h15) : crédits sur les **fenêtres** téléchargées (clips × (durationMax + 2×marge)), pas la VOD entière.
 * - **Manuel** : ~1 crédit / min sur la **plage** timeline (fin − début).
 */

import { AUTO_MAX_SOURCE_SEC } from "@/lib/clip-manual-range";
import { clipsMaxForSourceSeconds } from "@/lib/plan";

/** Marge autour d’un moment (aligné SECTION_MARGIN_SEC backend). */
export const LONG_AUTO_MARGIN_SEC = 30;

export function isLongAutoEnabled(): boolean {
  const v = process.env.LONG_AUTO_ENABLED?.trim();
  return v === "1" || v === "true";
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

/** Quota en mode auto court : ~1 crédit / min sur la durée source entière. */
export function creditsForAutoMode(source_duration_seconds: number): number {
  const s = Math.max(0, Number(source_duration_seconds));
  return Math.max(1, Math.ceil(s / 60));
}

/**
 * Auto long : on ne facture pas les 240 min d’une VOD 4 h.
 * 10 clips × (durationMax + 60 s de marge) — ex. 60 s clips → ~20 crédits.
 */
export function creditsForLongAuto(input: {
  sourceDurationSec: number;
  durationMaxSec: number;
  plan?: string | null;
}): number {
  const clipsMax = clipsMaxForSourceSeconds(
    input.sourceDurationSec,
    input.plan ?? "creator"
  );
  const windowSec =
    Math.max(1, Math.round(Number(input.durationMaxSec) || 0)) +
    2 * LONG_AUTO_MARGIN_SEC;
  return Math.max(1, Math.ceil((clipsMax * windowSec) / 60));
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
