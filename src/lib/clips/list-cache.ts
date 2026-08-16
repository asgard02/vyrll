/** Client cache for /api/clips list — instant paint on /projets revisit. */

const STORAGE_KEY = "upcut_clips_list_v1";
const TTL_MS = 60_000;

export type CachedClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  channel_title?: string | null;
  duration: number;
  status: string;
  error?: string | null;
  clips?: unknown[];
  clips_count?: number;
  created_at: string;
  expires_at?: string | null;
  progress?: number;
};

type CachePayload = {
  jobs: CachedClipJob[];
  savedAt: number;
};

export function readClipsListCache(): CachedClipJob[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed || !Array.isArray(parsed.jobs) || typeof parsed.savedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed.jobs;
  } catch {
    return null;
  }
}

export function writeClipsListCache(jobs: CachedClipJob[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CachePayload = { jobs, savedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function invalidateClipsListCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Warm the list in the background (sidebar hover / dashboard). */
export function prefetchClipsList(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/clips", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.jobs)) writeClipsListCache(data.jobs);
    })
    .catch(() => {});
}
