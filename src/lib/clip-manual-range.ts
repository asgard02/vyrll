/**
 * Fenêtre [début, fin] sur la vidéo source pour l’analyse IA — **indépendante** de la durée cible des clips.
 */
export function clampSearchWindow(
  start: number,
  end: number,
  sourceDurationSec: number
): { start: number; end: number } {
  const dur = Math.max(0, Math.floor(sourceDurationSec));
  if (dur <= 1) return { start: 0, end: 1 };

  const s = Math.max(0, Math.min(Math.round(start), dur - 2));
  let e = Math.max(s + 1, Math.min(Math.round(end), dur));
  if (e <= s) e = Math.min(s + 1, dur);
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
