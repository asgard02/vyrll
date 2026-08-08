import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { clipExpiresAt } from "@/lib/clips/retention";

type ListedClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  channel_title?: string | null;
  duration: number;
  status: string;
  error?: string | null;
  created_at: string;
  clips_count: number;
};

export async function GET() {
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

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    const plan = profileRow?.plan ?? "free";

    // RPC : métadonnées + clips_count sans JSONB clips (egress PostgREST).
    const { data: rpcJobs, error: rpcError } = await supabase.rpc(
      "list_my_clip_jobs",
      { p_limit: 50 }
    );

    if (!rpcError && Array.isArray(rpcJobs)) {
      const jobs = (rpcJobs as ListedClipJob[]).map((j) => {
        const count = Math.max(0, Number(j.clips_count) || 0);
        return {
          id: j.id,
          url: j.url,
          video_title: j.video_title ?? null,
          channel_title: j.channel_title ?? null,
          duration: j.duration,
          status: j.status,
          error: j.error ?? null,
          created_at: j.created_at,
          expires_at: clipExpiresAt(j.created_at, plan),
          clips_count: count,
          // Compat UI legacy : placeholders indexés sans payload segments.
          clips: Array.from({ length: count }, () => ({})),
        };
      });
      return NextResponse.json({ jobs, retention_plan: plan });
    }

    // Fallback si la migration RPC n'est pas encore appliquée.
    if (rpcError) {
      console.warn(
        "[clips/list] list_my_clip_jobs unavailable, falling back:",
        rpcError.message
      );
    }

    let jobs = null;
    let error = null as unknown;

    const { data: jobsMeta, error: errMeta } = await supabase
      .from("clip_jobs")
      .select(
        "id, url, video_title, channel_title, duration, status, error, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!errMeta) {
      jobs = (jobsMeta ?? []).map((j) => ({
        ...j,
        expires_at: clipExpiresAt(j.created_at, plan),
        clips_count: 0,
        clips: [] as unknown[],
      }));
    } else if ((errMeta as { code?: string }).code === "42703") {
      const { data: jobsLegacy, error: errLegacy } = await supabase
        .from("clip_jobs")
        .select("id, url, duration, status, error, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      jobs = (jobsLegacy ?? []).map((j) => ({
        ...j,
        video_title: null,
        channel_title: null,
        expires_at: clipExpiresAt(j.created_at, plan),
        clips_count: 0,
        clips: [] as unknown[],
      }));
      error = errLegacy;
    } else {
      error = errMeta;
    }

    if (error) {
      console.error("Clips list error:", error);
      return NextResponse.json(
        { error: "Erreur." },
        { status: 500 }
      );
    }

    return NextResponse.json({ jobs: jobs ?? [], retention_plan: plan });
  } catch (err) {
    console.error("Clips list error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
