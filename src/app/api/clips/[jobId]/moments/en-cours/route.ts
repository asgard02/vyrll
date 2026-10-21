import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { etapeFromPipeline } from "@/lib/clips/job-etape";
import { pipelineChoosingAt, pipelineObject } from "@/lib/clips/moments-choice";

type OwnedJob = {
  id: string;
  pipeline: unknown;
};

async function loadOwnedJob(
  jobId: string
): Promise<{ userId: string; job: OwnedJob } | { response: NextResponse }> {
  if (!isSupabaseConfigured()) {
    return {
      response: NextResponse.json({ error: "Authentification non configurée." }, { status: 503 }),
    };
  }
  const supabase = await createClient();
  const { user } = await getServerUser(supabase);
  if (!user) {
    return { response: NextResponse.json({ error: "Non authentifié." }, { status: 401 }) };
  }
  const { data, error } = await supabase
    .from("clip_jobs")
    .select("id, pipeline")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return { response: NextResponse.json({ error: "Introuvable." }, { status: 404 }) };
  }
  return {
    userId: user.id,
    job: { id: data.id as string, pipeline: data.pipeline },
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const loaded = await loadOwnedJob(jobId);
    if ("response" in loaded) return loaded.response;
    const { userId, job } = loaded;
    const etape = etapeFromPipeline(job.pipeline);
    if (etape?.id !== "moments_prets") {
      return NextResponse.json({ error: "Mauvaise étape." }, { status: 409 });
    }
    const existing = pipelineChoosingAt(job.pipeline);
    if (existing) {
      return NextResponse.json({ choix_en_cours_at: existing });
    }

    const at = new Date().toISOString();
    const pipeline = pipelineObject(job.pipeline) ?? {};
    pipeline.etape = "moments_prets";
    pipeline.choix_en_cours_at = at;

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("clip_jobs")
      .update({ pipeline })
      .eq("id", job.id)
      .eq("user_id", userId)
      .filter("pipeline->>etape", "eq", "moments_prets")
      .filter("pipeline->>choix_en_cours_at", "is", null)
      .select("id");
    if (error) {
      console.error("[moments] pause update failed:", error);
      return NextResponse.json({ error: "Erreur." }, { status: 500 });
    }
    if (updated?.length) {
      return NextResponse.json({ choix_en_cours_at: at });
    }

    const { data: again } = await admin
      .from("clip_jobs")
      .select("pipeline")
      .eq("id", job.id)
      .eq("user_id", userId)
      .maybeSingle();
    const kept = pipelineChoosingAt(again?.pipeline);
    if (kept) return NextResponse.json({ choix_en_cours_at: kept });
    return NextResponse.json({ error: "Mauvaise étape." }, { status: 409 });
  } catch (err) {
    console.error("[moments] en-cours failed:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
