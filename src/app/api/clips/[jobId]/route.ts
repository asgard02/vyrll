import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isR2Configured, deleteR2Clips } from "@/lib/r2";
import { creditsForClipJob } from "@/lib/clip-credits";

const TERMINAL_STATUSES = ["done", "error"] as const;

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
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
      "id, user_id, url, duration, status, error, clips, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, split_confidence, start_time_sec";
    const selectMinimal = "id, user_id, url, duration, status, error, clips, backend_job_id, created_at";

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

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    const isTerminal = TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number]);
    let backendProgress: number | undefined;

    if (
      !isTerminal &&
      job.backend_job_id &&
      backendUrl &&
      backendSecret
    ) {
      const res = await fetch(
        `${backendUrl.replace(/\/$/, "")}/jobs/${job.backend_job_id}`,
        { headers: { "x-backend-secret": backendSecret } }
      );
      const backendData = await res.json().catch(() => ({}));

      // Backend 404 = job perdu (ex. node --watch a redémarré) → marquer en erreur pour stopper le polling
      const backendGone = res.status === 404;
      const backendStatus = backendGone
        ? "error"
        : backendData.status ?? (res.ok ? "processing" : "error");
      const backendError = backendGone
        ? "PROCESSING_FAILED"
        : backendData.error ?? (res.ok ? null : backendData.message ?? "PROCESSING_FAILED");
      const backendClips = Array.isArray(backendData.clips) ? backendData.clips : [];
      backendProgress = typeof backendData.progress === "number" ? backendData.progress : undefined;
      const backendSourceDuration = typeof backendData.source_duration_seconds === "number" ? backendData.source_duration_seconds : null;

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
          start_time_sec?: number | null;
        };
        const sourceDuration = Math.round(
          Number(backendSourceDuration ?? j.source_duration_seconds ?? 0)
        );
        const durationMaxClip = Math.max(
          1,
          Math.round(Number(j.duration_max ?? j.duration ?? 60))
        );
        const mode = j.render_mode === "manual" ? "manual" : "auto";
        const startSec =
          mode === "manual" && j.start_time_sec != null
            ? Math.max(0, Math.round(Number(j.start_time_sec)))
            : null;
        const credits = Math.max(
          1,
          creditsForClipJob({
            sourceDurationSec: sourceDuration,
            durationMaxSec: durationMaxClip,
            mode,
            startTimeSec: startSec,
          })
        );
        await supabase.rpc("increment_credits_used", { p_user_id: user.id, p_credits: credits });
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

    return NextResponse.json({
      id: job.id,
      url: job.url,
      duration: job.duration,
      created_at: job.created_at,
      status,
      progress,
      error: updatedJob?.error ?? job.error ?? undefined,
      clips,
      format: (job as { format?: string }).format ?? undefined,
      style: (job as { style?: string }).style ?? undefined,
      duration_min: (job as { duration_min?: number }).duration_min ?? undefined,
      duration_max: (job as { duration_max?: number }).duration_max ?? undefined,
      render_mode: derivedRenderMode ?? undefined,
      split_confidence: derivedSplitConf ?? undefined,
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
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
