import { tokenizeQuery } from "./library-search";
import {
  serializeAgentIntent,
  topicsCap,
  type ClipAgentQuantity,
} from "@/lib/clip-agent/decision";

export {
  classifyExplicitClipAsk,
  coerceDecision,
  decisionMutatesTopics,
  extractThemeFocus,
  inferAskQuantity,
  isClipOffTopicAsk,
  isGlobalRankingAsk,
  isGlobalRankingDecision,
  isOverviewQuery,
  mergeClipDecision,
  parseAgentDecision,
  parseAgentIntentContract,
  pendingListenReply,
  requestedMomentsMax,
  serializeAgentIntent,
  topicsCap,
  transcriptMissingReply,
} from "@/lib/clip-agent/decision";
export type {
  ClipAgentDecision,
  ClipAgentIntentV1,
  ClipAgentMode,
  ClipAgentQuantity,
} from "@/lib/clip-agent/decision";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.SUPPORT_CHAT_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 90_000;
/** Un appel tient ~60–90 min de parole. Au-delà : chunks consécutifs (pas de saut de phrases). */
export const TRANSCRIPT_CONTEXT_CHARS = 100_000;
export const TRANSCRIPT_RETRIEVE_CHARS = 16_000;
export const TRANSCRIPT_PAGE_SIZE = 1000;
/** @deprecated use TRANSCRIPT_PAGE_SIZE + paginateTranscriptPages */
export const TRANSCRIPT_JOB_SEGMENTS = TRANSCRIPT_PAGE_SIZE;

export type TranscriptLine = {
  start_ms: number;
  end_ms: number;
  text: string;
  video_key?: string;
};

export type AgentTopic = {
  id: string;
  title: string;
  blurb: string;
};

export type TranscriptPack = {
  text: string;
  complete: boolean;
  chunks: string[];
};

function fmtTs(ms: number): string {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function transcriptLines(segments: TranscriptLine[]): string[] {
  return (Array.isArray(segments) ? segments : [])
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .map((s) => `[${fmtTs(s.start_ms)}] ${s.text.trim().replace(/\s+/g, " ")}`);
}

/** Découpe le Whisper en blocs **consécutifs** qui tiennent dans maxChars. Aucune phrase sautée. */
export function coverTranscriptChunks(
  segments: TranscriptLine[],
  maxChars = TRANSCRIPT_CONTEXT_CHARS
): string[] {
  const lines = transcriptLines(segments);
  if (!lines.length) return [];
  const chunks: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = (buf.length ? 1 : 0) + line.length;
    if (buf.length && len + add > maxChars) {
      chunks.push(buf.join("\n"));
      buf = [line];
      len = line.length;
    } else {
      buf.push(line);
      len += add;
    }
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks;
}

export function packTranscript(
  segments: TranscriptLine[],
  maxChars = TRANSCRIPT_CONTEXT_CHARS
): TranscriptPack {
  const chunks = coverTranscriptChunks(segments, maxChars);
  if (!chunks.length) return { text: "", complete: true, chunks: [] };
  if (chunks.length === 1) {
    return { text: chunks[0], complete: true, chunks };
  }
  return { text: chunks[0], complete: false, chunks };
}

/** Tout le texte horodaté, sans sauter de lignes. Si trop long : premier bloc consécutif. */
export function compactTranscriptLines(
  segments: TranscriptLine[],
  maxChars = TRANSCRIPT_CONTEXT_CHARS
): string {
  return packTranscript(segments, maxChars).text;
}

export async function paginateTranscriptPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = TRANSCRIPT_PAGE_SIZE
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const rows = await fetchPage(from, from + pageSize - 1);
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (out.length >= 50_000) break;
  }
  return out;
}

function overlapScore(text: string, tokens: string[]): number {
  const hay = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  let score = 0;
  for (const token of tokens) {
    if (token.length < 3) continue;
    const needle = token
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "");
    if (hay.includes(needle)) score += 1;
  }
  return score;
}

/**
 * Retrouve les passages du Whisper qui collent à la demande — dans tout le texte,
 * pas dans une grille de créneaux déjà choisie.
 */
export function retrieveTranscriptPassages(
  segments: TranscriptLine[],
  query: string,
  maxChars = TRANSCRIPT_RETRIEVE_CHARS,
  opts?: { maxHits?: number }
): string {
  const list = Array.isArray(segments) ? segments : [];
  const tokens = tokenizeQuery(query);
  if (!list.length || !tokens.length) return "";
  const maxHits = Math.max(1, Math.min(80, opts?.maxHits ?? 14));

  const scored = list
    .map((s, i) => ({
      i,
      score: overlapScore(s.text || "", tokens),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, maxHits);

  if (!scored.length) return "";

  const keep = new Set<number>();
  for (const hit of scored) {
    keep.add(hit.i);
    if (hit.i > 0) keep.add(hit.i - 1);
    if (hit.i + 1 < list.length) keep.add(hit.i + 1);
  }

  const ordered = [...keep].sort((a, b) => a - b);
  const lines: string[] = [];
  let len = 0;
  let last = -2;
  for (const i of ordered) {
    const line = transcriptLines([list[i]])[0];
    if (!line) continue;
    const gap = last >= 0 && i !== last + 1;
    const extra = (lines.length ? 1 : 0) + (gap ? 4 : 0) + line.length;
    if (len + extra > maxChars) break;
    if (gap) {
      lines.push("…");
      len += 2;
    }
    lines.push(line);
    len += extra;
    last = i;
  }
  return lines.join("\n");
}

export async function openaiJsonObject(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[library-agent] openai status", res.status);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
      }
    }
    return null;
  } catch (err) {
    console.error(
      "[library-agent] openai error",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseTopics(
  raw: Record<string, unknown> | null,
  max: number | ClipAgentQuantity = 8
): AgentTopic[] {
  if (!raw) return [];
  const cap = typeof max === "number" ? Math.max(1, Math.min(8, max)) : topicsCap(max);
  const list = Array.isArray(raw.topics) ? raw.topics : [];
  const out: AgentTopic[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 80) : "";
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const blurb =
      typeof rec.blurb === "string" ? rec.blurb.trim().slice(0, 160) : "";
    const idRaw = typeof rec.id === "string" ? rec.id.trim() : "";
    out.push({
      id: idRaw || `t${out.length + 1}`,
      title,
      blurb,
    });
    if (out.length >= cap) break;
  }
  return out;
}

export function parseAgentReply(
  raw: Record<string, unknown> | null,
  fallbackIntent: string
): { reply: string; intent: string } {
  const decision = {
    mode: "theme" as const,
    quantity: "all" as const,
    focus: fallbackIntent.slice(0, 200),
    reply:
      raw && typeof raw.reply === "string"
        ? raw.reply.trim().slice(0, 1200)
        : "",
  };
  return {
    reply:
      decision.reply ||
      "Je peux m’en occuper. Dis-moi le sujet, ou choisis une piste ci-dessus.",
    intent: serializeAgentIntent(decision) || fallbackIntent.slice(0, 400),
  };
}
