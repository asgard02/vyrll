const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.SUPPORT_CHAT_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_COMPACT_CHARS = 12_000;

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

function fmtTs(ms: number): string {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Compacte les segments pour le LLM — jamais renvoyé au client. */
export function compactTranscriptLines(
  segments: TranscriptLine[],
  maxChars = MAX_COMPACT_CHARS
): string {
  const lines = (Array.isArray(segments) ? segments : [])
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .map((s) => `[${fmtTs(s.start_ms)}] ${s.text.trim().replace(/\s+/g, " ")}`);
  if (!lines.length) return "";
  let joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  const target = Math.max(8, Math.floor(maxChars / 90));
  const step = Math.max(1, Math.ceil(lines.length / target));
  joined = lines.filter((_, i) => i % step === 0).join("\n");
  return joined.slice(0, maxChars);
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

export function parseTopics(raw: Record<string, unknown> | null): AgentTopic[] {
  if (!raw) return [];
  const list = Array.isArray(raw.topics) ? raw.topics : [];
  const out: AgentTopic[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 80) : "";
    if (!title) continue;
    const blurb =
      typeof rec.blurb === "string" ? rec.blurb.trim().slice(0, 160) : "";
    const idRaw = typeof rec.id === "string" ? rec.id.trim() : "";
    out.push({
      id: idRaw || `t${out.length + 1}`,
      title,
      blurb,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function parseAgentReply(
  raw: Record<string, unknown> | null,
  fallbackIntent: string
): { reply: string; intent: string } {
  const reply =
    raw && typeof raw.reply === "string" ? raw.reply.trim().slice(0, 1200) : "";
  const intent =
    raw && typeof raw.intent === "string"
      ? raw.intent.trim().slice(0, 400)
      : fallbackIntent.slice(0, 400);
  return {
    reply:
      reply ||
      "Je peux m’en occuper. Dis-moi le sujet, ou choisis une piste ci-dessus.",
    intent: intent || fallbackIntent.slice(0, 400),
  };
}
