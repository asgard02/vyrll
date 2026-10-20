import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { extractVideoId } from "@/lib/youtube";
import {
  chaptersApiPayload,
  chaptersDurationEligible,
  loadOrCreateVideoChapters,
  pickChapterTranscript,
  type ChapterInsert,
  type ChapterTranscriptRow,
  type ChaptersApiPayload,
} from "@/lib/clips/chapters";

const TRANSCRIPT_COLUMNS =
  "transcript, word_count, lang, window_start_sec, window_end_sec, stt_version, groq_model";

const CHAPTER_COLUMNS = "video_id, chapters, summary, lang, model";

type JobRow = {
  id: string;
  url: string;
  status: string;
  source_duration_seconds?: number | null;
};

function empty(available: boolean): ChaptersApiPayload {
  return chaptersApiPayload(null, available);
}

function sourceDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asChapterRow(data: unknown): ChapterInsert | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as {
    video_id?: unknown;
    chapters?: unknown;
    summary?: unknown;
    lang?: unknown;
    model?: unknown;
  };
  if (typeof rec.video_id !== "string" || typeof rec.summary !== "string" || typeof rec.model !== "string") {
    return null;
  }
  if (!Array.isArray(rec.chapters)) return null;
  const chapters: ChapterInsert["chapters"] = [];
  for (const item of rec.chapters) {
    if (!item || typeof item !== "object") return null;
    const chapter = item as { start_sec?: unknown; title?: unknown };
    const startSec = Number(chapter.start_sec);
    const title = typeof chapter.title === "string" ? chapter.title : "";
    if (!Number.isFinite(startSec) || !title) return null;
    chapters.push({ start_sec: startSec, title });
  }
  const lang = typeof rec.lang === "string" && rec.lang.trim() ? rec.lang : null;
  return {
    video_id: rec.video_id,
    chapters,
    summary: rec.summary,
    lang,
    model: rec.model,
  };
}

function outputLang(lang: string | null | undefined): string | null {
  const value = lang?.trim().toLowerCase() ?? "";
  if (!value || value === "auto") return null;
  return value;
}

async function ownedJob(
  jobId: string,
  userId: string
): Promise<{ job: JobRow } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clip_jobs")
    .select("id, url, status, source_duration_seconds")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    return { response: NextResponse.json({ error: "Projet introuvable." }, { status: 404 }) };
  }
  return { job: data as JobRow };
}

async function transcriptCached(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("video_transcripts")
    .select("video_key")
    .eq("video_key", videoId)
    .limit(1);
  if (error) {
    console.warn("[chapters] cache:", error.message);
    return null;
  }
  return Array.isArray(data) && data.length > 0;
}

async function readChapter(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string
): Promise<{ row: ChapterInsert | null; failed: boolean }> {
  const { data, error } = await admin
    .from("video_chapters")
    .select(CHAPTER_COLUMNS)
    .eq("video_id", videoId)
    .maybeSingle();
  if (error) {
    console.warn("[chapters] read:", error.message);
    return { row: null, failed: true };
  }
  return { row: asChapterRow(data), failed: false };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(empty(false));
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
    const owned = await ownedJob(jobId, user.id);
    if ("response" in owned) return owned.response;
    const { job } = owned;
    if (job.status !== "done") return NextResponse.json(empty(false));

    const videoId = extractVideoId(job.url || "");
    const durationSec = sourceDuration(job.source_duration_seconds);
    if (!videoId || !chaptersDurationEligible(durationSec)) {
      return NextResponse.json(empty(false));
    }

    const admin = createAdminClient();
    const cached = await transcriptCached(admin, videoId);
    if (cached !== true) return NextResponse.json(empty(false));

    const stored = await readChapter(admin, videoId);
    if (stored.failed) return NextResponse.json(empty(false));
    if (stored.row) return NextResponse.json(chaptersApiPayload(stored.row, true));
    return NextResponse.json(empty(true));
  } catch (err) {
    console.error("[chapters] get:", err instanceof Error ? err.message : "error");
    return NextResponse.json(empty(false));
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(empty(false));
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
    const owned = await ownedJob(jobId, user.id);
    if ("response" in owned) return owned.response;
    const { job } = owned;
    if (job.status !== "done") return NextResponse.json(empty(false));

    const videoId = extractVideoId(job.url || "");
    const durationSec = sourceDuration(job.source_duration_seconds);
    if (!videoId || durationSec == null || !chaptersDurationEligible(durationSec)) {
      return NextResponse.json(empty(false));
    }

    const admin = createAdminClient();
    const cached = await transcriptCached(admin, videoId);
    if (cached !== true) return NextResponse.json(empty(false));

    const stored = await readChapter(admin, videoId);
    if (stored.failed) return NextResponse.json(empty(false));
    if (stored.row) return NextResponse.json(chaptersApiPayload(stored.row, true));

    const { data: transcriptData, error: transcriptError } = await admin
      .from("video_transcripts")
      .select(TRANSCRIPT_COLUMNS)
      .eq("video_key", videoId);
    if (transcriptError) {
      console.warn("[chapters] transcript:", transcriptError.message);
      return NextResponse.json(empty(false));
    }
    const picked = pickChapterTranscript(
      (Array.isArray(transcriptData) ? transcriptData : []) as ChapterTranscriptRow[]
    );
    if (!picked) return NextResponse.json(empty(false));

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      console.warn("[chapters] model not configured");
      return NextResponse.json(empty(true));
    }

    const created = await loadOrCreateVideoChapters({
      videoId,
      durationSec,
      lang: outputLang(picked.lang),
      transcript: picked.transcript,
      apiKey,
      readExisting: async () => (await readChapter(admin, videoId)).row,
      reread: async () => (await readChapter(admin, videoId)).row,
      insert: async (row) => {
        const { error } = await admin.from("video_chapters").insert(row);
        if (error?.code === "23505") return "conflict";
        if (error) throw new Error(error.message);
        return "inserted";
      },
    });
    if (!created) return NextResponse.json(empty(true));
    return NextResponse.json(chaptersApiPayload(created, true));
  } catch (err) {
    console.error("[chapters] post:", err instanceof Error ? err.message : "error");
    return NextResponse.json(empty(true));
  }
}
