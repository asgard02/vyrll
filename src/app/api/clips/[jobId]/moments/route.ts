import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  postMomentChoice,
  type MomentJobLoad,
  type MomentsAdmin,
} from "@/lib/clips/moments-http";

const RENDER_TIMEOUT_MS = 20_000;

async function loadOwnedJob(jobId: string): Promise<MomentJobLoad> {
  if (!isSupabaseConfigured()) return { kind: "unconfigured" };
  const supabase = await createClient();
  const { user } = await getServerUser(supabase);
  if (!user) return { kind: "anonymous" };
  const { data, error } = await supabase
    .from("clip_jobs")
    .select("id, backend_job_id, pipeline")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return { kind: "missing" };
  return {
    kind: "ready",
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
    if (loaded.kind !== "ready") {
      const result = await postMomentChoice(loaded, null);
      return NextResponse.json(result.body, { status: result.status });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
    }
    const result = await postMomentChoice(loaded, body, {
      admin: createAdminClient() as unknown as MomentsAdmin,
      enqueue: enqueueRender,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[moments] POST failed:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
