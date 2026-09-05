import type { ClipTextSegment } from "@/lib/clips/types";

/** Caption cartouche: locked time window + freely editable text. */
export type ClipShot = {
  start: number;
  end: number;
  text: string;
};

/** Matches backend-clips/render_subtitles.py `_MAX_WORD_GAP_IN_BLOCK`. */
const MAX_WORD_GAP_SEC = 0.65;

export function maxWordsPerShot(
  style?: string | null,
  renderMode?: string | null
): number {
  if (renderMode === "split_vertical") return 2;
  if (style === "impact") return 2;
  if (style === "minimal") return 6;
  return 3;
}

function tokenCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Reburn already stored phrase-level segments — don't regroup into smaller shots. */
export function segmentsArePackedShots(segments: ClipTextSegment[]): boolean {
  if (segments.length === 0) return false;
  const packed = segments.filter((s) => tokenCount(s.text) >= 2).length;
  return packed >= Math.ceil(segments.length * 0.4);
}

function flushChunk(chunk: ClipTextSegment[]): ClipShot {
  const start = chunk[0].start;
  const end = Math.max(chunk[chunk.length - 1].end, start + 0.05);
  return {
    start,
    end,
    text: chunk
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

/**
 * Word-level transcript → on-screen cartouches (same cuts as the renderer:
 * max words per block + silence gap). Packed segments stay one shot each.
 */
export function groupSegmentsIntoShots(
  segments: ClipTextSegment[],
  options?: { style?: string | null; renderMode?: string | null }
): ClipShot[] {
  if (!segments.length) return [];
  if (segmentsArePackedShots(segments)) {
    return segments.map((s) => ({
      start: s.start,
      end: Math.max(s.end, s.start + 0.05),
      text: s.text.replace(/\s+/g, " ").trim(),
    }));
  }

  const maxPer = maxWordsPerShot(options?.style, options?.renderMode);
  const shots: ClipShot[] = [];
  let cur: ClipTextSegment[] = [];

  for (const word of segments) {
    if (!cur.length) {
      cur = [word];
      continue;
    }
    const gap = word.start - cur[cur.length - 1].end;
    if (cur.length >= maxPer || gap > MAX_WORD_GAP_SEC) {
      shots.push(flushChunk(cur));
      cur = [word];
    } else {
      cur.push(word);
    }
  }
  if (cur.length) shots.push(flushChunk(cur));
  return shots;
}

export function shotsToSegments(shots: ClipShot[]): ClipTextSegment[] {
  return shots
    .map((s) => ({
      start: s.start,
      end: Math.max(s.end, s.start + 0.05),
      text: s.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text.length > 0);
}

export function shotsEqual(a: ClipShot[], b: ClipShot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text) return false;
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
  }
  return true;
}

export function findActiveShotIndex(shots: ClipShot[], time: number): number {
  if (!shots.length) return -1;
  const t = Number.isFinite(time) ? time : 0;

  for (let i = 0; i < shots.length; i++) {
    const start = shots[i].start;
    const end = Math.max(shots[i].end, start + 0.05);
    if (t >= start && t < end) return i;
  }
  // Gap or outside all windows — do not steal another shot's highlight.
  return -1;
}

export function formatShotIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

const MIN_SHOT_SPAN_SEC = 0.16;

export function canSplitShot(shots: ClipShot[], index: number): boolean {
  const cur = shots[index];
  if (!cur) return false;
  const next = shots[index + 1];
  const capEnd = next ? Math.min(cur.end, next.start) : cur.end;
  return capEnd - cur.start >= MIN_SHOT_SPAN_SEC * 2;
}

/** Split this shot's window in two. Audio timeline unchanged; new shot is empty. */
export function insertShotAfter(shots: ClipShot[], index: number): ClipShot[] {
  const cur = shots[index];
  if (!cur || !canSplitShot(shots, index)) return shots;
  const next = shots[index + 1];
  const capEnd = next ? Math.min(cur.end, next.start) : cur.end;
  const mid = cur.start + (capEnd - cur.start) / 2;
  const copy = shots.map((s) => ({ ...s }));
  copy[index] = { ...copy[index], end: mid };
  copy.splice(index + 1, 0, {
    start: mid,
    end: cur.end,
    text: "",
  });
  return copy;
}

/** Remove this caption only. Its time window stays; later shots do not slide up. */
export function clearShot(shots: ClipShot[], index: number): ClipShot[] {
  if (!shots[index] || !shots[index].text) return shots;
  const copy = shots.map((s) => ({ ...s }));
  copy[index] = { ...copy[index], text: "" };
  return copy;
}

export function createCoveringShot(start: number, end: number, text = ""): ClipShot {
  const s = Number.isFinite(start) ? Math.max(0, start) : 0;
  const e = Number.isFinite(end) && end > s + MIN_SHOT_SPAN_SEC ? end : s + 1;
  return { start: s, end: e, text };
}
