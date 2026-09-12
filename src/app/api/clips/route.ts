import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { clipExpiresAt } from "@/lib/clips/retention";
import { isLibraryVisibleClipJob } from "@/lib/clips/library-visible";

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
  credits_quoted?: number | null;
  analyze_only?: boolean | null;
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
  // `Number(null) === 0`, so a missing `offset` must not win over `page`.
  const offsetParam = url.searchParams.get("offset");
  const parsedOffset =
    offsetParam == null || offsetParam === "" ? NaN : Number(offsetParam);
  const offset =
    Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? Math.floor(parsedOffset)
      : (page - 1) * limit;
  const q = url.searchParams.get("q")?.trim() || null;
  return { limit, page, offset, q };
}

function mapJobs(rows: ListedClipJob[], plan: string) {
  return rows.filter(isLibraryVisibleClipJob).map((j) => {
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
  const selectFull =
    "id, url, video_title, channel_title, duration, status, error, created_at, clips, credits_quoted, analyze_only";
  const selectBase =
    "id, url, video_title, channel_title, duration, status, error, created_at, clips";

  const buildQuery = (selectCols: string) => {
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
    return listQuery;
  };

  let result = await buildQuery(selectFull);
  if (result.error && (result.error as { code?: string }).code === "42703") {
    result = await buildQuery(selectBase);
  }

  const { data: jobsMeta, error: errMeta, count } = result;

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
    const row = j as unknown as ListedClipJob & { clips?: unknown[] };
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
      credits_quoted:
        typeof row.credits_quoted === "number" ? row.credits_quoted : null,
      analyze_only: row.analyze_only === true,
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
        const visible = mapJobs(rows, plan);
        const totalRaw = rows[0]?.total_count;
        let total =
          totalRaw != null && Number.isFinite(Number(totalRaw))
            ? Math.max(0, Number(totalRaw))
            : offset + rows.length;

        if (visible.length === rows.length || rows.length < limit) {
          if (visible.length < rows.length && typeof totalRaw === "number") {
            total = Math.max(0, total - (rows.length - visible.length));
          }
          return NextResponse.json({
            jobs: visible,
            total,
            limit,
            offset,
            retention_plan: plan,
          });
        }

        const collected: ListedClipJob[] = rows.filter(isLibraryVisibleClipJob);
        let hidden = rows.length - collected.length;
        let dbOffset = offset + rows.length;
        const rpcTotal =
          totalRaw != null && Number.isFinite(Number(totalRaw))
            ? Math.max(0, Number(totalRaw))
            : null;
        while (collected.length < limit && (rpcTotal == null || dbOffset < rpcTotal)) {
          const extra = await supabase.rpc("list_my_clip_jobs", {
            p_limit: 50,
            p_offset: dbOffset,
            p_query: q,
          });
          if (extra.error || !Array.isArray(extra.data) || extra.data.length === 0) break;
          const extraRows = extra.data as ListedClipJob[];
          for (const row of extraRows) {
            if (isLibraryVisibleClipJob(row)) collected.push(row);
            else hidden += 1;
            if (collected.length >= limit) break;
          }
          dbOffset += extraRows.length;
          if (extraRows.length < 50) break;
          if (dbOffset > offset + 400) break;
        }

        return NextResponse.json({
          jobs: mapJobs(collected.slice(0, limit), plan),
          total: rpcTotal != null ? Math.max(0, rpcTotal - hidden) : collected.length,
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
