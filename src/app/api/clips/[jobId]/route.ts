import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (!profile || profile.plan === "free") {
      return NextResponse.json(
        { error: "Accès refusé." },
        { status: 403 }
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
      .select("id, user_id, url, duration, status, error, clips, backend_job_id, created_at")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
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

      const backendStatus = backendData.status ?? (res.ok ? "processing" : "error");
      const backendError =
        backendData.error ?? (res.ok ? null : backendData.message ?? "PROCESSING_FAILED");
      const backendClips = Array.isArray(backendData.clips) ? backendData.clips : [];
      backendProgress = typeof backendData.progress === "number" ? backendData.progress : undefined;

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
      } = {
        status: newStatus,
        error: backendError ?? null,
        clips: backendClips.length ? backendClips : job.clips ?? [],
      };

      const wasDone = job.status === "done";
      await supabase
        .from("clip_jobs")
        .update(updatePayload)
        .eq("id", jobId)
        .eq("user_id", user.id);

      if (newStatus === "done" && !wasDone) {
        await supabase.rpc("increment_clips_used", { p_user_id: user.id });
      }
    }

    const { data: updatedJob } = await supabase
      .from("clip_jobs")
      .select("status, error, clips")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    const baseUrl = request.nextUrl.origin;
    const clips = (updatedJob?.clips ?? job.clips ?? []).map((_: unknown, i: number) => ({
      downloadUrl: `${baseUrl}/api/clips/${jobId}/download/${i}`,
    }));
    const status = updatedJob?.status ?? job.status;
    const progress =
      typeof backendProgress === "number"
        ? backendProgress
        : status === "done"
          ? 100
          : status === "error"
            ? 0
            : undefined;

    return NextResponse.json({
      id: job.id,
      url: job.url,
      duration: job.duration,
      created_at: job.created_at,
      status,
      progress,
      error: updatedJob?.error ?? job.error ?? undefined,
      clips,
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (!profile || profile.plan === "free") {
      return NextResponse.json(
        { error: "Accès refusé." },
        { status: 403 }
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

    const admin = createAdminClient();
    const storageFolder = job.backend_job_id ?? jobId;
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
      console.error("Clips storage delete error:", storageErr);
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
