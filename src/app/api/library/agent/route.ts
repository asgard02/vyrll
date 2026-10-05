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
  TRANSCRIPT_PAGE_SIZE,
  coerceDecision,
  classifyExplicitClipAsk,
  decisionMutatesTopics,
  isGlobalRankingDecision,
  openaiJsonObject,
  packTranscript,
  paginateTranscriptPages,
  parseAgentDecision,
  pendingListenReply,
  retrieveTranscriptPassages,
  serializeAgentIntent,
  transcriptMissingReply,
  type ClipAgentDecision,
  type TranscriptLine,
} from "@/lib/library-agent";
import { clipAgentChatSystemPrompt } from "@/lib/clip-agent/prompt";
import { isClipAgentEnabled } from "@/lib/clip-agent/enabled";
import type { SupportLocale } from "@/lib/support-chat/prompt";

async function loadJobSegments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
): Promise<TranscriptLine[]> {
  return paginateTranscriptPages(async (from, to) => {
    const { data, error } = await supabase
      .from("transcript_segments")
      .select("start_ms, end_ms, text, video_key")
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as TranscriptLine[];
  }, TRANSCRIPT_PAGE_SIZE);
}

function decisionPayload(decision: ClipAgentDecision) {
  return {
    reply: decision.reply,
    intent: serializeAgentIntent(decision),
    mode: decision.mode,
    quantity: decision.quantity,
    focus: decision.focus,
    decision,
  };
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
    const locale: SupportLocale =
      typeof rec.locale === "string" ? parseLocale(rec.locale) : headerLocale;
    const history = normalizeHistory(rec.history);
    const previous = coerceDecision(rec.decision);
    const explicit = classifyExplicitClipAsk(message, previous, locale);

    if (explicit?.mode === "off_topic" || explicit?.mode === "clarify") {
      return NextResponse.json(decisionPayload(explicit));
    }

    const { data: job } = await supabase
      .from("clip_jobs")
      .select("id, status")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!job?.id) {
      return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    }

    let segments = await loadJobSegments(supabase, jobId);
    let packed = packTranscript(segments);
    if (!packed.text) {
      await new Promise((r) => setTimeout(r, 1500));
      segments = await loadJobSegments(supabase, jobId);
      packed = packTranscript(segments);
    }
    const videoKey = segments[0]?.video_key || "";
    const transcriptReady = Boolean(packed.text);

    if (!transcriptReady) {
      const jobDone = job.status === "done" || job.status === "error";
      const pending: ClipAgentDecision = explicit
        ? {
            ...explicit,
            reply: jobDone
              ? transcriptMissingReply(locale)
              : pendingListenReply(locale),
          }
        : {
            mode: "clarify",
            quantity: null,
            focus: "",
            reply: jobDone
              ? transcriptMissingReply(locale)
              : pendingListenReply(locale),
          };
      return NextResponse.json(decisionPayload(pending));
    }

    const routing = explicit ?? previous;
    const overview = routing?.mode === "overview";
    const ranking =
      isGlobalRankingDecision(explicit) ||
      (routing?.mode === "best" && !routing.focus);
    const themeFocus =
      routing?.mode === "theme" ? routing.focus : explicit?.focus || "";
    const usePassages =
      Boolean(themeFocus) &&
      !ranking &&
      routing?.mode !== "overview";
    const passages = usePassages
      ? retrieveTranscriptPassages(segments, themeFocus || message, undefined, {
          maxHits: routing?.quantity === 1 ? 14 : 28,
        })
      : "";
    const whisperBlock = overview || ranking || !passages ? packed.text : passages;

    let momentsSummary = "";
    if (usePassages && themeFocus) {
      try {
        const { moments } = await searchLibraryMoments(supabase, {
          query: themeFocus,
          k: routing?.quantity === 1 ? 3 : 8,
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
    }

    const historyBlock = history
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");

    const topicCount =
      typeof rec.topicCount === "number" && Number.isFinite(rec.topicCount)
        ? Math.max(0, Math.min(8, Math.round(rec.topicCount)))
        : null;

    const locked = Boolean(
      (explicit && decisionMutatesTopics(explicit)) ||
        explicit?.mode === "overview"
    );
    const parsed = await openaiJsonObject({
      system: clipAgentChatSystemPrompt(locale, {
        transcriptReady: true,
        locked,
      }),
      user:
        `Message: ${message}\n` +
        (previous
          ? `\nDirective précédente: ${JSON.stringify({
              mode: previous.mode,
              quantity: previous.quantity,
              focus: previous.focus,
            })}\n`
          : "") +
        (explicit
          ? `\nDécision déjà tranchée (à respecter): ${JSON.stringify({
              mode: explicit.mode,
              quantity: explicit.quantity,
              focus: explicit.focus,
            })}\n`
          : "") +
        (historyBlock ? `\nHistorique:\n${historyBlock}\n` : "") +
        (routing?.mode === "overview"
          ? "\n(Analyse prête. Transcript Whisper intégral ci-dessous. Réponds à partir de ce texte.)\n"
          : usePassages && passages
            ? "\n(Analyse prête. Passages Whisper qui collent à la demande — ce sont les vrais endroits.)\n"
            : "\n(Analyse prête. Parle-lui, pas à un ticket. Si l'objectif est déjà dit, ne pas le faire répéter — raconte ce que tu as trouvé.)\n") +
        (topicCount === 0
          ? locale === "en"
            ? "\n(UI: 0 topic cards. Don’t loop “I can’t find it”. Point to Take the best moments.)\n"
            : "\n(UI : 0 carte proposition. Ne pas boucler « j'arrive pas à trouver ». Oriente vers Prendre les meilleurs moments.)\n"
          : topicCount != null
            ? `\n(UI : ${topicCount} proposition(s) affichées.)\n`
            : "") +
        (momentsSummary
          ? `\nPistes internes (ne pas lister les timestamps à l'utilisateur):\n${momentsSummary}\n`
          : "") +
        `\n${
          overview || ranking || !passages
            ? "Transcript Whisper intégral (ne pas recopier, ne pas citer les timestamps) :"
            : "Passages Whisper pertinents (ne pas recopier les timestamps) :"
        }\n${whisperBlock}`,
      temperature: 0.5,
      maxTokens: 700,
    });

    const decision = parseAgentDecision(parsed, {
      message,
      previous,
      locale,
    });
    return NextResponse.json(decisionPayload(decision));
  } catch (err) {
    console.error("library/agent error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
