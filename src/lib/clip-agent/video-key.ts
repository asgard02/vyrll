import { createHash } from "node:crypto";
import { extractVideoId } from "@/lib/youtube";

/** Aligné sur backend-clips/transcript-index.js `videoKeyForJob`. */
export function videoKeyFromClipSource(opts: {
  url?: string;
  uploadId?: string | null;
}): string | null {
  if (opts.uploadId) {
    return createHash("sha256")
      .update(String(opts.uploadId))
      .digest("hex")
      .slice(0, 32);
  }
  const url = String(opts.url || "").trim();
  if (!url) return null;
  const yt = extractVideoId(url);
  if (yt) return yt;
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}
