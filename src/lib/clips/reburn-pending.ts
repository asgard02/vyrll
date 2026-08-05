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

/** Anti-doublon in-memory (survit au remount Strict Mode, pas au refresh page). */
const reburnRunClaims = new Map<string, number>();
const CLAIM_TTL_MS = 5 * 60_000;

export function tryClaimReburnRun(runKey: string): boolean {
  const now = Date.now();
  for (const [k, t] of reburnRunClaims) {
    if (now - t > CLAIM_TTL_MS) reburnRunClaims.delete(k);
  }
  if (reburnRunClaims.has(runKey)) return false;
  reburnRunClaims.set(runKey, now);
  return true;
}

export function releaseReburnRun(runKey: string) {
  reburnRunClaims.delete(runKey);
}

export function buildReburnRunKey(
  jobId: string,
  storageIndex: number,
  segments: ClipTextSegment[],
  hook?: string | null
): string {
  return `${jobId}:${storageIndex}:${segments.map((s) => s.text).join("|").slice(0, 80)}:h=${String(hook ?? "").slice(0, 40)}`;
}
