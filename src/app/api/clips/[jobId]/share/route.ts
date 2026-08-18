import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { shareFolderPath } from "@/lib/clips/share";

function sharePayload(jobId: string) {
  return { token: jobId, path: shareFolderPath(jobId) };
}

async function requireOwnedJob(jobId: string, userId: string) {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("clip_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  return { job, error };
}

export async function GET(
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

    const { job, error } = await requireOwnedJob(jobId, user.id);
    if (error || !job) {
      return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    }

    return NextResponse.json(sharePayload(job.id));
  } catch (err) {
    console.error("Share GET error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

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

    const { job, error } = await requireOwnedJob(jobId, user.id);
    if (error || !job) {
      return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    }
    if (job.status !== "done") {
      return NextResponse.json(
        { error: "Le projet n’est pas encore prêt à être partagé." },
        { status: 409 }
      );
    }

    return NextResponse.json(sharePayload(job.id));
  } catch (err) {
    console.error("Share POST error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
