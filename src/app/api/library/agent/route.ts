import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  normalizeHistory,
  normalizeMessage,
  parseLocale,
} from "@/lib/support-chat/guard";
import {
  AGENT_CHAT_LIMIT,
  isUserRateLimited,
} from "@/lib/clip-agent/rate-limit";
import { searchLibraryMoments } from "@/lib/library-search";
import {
  compactTranscriptLines,
  openaiJsonObject,
  parseAgentReply,
  type TranscriptLine,
} from "@/lib/library-agent";
import { clipAgentChatSystemPrompt } from "@/lib/clip-agent/prompt";

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
        "agent",
        AGENT_CHAT_LIMIT.max,
        AGENT_CHAT_LIMIT.windowMs
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
    const message = normalizeMessage(rec.message);
    if (!jobId || !message) {
      return NextResponse.json({ error: "jobId et message requis." }, { status: 400 });
    }
    const locale =
      typeof rec.locale === "string" ? parseLocale(rec.locale) : headerLocale;
    const history = normalizeHistory(rec.history);

    const { data: job } = await supabase
      .from("clip_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!job?.id) {
      return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    }

    const { data: segRows } = await supabase
      .from("transcript_segments")
      .select("start_ms, end_ms, text, video_key")
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true })
      .limit(400);
    const segments = (Array.isArray(segRows) ? segRows : []) as TranscriptLine[];
    const videoKey = segments[0]?.video_key || "";
    const compact = compactTranscriptLines(segments);

    let momentsSummary = "";
    try {
      const { moments } = await searchLibraryMoments(supabase, {
        query: message,
        k: 5,
        videoKey: videoKey || undefined,
      });
      if (moments.length) {
        momentsSummary = moments
          .map((m) => {
            const start = Math.floor(m.start_ms / 1000);
            const end = Math.floor(m.end_ms / 1000);
            const snippet = m.text.replace(/\s+/g, " ").trim().slice(0, 220);
            return `- ${start}s–${end}s${snippet ? `: ${snippet}` : ""}`;
          })
          .join("\n");
      }
    } catch (err) {
      console.warn(
        "[library/agent] FTS skipped:",
        err instanceof Error ? err.message : err
      );
    }

    const historyBlock = history
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");

    const transcriptReady = Boolean(compact);
    const parsed = await openaiJsonObject({
      system: clipAgentChatSystemPrompt(locale, { transcriptReady }),
      user:
        `Message: ${message}\n` +
        (historyBlock ? `\nHistorique:\n${historyBlock}\n` : "") +
        (transcriptReady
          ? "\n(Analyse prête. Parle-lui, pas à un ticket. Si l'objectif est déjà dit, ne pas le faire répéter — raconte ce que tu as trouvé, avec plusieurs angles s'il y en a.)\n"
          : "") +
        (momentsSummary ? `\nPistes internes (ne pas lister les timestamps à l'utilisateur):\n${momentsSummary}\n` : "") +
        (transcriptReady
          ? `\nContexte interne compact (ne pas recopier):\n${compact}`
          : "\n(Analyse pas encore disponible — ne rien inventer sur le contenu.)"),
      temperature: transcriptReady ? 0.5 : 0.45,
      maxTokens: transcriptReady ? 700 : 500,
    });

    const { reply, intent } = parseAgentReply(parsed, message);
    return NextResponse.json({ reply, intent });
  } catch (err) {
    console.error("library/agent error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
