import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isR2Configured, deleteR2Clips } from "@/lib/r2";
import { creditsForAutoMode, creditsForManualWindow } from "@/lib/clip-credits";
import { resolveVideoSourceMetadata } from "@/lib/video-source-metadata";

const TERMINAL_STATUSES = ["done", "error"] as const;
const BACKEND_POLL_TIMEOUT_MS = 20_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
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
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId manquant." },
        { status: 400 }
      );
    }

    // Sélection progressive : colonnes étendues puis minimales (compatibilité migrations partielles)
    const selectFull =
      "id, user_id, url, duration, status, error, clips, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, split_confidence, start_time_sec, search_window_start_sec, search_window_end_sec, video_title, channel_title, channel_thumbnail_url, credits_billed_at, credits_billed_amount";
    const selectMinimal = "id, user_id, url, duration, status, error, clips, backend_job_id, created_at";

    let supabaseSelectTier: "full" | "minimal" = "full";
    let { data: job, error: jobError } = await supabase
      .from("clip_jobs")
      .select(selectFull)
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError && !job) {
      const fallback = await supabase
        .from("clip_jobs")
        .select(selectMinimal)
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single();
      if (fallback.data) {
        supabaseSelectTier = "minimal";
        // selectMinimal : moins de colonnes — cast pour compat migrations
        job = fallback.data as unknown as typeof job;
        jobError = fallback.error;
      }
    }

    if (jobError || !job) {
      if (jobError) {
        console.warn("[clips] Job fetch failed:", jobId, jobError.code, jobError.message);
      }
      return NextResponse.json(
        { error: "Job introuvable." },
        { status: 404 }
      );
    }

    // Si les métadonnées source n’ont pas encore été persistées (course avec POST /start, ou migration),
    // les résoudre ici pour que le polling affiche le nom de chaîne / avatar sans attendre.
    {
      const j = job as {
        url?: string;
        status?: string;
        channel_title?: string | null;
        video_title?: string | null;
        channel_thumbnail_url?: string | null;
      };
      const sourceUrl = j.url ?? "";
      const st = String(j.status ?? "");
      const shouldHydrate =
        (st === "pending" || st === "processing") &&
        sourceUrl.length > 0 &&
        !sourceUrl.startsWith("upload://") &&
        !String(j.channel_title ?? "").trim();

      if (shouldHydrate) {
        try {
          const meta = await resolveVideoSourceMetadata(sourceUrl);
          const payload: Record<string, string> = {};
          if (meta.video_title) payload.video_title = meta.video_title;
          if (meta.channel_title) payload.channel_title = meta.channel_title;
          if (meta.channel_thumbnail_url) payload.channel_thumbnail_url = meta.channel_thumbnail_url;
          if (Object.keys(payload).length > 0) {
            const { error: upErr } = await supabase
              .from("clip_jobs")
              .update(payload)
              .eq("id", jobId)
              .eq("user_id", user.id);
            if (!upErr) {
              if (meta.video_title) j.video_title = meta.video_title;
              if (meta.channel_title) j.channel_title = meta.channel_title;
              if (meta.channel_thumbnail_url) j.channel_thumbnail_url = meta.channel_thumbnail_url;
            } else if (meta.video_title && (payload.channel_title || payload.channel_thumbnail_url)) {
              await supabase
                .from("clip_jobs")
                .update({ video_title: meta.video_title })
                .eq("id", jobId)
                .eq("user_id", user.id);
              if (meta.video_title) j.video_title = meta.video_title;
            }
          }
        } catch {
          /* best-effort */
        }
      }
    }

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    const isTerminal = TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number]);
    let backendProgress: number | undefined;

    let backendPollDebug: Record<string, unknown> = {
      skipped: true,
      reason: isTerminal
        ? "terminal_status"
        : !job.backend_job_id
          ? "no_backend_job_id"
          : !backendUrl || !backendSecret
            ? "backend_env_missing"
            : "unknown",
    };

    if (
      !isTerminal &&
      job.backend_job_id &&
      backendUrl &&
      backendSecret
    ) {
      const res = await fetch(
        `${backendUrl.replace(/\/$/, "")}/jobs/${job.backend_job_id}`,
        {
          headers: { "x-backend-secret": backendSecret },
          signal: AbortSignal.timeout(BACKEND_POLL_TIMEOUT_MS),
        }
      );
      const backendData = await res.json().catch(() => ({}));

      // Backend 404 = job absent en mémoire (redémarrage, autre réplica, etc.) → code dédié
      const backendGone = res.status === 404;
      const backendStatus = backendGone
        ? "error"
        : backendData.status ?? (res.ok ? "processing" : "error");
      const backendError = backendGone
        ? "BACKEND_JOB_LOST"
        : backendData.error ?? (res.ok ? null : backendData.message ?? "PROCESSING_FAILED");
      const backendClips = Array.isArray(backendData.clips) ? backendData.clips : [];
      backendProgress = typeof backendData.progress === "number" ? backendData.progress : undefined;
      const backendSourceDuration = typeof backendData.source_duration_seconds === "number" ? backendData.source_duration_seconds : null;

      backendPollDebug = {
        skipped: false,
        backend_job_id: job.backend_job_id,
        http_status: res.status,
        ok: res.ok,
        backend_job_lost: backendGone,
        ...(backendGone
          ? {
              hint:
                "GET /jobs/:id a renvoyé 404 — jobs en RAM uniquement : vérifier 1 réplica Railway, absence de redémarrage pendant le job, BACKEND_URL pointant vers le bon service.",
            }
          : {}),
        progress_raw: backendProgress,
        source_duration_seconds_raw: backendSourceDuration,
        status_raw:
          typeof backendData === "object" && backendData !== null && "status" in backendData
            ? (backendData as { status?: unknown }).status
            : undefined,
        error_raw:
          typeof backendData === "object" && backendData !== null && "error" in backendData
            ? (backendData as { error?: unknown }).error
            : undefined,
        clips_count: backendClips.length,
        response_keys:
          typeof backendData === "object" && backendData !== null && !Array.isArray(backendData)
            ? Object.keys(backendData as object)
            : [],
      };

      const newStatus =
        backendStatus === "done" || backendStatus === "completed"
          ? "done"
          : backendStatus === "error" || backendStatus === "failed"
            ? "error"
            : backendStatus === "pending" || backendStatus === "processing"
              ? "processing"
              : job.status;

      const updatePayload: {
        status: string;
        error?: string | null;
        clips?: unknown[];
        source_duration_seconds?: number | null;
        render_mode?: string | null;
        split_confidence?: number | null;
      } = {
        status: newStatus,
        error: backendError ?? null,
        clips: backendClips.length ? backendClips : job.clips ?? [],
      };
      if (backendSourceDuration != null) {
        updatePayload.source_duration_seconds = backendSourceDuration;
      }
      if (newStatus === "done" && backendClips.length > 0) {
        const anySplit = backendClips.some((c: { render_mode?: string }) => c?.render_mode === "split_vertical");
        if (anySplit) {
          updatePayload.render_mode = "split_vertical";
          const maxConf = Math.max(
            ...backendClips
              .filter((c: { render_mode?: string }) => c?.render_mode === "split_vertical")
              .map((c: { split_confidence?: number }) => c?.split_confidence ?? 0)
          );
          updatePayload.split_confidence = maxConf > 0 ? maxConf : null;
        } else {
          updatePayload.render_mode = "normal";
          updatePayload.split_confidence = null;
        }
      }

      const wasDone = job.status === "done";
      const { error: updateErr } = await supabase
        .from("clip_jobs")
        .update(updatePayload)
        .eq("id", jobId)
        .eq("user_id", user.id);
      if (updateErr && updatePayload.render_mode != null) {
        const fallback = { ...updatePayload };
        delete (fallback as Record<string, unknown>).render_mode;
        delete (fallback as Record<string, unknown>).split_confidence;
        await supabase
          .from("clip_jobs")
          .update(fallback)
          .eq("id", jobId)
          .eq("user_id", user.id);
      }

      if (newStatus === "done" && !wasDone) {
        const j = job as {
          source_duration_seconds?: number | null;
          duration?: number | null;
          duration_max?: number | null;
          render_mode?: string | null;
          search_window_start_sec?: number | null;
          search_window_end_sec?: number | null;
        };
        const sourceDuration = Math.round(
          Number(backendSourceDuration ?? j.source_duration_seconds ?? 0)
        );
        const isManual = j.render_mode === "manual";
        const ws = j.search_window_start_sec;
        const we = j.search_window_end_sec;
        const windowLen =
          isManual &&
          ws != null &&
          we != null &&
          Number.isFinite(ws) &&
          Number.isFinite(we) &&
          we > ws
            ? Math.round(we - ws)
            : 0;
        const credits =
          isManual && windowLen > 0
            ? creditsForManualWindow(windowLen)
            : creditsForAutoMode(sourceDuration);
        const finalCredits = Math.max(1, credits);
        const { error: billingErr } = await supabase.rpc("charge_clip_job_once", {
          p_job_id: jobId,
          p_user_id: user.id,
          p_credits: finalCredits,
        });
        if (billingErr) {
          const fnMissing = billingErr.code === "42883";
          if (fnMissing) {
            await supabase.rpc("increment_credits_used", {
              p_user_id: user.id,
              p_credits: finalCredits,
            });
          } else {
            console.error("[clips] charge_clip_job_once failed:", billingErr);
          }
        }
      }
    }

    const { data: updatedJob } = await supabase
      .from("clip_jobs")
      .select("status, error, clips, render_mode, split_confidence")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    const baseUrl = request.nextUrl.origin;
    const rawClips = (updatedJob?.clips ?? job.clips ?? []) as { url?: string; index?: number; render_mode?: string; split_confidence?: number; score_viral?: number }[];
    const clips = rawClips.map((c, i) => {
      const proxyUrl = `${baseUrl}/api/clips/${jobId}/download/${i}`;
      const directUrl = c?.url?.startsWith("http") ? c.url : null;
      return {
        downloadUrl: proxyUrl,
        directUrl: directUrl ?? undefined,
        renderMode: c?.render_mode ?? undefined,
        splitConfidence: c?.split_confidence ?? undefined,
        scoreViral: c?.score_viral != null ? Number(c.score_viral) : undefined,
      };
    });
    const status = updatedJob?.status ?? job.status;
    const progress =
      typeof backendProgress === "number"
        ? backendProgress
        : status === "done"
          ? 100
          : status === "error"
            ? 0
            : undefined;

    const jobData = updatedJob ?? job;
    const rawClipsForDerive = (jobData?.clips ?? job.clips ?? []) as { render_mode?: string; split_confidence?: number }[];
    const derivedRenderMode = jobData?.render_mode ?? (rawClipsForDerive.some((c) => c?.render_mode === "split_vertical") ? "split_vertical" : undefined);
    const splitClips = rawClipsForDerive.filter((c) => c?.render_mode === "split_vertical");
    const derivedSplitConf =
      jobData?.split_confidence ?? (splitClips.length > 0 ? Math.max(...splitClips.map((c) => c?.split_confidence ?? 0)) : undefined);

    const j = job as {
      format?: string;
      style?: string;
      duration_min?: number;
      duration_max?: number;
      video_title?: string | null;
      channel_title?: string | null;
      channel_thumbnail_url?: string | null;
    };

    const debugRequested = request.nextUrl.searchParams.get("debug") === "1";
    const jobRowMerged = {
      ...(job as Record<string, unknown>),
      status: updatedJob?.status ?? job.status,
      error: updatedJob?.error ?? job.error,
      clips: updatedJob?.clips ?? job.clips,
      render_mode: updatedJob?.render_mode ?? (job as { render_mode?: unknown }).render_mode,
      split_confidence: updatedJob?.split_confidence ?? (job as { split_confidence?: unknown }).split_confidence,
    };

    return NextResponse.json({
      id: job.id,
      url: job.url,
      duration: job.duration,
      created_at: job.created_at,
      status,
      progress,
      error: updatedJob?.error ?? job.error ?? undefined,
      clips,
      format: j.format ?? undefined,
      style: j.style ?? undefined,
      duration_min: j.duration_min ?? undefined,
      duration_max: j.duration_max ?? undefined,
      render_mode: derivedRenderMode ?? undefined,
      split_confidence: derivedSplitConf ?? undefined,
      video_title: j.video_title?.trim() ? j.video_title.trim() : undefined,
      channel_title: j.channel_title?.trim() ? j.channel_title.trim() : undefined,
      channel_thumbnail_url:
        j.channel_thumbnail_url?.trim().startsWith("http")
          ? j.channel_thumbnail_url.trim()
          : undefined,
      ...(debugRequested
        ? {
            debug: {
              fetched_at_iso: new Date().toISOString(),
              supabase_select: supabaseSelectTier,
              job_row: jobRowMerged,
              backend_poll: backendPollDebug,
              computed: {
                progress,
                derived_render_mode: derivedRenderMode ?? null,
                derived_split_confidence: derivedSplitConf ?? null,
              },
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("Clips status error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
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
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId manquant." },
        { status: 400 }
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("clip_jobs")
      .select("id, user_id, backend_job_id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: "Job introuvable." },
        { status: 404 }
      );
    }

    const storageFolder = job.backend_job_id ?? jobId;

    if (isR2Configured()) {
      try {
        await deleteR2Clips(storageFolder);
      } catch (r2Err) {
        console.error("R2 clips delete error:", r2Err);
      }
    }

    const admin = createAdminClient();
    try {
      const { data: files } = await admin.storage
        .from("clips")
        .list(storageFolder, { limit: 50 });
      const pathsToRemove =
        files?.map((f) => `${storageFolder}/${f.name}`) ?? [];
      if (pathsToRemove.length > 0) {
        await admin.storage.from("clips").remove(pathsToRemove);
      }
    } catch (storageErr) {
      console.error("Supabase clips delete error:", storageErr);
    }

    const { error: deleteError } = await admin
      .from("clip_jobs")
      .delete()
      .eq("id", jobId)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("Clip job delete error:", deleteError);
      return NextResponse.json(
        { error: "Erreur lors de la suppression." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Clips delete error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
