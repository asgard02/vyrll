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
  /** Base vidéo croppée sans sous-titres — requis pour régénérer les subs. */
  cleanUrl?: string;
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
};

/** Raw clip row stored in clip_jobs.clips JSONB (snake_case). */
export type StoredClipRow = {
  url?: string;
  clean_url?: string;
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
};

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
  options?: { downloadUrl?: string; includeCleanUrl?: boolean }
): ClipItem {
  const proxyUrl = options?.downloadUrl ?? `/api/clips/${jobId}/download/${index}`;
  const rawUrl = c?.url?.startsWith("http") ? c.url : null;
  const directUrl =
    rawUrl && !isSupabaseStorageUrl(rawUrl) ? rawUrl : null;
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
  const rawClean = c?.clean_url?.startsWith("http") ? c.clean_url : undefined;
  const cleanUrl =
    includeCleanUrl && rawClean && !isSupabaseStorageUrl(rawClean)
      ? rawClean
      : undefined;

  return {
    index,
    downloadUrl: proxyUrl,
    directUrl: directUrl ?? undefined,
    ...(cleanUrl ? { cleanUrl } : {}),
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
  };
}
