/** Timed transcript unit (relative to clip start, seconds). */
export type ClipTextSegment = {
  start: number;
  end: number;
  text: string;
};

/** Clip as returned by GET /api/clips/[jobId] (camelCase). */
export type ClipItem = {
  downloadUrl?: string;
  directUrl?: string;
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

export function mapStoredClipToItem(
  c: StoredClipRow,
  jobId: string,
  index: number
): ClipItem {
  const proxyUrl = `/api/clips/${jobId}/download/${index}`;
  const directUrl = c?.url?.startsWith("http") ? c.url : null;
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

  return {
    downloadUrl: proxyUrl,
    directUrl: directUrl ?? undefined,
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
