/**
 * Titres et descriptions à poster, un appel modèle par clip.
 * CLIP_COPY_MODEL (défaut gpt-6-luna), corps partagé buildOpenAIChatBody.
 * La transcription vient du cache. Pas d'appel Groq.
 */

import { createHash } from "node:crypto";
import { buildOpenAIChatBody } from "@/lib/openai-chat";
import type { ClipPublishCopy, StoredClipRow } from "@/lib/clips/types";
import { extractVideoId } from "@/lib/youtube";

export const DEFAULT_CLIP_COPY_MODEL = "gpt-6-luna";

/** Jobs créés à cette date ou après reçoivent les textes tout seuls. */
export const PUBLISH_COPY_SINCE = "2026-10-15T00:00:00.000Z";

export const CLIP_COPY_PARALLEL = 3;

export const CLIP_COPY_COLUMNS =
  "clip_index, title, description_tiktok, description_shorts, description_instagram, hashtags, why, alt_hook, title_source";

/** ON CONFLICT (job_id, clip_index) DO NOTHING. */
export const CLIP_PUBLISH_UPSERT = {
  onConflict: "job_id,clip_index",
  ignoreDuplicates: true,
} as const;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CALL_TIMEOUT_MS = 40_000;
const TEMPERATURE = 0.4;
const MAX_COMPLETION_TOKENS = 800;

/** Aligné sur backend-clips/transcript-index.js. */
const WHISPER_STT_VERSION = "v9";
const GROQ_STT_MODEL = "whisper-large-v3-turbo";

const BRAND = /trimo\s*ai/gi;
const LONG_DASH = /\u2014|\u2013/g;

const SYSTEM = [
  "You write posting text for one short video clip.",
  "Reply with one JSON object only. Keys:",
  "title, description_tiktok, description_shorts, description_instagram, hashtags, why, alt_hook.",
  "title: one line, the title to publish.",
  "description_tiktok, description_shorts, description_instagram: a short caption for that platform.",
  "hashtags: an array of at most 5 tags. Each tag starts with #.",
  "why: one sentence that explains the viral score you are given. Do not invent another score.",
  "alt_hook: one alternate opening line. It does not replace any on-screen text.",
  "No emoji. Do not wrap a field in quotation marks.",
  "Use a comma or a period. Never a long dash.",
  "Do not name any product, brand, or tool.",
].join(" ");

export function clipCopyModel(): string {
  return process.env.CLIP_COPY_MODEL?.trim() || DEFAULT_CLIP_COPY_MODEL;
}

export function jobAutoPublishCopy(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  const since = Date.parse(PUBLISH_COPY_SINCE);
  return Number.isFinite(created) && created >= since;
}

export function clipCopyChatBody(messages: unknown[]): Record<string, unknown> {
  return buildOpenAIChatBody({
    model: clipCopyModel(),
    temperature: TEMPERATURE,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    responseFormat: { type: "json_object" },
    messages,
  });
}

export function sanitizePublishField(value: string): string {
  return value
    .replace(LONG_DASH, ", ")
    .replace(BRAND, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim();
}

export function firstSentence(text: string, fallback: string): string {
  const clean = sanitizePublishField(text);
  if (!clean) return fallback;
  const match = clean.match(/^(.+?[.!?…])(?:\s|$)/);
  const sentence = (match ? match[1] : clean.split(/\s+/).slice(0, 16).join(" ")).trim();
  const cut = Array.from(sentence).slice(0, 160).join("").trim();
  return cut || fallback;
}

function oneSentence(value: string): string {
  const sentence = firstSentence(value, "");
  return Array.from(sentence).slice(0, 280).join("").trim();
}

function cap(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("").trim();
}

function parseHashtags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\s,]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    let tag = sanitizePublishField(String(item ?? ""));
    if (!tag) continue;
    tag = tag.replace(/^#+/, "");
    if (!tag) continue;
    tag = `#${tag}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

export function parseClipCopyJson(text: string): ClipPublishCopy | null {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const title = cap(sanitizePublishField(typeof rec.title === "string" ? rec.title : ""), 160);
  if (!title) return null;
  const field = (key: string, max: number) =>
    cap(sanitizePublishField(typeof rec[key] === "string" ? (rec[key] as string) : ""), max);
  return {
    title,
    descriptionTiktok: field("description_tiktok", 600),
    descriptionShorts: field("description_shorts", 600),
    descriptionInstagram: field("description_instagram", 600),
    hashtags: parseHashtags(rec.hashtags),
    why: oneSentence(typeof rec.why === "string" ? rec.why : ""),
    altHook: field("alt_hook", 200),
    titleSource: "model",
  };
}

export function clipTranscriptForPrompt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 8000) return clean;
  return `${clean.slice(0, 5000)}\n...\n${clean.slice(-2500)}`;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clipSourceRangeSec(clip: {
  source_abs_start?: number | null;
  source_abs_end?: number | null;
  start?: number | null;
  end?: number | null;
}): { startSec: number; endSec: number } | null {
  const absStart = finite(clip.source_abs_start);
  const absEnd = finite(clip.source_abs_end);
  if (absStart != null && absEnd != null && absEnd > absStart) {
    return { startSec: absStart, endSec: absEnd };
  }
  const start = finite(clip.start);
  const end = finite(clip.end);
  if (start != null && end != null && end > start) {
    return { startSec: start, endSec: end };
  }
  return null;
}

export type TranscriptSegmentRow = {
  start_ms: number;
  end_ms: number;
  text: string;
  lang?: string | null;
  video_key?: string | null;
};

export function textFromSegments(
  segments: TranscriptSegmentRow[],
  startSec: number,
  endSec: number
): string {
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  return segments
    .filter((s) => s.end_ms > startMs && s.start_ms < endMs && s.text.trim())
    .map((s) => s.text.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textFromCachedTranscript(
  transcript: unknown,
  startSec: number,
  endSec: number
): string {
  if (!transcript || typeof transcript !== "object") return "";
  const rec = transcript as { words?: unknown; segments?: unknown };
  const words = Array.isArray(rec.words) ? rec.words : [];
  const picked: string[] = [];
  for (const item of words) {
    if (!item || typeof item !== "object") continue;
    const word = item as { word?: unknown; text?: unknown; start?: unknown; end?: unknown };
    const text = String(word.word ?? word.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || text === "♪") continue;
    const start = Number(word.start);
    if (!Number.isFinite(start)) continue;
    const endRaw = Number(word.end);
    const end = Number.isFinite(endRaw) ? endRaw : start;
    if (end <= startSec || start >= endSec) continue;
    picked.push(text);
  }
  if (picked.length) return picked.join(" ").replace(/\s+/g, " ").trim();

  const segs = Array.isArray(rec.segments) ? rec.segments : [];
  const segTexts: string[] = [];
  for (const item of segs) {
    if (!item || typeof item !== "object") continue;
    const seg = item as { text?: unknown; start?: unknown; end?: unknown };
    const text = String(seg.text ?? "").trim();
    const start = Number(seg.start);
    const end = Number(seg.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= startSec || start >= endSec) continue;
    segTexts.push(text);
  }
  return segTexts.join(" ").replace(/\s+/g, " ").trim();
}

export function clipSpeech(opts: {
  clip: Pick<StoredClipRow, "source_abs_start" | "source_abs_end" | "start" | "end" | "text">;
  segments: TranscriptSegmentRow[];
  transcript: unknown | null;
}): string {
  const range = clipSourceRangeSec(opts.clip);
  if (range && opts.segments.length) {
    const fromSeg = textFromSegments(opts.segments, range.startSec, range.endSec);
    if (fromSeg) return fromSeg;
  }
  if (range && opts.transcript) {
    const fromWords = textFromCachedTranscript(opts.transcript, range.startSec, range.endSec);
    if (fromWords) return fromWords;
  }
  return String(opts.clip.text ?? "").replace(/\s+/g, " ").trim();
}

export function buildVideoSummary(opts: {
  videoTitle?: string | null;
  channelTitle?: string | null;
  parts: string[];
}): string {
  const chunks = opts.parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = chunks.join(" ");
  let body = joined;
  const max = 1000;
  if (joined.length > max) {
    const third = Math.floor(max / 3);
    const mid = Math.max(0, Math.floor(joined.length / 2) - Math.floor(third / 2));
    body = [joined.slice(0, third), joined.slice(mid, mid + third), joined.slice(-third)].join(" ... ");
  }
  const head = [opts.videoTitle?.trim(), opts.channelTitle?.trim()].filter(Boolean).join(". ");
  return [head, body].filter(Boolean).join("\n").slice(0, 1200);
}

export type TranscriptCacheRow = {
  transcript: unknown;
  word_count: number;
  lang: string;
  window_start_sec: number | null;
  window_end_sec: number | null;
  stt_version: string;
  groq_model: string;
};

function sameWindow(
  row: TranscriptCacheRow,
  window: { start: number | null; end: number | null }
): boolean {
  const start = window.start == null ? null : Math.round(window.start);
  const end = window.end == null ? null : Math.round(window.end);
  return row.window_start_sec === start && row.window_end_sec === end;
}

export function pickTranscriptRow(
  rows: TranscriptCacheRow[],
  window: { start: number | null; end: number | null }
): TranscriptCacheRow | null {
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => {
    const aWin = sameWindow(a, window) ? 1 : 0;
    const bWin = sameWindow(b, window) ? 1 : 0;
    if (aWin !== bWin) return bWin - aWin;
    const aPref = a.stt_version === WHISPER_STT_VERSION && a.groq_model === GROQ_STT_MODEL ? 1 : 0;
    const bPref = b.stt_version === WHISPER_STT_VERSION && b.groq_model === GROQ_STT_MODEL ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return (b.word_count || 0) - (a.word_count || 0);
  });
  return ranked[0] ?? null;
}

export function dominantLang(langs: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const lang of langs) {
    const key = String(lang ?? "").trim().toLowerCase();
    if (!key || key === "auto") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [lang, count] of counts) {
    if (count > n) {
      best = lang;
      n = count;
    }
  }
  return best;
}

export function videoKeyFromUrl(url: string): string | null {
  const yt = extractVideoId(url);
  if (yt) return yt;
  if (!url) return null;
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

export type PreparedClip = {
  index: number;
  transcript: string;
  summary: string;
  score: number | null;
  lang: string | null;
  fallbackTitle: string;
  jobId: string;
};

export function prepareClipInputs(opts: {
  jobId: string;
  clips: StoredClipRow[];
  segments: TranscriptSegmentRow[];
  transcript: unknown | null;
  summary: string;
  lang: string | null;
}): PreparedClip[] {
  return opts.clips.map((clip, index) => ({
    index,
    jobId: opts.jobId,
    transcript: clipSpeech({ clip, segments: opts.segments, transcript: opts.transcript }),
    summary: opts.summary,
    score: finite(clip.score_viral),
    lang: opts.lang,
    fallbackTitle: `Clip ${index + 1}`,
  }));
}

export type PublishCopyRow = {
  job_id: string;
  clip_index: number;
  title: string;
  description_tiktok: string;
  description_shorts: string;
  description_instagram: string;
  hashtags: string[];
  why: string;
  alt_hook: string;
  title_source: "model" | "fallback";
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
};

export type ClipPublishCopyRow = {
  clip_index: number;
  title: string;
  description_tiktok: string | null;
  description_shorts: string | null;
  description_instagram: string | null;
  hashtags: string[] | null;
  why: string | null;
  alt_hook: string | null;
  title_source: string | null;
};

export function toPublishCopy(row: ClipPublishCopyRow): ClipPublishCopy {
  const titleSource = row.title_source === "fallback" ? "fallback" : "model";
  return {
    title: row.title,
    descriptionTiktok: row.description_tiktok ?? "",
    descriptionShorts: row.description_shorts ?? "",
    descriptionInstagram: row.description_instagram ?? "",
    hashtags: Array.isArray(row.hashtags) ? row.hashtags.slice(0, 5) : [],
    why: row.why ?? "",
    altHook: row.alt_hook ?? "",
    titleSource,
  };
}

export function mergePublishCopies<T extends { index?: number; publishCopy?: ClipPublishCopy | null }>(
  clips: T[],
  copies: Array<ClipPublishCopy & { index: number }>
): T[] {
  const byIndex = new Map(copies.map((copy) => [copy.index, copy]));
  return clips.map((clip, i) => {
    const key = typeof clip.index === "number" ? clip.index : i;
    const copy = byIndex.get(key);
    if (!copy) return clip;
    const publishCopy: ClipPublishCopy = {
      title: copy.title,
      descriptionTiktok: copy.descriptionTiktok,
      descriptionShorts: copy.descriptionShorts,
      descriptionInstagram: copy.descriptionInstagram,
      hashtags: copy.hashtags,
      why: copy.why,
      altHook: copy.altHook,
      titleSource: copy.titleSource,
    };
    return { ...clip, publishCopy };
  });
}

function clipCopyMessages(opts: {
  transcript: string;
  summary: string;
  score: number | null;
  lang: string | null;
  retry: boolean;
}): { role: string; content: string }[] {
  const langLine = opts.lang
    ? `The transcript language code is ${opts.lang}. Write every field in that language.`
    : "Write every field in the same language as the clip transcript.";
  const scoreLine =
    opts.score != null && Number.isFinite(opts.score)
      ? `Viral score out of 100: ${Math.round(opts.score)}. The why field is one sentence that explains this score.`
      : "Viral score: unknown. The why field is one sentence about why this moment can travel.";
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `${langLine}\n${scoreLine}\n\nVideo summary:\n${opts.summary || "(none)"}\n\nClip transcript:\n${clipTranscriptForPrompt(opts.transcript)}`,
    },
  ];
  if (opts.retry) {
    messages.push({
      role: "user",
      content: "The previous reply was not valid JSON, or the title was empty. Return only the JSON object, with a non-empty title.",
    });
  }
  return messages;
}

type UsageHandler = (info: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  attempt: number;
}) => void;

function usageOf(data: unknown): { prompt: number; completion: number } {
  if (!data || typeof data !== "object") return { prompt: 0, completion: 0 };
  const usage = (data as { usage?: Record<string, unknown> }).usage;
  if (!usage) return { prompt: 0, completion: 0 };
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    prompt: Number.isFinite(prompt) ? prompt : 0,
    completion: Number.isFinite(completion) ? completion : 0,
  };
}

async function callOnce(opts: {
  messages: { role: string; content: string }[];
  apiKey: string;
  fetchImpl: typeof fetch;
  attempt: number;
  onUsage?: UsageHandler;
}): Promise<ClipPublishCopy | null> {
  const model = clipCopyModel();
  let data: unknown = null;
  try {
    const res = await opts.fetchImpl(OPENAI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(clipCopyChatBody(opts.messages)),
    });
    data = await res.json().catch(() => null);
    const usage = usageOf(data);
    opts.onUsage?.({
      model,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      attempt: opts.attempt,
    });
    if (!res.ok) return null;
  } catch {
    opts.onUsage?.({
      model,
      promptTokens: 0,
      completionTokens: 0,
      attempt: opts.attempt,
    });
    return null;
  }
  const content =
    data && typeof data === "object"
      ? (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content
      : "";
  return parseClipCopyJson(typeof content === "string" ? content : "");
}

export function logClipCopyTokens(info: {
  jobId: string;
  clipIndex: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  attempt: number;
}): void {
  console.log(
    `[publish-copy] job=${info.jobId} clip=${info.clipIndex} model=${info.model} prompt_tokens=${info.promptTokens} completion_tokens=${info.completionTokens} attempt=${info.attempt}`
  );
}

function fallbackCopy(clip: PreparedClip): ClipPublishCopy {
  return {
    title: firstSentence(clip.transcript, clip.fallbackTitle),
    descriptionTiktok: "",
    descriptionShorts: "",
    descriptionInstagram: "",
    hashtags: [],
    why: "",
    altHook: "",
    titleSource: "fallback",
  };
}

function toRow(jobId: string, index: number, copy: ClipPublishCopy, tokens: { prompt: number; completion: number }): PublishCopyRow {
  return {
    job_id: jobId,
    clip_index: index,
    title: copy.title,
    description_tiktok: copy.descriptionTiktok,
    description_shorts: copy.descriptionShorts,
    description_instagram: copy.descriptionInstagram,
    hashtags: copy.hashtags,
    why: copy.why,
    alt_hook: copy.altHook,
    title_source: copy.titleSource,
    model: clipCopyModel(),
    prompt_tokens: tokens.prompt,
    completion_tokens: tokens.completion,
  };
}

export async function copyForClip(
  clip: PreparedClip,
  opts: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    onUsage?: UsageHandler;
  }
): Promise<PublishCopyRow> {
  if (!clip.transcript.trim()) {
    return toRow(clip.jobId, clip.index, fallbackCopy(clip), { prompt: 0, completion: 0 });
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  let prompt = 0;
  let completion = 0;
  const track: UsageHandler = (info) => {
    prompt += info.promptTokens;
    completion += info.completionTokens;
    opts.onUsage?.(info);
  };
  const first = await callOnce({
    messages: clipCopyMessages({ ...clip, retry: false }),
    apiKey: opts.apiKey,
    fetchImpl,
    attempt: 1,
    onUsage: track,
  });
  if (first) return toRow(clip.jobId, clip.index, first, { prompt, completion });
  const second = await callOnce({
    messages: clipCopyMessages({ ...clip, retry: true }),
    apiKey: opts.apiKey,
    fetchImpl,
    attempt: 2,
    onUsage: track,
  });
  if (second) return toRow(clip.jobId, clip.index, second, { prompt, completion });
  return toRow(clip.jobId, clip.index, fallbackCopy(clip), { prompt, completion });
}

export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  const cap = Math.max(1, limit);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await worker(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => run()));
}

export async function generateMissingClipCopies(opts: {
  clips: PreparedClip[];
  hasCopy: (index: number) => Promise<boolean>;
  produce: (clip: PreparedClip) => Promise<PublishCopyRow>;
  insertCopy: (row: PublishCopyRow) => Promise<void>;
  parallel?: number;
}): Promise<{ inserted: PublishCopyRow[]; failed: number[] }> {
  const inserted: PublishCopyRow[] = [];
  const failed: number[] = [];
  await mapWithConcurrency(opts.clips, opts.parallel ?? CLIP_COPY_PARALLEL, async (clip) => {
    try {
      if (await opts.hasCopy(clip.index)) return;
      const row = await opts.produce(clip);
      await opts.insertCopy(row);
      inserted.push(row);
    } catch (err) {
      failed.push(clip.index);
      console.error(
        "[publish-copy] clip failed",
        clip.index,
        err instanceof Error ? err.message : err
      );
    }
  });
  return { inserted, failed };
}

type UpsertClient = {
  from(table: string): {
    upsert(
      row: PublishCopyRow,
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ): PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function insertClipPublishCopy(admin: UpsertClient, row: PublishCopyRow): Promise<void> {
  const { error } = await admin.from("clip_publish_copy").upsert(row, CLIP_PUBLISH_UPSERT);
  if (error) throw new Error(error.message);
}

export function publishCopyApi(row: PublishCopyRow): ClipPublishCopy & { index: number } {
  return {
    index: row.clip_index,
    title: row.title,
    descriptionTiktok: row.description_tiktok,
    descriptionShorts: row.description_shorts,
    descriptionInstagram: row.description_instagram,
    hashtags: row.hashtags,
    why: row.why,
    altHook: row.alt_hook,
    titleSource: row.title_source,
  };
}
