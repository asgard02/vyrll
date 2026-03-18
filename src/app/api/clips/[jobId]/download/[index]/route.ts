import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

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
    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    // Redirection vers l'URL R2/Supabase directe (évite le proxy qui cause UND_ERR_SOCKET)
    if (clipUrl?.startsWith("http")) {
      return NextResponse.redirect(clipUrl, 302);
    }

    const backendJobId = job.backend_job_id ?? jobId;

    const range = request.headers.get("range");
    const fetchHeaders = new Headers({
      "x-backend-secret": backendSecret,
    });
    if (range) fetchHeaders.set("Range", range);

    const res = await fetch(
      `${backendUrl.replace(/\/$/, "")}/jobs/${backendJobId}/clips/${idx}`,
      { headers: fetchHeaders }
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
