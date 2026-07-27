import type { ClipTextSegment } from "@/lib/clips/types";

export type PendingReburnPayload = {
  storageIndex: number;
  segments: ClipTextSegment[];
  /** Titre bandeau putaclic (optionnel). Si défini, remplace le hook stocké au reburn. */
  hook?: string | null;
};

export function reburnStorageKey(jobId: string) {
  return `upcut_reburn_${jobId}`;
}

export function writePendingReburn(jobId: string, payload: PendingReburnPayload) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(reburnStorageKey(jobId), JSON.stringify(payload));
}

export function readPendingReburn(jobId: string): PendingReburnPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(reburnStorageKey(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingReburnPayload;
    if (
      typeof parsed?.storageIndex !== "number" ||
      !Array.isArray(parsed.segments) ||
      parsed.segments.length === 0
    ) {
      return null;
    }
    return {
      storageIndex: parsed.storageIndex,
      segments: parsed.segments,
      hook: parsed.hook != null ? String(parsed.hook) : undefined,
    };
  } catch {
    return null;
  }
}

export function clearPendingReburn(jobId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(reburnStorageKey(jobId));
}
