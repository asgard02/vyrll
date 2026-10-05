import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { parseLocale } from "@/lib/support-chat/guard";
import {
  AGENT_TOPICS_LIMIT,
  isUserRateLimited,
} from "@/lib/clip-agent/rate-limit";
import {
  TRANSCRIPT_PAGE_SIZE,
  coerceDecision,
  decisionMutatesTopics,
  openaiJsonObject,
  packTranscript,
  paginateTranscriptPages,
  parseTopics,
  retrieveTranscriptPassages,
  topicsCap,
  type AgentTopic,
  type ClipAgentDecision,
  type TranscriptLine,
  type TranscriptPack,
} from "@/lib/library-agent";
import {
  clipTopicsReducePrompt,
  clipTopicsSystemPrompt,
} from "@/lib/clip-agent/prompt";
import type { SupportLocale } from "@/lib/support-chat/prompt";
import { isClipAgentEnabled } from "@/lib/clip-agent/enabled";

async function loadJobSegments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  jobId: string
): Promise<TranscriptLine[]> {
  const { data: job } = await supabase
    .from("clip_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job?.id) return [];

  const fetchSegs = () =>
    paginateTranscriptPages(async (from, to) => {
      const { data, error } = await supabase
        .from("transcript_segments")
        .select("start_ms, end_ms, text, video_key")
        .eq("job_id", jobId)
        .order("start_ms", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as TranscriptLine[];
    }, TRANSCRIPT_PAGE_SIZE);

  let segs = await fetchSegs();
  if (!segs.length) {
    await new Promise((r) => setTimeout(r, 1500));
    segs = await fetchSegs();
  }
  if (!segs.length) {
    await new Promise((r) => setTimeout(r, 2000));
    segs = await fetchSegs();
  }
  return segs;
}

function whisperUserBlock(
  packed: TranscriptPack,
  focus: string,
  chunkIndex?: number,
  passages?: string
): string {
  const prefix = focus ? `Demande utilisateur : ${focus}\n\n` : "";
  if (passages) {
    return (
      prefix +
      "Passages Whisper qui collent au thème (ne pas recopier) :\n" +
      passages
    );
  }
  if (packed.complete || chunkIndex == null) {
    return (
      prefix +
      "Transcript Whisper intégral, dans l'ordre (ne pas recopier) :\n" +
      packed.text
    );
  }
  return (
    prefix +
    `Transcript Whisper, partie ${chunkIndex + 1}/${packed.chunks.length} (bloc consécutif, ne pas recopier) :\n` +
    packed.chunks[chunkIndex]
  );
}

function resolveTopicsDecision(rec: Record<string, unknown>): ClipAgentDecision {
  const fromBody = coerceDecision(rec.decision);
  if (fromBody) return fromBody;
  const intent =
    typeof rec.intent === "string" ? rec.intent.trim().slice(0, 400) : "";
  return {
    mode: intent ? "theme" : "best",
    quantity: "all",
    focus: intent,
    reply: "",
  };
}

async function topicsFromWhisper(
  packed: TranscriptPack,
  locale: SupportLocale,
  decision: ClipAgentDecision,
  passages = ""
): Promise<AgentTopic[]> {
  if (!packed.text && !packed.chunks.length && !passages) return [];
  const cap = topicsCap(decision.quantity);
  const opts = {
    focus: decision.focus,
    mode: decision.mode,
    quantity: decision.quantity,
  };

  if (passages || packed.complete) {
    const parsed = await openaiJsonObject({
      system: clipTopicsSystemPrompt(locale, opts),
      user: whisperUserBlock(packed, decision.focus, undefined, passages || undefined),
      temperature: decision.focus ? 0.35 : 0.45,
      maxTokens: 900,
    });
    return parseTopics(parsed, cap);
  }

  const parts: AgentTopic[][] = [];
  const n = Math.min(packed.chunks.length, 4);
  for (let i = 0; i < n; i++) {
    const parsed = await openaiJsonObject({
      system: clipTopicsSystemPrompt(locale, opts),
      user: whisperUserBlock(packed, decision.focus, i),
      temperature: decision.focus ? 0.35 : 0.45,
      maxTokens: 900,
    });
    parts.push(parseTopics(parsed, cap));
  }
  const flat = parts.flat();
  if (!flat.length) return [];
  const merged = await openaiJsonObject({
    system: clipTopicsReducePrompt(locale, opts),
    user: `Sujets extraits par morceau (à fusionner) :\n${JSON.stringify({ parts: flat })}`,
    temperature: 0.3,
    maxTokens: 900,
  });
  const reduced = parseTopics(merged, cap);
  return reduced.length ? reduced : flat.slice(0, cap);
}

export async function POST(request: NextRequest) {
  if (!isClipAgentEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const headerLocale = parseLocale(request.headers.get("x-upcut-locale"));
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Authentification non configurée." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }
    if (
      isUserRateLimited(
        user.id,
        "topics",
        AGENT_TOPICS_LIMIT.max,
        AGENT_TOPICS_LIMIT.windowMs
      )
    ) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
    }
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const jobId = typeof rec.jobId === "string" ? rec.jobId.trim() : "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId requis." }, { status: 400 });
    }
    const locale =
      typeof rec.locale === "string" ? parseLocale(rec.locale) : headerLocale;
    const decision = resolveTopicsDecision(rec);
    if (rec.decision && !decisionMutatesTopics(decision)) {
      return NextResponse.json({ topics: [] });
    }

    const segments = await loadJobSegments(supabase, user.id, jobId);
    if (!segments.length) {
      return NextResponse.json({ topics: [] });
    }

    const packed = packTranscript(segments);
    const usePassages =
      decision.mode === "theme" && Boolean(decision.focus.trim());
    const passages = usePassages
      ? retrieveTranscriptPassages(segments, decision.focus, undefined, {
          maxHits: decision.quantity === 1 ? 14 : 28,
        })
      : "";
    const topics = await topicsFromWhisper(packed, locale, decision, passages);
    return NextResponse.json({ topics });
  } catch (err) {
    console.error("library/topics error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
