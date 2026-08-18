export const DOWNLOAD_PROXY_TIMEOUT_MS = 45_000;
const CLIP_PROXY_ALLOWED_HOSTS = (process.env.CLIP_PROXY_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedClipUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (CLIP_PROXY_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return true;
    }
    const r2Public = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
    if (r2Public) {
      try {
        if (host === new URL(r2Public).hostname.toLowerCase()) return true;
      } catch {
        /* ignore invalid R2_PUBLIC_URL */
      }
    }
    return (
      host.endsWith(".r2.dev") ||
      host.endsWith(".cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

export function clipAttachmentName(index: number) {
  return `clip-${index + 1}.mp4`;
}

export async function streamClipFromUrl(
  clipUrl: string,
  request: Request,
  options: {
    filename: string;
    disposition?: "inline" | "attachment";
  }
): Promise<Response> {
  const range = request.headers.get("range");
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set("Range", range);

  const res = await fetch(clipUrl, {
    headers: upstreamHeaders,
    signal: AbortSignal.timeout(DOWNLOAD_PROXY_TIMEOUT_MS),
  });
  if (!res.ok) {
    return Response.json(
      { error: "Fichier clip introuvable." },
      { status: res.status === 404 ? 404 : 502 }
    );
  }

  const disposition = options.disposition ?? "inline";
  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("content-type") || "video/mp4");
  const contentLength = res.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  const contentRange = res.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Disposition",
    `${disposition}; filename="${options.filename}"`
  );
  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}
