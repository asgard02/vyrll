import { clipsMaxForSourceSeconds } from "@/lib/plan";
import { channelAvatarDisplayUrl, isYouTubeVideoThumbnailUrl } from "@/lib/youtube";

export const EDITOR_STEPS = ["download", "transcription", "spotting", "creation"] as const;

export type EditorStep = (typeof EDITOR_STEPS)[number];

export type ClipCounter = { n: number; total: number };

/**
 * Étape du monteur.
 * Seuils calés sur setProgress du worker : download < 18, whisper < 40,
 * repérage < 55, rendu ensuite. Dès qu'un clip est déjà là, c'est la création.
 */
export function editorStepForProgress(
  progress: number | null | undefined,
  readyClips = 0
): EditorStep {
  if (readyClips > 0) return "creation";
  const p = typeof progress === "number" && Number.isFinite(progress) ? progress : 0;
  if (p < 18) return "download";
  if (p < 40) return "transcription";
  if (p < 55) return "spotting";
  return "creation";
}

export function phrasesForStep(
  step: EditorStep,
  lists: Partial<Record<EditorStep, unknown>>
): string[] {
  const raw = lists[step];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function phraseNeedsClipCounter(template: string): boolean {
  return template.includes("{n}") || template.includes("{total}");
}

export function visibleEditorPhrases(phrases: string[], counter: ClipCounter | null): string[] {
  if (counter) return phrases;
  return phrases.filter((phrase) => !phraseNeedsClipCounter(phrase));
}

export function phraseAt(phrases: string[], index: number): string {
  if (phrases.length === 0) return "";
  const i = ((Math.trunc(index) % phrases.length) + phrases.length) % phrases.length;
  return phrases[i] ?? "";
}

/** 4 à 5 s. rng dans [0, 1]. */
export function editorPhraseDelayMs(rng: () => number = Math.random): number {
  const unit = Math.min(1, Math.max(0, rng()));
  return 4000 + Math.round(unit * 1000);
}

/** Index suivant, jamais le même tant qu'il y a au moins deux phrases. */
export function nextEditorPhraseIndex(
  length: number,
  previous: number,
  rng: () => number = Math.random
): number {
  if (length <= 1) return 0;
  const prev = ((Math.trunc(previous) % length) + length) % length;
  const span = length - 1;
  const roll = Math.min(0.999999, Math.max(0, rng()));
  const offset = 1 + Math.floor(roll * span);
  return (prev + offset) % length;
}

export function renderEditorPhrase(template: string, counter: ClipCounter | null): string {
  if (!counter) return template;
  return template
    .replace(/\{n\}/g, String(counter.n))
    .replace(/\{total\}/g, String(counter.total));
}

/**
 * Combien de clips ce job est censé sortir (plafond pipeline), pas la durée cible du clip.
 * Fenêtre manuelle : on compte la fenêtre. Sinon la durée source.
 * Les clips déjà reçus ne peuvent pas dépasser ce total.
 */
export function plannedClipTotal(input: {
  sourceDurationSeconds?: number | null;
  windowStartSec?: number | null;
  windowEndSec?: number | null;
  clipMode?: string | null;
  plan?: string | null;
  ready?: number;
}): number | null {
  const ready = Math.max(0, Math.round(Number(input.ready) || 0));
  const start = Number(input.windowStartSec);
  const end = Number(input.windowEndSec);
  const windowSec =
    Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
  const manual = input.clipMode === "manual" || (input.clipMode == null && windowSec != null);
  const source = Number(input.sourceDurationSeconds);
  const effective =
    manual && windowSec != null
      ? windowSec
      : Number.isFinite(source) && source > 0
        ? source
        : null;
  if (effective == null) return ready > 0 ? ready : null;
  return Math.max(ready, clipsMaxForSourceSeconds(effective, input.plan));
}

/** Clip en cours : le prochain pas encore reçu, ou le dernier s'ils y sont tous. */
export function refiningClipCounter(ready: number, total: number | null): ClipCounter | null {
  if (total == null || !Number.isFinite(total) || total < 1) return null;
  const cap = Math.max(1, Math.round(total));
  const done = Math.max(0, Math.min(cap, Math.round(Number(ready) || 0)));
  const n = done >= cap ? cap : done + 1;
  return { n, total: cap };
}

export function httpUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.toLowerCase().startsWith("http")) return null;
  return trimmed;
}

/** Photo de profil de la chaîne. Une miniature vidéo ne compte pas. */
export function editorAvatarSrc(channelThumbnailUrl: string | null | undefined): string | null {
  const url = httpUrl(channelThumbnailUrl);
  if (!url || isYouTubeVideoThumbnailUrl(url)) return null;
  return channelAvatarDisplayUrl(url);
}
