import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Évite la coupure ~30s en prod (Vercel) quand le navigateur streame un long MP4 via ce proxy. */
export const maxDuration = 300;
const DOWNLOAD_PROXY_TIMEOUT_MS = 45_000;
const CLIP_PROXY_ALLOWED_HOSTS = (process.env.CLIP_PROXY_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isAllowedClipUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (CLIP_PROXY_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return true;
    }
    return (
      host.includes("supabase") ||
      host.endsWith(".r2.dev") ||
      host.endsWith(".cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

function clipAttachmentName(index: number) {
  return `clip-${index + 1}.mp4`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; index: string }> }
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

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;

    if (!backendUrl || !backendSecret) {
      return NextResponse.json(
        { error: "Service clips non configuré." },
        { status: 503 }
      );
    }

    const { jobId, index } = await params;
    if (!jobId || index === undefined) {
      return NextResponse.json(
        { error: "Paramètres manquants." },
        { status: 400 }
      );
    }

    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) {
      return NextResponse.json(
        { error: "Index invalide." },
        { status: 400 }
      );
    }

    const { data: job } = await supabase
      .from("clip_jobs")
      .select("backend_job_id, clips")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    }

    const clips = (job.clips ?? []) as { url?: string; index?: number }[];
    const clipUrl = clips[idx]?.url;

    // Stream depuis R2/Supabase avec Content-Disposition — une 302 casserait l’attribut
    // HTML `download` (cross-origin) et ouvrirait la vidéo dans l’onglet.
    if (clipUrl?.startsWith("http")) {
      if (!isAllowedClipUrl(clipUrl)) {
        return NextResponse.json(
          { error: "Hôte clip non autorisé." },
          { status: 400 }
        );
      }
      const range = request.headers.get("range");
      const upstreamHeaders = new Headers();
      if (range) upstreamHeaders.set("Range", range);

      const res = await fetch(clipUrl, {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(DOWNLOAD_PROXY_TIMEOUT_MS),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: "Fichier clip introuvable." },
          { status: res.status === 404 ? 404 : 502 }
        );
      }

      const filename = clipAttachmentName(idx);
      const headers = new Headers();
      headers.set("Content-Type", res.headers.get("content-type") || "video/mp4");
      const contentLength = res.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      const contentRange = res.headers.get("content-range");
      if (contentRange) headers.set("Content-Range", contentRange);
      headers.set("Accept-Ranges", "bytes");
      headers.set(
        "Content-Disposition",
        `inline; filename="${filename}"`
      );
      headers.set("Cache-Control", "private, max-age=3600");

      return new Response(res.body, {
        status: res.status,
        headers,
      });
    }

    const backendJobId = job.backend_job_id ?? jobId;

    const range = request.headers.get("range");
    const fetchHeaders = new Headers({
      "x-backend-secret": backendSecret,
    });
    if (range) fetchHeaders.set("Range", range);

    const res = await fetch(
      `${backendUrl.replace(/\/$/, "")}/jobs/${backendJobId}/clips/${idx}`,
      {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(DOWNLOAD_PROXY_TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: error.error || "Erreur backend." },
        { status: res.status >= 500 ? 503 : res.status }
      );
    }

    const contentType = res.headers.get("content-type") || "video/mp4";
    const contentLength = res.headers.get("content-length");
    const contentRange = res.headers.get("content-range");

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);
    headers.set("Accept-Ranges", "bytes");
    headers.set(
      "Content-Disposition",
      `inline; filename="${clipAttachmentName(idx)}"`
    );
    headers.set("Cache-Control", "private, max-age=3600");

    return new Response(res.body, {
      status: res.status,
      headers,
    });
  } catch (err) {
    console.error("Clips download error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
