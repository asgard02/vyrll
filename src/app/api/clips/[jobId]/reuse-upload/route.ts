import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchBackendWithRetry } from "@/lib/backend-fetch";

/**
 * Réutilise la source upload (R2) d’un projet pour « Refaire des clips »
 * sans re-déposer le fichier ni coller upload:// dans le champ URL.
 */
export async function POST(
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
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json({ error: "jobId manquant." }, { status: 400 });
    }

    const { data: job, error: jobErr } = await supabase
      .from("clip_jobs")
      .select("id, url, backend_job_id, source_duration_seconds")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
    }

    const displayUrl = String(job.url || "");
    if (!displayUrl.startsWith("upload://")) {
      return NextResponse.json(
        { error: "Ce projet n'est pas un upload." },
        { status: 400 }
      );
    }

    const filename =
      displayUrl.slice("upload://".length).trim() || "video.mp4";

    let uploadId: string | null = null;
    let durationSec =
      typeof job.source_duration_seconds === "number"
        ? Math.round(job.source_duration_seconds)
        : 0;

    if (job.backend_job_id) {
      const admin = createAdminClient();
      const { data: bj } = await admin
        .from("clip_backend_jobs")
        .select("payload")
        .eq("backend_job_id", job.backend_job_id)
        .maybeSingle();
      const payload = (bj?.payload ?? {}) as {
        upload_id?: string;
        upload_r2_key?: string;
        source_duration_seconds?: number;
      };
      if (typeof payload.upload_id === "string" && payload.upload_id.trim()) {
        uploadId = payload.upload_id.trim();
      } else if (
        typeof payload.upload_r2_key === "string" &&
        payload.upload_r2_key.startsWith("uploads/")
      ) {
        const m = payload.upload_r2_key.match(/^uploads\/([^/]+)\//);
        if (m?.[1]) uploadId = m[1];
      }
      if (
        !durationSec &&
        typeof payload.source_duration_seconds === "number"
      ) {
        durationSec = Math.round(payload.source_duration_seconds);
      }
    }

    if (!uploadId) {
      return NextResponse.json(
        {
          error:
            "Impossible de retrouver le fichier source. Re-dépose la vidéo.",
          code: "UPLOAD_SOURCE_MISSING",
        },
        { status: 404 }
      );
    }

    const backendUrl = process.env.BACKEND_URL?.trim();
    const backendSecret = process.env.BACKEND_SECRET?.trim();
    if (!backendUrl || !backendSecret) {
      return NextResponse.json(
        { error: "Service clips non configuré." },
        { status: 503 }
      );
    }

    try {
      const infoRes = await fetchBackendWithRetry(
        `${backendUrl.replace(/\/$/, "")}/upload-info/${uploadId}`,
        {
          method: "GET",
          headers: { "x-backend-secret": backendSecret },
        },
        10_000
      );
      const infoData = (await infoRes.json().catch(() => ({}))) as {
        duration_seconds?: number;
        error?: string;
      };
      if (!infoRes.ok) {
        return NextResponse.json(
          {
            error:
              infoData.error ??
              "Fichier source expiré. Re-dépose la vidéo.",
            code: "UPLOAD_EXPIRED",
          },
          { status: infoRes.status === 404 ? 404 : 400 }
        );
      }
      const d = Number(infoData.duration_seconds);
      if (Number.isFinite(d) && d > 0) durationSec = Math.round(d);
    } catch {
      return NextResponse.json(
        {
          error: "Impossible de vérifier le fichier source. Réessaie.",
          code: "BACKEND_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      upload_id: uploadId,
      duration_seconds: durationSec,
      filename,
    });
  } catch (err) {
    console.error("[clips/reuse-upload]", err);
    return NextResponse.json(
      { error: "Erreur lors de la réutilisation de l'upload." },
      { status: 500 }
    );
  }
}
