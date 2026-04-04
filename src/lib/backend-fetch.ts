/** Erreurs réseau transitoires (backend redémarré, socket fermée, etc.) */
export function isTransientBackendFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("ECONNRESET")) return true;
  const cause =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause?: unknown }).cause
      : undefined;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = String((cause as { code?: string }).code);
    if (code === "UND_ERR_SOCKET" || code === "ECONNRESET" || code === "ECONNREFUSED") {
      return true;
    }
  }
  return false;
}

const DEFAULT_RETRIES = 3;

/** fetch avec retries + timeout par tentative (yt-dlp peut être lent ou le backend redémarrer). */
export async function fetchBackendWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries = DEFAULT_RETRIES
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1 && isTransientBackendFetchError(e)) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
