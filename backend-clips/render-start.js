/** Horodatage du trajet clic → rendu. dtMs part du clic (renderStartedAt). */
export function renderStartLine(job, step, startedAt, now = Date.now) {
  const t = typeof now === "function" ? now() : Number(now);
  const origin = Number(startedAt);
  const dtMs = Number.isFinite(origin) && origin > 0 ? Math.max(0, t - origin) : 0;
  return `[render-start] job=${job || "?"} step=${step} t=${t} dtMs=${dtMs}`;
}

/**
 * Un réveil pendant un tick en cours ne doit pas attendre le prochain poll.
 * Le tick suivant part dès que le worker est libre (waitMs = 0).
 */
export function planWorkerWake({ running, pollMs }) {
  const poll = Math.max(0, Number(pollMs) || 0);
  if (running) {
    return { runNow: false, waitMs: 0, againWhenIdle: true, pollMs: poll };
  }
  return { runNow: true, waitMs: 0, againWhenIdle: false, pollMs: poll };
}
