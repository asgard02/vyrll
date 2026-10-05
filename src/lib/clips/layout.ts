export type ClipLayoutRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ClipOutputFormat = "9:16" | "1:1" | "16:9";

export type ClipEditorLayout = {
  mode: "stream_stack" | "talk_crop" | "visio_split" | "normal";
  format: ClipOutputFormat;
  cam?: ClipLayoutRect | null;
  game?: ClipLayoutRect | null;
  crop?: ClipLayoutRect | null;
};

/** Timed crop window, clip-relative seconds. Independent from caption shots. */
export type ClipLayoutBlock = {
  start: number;
  end: number;
  layout: ClipEditorLayout;
};

export const MIN_BLOCK_SPAN_SEC = 0.1;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizeRect(raw: unknown): ClipLayoutRect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const x = clamp01(Number(r.x));
  const y = clamp01(Number(r.y));
  const w = Math.min(1 - x, Math.max(0.04, Number(r.w)));
  const h = Math.min(1 - y, Math.max(0.04, Number(r.h)));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x, y, w, h };
}

export function parseEditorLayout(raw: unknown): ClipEditorLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode =
    o.mode === "stream_stack" ||
    o.mode === "talk_crop" ||
    o.mode === "visio_split" ||
    o.mode === "normal"
      ? o.mode
      : null;
  if (!mode) return null;
  const format: ClipOutputFormat =
    o.format === "1:1" || o.format === "16:9" ? o.format : "9:16";
  return {
    mode,
    format,
    cam: normalizeRect(o.cam),
    game: normalizeRect(o.game),
    crop: normalizeRect(o.crop),
  };
}

/** Centered crop of `format` AR on a source frame, in normalized coords. */
export function defaultCropForFormat(
  format: ClipOutputFormat,
  sourceAr = 16 / 9
): ClipLayoutRect {
  if (format === "16:9") return { x: 0, y: 0, w: 1, h: 1 };
  const outAr = format === "1:1" ? 1 : 9 / 16;
  const ratio = outAr / sourceAr;
  if (ratio >= 1) {
    const h = 1 / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  return { x: (1 - ratio) / 2, y: 0, w: ratio, h: 1 };
}

export function defaultGamingLayout(format: ClipOutputFormat = "9:16"): ClipEditorLayout {
  return {
    mode: "stream_stack",
    format,
    cam: { x: 0.02, y: 0.04, w: 0.28, h: 0.34 },
    game: { x: 0.2, y: 0.1, w: 0.6, h: 0.78 },
    crop: defaultCropForFormat(format),
  };
}

export function defaultTalkLayout(format: ClipOutputFormat = "9:16"): ClipEditorLayout {
  return {
    mode: "talk_crop",
    format,
    crop: defaultCropForFormat(format),
    cam: null,
    game: null,
  };
}

/** Pixel aspect (width/height) of one stacked half of the output. 9:16 → 9:8. */
export function stackedPanelAspect(format: ClipOutputFormat): number {
  return outputAspect(format) * 2;
}

/**
 * Tight person window whose pixel AR matches a stacked phone panel.
 * Same width as a 9:16 column, shorter so 16:9 handles = 9:16 preview.
 */
export function splitPanelRect(
  side: "left" | "right",
  format: ClipOutputFormat = "9:16",
  sourceAr = 16 / 9
): ClipLayoutRect {
  const panelAr = stackedPanelAspect(format);
  const slimW =
    format === "16:9" ? 0.5 : Math.min(0.48, (9 / 16) / Math.max(0.5, sourceAr));
  let w = slimW;
  let h = (w * sourceAr) / panelAr;
  if (h > 1) {
    h = 1;
    w = (h * panelAr) / sourceAr;
  }
  w = Math.min(1, Math.max(0.08, w));
  h = Math.min(1, Math.max(0.08, h));
  const y = Math.min(1 - h, 0.12);
  const x = side === "left" ? 0 : Math.max(0, 1 - w);
  return { x, y, w, h };
}

export function fitRectToPanelAspect(
  rect: ClipLayoutRect,
  format: ClipOutputFormat,
  sourceAr = 16 / 9
): ClipLayoutRect {
  const panelAr = stackedPanelAspect(format);
  const targetWH = panelAr / Math.max(0.5, sourceAr);
  let w = Math.max(0.08, rect.w);
  let h = w / targetWH;
  if (h > 1 - 1e-6) {
    h = 1;
    w = Math.min(1, h * targetWH);
  }
  if (w > 1 - 1e-6) {
    w = 1;
    h = Math.min(1, w / targetWH);
  }
  const x = clamp01(Math.min(rect.x, 1 - w));
  const y = clamp01(Math.min(rect.y, 1 - h));
  return { x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) };
}

/** Two panel-AR windows on a 16:9 source, stacked in the phone (interview / visio). */
export function defaultSplitLayout(
  format: ClipOutputFormat = "9:16",
  sourceAr = 16 / 9
): ClipEditorLayout {
  const cam = splitPanelRect("left", format, sourceAr);
  const game = splitPanelRect("right", format, sourceAr);
  return { mode: "visio_split", format, cam, game, crop: cam };
}

export function isStackedLayout(layout: ClipEditorLayout): boolean {
  return (
    (layout.mode === "stream_stack" || layout.mode === "visio_split") &&
    Boolean(layout.cam && layout.game)
  );
}

export function layoutFromRenderMode(
  renderMode: string | null | undefined,
  format: ClipOutputFormat = "9:16"
): ClipEditorLayout {
  if (renderMode === "stream_stack") return defaultGamingLayout(format);
  if (renderMode === "visio_split" || renderMode === "split_vertical") {
    return defaultSplitLayout(format);
  }
  return defaultTalkLayout(format);
}

export function clampOffset(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.28, Math.max(-0.28, n));
}

export function clampHookX(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.42, Math.max(-0.42, n));
}

export function clampHookScale(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(2.4, Math.max(0.45, n));
}

/** Largeur explicite du bandeau, en fraction de la frame. Absent = boîte collée au texte. */
export function clampHookBoxWidth(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0.9;
  return Math.min(0.92, Math.max(0.16, n));
}

export function outputAspect(format: ClipOutputFormat): number {
  if (format === "1:1") return 1;
  if (format === "16:9") return 16 / 9;
  return 9 / 16;
}

/** CSS for a <video> that fills its parent with a normalized source crop. */
export function cropFillStyle(crop: ClipLayoutRect): {
  position: "absolute";
  width: string;
  height: string;
  left: string;
  top: string;
  maxWidth: "none";
  objectFit: "fill";
} {
  const w = Math.max(0.04, crop.w);
  const h = Math.max(0.04, crop.h);
  return {
    position: "absolute",
    width: `${100 / w}%`,
    height: `${100 / h}%`,
    left: `${(-crop.x / w) * 100}%`,
    top: `${(-crop.y / h) * 100}%`,
    maxWidth: "none",
    objectFit: "fill",
  };
}

export function cloneLayout(layout: ClipEditorLayout): ClipEditorLayout {
  return {
    mode: layout.mode,
    format: layout.format,
    cam: layout.cam ? { ...layout.cam } : null,
    game: layout.game ? { ...layout.game } : null,
    crop: layout.crop ? { ...layout.crop } : null,
  };
}

function rectsEqual(
  a?: ClipLayoutRect | null,
  b?: ClipLayoutRect | null
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 1e-5 &&
    Math.abs(a.y - b.y) < 1e-5 &&
    Math.abs(a.w - b.w) < 1e-5 &&
    Math.abs(a.h - b.h) < 1e-5
  );
}

export function layoutsEqual(
  a?: ClipEditorLayout | null,
  b?: ClipEditorLayout | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  return (
    rectsEqual(a.crop, b.crop) &&
    rectsEqual(a.cam, b.cam) &&
    rectsEqual(a.game, b.game)
  );
}

export function coveringLayoutBlocks(
  layout: ClipEditorLayout,
  duration: number
): ClipLayoutBlock[] {
  const end = Math.max(
    MIN_BLOCK_SPAN_SEC,
    Number.isFinite(duration) ? duration : 1
  );
  return [{ start: 0, end, layout: cloneLayout(layout) }];
}

export function coverLayoutBlocksAcrossWindow(
  blocks: ClipLayoutBlock[],
  windowStart: number,
  windowEnd: number,
  fallback: ClipEditorLayout
): ClipLayoutBlock[] {
  const start = Number.isFinite(windowStart) ? Math.max(0, windowStart) : 0;
  const end =
    Number.isFinite(windowEnd) && windowEnd > start + MIN_BLOCK_SPAN_SEC
      ? windowEnd
      : start + MIN_BLOCK_SPAN_SEC;
  const sorted = blocks
    .map((b) => ({
      start: Math.max(start, b.start),
      end: Math.min(end, Math.max(b.end, b.start + 0.05)),
      layout: cloneLayout(b.layout),
    }))
    .filter((b) => b.end > b.start + 0.04)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return coveringLayoutBlocks(fallback, end - start);

  sorted[0] = { ...sorted[0], start };
  for (let i = 0; i < sorted.length - 1; i++) {
    const cut = sorted[i + 1].start;
    if (cut - sorted[i].start >= 0.05) {
      sorted[i] = { ...sorted[i], end: cut };
    }
  }
  sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], end };
  const kept = sorted.filter((b) => b.end > b.start + 0.04);
  return kept.length ? kept : coveringLayoutBlocks(fallback, end - start);
}

export function parseLayoutBlocks(
  raw: unknown,
  fallback: ClipEditorLayout,
  duration: number
): ClipLayoutBlock[] {
  const cover = coveringLayoutBlocks(fallback, duration);
  if (!Array.isArray(raw) || raw.length === 0) return cover;
  const parsed: ClipLayoutBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = Number(o.start);
    const end = Number(o.end);
    const layout = parseEditorLayout(o.layout);
    if (!layout || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!(end > start + 0.04)) continue;
    parsed.push({
      start,
      end,
      layout: { ...layout, format: fallback.format },
    });
  }
  if (!parsed.length) return cover;
  return coverLayoutBlocksAcrossWindow(parsed, 0, cover[0].end, fallback);
}

export function findActiveBlockIndex(
  blocks: ClipLayoutBlock[],
  time: number
): number {
  if (!blocks.length) return -1;
  const t = Number.isFinite(time) ? time : 0;
  if (t < blocks[0].start) return 0;
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i].start;
    const end = Math.max(blocks[i].end, start + 0.05);
    if (t >= start && t < end) return i;
  }
  return blocks.length - 1;
}

export function canSplitBlockAt(
  blocks: ClipLayoutBlock[],
  time: number,
  minSpan = MIN_BLOCK_SPAN_SEC
): boolean {
  const i = findActiveBlockIndex(blocks, time);
  if (i < 0) return false;
  const cur = blocks[i];
  if (!cur) return false;
  const t = Number.isFinite(time) ? time : 0;
  return t - cur.start >= minSpan && cur.end - t >= minSpan;
}

export function splitBlockAt(
  blocks: ClipLayoutBlock[],
  time: number,
  minSpan = MIN_BLOCK_SPAN_SEC
): ClipLayoutBlock[] {
  if (!canSplitBlockAt(blocks, time, minSpan)) return blocks;
  const i = findActiveBlockIndex(blocks, time);
  const cur = blocks[i];
  if (!cur) return blocks;
  const t = Number.isFinite(time) ? time : 0;
  const copy = blocks.map((b) => ({
    start: b.start,
    end: b.end,
    layout: cloneLayout(b.layout),
  }));
  copy.splice(
    i,
    1,
    { start: cur.start, end: t, layout: cloneLayout(cur.layout) },
    { start: t, end: cur.end, layout: cloneLayout(cur.layout) }
  );
  return copy;
}

export function remapLayoutBlocksToWindow(
  blocks: ClipLayoutBlock[],
  prevStart: number,
  nextStart: number,
  nextDuration: number,
  fallback: ClipEditorLayout
): ClipLayoutBlock[] {
  const delta = Number(nextStart) - Number(prevStart);
  const shifted = blocks.map((b) => ({
    start: b.start - delta,
    end: b.end - delta,
    layout: cloneLayout(b.layout),
  }));
  return coverLayoutBlocksAcrossWindow(
    shifted,
    0,
    Math.max(MIN_BLOCK_SPAN_SEC, nextDuration),
    fallback
  );
}

export function moveBlockBoundary(
  blocks: ClipLayoutBlock[],
  leftIndex: number,
  newEnd: number,
  minSpan = MIN_BLOCK_SPAN_SEC
): ClipLayoutBlock[] {
  const left = blocks[leftIndex];
  const right = blocks[leftIndex + 1];
  if (!left || !right) return blocks;
  const minEnd = left.start + minSpan;
  const maxEnd = right.end - minSpan;
  if (!(maxEnd > minEnd)) return blocks;
  const end = Math.min(maxEnd, Math.max(minEnd, newEnd));
  const copy = blocks.map((b) => ({
    start: b.start,
    end: b.end,
    layout: cloneLayout(b.layout),
  }));
  copy[leftIndex] = { ...copy[leftIndex], end };
  copy[leftIndex + 1] = { ...copy[leftIndex + 1], start: end };
  return copy;
}

export function patchBlockLayout(
  blocks: ClipLayoutBlock[],
  index: number,
  layout: ClipEditorLayout
): ClipLayoutBlock[] {
  if (!blocks[index]) return blocks;
  return blocks.map((b, i) =>
    i === index ? { ...b, layout: cloneLayout(layout) } : b
  );
}

export function applyFormatToLayout(
  layout: ClipEditorLayout,
  format: ClipOutputFormat
): ClipEditorLayout {
  if (layout.mode === "visio_split") return defaultSplitLayout(format);
  return {
    ...cloneLayout(layout),
    format,
    crop: defaultCropForFormat(format),
  };
}

export function applyFormatToBlocks(
  blocks: ClipLayoutBlock[],
  format: ClipOutputFormat
): ClipLayoutBlock[] {
  return blocks.map((b) => ({
    start: b.start,
    end: b.end,
    layout: applyFormatToLayout(b.layout, format),
  }));
}

export function layoutBlocksEqual(
  a: ClipLayoutBlock[],
  b: ClipLayoutBlock[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].start - b[i].start) > 1e-4) return false;
    if (Math.abs(a[i].end - b[i].end) > 1e-4) return false;
    if (!layoutsEqual(a[i].layout, b[i].layout)) return false;
  }
  return true;
}

export function allBlocksShareLayout(blocks: ClipLayoutBlock[]): boolean {
  if (blocks.length <= 1) return true;
  return blocks.every((b) => layoutsEqual(b.layout, blocks[0].layout));
}
