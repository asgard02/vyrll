import {
  parseEditorLayout,
  parseLayoutBlocks,
  type ClipEditorLayout,
  type ClipLayoutBlock,
} from "@/lib/clips/layout";

/** Timed transcript unit (relative to clip start, seconds). */
export type ClipTextSegment = {
  start: number;
  end: number;
  text: string;
};

/** Clip as returned by GET /api/clips/[jobId] (camelCase). */
export type ClipItem = {
  /** Index in clip_jobs.clips JSONB (stable; not display order). */
  index?: number;
  downloadUrl?: string;
  directUrl?: string;
  /** Set when clean_url is a true crop without overlays — not a blurred reburn leftover. */
  cleanOrigin?: string | null;
  /** Original-aspect cut (padded) — required to recrop / retrim. */
  sourceUrl?: string;
  sourceStart?: number;
  sourceEnd?: number;
  layout?: ClipEditorLayout | null;
  layoutBlocks?: ClipLayoutBlock[] | null;
  captionOffsetY?: number;
  captionOffsetX?: number;
  captionScale?: number;
  captionBoxWidth?: number;
  hookOffsetY?: number;
  hookOffsetX?: number;
  hookScale?: number;
  hookBoxWidth?: number;
  outputFormat?: "9:16" | "1:1" | "16:9";
  renderMode?: string;
  splitConfidence?: number;
  scoreViral?: number;
  start?: number;
  end?: number;
  hook?: string | null;
  reason?: string | null;
  type?: string | null;
  text?: string | null;
  segments?: ClipTextSegment[];
  reburning?: boolean;
  reburnedAt?: string | null;
};

/** Raw clip row stored in clip_jobs.clips JSONB (snake_case). */
export type StoredClipRow = {
  url?: string;
  clean_url?: string;
  source_url?: string;
  source_start?: number;
  source_end?: number;
  layout?: ClipEditorLayout | null;
  layout_blocks?: ClipLayoutBlock[] | null;
  caption_offset_y?: number;
  caption_offset_x?: number;
  caption_scale?: number;
  caption_box_width?: number | null;
  hook_offset_y?: number;
  hook_offset_x?: number;
  hook_scale?: number;
  hook_box_width?: number | null;
  output_format?: "9:16" | "1:1" | "16:9";
  index?: number;
  render_mode?: string;
  split_confidence?: number;
  score_viral?: number;
  start?: number;
  end?: number;
  hook?: string | null;
  reason?: string | null;
  type?: string | null;
  text?: string | null;
  segments?: ClipTextSegment[];
  reburning?: boolean;
  reburn_started_at?: string | null;
  reburned_at?: string | null;
  /** Set when clean_url is a true crop without overlays — not a blurred reburn leftover. */
  clean_origin?: "render" | string | null;
};

/** Same-origin proxy for the burned clip, the clean base, or the padded source. */
export function clipEditorProxyUrl(
  jobId: string,
  index: number,
  layer: "clip" | "clean" | "source" = "clip",
  reburnedAt?: string | null
): string {
  const path =
    layer === "clip"
      ? `/api/clips/${jobId}/download/${index}`
      : `/api/clips/${jobId}/download/${index}?layer=${layer}`;
  return cacheBustVideoUrl(path, reburnedAt);
}

/** Append a stable cache-buster from reburned_at — never persist `v=` on the R2 URL. */
export function cacheBustVideoUrl(
  url: string,
  reburnedAt?: string | null
): string {
  if (!reburnedAt) return url;
  const t = Date.parse(reburnedAt);
  if (!Number.isFinite(t)) return url;
  const v = String(t);
  try {
    const u = new URL(url);
    u.searchParams.set("v", v);
    return u.toString();
  } catch {
    return url.includes("?") ? `${url}&v=${v}` : `${url}?v=${v}`;
  }
}

/** True for legacy Supabase Storage public URLs — ne plus exposer côté client (egress). */
function isSupabaseStorageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("supabase");
  } catch {
    return false;
  }
}

export function mapStoredClipToItem(
  c: StoredClipRow,
  jobId: string,
  index: number,
  options?: { downloadUrl?: string; includeCleanUrl?: boolean; includeSourceUrl?: boolean }
): ClipItem {
  const proxyRaw = options?.downloadUrl ?? `/api/clips/${jobId}/download/${index}`;
  const rawUrl = c?.url?.startsWith("http") ? c.url : null;
  const reburnedAt =
    typeof c?.reburned_at === "string" && c.reburned_at.trim()
      ? c.reburned_at.trim()
      : null;
  const proxyUrl = cacheBustVideoUrl(proxyRaw, reburnedAt);
  const directRaw =
    rawUrl && !isSupabaseStorageUrl(rawUrl) ? rawUrl : null;
  const directUrl = directRaw
    ? cacheBustVideoUrl(directRaw, reburnedAt)
    : null;
  const segments = Array.isArray(c?.segments)
    ? c.segments
        .map((s) => {
          const start = Number(s?.start) || 0;
          let end = Number(s?.end) || 0;
          if (!(end > start)) end = start + 0.08;
          return {
            start,
            end,
            text: String(s?.text ?? "").trim(),
          };
        })
        .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    : undefined;

  const includeCleanUrl = options?.includeCleanUrl !== false;
  const includeSourceUrl = options?.includeSourceUrl !== false;
  const rawClean = c?.clean_url?.startsWith("http") ? c.clean_url : undefined;
  const cleanUrl =
    includeCleanUrl && rawClean && !isSupabaseStorageUrl(rawClean)
      ? rawClean
      : undefined;
  const rawSource = c?.source_url?.startsWith("http") ? c.source_url : undefined;
  const sourceUrl =
    includeSourceUrl && rawSource && !isSupabaseStorageUrl(rawSource)
      ? rawSource
      : undefined;

  return {
    index,
    downloadUrl: proxyUrl,
    directUrl: directUrl ?? undefined,
    ...(cleanUrl ? { cleanUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    cleanOrigin: c?.clean_origin ? String(c.clean_origin) : undefined,
    sourceStart:
      c?.source_start != null && Number.isFinite(Number(c.source_start))
        ? Number(c.source_start)
        : undefined,
    sourceEnd:
      c?.source_end != null && Number.isFinite(Number(c.source_end))
        ? Number(c.source_end)
        : undefined,
    layout: parseEditorLayout(c?.layout) ?? c?.layout ?? null,
    layoutBlocks: (() => {
      const parsedLayout = parseEditorLayout(c?.layout);
      if (!parsedLayout) return undefined;
      const start = c?.start != null && Number.isFinite(Number(c.start)) ? Number(c.start) : 0;
      const end = c?.end != null && Number.isFinite(Number(c.end)) ? Number(c.end) : start + 1;
      return parseLayoutBlocks(c?.layout_blocks, parsedLayout, Math.max(0.4, end - start));
    })(),
    captionOffsetY:
      c?.caption_offset_y != null && Number.isFinite(Number(c.caption_offset_y))
        ? Number(c.caption_offset_y)
        : undefined,
    captionOffsetX:
      c?.caption_offset_x != null && Number.isFinite(Number(c.caption_offset_x))
        ? Number(c.caption_offset_x)
        : undefined,
    captionScale:
      c?.caption_scale != null && Number.isFinite(Number(c.caption_scale))
        ? Number(c.caption_scale)
        : undefined,
    captionBoxWidth:
      c?.caption_box_width != null && Number.isFinite(Number(c.caption_box_width)) && Number(c.caption_box_width) > 0
        ? Number(c.caption_box_width)
        : undefined,
    hookOffsetY:
      c?.hook_offset_y != null && Number.isFinite(Number(c.hook_offset_y))
        ? Number(c.hook_offset_y)
        : undefined,
    hookOffsetX:
      c?.hook_offset_x != null && Number.isFinite(Number(c.hook_offset_x))
        ? Number(c.hook_offset_x)
        : undefined,
    hookScale:
      c?.hook_scale != null && Number.isFinite(Number(c.hook_scale))
        ? Number(c.hook_scale)
        : undefined,
    hookBoxWidth:
      c?.hook_box_width != null && Number.isFinite(Number(c.hook_box_width)) && Number(c.hook_box_width) > 0
        ? Number(c.hook_box_width)
        : undefined,
    outputFormat:
      c?.output_format === "1:1" || c?.output_format === "16:9" || c?.output_format === "9:16"
        ? c.output_format
        : undefined,
    renderMode: c?.render_mode ?? undefined,
    splitConfidence: c?.split_confidence ?? undefined,
    scoreViral: c?.score_viral != null ? Number(c.score_viral) : undefined,
    start: c?.start != null && Number.isFinite(Number(c.start)) ? Number(c.start) : undefined,
    end: c?.end != null && Number.isFinite(Number(c.end)) ? Number(c.end) : undefined,
    hook: c?.hook != null ? String(c.hook) : null,
    reason: c?.reason != null ? String(c.reason) : null,
    type: c?.type != null ? String(c.type) : null,
    text: c?.text != null ? String(c.text) : null,
    segments,
    reburning: c?.reburning === true,
    reburnedAt,
  };
}
