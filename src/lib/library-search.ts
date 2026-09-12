import type { SupabaseClient } from "@supabase/supabase-js";

const STOP = new Set(
  (
    "le la les de des du un une et ou en a à au aux ce cet cette ces que qui quoi dont où " +
    "il elle on nous vous ils elles je tu me te se son sa ses leur leurs est sont être était " +
    "pour par avec sans sur dans pas plus mais comme tout tous toute toutes ça cela c'est"
  ).split(" ")
);

const MERGE_GAP_MS = 60_000;
const MIN_ALONE_MS = 6_000;
const FTS_LIMIT = 100;
const DEFAULT_K = 5;
const MAX_K = 20;

export type RankedSegment = {
  video_key: string;
  title: string | null;
  source_url: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  rank: number;
};

export type LibraryMoment = {
  video_key: string;
  title: string;
  source_url: string;
  start_ms: number;
  end_ms: number;
  text: string;
  score: number;
  n_segments: number;
};

export function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "");
}

export function tokenizeQuery(q: string): string[] {
  const words = [...String(q || "").matchAll(/[\p{L}\p{N}]+/gu)].map((m) =>
    m[0].toLowerCase()
  );
  return words.filter((w) => {
    const n = stripAccents(w);
    return n.length > 2 && !STOP.has(n) && !STOP.has(w);
  });
}

export function clampK(k: unknown): number {
  const n = Math.floor(Number(k));
  if (!Number.isFinite(n)) return DEFAULT_K;
  return Math.min(MAX_K, Math.max(1, n));
}

/**
 * Fusionne les hits FTS contigus d'une même vidéo (écart < 60 s).
 * Un segment < 6 s ne peut pas former un moment à lui seul.
 * Score = sum(rank) × (1 + 0.1 × (n_segments - 1)).
 */
export function mergeContiguousMoments(
  rows: RankedSegment[],
  k: number
): LibraryMoment[] {
  const byVideo = new Map<string, RankedSegment[]>();
  for (const row of rows) {
    if (!row?.video_key) continue;
    const list = byVideo.get(row.video_key) ?? [];
    list.push(row);
    byVideo.set(row.video_key, list);
  }

  const moments: LibraryMoment[] = [];
  for (const [videoKey, list] of byVideo) {
    list.sort((a, b) => a.start_ms - b.start_ms);
    let cur: RankedSegment[] = [];

    const flush = () => {
      if (!cur.length) return;
      const n = cur.length;
      const startMs = cur[0].start_ms;
      const endMs = Math.max(...cur.map((s) => s.end_ms));
      const dur = endMs - startMs;
      const aloneTooShort = n === 1 && dur < MIN_ALONE_MS;
      if (aloneTooShort || dur < MIN_ALONE_MS) {
        cur = [];
        return;
      }
      const sumRank = cur.reduce((acc, s) => acc + (Number(s.rank) || 0), 0);
      const score = sumRank * (1 + 0.1 * (n - 1));
      moments.push({
        video_key: videoKey,
        title: cur[0].title || "",
        source_url: cur[0].source_url || "",
        start_ms: startMs,
        end_ms: endMs,
        text: cur
          .map((s) => s.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        score: Math.round(score * 1000) / 1000,
        n_segments: n,
      });
      cur = [];
    };

    for (const seg of list) {
      if (!cur.length) {
        cur = [seg];
        continue;
      }
      const prev = cur[cur.length - 1];
      if (seg.start_ms - prev.end_ms < MERGE_GAP_MS) {
        cur.push(seg);
      } else {
        flush();
        cur = [seg];
      }
    }
    flush();
  }

  moments.sort((a, b) => b.score - a.score);
  return moments.slice(0, clampK(k));
}

function asRankedSegment(row: Record<string, unknown>): RankedSegment | null {
  const videoKey = typeof row.video_key === "string" ? row.video_key : "";
  const startMs = Number(row.start_ms);
  const endMs = Number(row.end_ms);
  const text = typeof row.text === "string" ? row.text : "";
  if (!videoKey || !text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return {
    video_key: videoKey,
    title: typeof row.title === "string" ? row.title : null,
    source_url: typeof row.source_url === "string" ? row.source_url : null,
    start_ms: startMs,
    end_ms: endMs,
    text,
    rank: Number(row.rank) || 0,
  };
}

export async function searchLibraryMoments(
  supabase: SupabaseClient,
  opts: { query: string; k?: number; scope?: string; videoKey?: string }
): Promise<{ moments: LibraryMoment[]; took_ms: number; fts_hits: number }> {
  const t0 = Date.now();
  const tokens = tokenizeQuery(opts.query);
  if (!tokens.length) {
    return { moments: [], took_ms: Date.now() - t0, fts_hits: 0 };
  }
  const ftsQuery = tokens.join(" ");
  const { data, error } = await supabase.rpc("search_transcript_segments", {
    p_query: ftsQuery,
  });
  if (error) {
    throw new Error(error.message);
  }
  const videoKey = typeof opts.videoKey === "string" ? opts.videoKey.trim() : "";
  const rows = (Array.isArray(data) ? data : [])
    .slice(0, FTS_LIMIT)
    .map((row) => asRankedSegment(row as Record<string, unknown>))
    .filter((row): row is RankedSegment => row != null)
    .filter((row) => !videoKey || row.video_key === videoKey);
  const moments = mergeContiguousMoments(rows, opts.k ?? DEFAULT_K);
  return {
    moments,
    took_ms: Date.now() - t0,
    fts_hits: rows.length,
  };
}
