import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { etapeFromPipeline } from "@/lib/clips/job-etape";
import {
  matchMomentChoice,
  momentSpansFromBody,
  pipelineHasChosenMoments,
  pipelineObject,
} from "@/lib/clips/moments-choice";

const RENDER_TIMEOUT_MS = 20_000;

type OwnedJob = {
  id: string;
  backend_job_id: string | null;
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
    .select("id, backend_job_id, pipeline")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return { response: NextResponse.json({ error: "Introuvable." }, { status: 404 }) };
  }
  return {
    userId: user.id,
    job: {
      id: data.id as string,
      backend_job_id: typeof data.backend_job_id === "string" ? data.backend_job_id : null,
      pipeline: data.pipeline,
    },
  };
}

async function enqueueRender(backendJobId: string): Promise<boolean> {
  const backendUrl = process.env.BACKEND_URL;
  const backendSecret = process.env.BACKEND_SECRET;
  if (!backendUrl || !backendSecret) return false;
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/jobs/${backendJobId}/render`, {
      method: "POST",
      headers: { "x-backend-secret": backendSecret },
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { started?: unknown } | null;
    return data?.started === true;
  } catch (err) {
    console.warn(`[moments] enqueue failed job=${backendJobId}:`, err);
    return false;
  }
}

export async function POST(
  request: Request,
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
    if (pipelineHasChosenMoments(job.pipeline)) {
      return NextResponse.json({ started: false });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
    }
    const spans = momentSpansFromBody(body);
    if (!spans) {
      return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
    }
    const matched = matchMomentChoice(etape.moments, spans);
    if (!matched.ok) {
      return NextResponse.json(
        { error: matched.reason === "unknown" ? "Moment inconnu." : "Liste vide." },
        { status: 400 }
      );
    }

    const pipeline = pipelineObject(job.pipeline) ?? {};
    pipeline.etape = "moments_prets";
    pipeline.moments_choisis = matched.chosen;

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("clip_jobs")
      .update({ pipeline })
      .eq("id", job.id)
      .eq("user_id", userId)
      .filter("pipeline->>etape", "eq", "moments_prets")
      .filter("pipeline->>moments_choisis", "is", null)
      .select("id");
    if (error) {
      console.error("[moments] choice update failed:", error);
      return NextResponse.json({ error: "Erreur." }, { status: 500 });
    }
    if (!updated?.length) {
      const { data: again } = await admin
        .from("clip_jobs")
        .select("pipeline")
        .eq("id", job.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (pipelineHasChosenMoments(again?.pipeline)) {
        return NextResponse.json({ started: false });
      }
      return NextResponse.json({ error: "Mauvaise étape." }, { status: 409 });
    }
    const started = job.backend_job_id ? await enqueueRender(job.backend_job_id) : false;
    return NextResponse.json({ started });
  } catch (err) {
    console.error("[moments] POST failed:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
