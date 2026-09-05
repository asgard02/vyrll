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
  total_count?: number | string | null;
};

const PAGE_DEFAULT = 18;
const PAGE_MAX = 50;

/** Skip 3-arg RPC after schema cache miss until the process recycles. */
let pagedRpcAvailable: boolean | null = null;

function parsePageParams(url: URL) {
  const limit = Math.min(
    PAGE_MAX,
    Math.max(1, Number(url.searchParams.get("limit")) || PAGE_DEFAULT)
  );
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const rawOffset = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.floor(rawOffset)
    : (page - 1) * limit;
  const q = url.searchParams.get("q")?.trim() || null;
  return { limit, page, offset, q };
}

function mapJobs(rows: ListedClipJob[], plan: string) {
  return rows.map((j) => {
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
      clips: Array.from({ length: count }, () => ({})),
    };
  });
}

async function listJobsFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  plan: string,
  opts: { limit: number; offset: number; q: string | null }
) {
  const { limit, offset, q } = opts;
  const selectCols =
    "id, url, video_title, channel_title, duration, status, error, created_at, clips";

  let listQuery = supabase
    .from("clip_jobs")
    .select(selectCols, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    listQuery = listQuery.or(
      `video_title.ilike.%${q}%,channel_title.ilike.%${q}%,url.ilike.%${q}%`
    );
  }

  const { data: jobsMeta, error: errMeta, count } = await listQuery;

  if (errMeta && (errMeta as { code?: string }).code === "42703") {
    let legacyQuery = supabase
      .from("clip_jobs")
      .select("id, url, duration, status, error, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (q) legacyQuery = legacyQuery.ilike("url", `%${q}%`);
    const legacy = await legacyQuery;
    if (legacy.error) {
      console.error("Clips list error:", legacy.error);
      return NextResponse.json({ error: "Erreur." }, { status: 500 });
    }
    const jobs = (legacy.data ?? []).map((j) => ({
      ...j,
      video_title: null as string | null,
      channel_title: null as string | null,
      clips_count: 0,
    }));
    return NextResponse.json({
      jobs: mapJobs(jobs, plan),
      total: legacy.count ?? jobs.length,
      limit,
      offset,
      retention_plan: plan,
    });
  }

  if (errMeta) {
    console.error("Clips list error:", errMeta);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }

  const jobs = (jobsMeta ?? []).map((j): ListedClipJob => {
    const row = j as ListedClipJob & { clips?: unknown[] };
    const clips_count = Array.isArray(row.clips) ? row.clips.length : 0;
    return {
      id: row.id,
      url: row.url,
      video_title: row.video_title ?? null,
      channel_title: row.channel_title ?? null,
      duration: row.duration,
      status: row.status,
      error: row.error ?? null,
      created_at: row.created_at,
      clips_count,
    };
  });

  return NextResponse.json({
    jobs: mapJobs(jobs, plan),
    total: count ?? jobs.length,
    limit,
    offset,
    retention_plan: plan,
  });
}

export async function GET(request: Request) {
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

    const { limit, offset, q } = parsePageParams(new URL(request.url));
    const escapedQ = q ? q.replace(/[%_,]/g, " ").trim() : null;
    const profilePromise = supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();

    if (pagedRpcAvailable !== false) {
      const [profileRes, rpcRes] = await Promise.all([
        profilePromise,
        supabase.rpc("list_my_clip_jobs", {
          p_limit: limit,
          p_offset: offset,
          p_query: q,
        }),
      ]);
      const plan = profileRes.data?.plan ?? "free";
      const { data: rpcJobs, error: rpcError } = rpcRes;

      if (!rpcError && Array.isArray(rpcJobs)) {
        pagedRpcAvailable = true;
        const rows = rpcJobs as ListedClipJob[];
        const totalRaw = rows[0]?.total_count;
        const total =
          totalRaw != null && Number.isFinite(Number(totalRaw))
            ? Math.max(0, Number(totalRaw))
            : offset + rows.length;
        return NextResponse.json({
          jobs: mapJobs(rows, plan),
          total,
          limit,
          offset,
          retention_plan: plan,
        });
      }

      if (rpcError) {
        pagedRpcAvailable = false;
        console.warn(
          "[clips/list] list_my_clip_jobs unavailable, falling back:",
          rpcError.message
        );
      }

      return await listJobsFallback(supabase, user.id, plan, {
        limit,
        offset,
        q: escapedQ,
      });
    }

    const profileRes = await profilePromise;
    const plan = profileRes.data?.plan ?? "free";
    return await listJobsFallback(supabase, user.id, plan, {
      limit,
      offset,
      q: escapedQ,
    });
  } catch (err) {
    console.error("Clips list error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
