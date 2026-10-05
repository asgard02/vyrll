import type { ClipEditorLayout, ClipLayoutBlock } from "@/lib/clips/layout";
import type { ClipTextSegment } from "@/lib/clips/types";

export type PendingReburnPayload = {
  storageIndex: number;
  segments: ClipTextSegment[];
  /** Titre bandeau putaclic (optionnel). Si défini, remplace le hook stocké au reburn. */
  hook?: string | null;
  kind?: "reburn" | "recut";
  start?: number;
  end?: number;
  layout?: ClipEditorLayout | null;
  layoutBlocks?: ClipLayoutBlock[] | null;
  format?: "9:16" | "1:1" | "16:9";
  captionOffsetY?: number;
  captionOffsetX?: number;
  captionScale?: number;
  captionBoxWidth?: number | null;
  hookOffsetY?: number;
  hookOffsetX?: number;
  hookScale?: number;
  hookBoxWidth?: number | null;
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
      kind: parsed.kind === "recut" ? "recut" : "reburn",
      start:
        parsed.start != null && Number.isFinite(Number(parsed.start))
          ? Number(parsed.start)
          : undefined,
      end:
        parsed.end != null && Number.isFinite(Number(parsed.end))
          ? Number(parsed.end)
          : undefined,
      layout: parsed.layout ?? undefined,
      layoutBlocks: Array.isArray(parsed.layoutBlocks) ? parsed.layoutBlocks : undefined,
      format:
        parsed.format === "1:1" || parsed.format === "16:9" || parsed.format === "9:16"
          ? parsed.format
          : undefined,
      captionOffsetY:
        parsed.captionOffsetY != null && Number.isFinite(Number(parsed.captionOffsetY))
          ? Number(parsed.captionOffsetY)
          : undefined,
      captionOffsetX:
        parsed.captionOffsetX != null && Number.isFinite(Number(parsed.captionOffsetX))
          ? Number(parsed.captionOffsetX)
          : undefined,
      captionScale:
        parsed.captionScale != null && Number.isFinite(Number(parsed.captionScale))
          ? Number(parsed.captionScale)
          : undefined,
      captionBoxWidth:
        parsed.captionBoxWidth != null &&
        Number.isFinite(Number(parsed.captionBoxWidth)) &&
        Number(parsed.captionBoxWidth) > 0
          ? Number(parsed.captionBoxWidth)
          : undefined,
      hookOffsetY:
        parsed.hookOffsetY != null && Number.isFinite(Number(parsed.hookOffsetY))
          ? Number(parsed.hookOffsetY)
          : undefined,
      hookOffsetX:
        parsed.hookOffsetX != null && Number.isFinite(Number(parsed.hookOffsetX))
          ? Number(parsed.hookOffsetX)
          : undefined,
      hookScale:
        parsed.hookScale != null && Number.isFinite(Number(parsed.hookScale))
          ? Number(parsed.hookScale)
          : undefined,
      hookBoxWidth:
        parsed.hookBoxWidth != null && Number.isFinite(Number(parsed.hookBoxWidth)) && Number(parsed.hookBoxWidth) > 0
          ? Number(parsed.hookBoxWidth)
          : undefined,
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
  hook?: string | null,
  kind: "reburn" | "recut" = "reburn"
): string {
  return `${jobId}:${kind}:${storageIndex}:${segments.map((s) => s.text).join("|").slice(0, 80)}:h=${String(hook ?? "").slice(0, 40)}`;
}

const ACTIVE_REBURN_KEY = "upcut_reburn_active";
export const ACTIVE_REBURN_TTL_MS = 4 * 60_000;
const ACTIVE_REBURN_EVENT = "upcut-reburn-active";

export type ActiveReburn = {
  jobId: string;
  index: number;
  startedAt: number;
};

function emitActiveReburnChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_REBURN_EVENT));
}

export function writeActiveReburn(jobId: string, index: number) {
  if (typeof window === "undefined") return;
  const payload: ActiveReburn = { jobId, index, startedAt: Date.now() };
  try {
    localStorage.setItem(ACTIVE_REBURN_KEY, JSON.stringify(payload));
    emitActiveReburnChange();
  } catch {
    /* private mode / quota */
  }
}

export function readActiveReburn(): ActiveReburn | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_REBURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveReburn;
    if (
      typeof parsed?.jobId !== "string" ||
      !parsed.jobId ||
      typeof parsed.index !== "number" ||
      !Number.isFinite(parsed.index) ||
      parsed.index < 0 ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.startedAt > ACTIVE_REBURN_TTL_MS) {
      localStorage.removeItem(ACTIVE_REBURN_KEY);
      return null;
    }
    return {
      jobId: parsed.jobId,
      index: parsed.index,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearActiveReburn(jobId?: string) {
  if (typeof window === "undefined") return;
  try {
    if (jobId) {
      const current = readActiveReburn();
      if (current && current.jobId !== jobId) return;
    }
    localStorage.removeItem(ACTIVE_REBURN_KEY);
    emitActiveReburnChange();
  } catch {
    /* ignore */
  }
}

export function subscribeActiveReburn(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACTIVE_REBURN_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(ACTIVE_REBURN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ACTIVE_REBURN_EVENT, onChange);
  };
}
