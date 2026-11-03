import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { extractVideoId } from "@/lib/youtube";
import {
  chaptersApiPayload,
  chaptersDurationEligible,
  chaptersEligibilityLine,
  chaptersSourceKind,
  loadOrCreateVideoChapters,
  pickChapterTranscript,
  sourceMetaFromTranscript,
  sourceMetaUseful,
  type ChapterEligibilityReason,
  type ChapterInsert,
  type ChapterTranscriptRow,
  type ChaptersApiPayload,
  type SourceMeta,
} from "@/lib/clips/chapters";

const TRANSCRIPT_COLUMNS =
  "transcript, word_count, lang, window_start_sec, window_end_sec, stt_version, groq_model";

const CHAPTER_COLUMNS = "video_id, chapters, summary, lang, model, created_at";
const REGEN_COOLDOWN_MS = 10 * 60 * 1000;
const NO_META_MESSAGE = "Pas de titre ni de description pour cette vidéo.";
const COOLDOWN_MESSAGE = "Ces chapitres ont été refaits il y a moins de 10 minutes.";

type JobRow = {
  id: string;
  url: string;
  status: string;
  source_duration_seconds?: number | null;
};

function empty(available: boolean): ChaptersApiPayload {
  return chaptersApiPayload(null, available);
}

function isChaptersAdmin(email: string | null | undefined): boolean {
  const expected = process.env.CHAPTERS_ADMIN_EMAIL?.trim().toLowerCase();
  const actual = email?.trim().toLowerCase();
  return Boolean(expected && actual && expected === actual);
}

function withAdmin(payload: ChaptersApiPayload, email: string | null | undefined) {
  return { ...payload, canRegenerate: isChaptersAdmin(email) };
}

function createdAtFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { created_at?: unknown }).created_at;
  return typeof value === "string" && value.trim() ? value : null;
}

function regeneratedTooRecently(createdAt: string | null): boolean {
  if (!createdAt) return false;
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return false;
  return Date.now() - time < REGEN_COOLDOWN_MS;
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

function logEligibility(
  job: JobRow,
  transcriptCachedFlag: boolean,
  eligible: boolean,
  reason: ChapterEligibilityReason
): void {
  console.log(
    chaptersEligibilityLine({
      job: job.id,
      source: chaptersSourceKind(job.url || ""),
      dur: sourceDuration(job.source_duration_seconds),
      transcriptCached: transcriptCachedFlag,
      eligible,
      reason,
    })
  );
}

async function openChapters(job: JobRow): Promise<
  | { response: NextResponse }
  | {
      admin: ReturnType<typeof createAdminClient>;
      videoId: string;
      durationSec: number;
      row: ChapterInsert | null;
      createdAt: string | null;
    }
> {
  const durationSec = sourceDuration(job.source_duration_seconds);
  const videoId = extractVideoId(job.url || "");
  const admin = videoId ? createAdminClient() : null;
  const found = admin && videoId ? await transcriptCached(admin, videoId) : false;
  const cached = found === true;
  const deny = (reason: ChapterEligibilityReason) => {
    logEligibility(job, cached, false, reason);
    return { response: NextResponse.json(empty(false)) };
  };
  if (job.status !== "done") return deny("not-done");
  if (!videoId || !admin) return deny("not-youtube");
  if (durationSec == null || !chaptersDurationEligible(durationSec)) return deny("duration");
  if (!cached) return deny("no-transcript");
  const stored = await readChapter(admin, videoId);
  if (stored.failed) return deny("chapters-read-failed");
  logEligibility(job, true, true, "ok");
  return { admin, videoId, durationSec, row: stored.row, createdAt: stored.createdAt };
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
): Promise<{ row: ChapterInsert | null; createdAt: string | null; failed: boolean }> {
  const { data, error } = await admin
    .from("video_chapters")
    .select(CHAPTER_COLUMNS)
    .eq("video_id", videoId)
    .maybeSingle();
  if (error) {
    console.warn("[chapters] read:", error.message);
    return { row: null, createdAt: null, failed: true };
  }
  return { row: asChapterRow(data), createdAt: createdAtFrom(data), failed: false };
}

async function fetchYoutubeChapterMeta(videoId: string): Promise<SourceMeta | null> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return null;
  try {
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}` +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: {
        snippet?: { title?: string; channelTitle?: string; description?: string; tags?: string[] };
      }[];
    };
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;
    const meta: SourceMeta = {};
    const title = snippet.title?.trim() ?? "";
    const channel = snippet.channelTitle?.trim() ?? "";
    const description = snippet.description?.trim() ?? "";
    if (title) meta.title = title;
    if (channel) meta.channel = channel;
    if (description) meta.description = description;
    if (Array.isArray(snippet.tags)) {
      const tags = snippet.tags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim());
      if (tags.length) meta.tags = tags;
    }
    if (!meta.title && !meta.channel && !meta.description && !meta.tags?.length) return null;
    return meta;
  } catch (err) {
    console.warn("[chapters] metadata:", err instanceof Error ? err.message : "error");
    return null;
  }
}

async function loadTranscript(admin: ReturnType<typeof createAdminClient>, videoId: string) {
  const { data, error } = await admin
    .from("video_transcripts")
    .select(TRANSCRIPT_COLUMNS)
    .eq("video_key", videoId);
  if (error) {
    console.warn("[chapters] transcript:", error.message);
    return { picked: null, failed: true };
  }
  return {
    picked: pickChapterTranscript(
      (Array.isArray(data) ? data : []) as ChapterTranscriptRow[]
    ),
    failed: false,
  };
}

async function createChapters(job: JobRow, email: string | null | undefined): Promise<NextResponse> {
  const opened = await openChapters(job);
  if ("response" in opened) return opened.response;
  const { admin, videoId, durationSec, row } = opened;
  if (row) return NextResponse.json(withAdmin(chaptersApiPayload(row, true), email));

  const loaded = await loadTranscript(admin, videoId);
  if (loaded.failed || !loaded.picked) return NextResponse.json(withAdmin(empty(false), email));
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[chapters] model not configured");
    return NextResponse.json(withAdmin(empty(true), email));
  }
  const created = await loadOrCreateVideoChapters({
    videoId,
    jobId: job.id,
    durationSec,
    lang: outputLang(loaded.picked.lang),
    transcript: loaded.picked.transcript,
    apiKey,
    readExisting: async () => (await readChapter(admin, videoId)).row,
    reread: async () => (await readChapter(admin, videoId)).row,
    insert: async (next) => {
      const { error } = await admin.from("video_chapters").insert(next);
      if (error?.code === "23505") return "conflict";
      if (error) throw new Error(error.message);
      return "inserted";
    },
  });
  if (!created) return NextResponse.json(withAdmin(empty(true), email));
  return NextResponse.json(withAdmin(chaptersApiPayload(created, true), email));
}

async function regenerateChapters(job: JobRow): Promise<NextResponse> {
  const opened = await openChapters(job);
  if ("response" in opened) return opened.response;
  const { admin, videoId, durationSec, row, createdAt } = opened;
  if (!row) {
    return NextResponse.json({ error: "Pas de chapitres à régénérer." }, { status: 404 });
  }
  if (regeneratedTooRecently(createdAt)) {
    return NextResponse.json({ error: COOLDOWN_MESSAGE }, { status: 429 });
  }
  const loaded = await loadTranscript(admin, videoId);
  if (loaded.failed || !loaded.picked) {
    return NextResponse.json({ error: "Transcription introuvable." }, { status: 404 });
  }
  const storedMeta = sourceMetaFromTranscript(loaded.picked.transcript);
  const meta = sourceMetaUseful(storedMeta) ? storedMeta : await fetchYoutubeChapterMeta(videoId);
  if (!sourceMetaUseful(meta)) {
    return NextResponse.json({ error: NO_META_MESSAGE }, { status: 422 });
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[chapters] model not configured");
    return NextResponse.json({ error: "Les chapitres n'ont pas pu être refaits." }, { status: 503 });
  }
  let created: ChapterInsert | null = null;
  try {
    created = await loadOrCreateVideoChapters({
      videoId,
      jobId: job.id,
      durationSec,
      lang: outputLang(loaded.picked.lang),
      transcript: loaded.picked.transcript,
      meta,
      replace: true,
      apiKey,
      readExisting: async () => (await readChapter(admin, videoId)).row,
      reread: async () => (await readChapter(admin, videoId)).row,
      update: async (next) => {
        const { error } = await admin
          .from("video_chapters")
          .update({
            chapters: next.chapters,
            summary: next.summary,
            lang: next.lang,
            model: next.model,
            created_at: new Date().toISOString(),
          })
          .eq("video_id", next.video_id);
        if (error) throw new Error(error.message);
      },
      insert: async () => "conflict",
    });
  } catch (err) {
    console.warn("[chapters] regenerate:", err instanceof Error ? err.message : "error");
    return NextResponse.json({ error: "Les chapitres n'ont pas pu être refaits." }, { status: 502 });
  }
  if (!created) {
    return NextResponse.json({ error: "Les chapitres n'ont pas pu être refaits." }, { status: 502 });
  }
  return NextResponse.json(chaptersApiPayload(created, true));
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
    const opened = await openChapters(owned.job);
    if ("response" in opened) return opened.response;
    if (opened.row) return NextResponse.json(withAdmin(chaptersApiPayload(opened.row, true), user.email));
    return NextResponse.json(withAdmin(empty(true), user.email));
  } catch (err) {
    console.error("[chapters] get:", err instanceof Error ? err.message : "error");
    return NextResponse.json(empty(false));
  }
}

export async function POST(
  request: NextRequest,
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
    const body = (await request.json().catch(() => null)) as { regenerate?: unknown } | null;
    if (body?.regenerate === true) {
      if (!isChaptersAdmin(user.email)) {
        return NextResponse.json({ error: "Réservé." }, { status: 403 });
      }
      return regenerateChapters(owned.job);
    }
    return createChapters(owned.job, user.email);
  } catch (err) {
    console.error("[chapters] post:", err instanceof Error ? err.message : "error");
    return NextResponse.json(empty(true));
  }
}
