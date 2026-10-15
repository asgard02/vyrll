import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { StoredClipRow } from "@/lib/clips/types";
import {
  buildVideoSummary,
  CLIP_COPY_PARALLEL,
  clipSourceRangeSec,
  copyForClip,
  dominantLang,
  generateMissingClipCopies,
  insertClipPublishCopy,
  logClipCopyTokens,
  pickTranscriptRow,
  prepareClipInputs,
  publishCopyApi,
  textFromCachedTranscript,
  textFromSegments,
  videoKeyFromUrl,
  type TranscriptCacheRow,
  type TranscriptSegmentRow,
} from "@/lib/clips/publish-copy";

const SEGMENT_COLUMNS = "start_ms, end_ms, text, lang, video_key";
const TRANSCRIPT_COLUMNS =
  "transcript, word_count, lang, window_start_sec, window_end_sec, stt_version, groq_model";

type JobRow = {
  id: string;
  url: string;
  status: string;
  video_title?: string | null;
  channel_title?: string | null;
  search_window_start_sec?: number | null;
  search_window_end_sec?: number | null;
  clips?: StoredClipRow[] | null;
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Authentification non configurée." }, { status: 503 });
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json({ error: "jobId manquant." }, { status: 400 });
    }

    const { data: job, error: jobError } = await supabase
      .from("clip_jobs")
      .select(
        "id, url, status, video_title, channel_title, search_window_start_sec, search_window_end_sec, clips"
      )
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (jobError || !job) {
      return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
    }

    const row = job as JobRow;
    if (row.status !== "done") {
      return NextResponse.json({ error: "Le projet n'est pas terminé." }, { status: 409 });
    }

    const clips = Array.isArray(row.clips) ? row.clips : [];
    if (!clips.length) {
      return NextResponse.json({ copies: [], failed: [] });
    }

    const admin = createAdminClient();
    const { data: segmentData, error: segmentError } = await admin
      .from("transcript_segments")
      .select(SEGMENT_COLUMNS)
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true });
    if (segmentError) {
      console.warn("[publish-copy] segments:", segmentError.message);
    }
    const segments = (Array.isArray(segmentData) ? segmentData : []) as TranscriptSegmentRow[];

    const needsCache = clips.some((clip) => {
      const range = clipSourceRangeSec(clip);
      if (!range || !segments.length) return true;
      return !textFromSegments(segments, range.startSec, range.endSec);
    });
    const videoKey =
      segments.find((segment) => segment.video_key)?.video_key || videoKeyFromUrl(row.url || "");
    let transcript: unknown | null = null;
    let transcriptLang: string | null = null;
    if (needsCache && videoKey) {
      const { data: transcriptData, error: transcriptError } = await admin
        .from("video_transcripts")
        .select(TRANSCRIPT_COLUMNS)
        .eq("video_key", videoKey);
      if (transcriptError) {
        console.warn("[publish-copy] video_transcripts:", transcriptError.message);
      } else {
        const picked = pickTranscriptRow((Array.isArray(transcriptData) ? transcriptData : []) as TranscriptCacheRow[], {
          start: row.search_window_start_sec ?? null,
          end: row.search_window_end_sec ?? null,
        });
        transcript = picked?.transcript ?? null;
        transcriptLang = picked?.lang ?? null;
      }
    }

    const lang = dominantLang([...segments.map((segment) => segment.lang), transcriptLang]);
    const summaryParts = segments.map((segment) => segment.text);
    if (!summaryParts.length && transcript) {
      summaryParts.push(textFromCachedTranscript(transcript, 0, 1e9));
    }
    const summary = buildVideoSummary({
      videoTitle: row.video_title,
      channelTitle: row.channel_title,
      parts: summaryParts,
    });

    const prepared = prepareClipInputs({
      jobId,
      clips,
      segments,
      transcript,
      summary,
      lang,
    });

    const { data: existing, error: existingError } = await admin
      .from("clip_publish_copy")
      .select("clip_index")
      .eq("job_id", jobId);
    if (existingError) {
      console.error("[publish-copy] existing:", existingError.message);
      return NextResponse.json({ error: "Lecture des textes impossible." }, { status: 500 });
    }
    const known = new Set(
      (Array.isArray(existing) ? existing : [])
        .map((item) => Number((item as { clip_index?: unknown }).clip_index))
        .filter((index) => Number.isInteger(index))
    );
    const pending = prepared.filter((clip) => !known.has(clip.index));
    if (!pending.length) {
      return NextResponse.json({ copies: [], failed: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Le modèle n'est pas configuré." }, { status: 503 });
    }

    const { inserted, failed } = await generateMissingClipCopies({
      clips: pending,
      parallel: CLIP_COPY_PARALLEL,
      hasCopy: async (index) => {
        const { data, error } = await admin
          .from("clip_publish_copy")
          .select("clip_index")
          .eq("job_id", jobId)
          .eq("clip_index", index)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return Boolean(data);
      },
      produce: (clip) =>
        copyForClip(clip, {
          apiKey,
          onUsage: (info) =>
            logClipCopyTokens({
              jobId,
              clipIndex: clip.index,
              model: info.model,
              promptTokens: info.promptTokens,
              completionTokens: info.completionTokens,
              attempt: info.attempt,
            }),
        }),
      insertCopy: (copyRow) => insertClipPublishCopy(admin, copyRow),
    });

    return NextResponse.json({
      copies: inserted.map(publishCopyApi),
      failed,
    });
  } catch (err) {
    console.error("[publish-copy]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
