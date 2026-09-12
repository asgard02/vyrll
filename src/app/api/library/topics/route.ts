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
  compactTranscriptLines,
  openaiJsonObject,
  parseTopics,
  type TranscriptLine,
} from "@/lib/library-agent";
import { clipTopicsSystemPrompt } from "@/lib/clip-agent/prompt";

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

  const fetchSegs = async () => {
    const { data, error } = await supabase
      .from("transcript_segments")
      .select("start_ms, end_ms, text, video_key")
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true })
      .limit(400);
    if (error) {
      throw new Error(error.message);
    }
    return (Array.isArray(data) ? data : []) as TranscriptLine[];
  };

  let segs = await fetchSegs();
  if (!segs.length) {
    await new Promise((r) => setTimeout(r, 1500));
    segs = await fetchSegs();
  }
  return segs;
}

export async function POST(request: NextRequest) {
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
    const focus =
      typeof rec.intent === "string" ? rec.intent.trim().slice(0, 400) : "";

    const segments = await loadJobSegments(supabase, user.id, jobId);
    if (!segments.length) {
      return NextResponse.json({ topics: [] });
    }

    const compact = compactTranscriptLines(segments);
    const parsed = await openaiJsonObject({
      system: clipTopicsSystemPrompt(locale, { focus }),
      user:
        (focus ? `Demande utilisateur : ${focus}\n\n` : "") +
        `Voici un résumé horodaté interne (ne pas le recopier) :\n${compact}`,
      temperature: focus ? 0.35 : 0.45,
      maxTokens: 900,
    });

    const topics = parseTopics(parsed);
    return NextResponse.json({ topics });
  } catch (err) {
    console.error("library/topics error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
