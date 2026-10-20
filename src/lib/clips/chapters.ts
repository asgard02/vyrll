/**
 * Chapitres YouTube et résumé de 3 lignes, un appel modèle par vidéo.
 * CHAPTERS_MODEL (défaut gpt-6-luna), corps partagé buildOpenAIChatBody.
 * La transcription vient du cache. Pas d'appel Groq. Pas de compte.
 */

import { buildOpenAIChatBody } from "@/lib/openai-chat";

export const DEFAULT_CHAPTERS_MODEL = "gpt-6-luna";
export const CHAPTERS_MIN_DURATION_SEC = 180;
export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_GAP_SEC = 10;
export const CHAPTER_TITLE_MAX = 80;
export const SUMMARY_LINE_MAX = 240;
export const TIMED_TRANSCRIPT_MAX_CHARS = 50_000;

/** Aligné sur backend-clips/transcript-index.js. */
const WHISPER_STT_VERSION = "v11";
const GROQ_STT_MODEL = "whisper-large-v3-turbo";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CALL_TIMEOUT_MS = 40_000;
const TEMPERATURE = 0.2;
const MAX_COMPLETION_TOKENS = 1500;

const BRAND = /trimo\s*ai/gi;
const LONG_DASH = /\u2014|\u2013/g;

const SYSTEM = [
  "You write YouTube chapters and a short summary for one video.",
  "Reply with one JSON object only. Keys: chapters, summary.",
  "chapters: an array of at least 3 objects. Each object has start and title.",
  "start: a timestamp from the beginning of the video. The first start is 00:00.",
  "Times increase. Each chapter lasts at least 10 seconds. No chapter starts before 0 or at or after the end of the video.",
  "title: a short non-empty title, at most 80 characters.",
  "summary: an array of exactly 3 non-empty lines.",
  "Write every title and every summary line in the language of the transcript.",
  "No emoji. Do not wrap a title in quotation marks.",
  "Use a comma or a period. Never a long dash.",
  "Do not name any product, brand, or tool.",
].join(" ");

export type Chapter = {
  startSec: number;
  title: string;
};

export type ChapterIssue = "count" | "start" | "order" | "gap" | "end" | "title" | "summary";

export type ChapterInsert = {
  video_id: string;
  chapters: { start_sec: number; title: string }[];
  summary: string;
  lang: string | null;
  model: string;
};

export type ChapterTranscriptRow = {
  transcript: unknown;
  word_count: number;
  lang: string;
  window_start_sec: number | null;
  window_end_sec: number | null;
  stt_version: string;
  groq_model: string;
};

export type ChaptersApiPayload = {
  available: boolean;
  chapters: Chapter[] | null;
  summary: string | null;
  text: string | null;
};

export function chaptersModel(): string {
  return process.env.CHAPTERS_MODEL?.trim() || DEFAULT_CHAPTERS_MODEL;
}

export function chaptersDurationEligible(durationSec: number | null | undefined): boolean {
  return (
    typeof durationSec === "number" &&
    Number.isFinite(durationSec) &&
    durationSec >= CHAPTERS_MIN_DURATION_SEC
  );
}

export function chaptersChatBody(model: string, messages: unknown[]): Record<string, unknown> {
  return buildOpenAIChatBody({
    model,
    temperature: TEMPERATURE,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    responseFormat: { type: "json_object" },
    messages,
  });
}

export function sanitizeChapterText(value: string): string {
  return value
    .replace(LONG_DASH, ", ")
    .replace(BRAND, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

export function formatChapterStamp(startSec: number): string {
  const total = Math.max(0, Math.floor(startSec));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function formatChapterLine(chapter: Chapter): string {
  return `${formatChapterStamp(chapter.startSec)} ${chapter.title}`;
}

export function formatChaptersBlock(chapters: Chapter[]): string {
  return chapters.map(formatChapterLine).join("\n");
}

export function parseChapterStart(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) {
    const mins = nums[0] ?? Number.NaN;
    const secs = nums[1] ?? Number.NaN;
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }
  const hours = nums[0] ?? Number.NaN;
  const mins = nums[1] ?? Number.NaN;
  const secs = nums[2] ?? Number.NaN;
  if (mins >= 60 || secs >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

export function validateChapterResult(
  chapters: Chapter[],
  durationSec: number,
  summary: string
): ChapterIssue | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return "end";
  if (!Array.isArray(chapters) || chapters.length < CHAPTER_MIN_COUNT) return "count";
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const start = chapter?.startSec;
    const title = (chapter?.title ?? "").trim();
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0 || start >= durationSec) {
      return "end";
    }
    if (!title || Array.from(title).length > CHAPTER_TITLE_MAX) return "title";
    if (i === 0 && start !== 0) return "start";
  }
  for (let i = 1; i < chapters.length; i++) {
    const start = chapters[i]?.startSec;
    const prev = chapters[i - 1]?.startSec;
    if (typeof start !== "number" || typeof prev !== "number" || start <= prev) return "order";
  }
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i]?.startSec;
    const next = i + 1 < chapters.length ? chapters[i + 1]?.startSec : durationSec;
    if (typeof start !== "number" || typeof next !== "number" || next - start < CHAPTER_MIN_GAP_SEC) {
      return "gap";
    }
  }
  const lines = summary.split("\n");
  if (
    lines.length !== 3 ||
    lines.some((line) => {
      const trimmed = line.trim();
      return !trimmed || Array.from(trimmed).length > SUMMARY_LINE_MAX;
    })
  ) {
    return "summary";
  }
  return null;
}

function fullVideo(row: ChapterTranscriptRow): boolean {
  return row.window_start_sec == null && row.window_end_sec == null;
}

export function pickChapterTranscript(rows: ChapterTranscriptRow[]): ChapterTranscriptRow | null {
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => {
    const aFull = fullVideo(a) ? 1 : 0;
    const bFull = fullVideo(b) ? 1 : 0;
    if (aFull !== bFull) return bFull - aFull;
    const aPref = a.stt_version === WHISPER_STT_VERSION && a.groq_model === GROQ_STT_MODEL ? 1 : 0;
    const bPref = b.stt_version === WHISPER_STT_VERSION && b.groq_model === GROQ_STT_MODEL ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return (b.word_count || 0) - (a.word_count || 0);
  });
  return ranked[0] ?? null;
}

type TimedLine = { start: number; text: string };

export function transcriptLines(transcript: unknown): TimedLine[] {
  if (!transcript || typeof transcript !== "object") return [];
  const segs = (transcript as { segments?: unknown }).segments;
  if (!Array.isArray(segs)) return [];
  const lines: TimedLine[] = [];
  for (const item of segs) {
    if (!item || typeof item !== "object") continue;
    const seg = item as { text?: unknown; start?: unknown };
    const text = sanitizeChapterText(String(seg.text ?? "").replace(/\s+/g, " "));
    const start = Number(seg.start);
    if (!text || !Number.isFinite(start) || start < 0) continue;
    lines.push({ start, text });
  }
  return lines;
}

export function thinTimedLines(lines: string[], maxChars: number): string {
  if (!lines.length) return "";
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  let step = 2;
  while (step < lines.length) {
    const picked: string[] = [];
    for (let i = 0; i < lines.length; i += step) {
      const line = lines[i];
      if (line) picked.push(line);
    }
    const last = lines[lines.length - 1];
    if (last && picked[picked.length - 1] !== last) picked.push(last);
    const text = picked.join("\n");
    if (text.length <= maxChars) return text;
    step *= 2;
  }
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  const pair = first === last ? first : `${first}\n${last}`;
  if (pair.length <= maxChars) return pair;
  return pair.slice(0, maxChars);
}

export function timedTranscript(transcript: unknown, maxChars = TIMED_TRANSCRIPT_MAX_CHARS): string {
  const lines = transcriptLines(transcript).map((line) => `${formatChapterStamp(line.start)} ${line.text}`);
  return thinTimedLines(lines, maxChars);
}

function jsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function readSummary(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    return raw.map((item) => sanitizeChapterText(typeof item === "string" ? item : "")).join("\n");
  }
  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map((line) => sanitizeChapterText(line))
      .join("\n");
  }
  return null;
}

export function parseChaptersPayload(text: string): { chapters: Chapter[]; summary: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText(text));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as { chapters?: unknown; summary?: unknown };
  if (!Array.isArray(rec.chapters)) return null;
  const chapters: Chapter[] = [];
  for (const item of rec.chapters) {
    if (!item || typeof item !== "object") return null;
    const row = item as { start?: unknown; title?: unknown; start_sec?: unknown; t?: unknown };
    const startSec = parseChapterStart(row.start ?? row.t ?? row.start_sec);
    if (startSec == null) return null;
    const title = sanitizeChapterText(typeof row.title === "string" ? row.title : "");
    chapters.push({ startSec, title });
  }
  const summary = readSummary(rec.summary);
  if (summary == null) return null;
  return { chapters, summary };
}

function issueHint(issue: ChapterIssue | "json" | "call"): string {
  switch (issue) {
    case "count":
      return "Need at least 3 chapters.";
    case "start":
      return "The first chapter must start at 00:00.";
    case "order":
      return "Chapter times must increase.";
    case "gap":
      return "Each chapter must last at least 10 seconds, including the last one before the end of the video.";
    case "end":
      return "No chapter may start before 0 or at or after the end of the video.";
    case "title":
      return "Every title must be non-empty and at most 80 characters.";
    case "summary":
      return "summary must be exactly 3 non-empty lines.";
    case "json":
      return "The previous reply was not valid JSON.";
    case "call":
      return "The previous reply was refused.";
  }
}

function chapterMessages(opts: {
  transcript: string;
  durationSec: number;
  lang: string | null;
  retry: ChapterIssue | "json" | "call" | null;
}): { role: string; content: string }[] {
  const langLine = opts.lang
    ? `The transcript language code is ${opts.lang}. Write every title and every summary line in that language.`
    : "Write every title and every summary line in the same language as the transcript.";
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        langLine,
        `Video length: ${formatChapterStamp(opts.durationSec)}. The last chapter must start at least 10 seconds before this time.`,
        "",
        "Transcript:",
        opts.transcript,
      ].join("\n"),
    },
  ];
  if (opts.retry) {
    messages.push({
      role: "user",
      content: `${issueHint(opts.retry)} Return only the JSON object.`,
    });
  }
  return messages;
}

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

export function logChapterTokens(info: {
  videoId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  attempt: number;
}): void {
  console.log(
    `[chapters] video=${info.videoId} model=${info.model} prompt_tokens=${info.promptTokens} completion_tokens=${info.completionTokens} attempt=${info.attempt}`
  );
}

type Attempt =
  | { ok: true; chapters: Chapter[]; summary: string }
  | { ok: false; issue: ChapterIssue | "json" | "call" };

async function callOnce(opts: {
  videoId: string;
  messages: { role: string; content: string }[];
  durationSec: number;
  apiKey: string;
  fetchImpl: typeof fetch;
  attempt: number;
}): Promise<Attempt> {
  const model = chaptersModel();
  let data: unknown = null;
  try {
    const res = await opts.fetchImpl(OPENAI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chaptersChatBody(model, opts.messages)),
    });
    data = await res.json().catch(() => null);
    const usage = usageOf(data);
    logChapterTokens({
      videoId: opts.videoId,
      model,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      attempt: opts.attempt,
    });
    if (!res.ok) return { ok: false, issue: "call" };
  } catch {
    logChapterTokens({
      videoId: opts.videoId,
      model,
      promptTokens: 0,
      completionTokens: 0,
      attempt: opts.attempt,
    });
    return { ok: false, issue: "call" };
  }
  const content =
    data && typeof data === "object"
      ? (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content
      : "";
  const parsed = parseChaptersPayload(typeof content === "string" ? content : "");
  if (!parsed) return { ok: false, issue: "json" };
  const issue = validateChapterResult(parsed.chapters, opts.durationSec, parsed.summary);
  if (issue) return { ok: false, issue };
  return { ok: true, chapters: parsed.chapters, summary: parsed.summary };
}

function toInsert(
  videoId: string,
  lang: string | null,
  chapters: Chapter[],
  summary: string
): ChapterInsert {
  return {
    video_id: videoId,
    chapters: chapters.map((chapter) => ({ start_sec: chapter.startSec, title: chapter.title })),
    summary,
    lang,
    model: chaptersModel(),
  };
}

export function chaptersFromRow(row: ChapterInsert): Chapter[] {
  return row.chapters.map((chapter) => ({
    startSec: chapter.start_sec,
    title: chapter.title,
  }));
}

export function chaptersApiPayload(row: ChapterInsert | null, available: boolean): ChaptersApiPayload {
  if (!row) {
    return { available, chapters: null, summary: null, text: null };
  }
  const chapters = chaptersFromRow(row);
  return {
    available: true,
    chapters,
    summary: row.summary,
    text: formatChaptersBlock(chapters),
  };
}

export async function loadOrCreateVideoChapters(opts: {
  videoId: string;
  durationSec: number;
  lang: string | null;
  transcript: unknown;
  readExisting: () => Promise<ChapterInsert | null>;
  insert: (row: ChapterInsert) => Promise<"inserted" | "conflict">;
  reread: () => Promise<ChapterInsert | null>;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ChapterInsert | null> {
  const existing = await opts.readExisting();
  if (existing) return existing;
  if (!chaptersDurationEligible(opts.durationSec)) return null;
  const transcript = timedTranscript(opts.transcript);
  if (!transcript || !opts.apiKey.trim()) return null;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let retry: ChapterIssue | "json" | "call" | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callOnce({
      videoId: opts.videoId,
      messages: chapterMessages({
        transcript,
        durationSec: opts.durationSec,
        lang: opts.lang,
        retry,
      }),
      durationSec: opts.durationSec,
      apiKey: opts.apiKey,
      fetchImpl,
      attempt,
    });
    if (!result.ok) {
      retry = result.issue;
      console.warn(`[chapters] video=${opts.videoId} attempt=${attempt} issue=${result.issue}`);
      continue;
    }
    const row = toInsert(opts.videoId, opts.lang, result.chapters, result.summary);
    const stored = await opts.insert(row);
    if (stored === "conflict") return opts.reread();
    return row;
  }
  return null;
}
