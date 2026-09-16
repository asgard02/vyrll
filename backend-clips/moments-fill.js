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

function clampWindow(start, end, lo, hi) {
  let a = Math.max(lo, start);
  let b = Math.min(hi, end);
  if (b > a) return { start: a, end: b };
  return null;
}

function windowInBin(binStart, binEnd, windowSec, t0, t1) {
  const span = binEnd - binStart;
  if (!(span > 0) || !(windowSec > 0)) return null;
  const win = Math.min(windowSec, span, t1 - t0);
  if (!(win > 0)) return null;
  const mid = (binStart + binEnd) / 2;
  let start = mid - win / 2;
  let end = start + win;
  if (start < binStart) {
    start = binStart;
    end = Math.min(t1, Math.min(binEnd, start + win));
  }
  if (end > binEnd) {
    end = binEnd;
    start = Math.max(t0, Math.max(binStart, end - win));
  }
  return clampWindow(start, end, t0, t1);
}

/**
 * One clip per equal time bin across the full source.
 * Keeps the highest-score candidate in each bin; empty bins get a centered pad window.
 *
 * @param {{
 *   candidates?: { start:number, end:number, score?:number, source?:string }[],
 *   t0:number,
 *   t1:number,
 *   windowSec:number,
 *   targetCount:number,
 * }} args
 * @returns {{ start:number, end:number, source:string, score:number, index:number, bin:number }[]}
 */
export function binSpreadWindows({
  candidates = [],
  t0,
  t1,
  windowSec,
  targetCount,
} = {}) {
  const startBound = Number(t0);
  const endBound = Number(t1);
  const win = Math.max(1, Number(windowSec) || 45);
  const n = Math.max(1, Math.floor(Number(targetCount) || 1));
  const dur = endBound - startBound;

  const items = (Array.isArray(candidates) ? candidates : [])
    .map((c, index) => ({
      start: Number(c.start),
      end: Number(c.end),
      score: Number(c.score) || 0,
      source: c.source || "kept",
      index,
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);

  if (!Number.isFinite(startBound) || !Number.isFinite(endBound) || !(dur > 0)) {
    return items.slice(0, n).map((c, bin) => ({ ...c, bin, source: "kept" }));
  }

  if (dur < n * win * 0.85) {
    const filled = padTimeWindows({
      occupied: items.map((c) => ({ start: c.start, end: c.end, source: "kept" })),
      t0: startBound,
      t1: endBound,
      windowSec: win,
      targetCount: n,
    });
    const mapped = filled.map((w, bin) => {
      if (w.source === "pad") {
        return { start: w.start, end: w.end, score: 6, source: "pad", index: -1, bin };
      }
      const orig = items.find(
        (c) => Math.abs(c.start - w.start) < 0.05 && Math.abs(c.end - w.end) < 0.05
      );
      return {
        start: w.start,
        end: w.end,
        score: orig?.score || 0,
        source: "kept",
        index: orig?.index ?? -1,
        bin,
      };
    });
    return mapped;
  }

  const binOf = (mid) => {
    const t = Math.min(endBound - 1e-9, Math.max(startBound, mid));
    return Math.max(0, Math.min(n - 1, Math.floor(((t - startBound) / dur) * n)));
  };

  const best = Array.from({ length: n }, () => null);
  for (const c of items) {
    const b = binOf((c.start + c.end) / 2);
    if (!best[b] || c.score > best[b].score) {
      best[b] = { ...c, bin: b, source: "kept" };
    }
  }

  const out = [];
  for (let b = 0; b < n; b++) {
    if (best[b]) {
      out.push(best[b]);
      continue;
    }
    const binStart = startBound + (dur * b) / n;
    const binEnd = startBound + (dur * (b + 1)) / n;
    const placed = windowInBin(binStart, binEnd, win, startBound, endBound);
    if (!placed) continue;
    out.push({
      start: placed.start,
      end: placed.end,
      score: 6,
      source: "pad",
      index: -1,
      bin: b,
    });
  }
  return out;
}

export function binSpreadStats(windows) {
  const list = Array.isArray(windows) ? windows : [];
  return {
    kept: list.filter((w) => w.source !== "pad").length,
    pad: list.filter((w) => w.source === "pad").length,
    bins: list.length,
    lastEnd: list.reduce((m, w) => Math.max(m, Number(w.end) || 0), 0),
  };
}
