/** Transient Groq/Whisper failures that must not kill a long job on the first blip. */

const RETRYABLE_NET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableWhisperError(err) {
  if (!err) return false;
  const name = String(err?.name || "");
  const msg = `${err?.message || ""} ${err?.cause?.message || ""}`;
  const code = String(err?.code || err?.cause?.code || "");
  const status = Number(err?.status || err?.response?.status || 0);
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true;
  if (RETRYABLE_NET_CODES.has(code)) return true;
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  if (
    /WHISPER_TIMEOUT|Connection error|ECONNRESET|ETIMEDOUT|socket hang up|network|fetch failed|terminated|overloaded|aborted/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

/**
 * @param {number} attempt 0-based failed attempt
 * @param {unknown} [err]
 */
export function whisperRetryDelayMs(attempt, err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const base = status === 429 ? 1500 : 500;
  return Math.min(12_000, base * Math.pow(2, Math.max(0, attempt)));
}

/**
 * Keep `/transcri/i` classification in processJob (otherwise "Connection error." → PROCESSING_FAILED).
 * @param {unknown} err
 */
export function wrapWhisperError(err) {
  const msg = String(err?.message || err || "unknown");
  const wrapped = new Error(`transcription failed: ${msg}`);
  wrapped.cause = err;
  return wrapped;
}

/**
 * Pace Groq Whisper under the org RPM cap so the pipe stays full instead of
 * bursting (WHISPER_CONCURRENCY + gap-fill) then sleeping on 429.
 */
export function createWhisperPace({
  rpm = 360,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const gap = 60_000 / Math.max(1, Number(rpm) || 360);
  let nextAt = 0;
  return async function acquireWhisperSlot() {
    const t = now();
    const at = Math.max(t, nextAt);
    nextAt = at + gap;
    const wait = at - t;
    if (wait > 0) await sleep(wait);
  };
}

const pacedRpm = Math.max(
  60,
  Math.min(400, Number(process.env.WHISPER_MAX_RPM) || 360)
);
export const acquireWhisperSlot = createWhisperPace({ rpm: pacedRpm });
