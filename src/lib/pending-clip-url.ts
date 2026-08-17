/**
 * Source pending (landing ou « Refaire des clips ») → dashboard.
 * URL YouTube/Twitch OU upload déjà sur R2 (pas de re-drop).
 */

export const PENDING_CLIP_URL_KEY = "upcut_pending_clip_url";
const LEGACY_PENDING_URL_KEY = "upcut_pending_url";
export const PENDING_CLIP_UPLOAD_KEY = "upcut_pending_clip_upload";

export type PendingClipUpload = {
  upload_id: string;
  duration_seconds: number;
  filename: string;
};

export function setPendingClipUrl(url: string): void {
  if (typeof window === "undefined") return;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("upload://")) return;
  try {
    sessionStorage.setItem(PENDING_CLIP_URL_KEY, trimmed);
    sessionStorage.removeItem(LEGACY_PENDING_URL_KEY);
    sessionStorage.removeItem(PENDING_CLIP_UPLOAD_KEY);
  } catch {
    /* private mode / quota */
  }
}

export function setPendingClipUpload(upload: PendingClipUpload): void {
  if (typeof window === "undefined") return;
  if (!upload?.upload_id?.trim()) return;
  try {
    sessionStorage.setItem(
      PENDING_CLIP_UPLOAD_KEY,
      JSON.stringify({
        upload_id: upload.upload_id.trim(),
        duration_seconds: Number(upload.duration_seconds) || 0,
        filename: String(upload.filename || "video.mp4").trim() || "video.mp4",
      })
    );
    sessionStorage.removeItem(PENDING_CLIP_URL_KEY);
    sessionStorage.removeItem(LEGACY_PENDING_URL_KEY);
  } catch {
    /* private mode / quota */
  }
}

/** Ouvre le dashboard en mode upload sans fichier (fallback si réutilisation impossible). */
export function setPendingClipUploadMode(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_CLIP_UPLOAD_KEY, JSON.stringify({ modeOnly: true }));
    sessionStorage.removeItem(PENDING_CLIP_URL_KEY);
    sessionStorage.removeItem(LEGACY_PENDING_URL_KEY);
  } catch {
    /* ignore */
  }
}

/** Lit et consomme l’URL pending (clé actuelle + legacy). Ignore upload://. */
export function consumePendingClipUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const current = sessionStorage.getItem(PENDING_CLIP_URL_KEY);
    if (current?.trim()) {
      sessionStorage.removeItem(PENDING_CLIP_URL_KEY);
      sessionStorage.removeItem(LEGACY_PENDING_URL_KEY);
      const v = current.trim();
      if (v.startsWith("upload://")) return null;
      return v;
    }
    const legacy = sessionStorage.getItem(LEGACY_PENDING_URL_KEY);
    if (legacy?.trim()) {
      sessionStorage.removeItem(LEGACY_PENDING_URL_KEY);
      const v = legacy.trim();
      if (v.startsWith("upload://")) return null;
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type ConsumedPendingUpload =
  | PendingClipUpload
  | { modeOnly: true }
  | null;

/** Lit et consomme un upload pending (fichier déjà prêt ou mode upload seul). */
export function consumePendingClipUpload(): ConsumedPendingUpload {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CLIP_UPLOAD_KEY);
    sessionStorage.removeItem(PENDING_CLIP_UPLOAD_KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as {
      modeOnly?: boolean;
      upload_id?: string;
      duration_seconds?: number;
      filename?: string;
    };
    if (parsed?.modeOnly) return { modeOnly: true };
    if (parsed?.upload_id?.trim()) {
      return {
        upload_id: parsed.upload_id.trim(),
        duration_seconds: Number(parsed.duration_seconds) || 0,
        filename: String(parsed.filename || "video.mp4").trim() || "video.mp4",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function peekPendingClipUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const current = sessionStorage.getItem(PENDING_CLIP_URL_KEY);
    if (current?.trim()) {
      const v = current.trim();
      return v.startsWith("upload://") ? null : v;
    }
    const legacy = sessionStorage.getItem(LEGACY_PENDING_URL_KEY);
    if (legacy?.trim()) {
      const v = legacy.trim();
      return v.startsWith("upload://") ? null : v;
    }
  } catch {
    /* ignore */
  }
  return null;
}
