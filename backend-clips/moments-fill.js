/**
 * Place non-overlapping clip windows in the gaps left by already-chosen moments.
 * Used when GPT under-proposes (e.g. 3 moments on a 1h source that should yield 10 clips).
 */

function overlapTooMuch(a, b, ratio = 0.4) {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  if (overlap <= 0) return false;
  const aDur = Math.max(0.001, a.end - a.start);
  const bDur = Math.max(0.001, b.end - b.start);
  return overlap / Math.min(aDur, bDur) >= ratio;
}

function normalizeOccupied(occupied) {
  return (Array.isArray(occupied) ? occupied : [])
    .map((o) => ({
      start: Number(o.start),
      end: Number(o.end),
      source: o.source || "kept",
    }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start)
    .sort((a, b) => a.start - b.start);
}

function gapsBetween(occupied, t0, t1) {
  const gaps = [];
  let cursor = t0;
  for (const o of occupied) {
    if (o.start - cursor > 0) gaps.push({ start: cursor, end: o.start });
    cursor = Math.max(cursor, o.end);
  }
  if (t1 - cursor > 0) gaps.push({ start: cursor, end: t1 });
  return gaps;
}

function placeWindowsInGap(gapStart, gapEnd, windowSec, maxN) {
  const span = gapEnd - gapStart;
  if (!(span > 0) || !(windowSec > 0) || maxN <= 0) return [];
  if (span < windowSec * 0.85) return [];
  const nFit = Math.min(maxN, Math.max(1, Math.floor(span / windowSec)));
  const usable = Math.max(0, span - windowSec);
  const out = [];
  for (let k = 0; k < nFit; k++) {
    const start =
      nFit === 1 || usable <= 0 ? gapStart : gapStart + (usable * k) / (nFit - 1);
    const end = Math.min(gapEnd, start + windowSec);
    if (end > start) out.push({ start, end, source: "pad" });
  }
  return out;
}

/**
 * @param {{ occupied?: {start:number,end:number}[], t0:number, t1:number, windowSec:number, targetCount:number, overlapRatio?: number }} args
 * @returns {{ start:number, end:number, source:string }[]}
 */
export function padTimeWindows({
  occupied = [],
  t0,
  t1,
  windowSec,
  targetCount,
  overlapRatio = 0.4,
} = {}) {
  const startBound = Number(t0);
  const endBound = Number(t1);
  const win = Number(windowSec);
  const want = Math.max(0, Math.floor(Number(targetCount) || 0));
  const kept = normalizeOccupied(occupied);
  if (!Number.isFinite(startBound) || !Number.isFinite(endBound) || endBound <= startBound) {
    return kept;
  }
  if (!(win > 0) || want <= 0) return kept;
  const out = kept.slice();
  if (out.length >= want) return out.slice(0, want);

  const gaps = gapsBetween(out, startBound, endBound).filter(
    (g) => g.end - g.start >= win * 0.85
  );
  const remaining = want - out.length;
  const totalGap = gaps.reduce((s, g) => s + (g.end - g.start), 0);
  if (!(totalGap > 0) || remaining <= 0) return out;

  let left = remaining;
  for (let i = 0; i < gaps.length && left > 0; i++) {
    const g = gaps[i];
    const share =
      i === gaps.length - 1
        ? left
        : Math.max(1, Math.round(remaining * ((g.end - g.start) / totalGap)));
    const placed = placeWindowsInGap(g.start, g.end, win, Math.min(left, share));
    for (const w of placed) {
      if (out.length >= want) break;
      if (out.some((o) => overlapTooMuch(w, o, overlapRatio))) continue;
      out.push(w);
      left = want - out.length;
    }
  }

  if (out.length < want) {
    const leftover = gapsBetween(out, startBound, endBound).sort(
      (a, b) => b.end - b.start - (a.end - a.start)
    );
    for (const g of leftover) {
      if (out.length >= want) break;
      const placed = placeWindowsInGap(g.start, g.end, win, want - out.length);
      for (const w of placed) {
        if (out.length >= want) break;
        if (out.some((o) => overlapTooMuch(w, o, overlapRatio))) continue;
        out.push(w);
      }
    }
  }

  return out;
}

export function padWindowsOnly(filled) {
  return (filled || []).filter((w) => w.source === "pad");
}
