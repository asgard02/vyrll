/** Même ligne que backend-clips/render-start.js, pour le clic et l'API Next. */
export function renderStartLine(
  job: string,
  step: "click" | "api" | "queued" | "claimed" | "render_begin",
  startedAt: number,
  now = Date.now()
): string {
  const t = now;
  const origin = Number(startedAt);
  const dtMs = Number.isFinite(origin) ? Math.max(0, t - origin) : 0;
  return `[render-start] job=${job || "?"} step=${step} t=${t} dtMs=${dtMs}`;
}
