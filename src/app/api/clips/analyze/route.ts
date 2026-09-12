import { NextRequest, NextResponse } from "next/server";
import { canonicalizeVideoUrlForClips, isValidVideoUrl } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
  isTransientBackendFetchError,
} from "@/lib/backend-fetch";
import { resolveVideoSourceMetadata } from "@/lib/video-source-metadata";
import { videoKeyFromClipSource } from "@/lib/clip-agent/video-key";
import {
  AGENT_ANALYZE_LIMIT,
  isUserRateLimited,
} from "@/lib/clip-agent/rate-limit";

const BACKEND_JOBS_TIMEOUT_MS = 30_000;
const MIN_CACHED_SEGMENTS = 5;

async function findCachedTranscriptJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  videoKey: string
): Promise<string | null> {
  const { count, error: countErr } = await supabase
    .from("transcript_segments")
    .select("job_id", { count: "exact", head: true })
    .eq("video_key", videoKey);
  if (countErr || (count ?? 0) < MIN_CACHED_SEGMENTS) return null;

  const { data, error } = await supabase
    .from("transcript_segments")
    .select("job_id")
    .eq("video_key", videoKey)
    .limit(80);
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const jobIds = [
    ...new Set(
      data
        .map((row) => (typeof row?.job_id === "string" ? row.job_id : ""))
        .filter(Boolean)
    ),
  ];
  if (jobIds.length === 0) return null;

  const { data: job } = await supabase
    .from("clip_jobs")
    .select("id")
    .eq("user_id", userId)
    .in("id", jobIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return job?.id ?? null;
}

async function findReusableAnalyzeJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  url: string
): Promise<string | null> {
  const analyzeOnly = await supabase
    .from("clip_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("url", url)
    .eq("analyze_only", true)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!analyzeOnly.error && typeof analyzeOnly.data?.id === "string") {
    return analyzeOnly.data.id;
  }

  const quoted = await supabase
    .from("clip_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("url", url)
    .eq("credits_quoted", 0)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quoted.error && typeof quoted.data?.id === "string") {
    return quoted.data.id;
  }
  return null;
}

/**
 * Whisper + index FTS, sans rendu ni facturation.
 * Poll via GET /api/clips/[jobId].
 */
export async function POST(request: NextRequest) {
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
        "analyze",
        AGENT_ANALYZE_LIMIT.max,
        AGENT_ANALYZE_LIMIT.windowMs
      )
    ) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();
    if (!profile) {
      return NextResponse.json({ error: "Profil non trouvé." }, { status: 403 });
    }

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    if (!backendUrl || !backendSecret) {
      return NextResponse.json(
        { error: "Service clips non configuré." },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const urlRaw = typeof body?.url === "string" ? body.url.trim() : "";
    const uploadId: string | null =
      typeof body?.upload_id === "string" && body.upload_id.trim()
        ? body.upload_id.trim()
        : null;
    const uploadFilename: string =
      typeof body?.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : "upload.mp4";
    const isUpload = !!uploadId;

    if (!isUpload) {
      if (!urlRaw) {
        return NextResponse.json({ error: "URL vidéo requise." }, { status: 400 });
      }
      if (!isValidVideoUrl(urlRaw)) {
        return NextResponse.json(
          { error: "URL YouTube ou Twitch invalide." },
          { status: 400 }
        );
      }
    }

    const url = isUpload
      ? `upload://${uploadFilename}`
      : (canonicalizeVideoUrlForClips(urlRaw) ?? urlRaw);

    const videoKey = videoKeyFromClipSource({
      url: isUpload ? undefined : url,
      uploadId,
    });
    if (videoKey) {
      const cachedJobId = await findCachedTranscriptJob(supabase, user.id, videoKey);
      if (cachedJobId) {
        console.log(
          `[clips/analyze] transcript cache HIT video_key=${videoKey} job=${cachedJobId}`
        );
        return NextResponse.json({ jobId: cachedJobId, cached: true });
      }
    }

    const reusableJobId = await findReusableAnalyzeJob(supabase, user.id, url);
    if (reusableJobId) {
      return NextResponse.json({ jobId: reusableJobId });
    }

    const billedAt = new Date().toISOString();
    const basePayload: Record<string, unknown> = {
      user_id: user.id,
      url,
      duration: 60,
      status: "processing",
      format: "9:16",
      clip_mode: "auto",
      analyze_only: true,
      credits_quoted: 0,
      credits_billed_at: billedAt,
      credits_billed_amount: 0,
    };

    let job: { id: string } | null = null;
    let insertError: unknown = null;

    const { data: d1, error: e1 } = await supabase
      .from("clip_jobs")
      .insert(basePayload)
      .select("id")
      .single();

    if (!e1 && d1) {
      job = d1;
    } else if (e1?.code === "PGRST204") {
      const fallbackPayload: Record<string, unknown> = {
        user_id: user.id,
        url,
        duration: 60,
        status: "processing",
        format: "9:16",
        analyze_only: true,
        credits_quoted: 0,
      };
      const { data: d2, error: e2 } = await supabase
        .from("clip_jobs")
        .insert(fallbackPayload)
        .select("id")
        .single();
      if (!e2 && d2) {
        job = d2;
      } else if (e2?.code === "PGRST204") {
        const { data: d3, error: e3 } = await supabase
          .from("clip_jobs")
          .insert({
            user_id: user.id,
            url,
            duration: 60,
            status: "processing",
          })
          .select("id")
          .single();
        job = d3;
        insertError = e3;
      } else {
        job = d2;
        insertError = e2;
      }
    } else {
      insertError = e1;
    }

    if (insertError || !job) {
      console.error("Clip analyze insert error:", insertError);
      return NextResponse.json(
        { error: "Erreur lors de la création du job." },
        { status: 500 }
      );
    }

    {
      const admin = createAdminClient();
      void admin
        .from("clip_jobs")
        .update({
          clip_mode: "auto",
          analyze_only: true,
          credits_quoted: 0,
          credits_billed_at: billedAt,
          credits_billed_amount: 0,
        })
        .eq("id", job.id)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[clips/analyze] billed_at/credits_quoted update skipped:",
              error.message
            );
          }
        });
    }

    if (!isUpload) {
      void resolveVideoSourceMetadata(url)
        .then(async (meta) => {
          const payload: Record<string, string> = {};
          if (meta.video_title) payload.video_title = meta.video_title;
          if (meta.channel_title) payload.channel_title = meta.channel_title;
          if (meta.channel_thumbnail_url) {
            payload.channel_thumbnail_url = meta.channel_thumbnail_url;
          }
          if (Object.keys(payload).length === 0) return;
          const admin = createAdminClient();
          const { error } = await admin
            .from("clip_jobs")
            .update(payload)
            .eq("id", job.id)
            .eq("user_id", user.id);
          if (
            error &&
            meta.video_title &&
            (payload.channel_title || payload.channel_thumbnail_url)
          ) {
            await admin
              .from("clip_jobs")
              .update({ video_title: meta.video_title })
              .eq("id", job.id)
              .eq("user_id", user.id);
          }
        })
        .catch(() => {});
    }

    let res: Response;
    try {
      res = await fetchBackendWithRetry(
        `${backendUrl.replace(/\/$/, "")}/jobs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-backend-secret": backendSecret,
          },
          body: JSON.stringify({
            ...(isUpload ? { upload_id: uploadId } : { url }),
            duration_min: 30,
            duration_max: 60,
            format: "9:16",
            style: "impact",
            mode: "auto",
            analyze_only: true,
          }),
        },
        BACKEND_JOBS_TIMEOUT_MS
      );
    } catch (err: unknown) {
      const admin = createAdminClient();
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name?: string }).name)
          : "";
      if (name === "AbortError" || name === "TimeoutError") {
        await admin
          .from("clip_jobs")
          .update({ status: "error", error: "BACKEND_TIMEOUT" })
          .eq("id", job.id)
          .eq("user_id", user.id);
        return NextResponse.json(
          { error: "Le serveur clips ne répond pas à temps. Réessaie." },
          { status: 504 }
        );
      }
      if (isTransientBackendFetchError(err)) {
        await admin
          .from("clip_jobs")
          .update({ status: "error", error: "BACKEND_SOCKET" })
          .eq("id", job.id)
          .eq("user_id", user.id);
        return NextResponse.json(
          {
            error:
              "Connexion au serveur clips interrompue. Réessaie (le backend a peut‑être redémarré).",
          },
          { status: 503 }
        );
      }
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const admin = createAdminClient();
      await admin
        .from("clip_jobs")
        .update({ status: "error", error: data.error ?? "BACKEND_ERROR" })
        .eq("id", job.id)
        .eq("user_id", user.id);
      return NextResponse.json(
        { error: data.error || "Erreur backend." },
        { status: res.status >= 500 ? 503 : res.status }
      );
    }

    const backendJobId = data.jobId ?? data.job_id ?? null;
    if (backendJobId) {
      const admin = createAdminClient();
      await admin
        .from("clip_jobs")
        .update({ backend_job_id: backendJobId })
        .eq("id", job.id)
        .eq("user_id", user.id);
    }

    console.log(
      `[clips/analyze] POST /jobs OK supabase_job=${job.id} backend_job=${backendJobId ?? "none"}`
    );

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error("Clips analyze error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
