import {
  creditsForAutoMode,
  creditsForLongAuto,
  creditsForManualWindow,
  isLongAutoSource,
} from "@/lib/clip-credits";
import type { JobEtapeMoment } from "@/lib/clips/job-etape";

export const MOMENT_MATCH_SEC = 0.05;
export const MOMENTS_CHOICE_MS = 10 * 60 * 1000;

export type MomentSpan = {
  debut: number;
  fin: number;
};

type ChoiceResult =
  | { ok: true; chosen: JobEtapeMoment[] }
  | { ok: false; reason: "empty" | "unknown" | "invalid" };

function sameInstant(a: number, b: number): boolean {
  return Math.abs(a - b) <= MOMENT_MATCH_SEC + 1e-6;
}

export function momentSpansMatch(a: MomentSpan, b: MomentSpan): boolean {
  return sameInstant(a.debut, b.debut) && sameInstant(a.fin, b.fin);
}

function spanFrom(value: unknown): MomentSpan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const debut = Number(row.debut);
  const fin = Number(row.fin);
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || !(fin > debut)) return null;
  return { debut, fin };
}

/** Corps JSON : un tableau, ou `{ moments: [...] }`. */
export function momentSpansFromBody(body: unknown): MomentSpan[] | null {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { moments?: unknown }).moments)
      ? (body as { moments: unknown[] }).moments
      : null;
  if (!list) return null;
  const spans: MomentSpan[] = [];
  for (const item of list) {
    const span = spanFrom(item);
    if (!span) return null;
    spans.push(span);
  }
  return spans;
}

/**
 * Chaque entrée doit coller à un moment stocké, à 0,05 s.
 * Les doublons sortent. L'ordre du corps est l'ordre du rendu.
 */
export function matchMomentChoice(stored: JobEtapeMoment[], requested: MomentSpan[]): ChoiceResult {
  if (!requested.length) return { ok: false, reason: "empty" };
  const used = new Set<number>();
  const chosen: JobEtapeMoment[] = [];
  for (const span of requested) {
    const idx = stored.findIndex(
      (moment, index) => !used.has(index) && momentSpansMatch(moment, span)
    );
    if (idx < 0) return { ok: false, reason: "unknown" };
    used.add(idx);
    chosen.push(stored[idx]);
  }
  if (!chosen.length) return { ok: false, reason: "empty" };
  return { ok: true, chosen };
}

/** Meilleurs scores d'abord. À égalité, l'ordre d'origine. */
export function defaultMomentIndexes(scores: number[], count: number | null | undefined): number[] {
  const ranked = scores.map((score, index) => ({ score, index }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const cap =
    typeof count === "number" && Number.isInteger(count) && count >= 1
      ? Math.min(count, ranked.length)
      : ranked.length;
  return ranked.slice(0, cap).map((row) => row.index);
}

export function momentScore100(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score <= 10) return Math.round(score * 10);
  return Math.round(Math.max(0, score));
}

export function pipelineObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

export function pipelineHasChosenMoments(pipeline: unknown): boolean {
  const row = pipelineObject(pipeline);
  if (!row || !Array.isArray(row.moments_choisis)) return false;
  return row.moments_choisis.some((item) => spanFrom(item) != null);
}

export function pipelineChoosingAt(pipeline: unknown): string | null {
  const row = pipelineObject(pipeline);
  const value = row?.choix_en_cours_at;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Compte à rebours de 10 min. Figé à l'instant où une case a été touchée.
 * Null si l'horodatage de départ est illisible.
 */
export function choiceCountdownMs(
  readyAt: string,
  nowMs: number,
  pausedAt?: string | null
): number | null {
  const ready = Date.parse(readyAt);
  if (!Number.isFinite(ready)) return null;
  const basis = pausedAt ? Date.parse(pausedAt) : nowMs;
  if (!Number.isFinite(basis)) return null;
  return Math.max(0, ready + MOMENTS_CHOICE_MS - basis);
}

type BilledJob = {
  credits_quoted?: number | null;
  clip_mode?: string | null;
  render_mode?: string | null;
  search_window_start_sec?: number | null;
  search_window_end_sec?: number | null;
  source_duration_seconds?: number | null;
  duration_max?: number | null;
};

/** Minutes déjà devisées. Sinon le même calcul que le débit au done. */
export function billedMinutesForChoice(job: BilledJob): number | null {
  const quoted = job.credits_quoted;
  if (typeof quoted === "number" && Number.isFinite(quoted)) {
    return Math.max(0, Math.round(quoted));
  }
  const ws = job.search_window_start_sec;
  const we = job.search_window_end_sec;
  const isManual =
    job.clip_mode === "manual" ||
    job.render_mode === "manual" ||
    (ws != null && we != null);
  if (
    isManual &&
    ws != null &&
    we != null &&
    Number.isFinite(ws) &&
    Number.isFinite(we) &&
    we > ws
  ) {
    return creditsForManualWindow(Math.round(we - ws));
  }
  const source = Number(job.source_duration_seconds);
  if (!Number.isFinite(source) || source <= 0) return null;
  if (isLongAutoSource(source)) {
    return creditsForLongAuto({
      sourceDurationSec: source,
      durationMaxSec: Number(job.duration_max) || 60,
    });
  }
  return creditsForAutoMode(source);
}
