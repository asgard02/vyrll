/** Aligné sur `MAX_VIDEO_DURATION_SEC` du backend — au-delà, le mode auto est refusé. */
export const AUTO_MAX_SOURCE_SEC = 75 * 60;

/** Fenêtre manuelle par défaut (évite de sélectionner une VOD Twitch entière de plusieurs heures). */
export const DEFAULT_MANUAL_WINDOW_SEC = 10 * 60;

/** Plafond de plage manuelle (crédits + Whisper + segment download). */
export const MAX_MANUAL_WINDOW_SEC = 45 * 60;

/**
 * Fenêtre initiale raisonnable : toute la source si courte, sinon les N premières minutes.
 */
export function defaultManualSearchWindow(sourceDurationSec: number): {
  start: number;
  end: number;
} {
  const dur = Math.max(0, Math.floor(sourceDurationSec));
  if (dur <= 1) return { start: 0, end: 1 };
  const end = Math.min(dur, DEFAULT_MANUAL_WINDOW_SEC);
  return { start: 0, end };
}

/**
 * Fenêtre [début, fin] sur la vidéo source.
 * - URL / moments : zone où l’IA cherche (indépendante de la durée cible des clips)
 * - Upload : extrait exact à rendre (pas de sous-sélection IA)
 */
export function clampSearchWindow(
  start: number,
  end: number,
  sourceDurationSec: number,
  maxWindowSec: number = MAX_MANUAL_WINDOW_SEC
): { start: number; end: number } {
  const dur = Math.max(0, Math.floor(sourceDurationSec));
  if (dur <= 1) return { start: 0, end: 1 };

  const s = Math.max(0, Math.min(Math.round(start), dur - 2));
  let e = Math.max(s + 1, Math.min(Math.round(end), dur));
  if (e <= s) e = Math.min(s + 1, dur);
  const maxWin = Math.max(1, Math.floor(maxWindowSec));
  if (e - s > maxWin) e = Math.min(s + maxWin, dur);
  return { start: s, end: e };
}

/**
 * Borne [début, fin] sur la durée source et respecte une longueur d’extrait min–max (secondes).
 */
export function clampManualSegment(
  start: number,
  end: number,
  sourceDurationSec: number,
  minLen: number,
  maxLen: number
): { start: number; end: number } {
  const dur = Math.max(0, Math.floor(sourceDurationSec));
  if (dur <= 1) return { start: 0, end: 1 };

  let s = Math.max(0, Math.min(Math.round(start), dur - 2));
  let e = Math.max(s + 1, Math.min(Math.round(end), dur));

  if (e - s < minLen) e = Math.min(s + minLen, dur);
  if (e - s > maxLen) e = Math.min(s + maxLen, dur);
  if (e <= s) e = Math.min(s + minLen, dur);

  return { start: s, end: e };
}
