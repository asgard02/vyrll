import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { postMomentPause, type MomentsAdmin, type PauseJobLoad } from "@/lib/clips/moments-http";

async function loadOwnedJob(jobId: string): Promise<PauseJobLoad> {
  if (!isSupabaseConfigured()) return { kind: "unconfigured" };
  const supabase = await createClient();
  const { user } = await getServerUser(supabase);
  if (!user) return { kind: "anonymous" };
  const { data, error } = await supabase
    .from("clip_jobs")
    .select("id, pipeline")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return { kind: "missing" };
  return {
    kind: "ready",
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
    const result =
      loaded.kind === "ready"
        ? await postMomentPause(loaded, {
            admin: createAdminClient() as unknown as MomentsAdmin,
          })
        : await postMomentPause(loaded);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[moments] en-cours failed:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
