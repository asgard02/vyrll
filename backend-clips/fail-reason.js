function compactOneLine(text, max = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function oomText(text) {
  return /out of memory|cannot allocate memory|oom-kill/i.test(String(text || ""));
}

/**
 * Why a job step died.
 * timeout = our timer killed the process.
 * signal:NAME = the OS killed it.
 * exit_code:N = the process exited.
 * exception:message = a JavaScript throw, not a process exit.
 */
export function jobFailReason(err) {
  if (err?.renderFail?.reason && err.renderFail.reason !== "exit_code:?") {
    return err.renderFail.reason;
  }
  const msg = String(err?.message || err || "");
  if (/timeout/i.test(msg)) return "timeout";
  if (oomText(msg)) return "oom";
  const sig = msg.match(/signal=([A-Za-z0-9]+)/);
  if (sig) return `signal:${sig[1]}`;
  if (/\bSIGKILL\b/.test(msg)) return "signal:SIGKILL";
  const exit = msg.match(/(?:Python exit|ffmpeg exit|exit) (\d+)/i);
  if (exit) return `exit_code:${exit[1]}`;
  const line = compactOneLine(msg);
  if (line) return `exception:${line}`;
  return "exit_code:?";
}
