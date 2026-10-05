export const SOURCE_PAD_SEC = 0;

export function sourceWindowForClip(
  clipStart: number,
  clipEnd: number,
  videoDur: number,
  padSec: number = SOURCE_PAD_SEC
): { sourceStart: number; sourceEnd: number } | null {
  const start = Number(clipStart);
  const end = Number(clipEnd);
  const dur = Number(videoDur);
  const pad = Number.isFinite(padSec) && padSec >= 0 ? padSec : SOURCE_PAD_SEC;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    return null;
  }
  const maxDur = Number.isFinite(dur) && dur > 0 ? dur : end + pad;
  const sourceStart = Math.max(0, start - pad);
  const sourceEnd = Math.min(maxDur, end + pad);
  if (!(sourceEnd > sourceStart + 0.2)) return null;
  return { sourceStart, sourceEnd };
}

/** Seconds into the source file that correspond to clip t=0. */
export function clipOriginInSource(
  clipStart: number,
  sourceStart: number
): number {
  const origin = Number(clipStart) - Number(sourceStart);
  return Number.isFinite(origin) ? Math.max(0, origin) : 0;
}
