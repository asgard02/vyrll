import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { creditsForAutoMode, creditsForLongAuto, creditsForManualWindow, isLongAutoSource } from "@/lib/clip-credits";
import { resolveVideoSourceMetadata } from "@/lib/video-source-metadata";
import { mapStoredClipToItem, type StoredClipRow } from "@/lib/clips/types";
import { clipExpiresAt } from "@/lib/clips/retention";
import { purgeClipJob } from "@/lib/clips/purge-job";

const TERMINAL_STATUSES = ["done", "error"] as const;
const BACKEND_POLL_TIMEOUT_MS = 20_000;

type ClipJobRow = {
  id: string;
  user_id: string;
  url: string;
  duration: number;
  status: string;
  error?: string | null;
  clips?: StoredClipRow[] | null;
  backend_job_id?: string | null;
  source_duration_seconds?: number | null;
  created_at: string;
  format?: string | null;
  style?: string | null;
  duration_min?: number | null;
  duration_max?: number | null;
  render_mode?: string | null;
  clip_mode?: string | null;
  credits_quoted?: number | null;
  split_confidence?: number | null;
  start_time_sec?: number | null;
  search_window_start_sec?: number | null;
  search_window_end_sec?: number | null;
  video_title?: string | null;
  channel_title?: string | null;
  channel_thumbnail_url?: string | null;
  credits_billed_at?: string | null;
  credits_billed_amount?: number | null;
};

export async function GET(
  request: NextRequest,
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
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId manquant." },
        { status: 400 }
      );
    }

    // lite=1 : poll status/progress sans JSONB clips (egress PostgREST).
    const lite = request.nextUrl.searchParams.get("lite") === "1";

    // Sélection progressive : colonnes étendues puis legacy puis minimales
    const selectFull = lite
      ? "id, user_id, url, duration, status, error, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, clip_mode, credits_quoted, split_confidence, start_time_sec, search_window_start_sec, search_window_end_sec, video_title, channel_title, channel_thumbnail_url, credits_billed_at, credits_billed_amount"
      : "id, user_id, url, duration, status, error, clips, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, clip_mode, credits_quoted, split_confidence, start_time_sec, search_window_start_sec, search_window_end_sec, video_title, channel_title, channel_thumbnail_url, credits_billed_at, credits_billed_amount";
    const selectLegacy = lite
      ? "id, user_id, url, duration, status, error, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, split_confidence, start_time_sec, search_window_start_sec, search_window_end_sec, video_title, channel_title, channel_thumbnail_url, credits_billed_at, credits_billed_amount"
      : "id, user_id, url, duration, status, error, clips, backend_job_id, source_duration_seconds, created_at, format, style, duration_min, duration_max, render_mode, split_confidence, start_time_sec, search_window_start_sec, search_window_end_sec, video_title, channel_title, channel_thumbnail_url, credits_billed_at, credits_billed_amount";
    const selectMinimal = lite
      ? "id, user_id, url, duration, status, error, backend_job_id, created_at"
      : "id, user_id, url, duration, status, error, clips, backend_job_id, created_at";

    let supabaseSelectTier: "full" | "legacy" | "minimal" = "full";
    let job: ClipJobRow | null = null;
    let jobError: { code?: string; message?: string } | null = null;

    {
      // Cast select dynamique : évite l'explosion d'inférence PostgREST (lite vs full).
      const res = await supabase
        .from("clip_jobs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select(selectFull as any)
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single();
      job = (res.data as ClipJobRow | null) ?? null;
      jobError = res.error;
    }

    if (jobError && !job) {
      const legacy = await supabase
        .from("clip_jobs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select(selectLegacy as any)
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single();
      if (legacy.data) {
        supabaseSelectTier = "legacy";
        job = legacy.data as unknown as ClipJobRow;
        jobError = legacy.error;
      } else {
        const fallback = await supabase
          .from("clip_jobs")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select(selectMinimal as any)
          .eq("id", jobId)
          .eq("user_id", user.id)
          .single();
        if (fallback.data) {
          supabaseSelectTier = "minimal";
          job = fallback.data as unknown as ClipJobRow;
          jobError = fallback.error;
        }
      }
    }

    if (jobError || !job) {
      if (jobError) {
        console.warn("[clips] Job fetch failed:", jobId, jobError.code, jobError.message);
      }
      return NextResponse.json(
        { error: "Job introuvable." },
        { status: 404 }
      );
    }

    // Si les métadonnées source n’ont pas encore été persistées (course avec POST /start, ou migration),
    // les résoudre ici pour que le polling affiche le nom de chaîne / avatar sans attendre.
    {
      const j = job as {
        url?: string;
        status?: string;
        channel_title?: string | null;
        video_title?: string | null;
        channel_thumbnail_url?: string | null;
      };
      const sourceUrl = j.url ?? "";
      const st = String(j.status ?? "");
      const shouldHydrate =
        (st === "pending" || st === "processing") &&
        sourceUrl.length > 0 &&
        !sourceUrl.startsWith("upload://") &&
        !String(j.channel_title ?? "").trim();

      if (shouldHydrate) {
        try {
          const meta = await resolveVideoSourceMetadata(sourceUrl);
          const payload: Record<string, string> = {};
          if (meta.video_title) payload.video_title = meta.video_title;
          if (meta.channel_title) payload.channel_title = meta.channel_title;
          if (meta.channel_thumbnail_url) payload.channel_thumbnail_url = meta.channel_thumbnail_url;
          if (Object.keys(payload).length > 0) {
            const admin = createAdminClient();
            const { error: upErr } = await admin
              .from("clip_jobs")
              .update(payload)
              .eq("id", jobId)
              .eq("user_id", user.id);
            if (!upErr) {
              if (meta.video_title) j.video_title = meta.video_title;
              if (meta.channel_title) j.channel_title = meta.channel_title;
              if (meta.channel_thumbnail_url) j.channel_thumbnail_url = meta.channel_thumbnail_url;
            } else if (meta.video_title && (payload.channel_title || payload.channel_thumbnail_url)) {
              await admin
                .from("clip_jobs")
                .update({ video_title: meta.video_title })
                .eq("id", jobId)
                .eq("user_id", user.id);
              if (meta.video_title) j.video_title = meta.video_title;
            }
          }
        } catch {
          /* best-effort */
        }
      }
    }

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    const isStaleError =
      job.status === "error" &&
      String(job.error ?? "") === "STALE_JOB_TIMEOUT";
    const isTerminal =
      TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number]) &&
      !isStaleError;
    let backendProgress: number | undefined;
    let backendSourceDuration: number | null = null;
    let resolvedStatus = job.status as string;

    let backendPollDebug: Record<string, unknown> = {
      skipped: true,
      reason: isTerminal
        ? "terminal_status"
        : !job.backend_job_id
          ? "no_backend_job_id"
          : "unknown",
    };

    // Toujours pouvoir se soigner depuis clip_backend_jobs (même si HTTP worker down
    // ou job déjà marqué STALE_JOB_TIMEOUT à tort).
    if (!isTerminal && job.backend_job_id) {
      try {
        const adminDb = createAdminClient();
        // Ne pas tirer le JSONB clips tant que le backend n'est pas done.
        const { data: bjMeta } = await adminDb
          .from("clip_backend_jobs")
          .select("status, progress, error, source_duration_seconds")
          .eq("backend_job_id", job.backend_job_id)
          .maybeSingle();
        if (bjMeta?.status === "done") {
          const { data: bj } = await adminDb
            .from("clip_backend_jobs")
            .select("clips, source_duration_seconds")
            .eq("backend_job_id", job.backend_job_id)
            .maybeSingle();
          const backendClips = Array.isArray(bj?.clips) ? bj.clips : [];
          if (backendClips.length > 0) {
            backendProgress = 100;
            backendSourceDuration =
              typeof (bj?.source_duration_seconds ?? bjMeta.source_duration_seconds) ===
              "number"
                ? Number(bj?.source_duration_seconds ?? bjMeta.source_duration_seconds)
                : null;
            resolvedStatus = "done";
            const updatePayload: {
              status: string;
              error: null;
              clips: unknown[];
              source_duration_seconds?: number | null;
            } = {
              status: "done",
              error: null,
              clips: backendClips,
            };
            if (backendSourceDuration != null) {
              updatePayload.source_duration_seconds = backendSourceDuration;
            }
            await adminDb
              .from("clip_jobs")
              .update(updatePayload)
              .eq("id", jobId)
              .eq("user_id", user.id)
              .in("status", ["pending", "processing", "error"]);
            backendPollDebug = {
              skipped: false,
              source: "clip_backend_jobs",
              backend_job_id: job.backend_job_id,
              status_raw: bjMeta.status,
              clips_count: backendClips.length,
              healed_stale: isStaleError,
            };
          }
        } else if (bjMeta && typeof bjMeta.progress === "number") {
          backendProgress = bjMeta.progress;
          backendPollDebug = {
            skipped: false,
            source: "clip_backend_jobs_meta",
            backend_job_id: job.backend_job_id,
            status_raw: bjMeta.status,
            progress_raw: bjMeta.progress,
          };
        }
      } catch (healErr) {
        console.warn(
          "[clips] heal from clip_backend_jobs failed:",
          healErr instanceof Error ? healErr.message : healErr
        );
      }
    }

    if (
      resolvedStatus !== "done" &&
      !isTerminal &&
      job.backend_job_id &&
      backendUrl &&
      backendSecret
    ) {
      try {
        const res = await fetch(
          `${backendUrl.replace(/\/$/, "")}/jobs/${job.backend_job_id}`,
          {
            headers: { "x-backend-secret": backendSecret },
            signal: AbortSignal.timeout(BACKEND_POLL_TIMEOUT_MS),
          }
        );
        const backendData = await res.json().catch(() => ({}));

        // Backend 404 = job absent en mémoire (redémarrage, autre réplica, etc.) → code dédié
        const backendGone = res.status === 404;
        const backendStatus = backendGone
          ? "error"
          : backendData.status ?? (res.ok ? "processing" : "error");
        const backendError = backendGone
          ? "BACKEND_JOB_LOST"
          : backendData.error ?? (res.ok ? null : backendData.message ?? "PROCESSING_FAILED");
        const backendClips = Array.isArray(backendData.clips) ? backendData.clips : [];
        // Never let a stale replica snapshot (progress 0) clobber durable DB progress.
        const httpProgress =
          typeof backendData.progress === "number" ? backendData.progress : undefined;
        if (typeof httpProgress === "number") {
          backendProgress =
            typeof backendProgress === "number"
              ? Math.max(backendProgress, httpProgress)
              : httpProgress;
        }
        backendSourceDuration =
          typeof backendData.source_duration_seconds === "number"
            ? backendData.source_duration_seconds
            : null;

        backendPollDebug = {
          skipped: false,
          backend_job_id: job.backend_job_id,
          http_status: res.status,
          ok: res.ok,
          backend_job_lost: backendGone,
          ...(backendGone
            ? {
                hint:
                  "GET /jobs/:id a renvoyé 404 — jobs en RAM uniquement : vérifier 1 réplica Railway, absence de redémarrage pendant le job, BACKEND_URL pointant vers le bon service.",
              }
            : {}),
          progress_raw: backendProgress,
          source_duration_seconds_raw: backendSourceDuration,
          status_raw:
            typeof backendData === "object" && backendData !== null && "status" in backendData
              ? (backendData as { status?: unknown }).status
              : undefined,
          error_raw:
            typeof backendData === "object" && backendData !== null && "error" in backendData
              ? (backendData as { error?: unknown }).error
              : undefined,
          clips_count: backendClips.length,
          response_keys:
            typeof backendData === "object" && backendData !== null && !Array.isArray(backendData)
              ? Object.keys(backendData as object)
              : [],
        };

        const newStatus =
          backendStatus === "done" || backendStatus === "completed"
            ? "done"
            : backendStatus === "error" || backendStatus === "failed"
              ? "error"
              : backendStatus === "pending" || backendStatus === "processing"
                ? "processing"
                : job.status;
        resolvedStatus = newStatus;

        const updatePayload: {
          status: string;
          error?: string | null;
          clips?: unknown[];
          source_duration_seconds?: number | null;
          render_mode?: string | null;
          split_confidence?: number | null;
        } = {
          status: newStatus,
          error: backendError ?? null,
        };
        // Ne réécrire clips que s'il y a un payload backend — évite wipe + egress.
        if (backendClips.length > 0) {
          updatePayload.clips = backendClips;
        } else if (
          !lite &&
          Array.isArray(job.clips) &&
          newStatus === "error"
        ) {
          updatePayload.clips = job.clips;
        }
        if (backendSourceDuration != null) {
          updatePayload.source_duration_seconds = backendSourceDuration;
        }
        if (newStatus === "done" && backendClips.length > 0) {
          const anySplit = backendClips.some((c: { render_mode?: string }) => c?.render_mode === "split_vertical");
          if (anySplit) {
            updatePayload.render_mode = "split_vertical";
            const maxConf = Math.max(
              ...backendClips
                .filter((c: { render_mode?: string }) => c?.render_mode === "split_vertical")
                .map((c: { split_confidence?: number }) => c?.split_confidence ?? 0)
            );
            updatePayload.split_confidence = maxConf > 0 ? maxConf : null;
          } else {
            updatePayload.render_mode = "normal";
            updatePayload.split_confidence = null;
          }
        }

        const admin = createAdminClient();
        const { error: updateErr } = await admin
          .from("clip_jobs")
          .update(updatePayload)
          .eq("id", jobId)
          .eq("user_id", user.id);
        if (updateErr && updatePayload.render_mode != null) {
          const fallback = { ...updatePayload };
          delete (fallback as Record<string, unknown>).render_mode;
          delete (fallback as Record<string, unknown>).split_confidence;
          await admin
            .from("clip_jobs")
            .update(fallback)
            .eq("id", jobId)
            .eq("user_id", user.id);
        }
      } catch (pollErr) {
        // Backend slow / TimeoutError must not 500 the status route — UI would thrash
        // (loading → error/final → loading). Keep last known Supabase status.
        const name =
          pollErr instanceof Error
            ? pollErr.name
            : typeof pollErr === "object" &&
                pollErr !== null &&
                "name" in pollErr &&
                typeof (pollErr as { name?: unknown }).name === "string"
              ? (pollErr as { name: string }).name
              : "Error";
        const isTimeout = name === "TimeoutError" || name === "AbortError";
        backendPollDebug = {
          skipped: false,
          soft_fail: true,
          reason: isTimeout ? "backend_poll_timeout" : "backend_poll_error",
          backend_job_id: job.backend_job_id,
          error_name: name,
        };
        if (!isTimeout) {
          console.warn("Clips backend poll soft-fail:", name);
        }
      }
    }

    // Billing is retry-safe: charge whenever done && not yet billed (not only on first transition).
    // Uses service_role so auth.uid() quirks cannot silently skip the profile increment.
    const jobBilling = job as {
      credits_billed_at?: string | null;
      source_duration_seconds?: number | null;
      render_mode?: string | null;
      clip_mode?: string | null;
      credits_quoted?: number | null;
      search_window_start_sec?: number | null;
      search_window_end_sec?: number | null;
      duration_max?: number | null;
    };
    if (resolvedStatus === "done" && !jobBilling.credits_billed_at) {
      const sourceDuration = Math.round(
        Number(backendSourceDuration ?? jobBilling.source_duration_seconds ?? 0)
      );
      const isManual =
        jobBilling.clip_mode === "manual" ||
        jobBilling.render_mode === "manual" ||
        (jobBilling.search_window_start_sec != null &&
          jobBilling.search_window_end_sec != null);
      const ws = jobBilling.search_window_start_sec;
      const we = jobBilling.search_window_end_sec;
      const windowLen =
        isManual &&
        ws != null &&
        we != null &&
        Number.isFinite(ws) &&
        Number.isFinite(we) &&
        we > ws
          ? Math.round(we - ws)
          : 0;
      const quoted =
        jobBilling.credits_quoted != null && Number.isFinite(jobBilling.credits_quoted)
          ? Math.max(0, Math.round(Number(jobBilling.credits_quoted)))
          : 0;

      let finalCredits: number | null = null;
      if (isManual && windowLen > 0) {
        finalCredits = Math.max(1, creditsForManualWindow(windowLen));
      } else if (isManual && quoted > 0) {
        finalCredits = Math.max(1, quoted);
      } else if (isManual) {
        console.error(
          `[clips] manual job ${jobId} missing search_window and credits_quoted; skipping bill`
        );
      } else if (isLongAutoSource(sourceDuration)) {
        finalCredits =
          quoted > 0
            ? Math.max(1, quoted)
            : Math.max(
                1,
                creditsForLongAuto({
                  sourceDurationSec: sourceDuration,
                  durationMaxSec: Number(jobBilling.duration_max) || 60,
                  plan: "creator",
                })
              );
      } else {
        finalCredits = Math.max(1, creditsForAutoMode(sourceDuration));
      }

      if (finalCredits != null) {
        const admin = createAdminClient();
        const { error: billingErr } = await admin.rpc("charge_clip_job_once", {
          p_job_id: jobId,
          p_user_id: user.id,
          p_credits: finalCredits,
        });
        if (billingErr) {
          const fnMissing = billingErr.code === "42883";
          if (fnMissing) {
            await admin.rpc("increment_credits_used", {
              p_user_id: user.id,
              p_credits: finalCredits,
            });
          } else {
            console.error("[clips] charge_clip_job_once failed:", billingErr);
          }
        }
      }
    }

    const updatedRes = await supabase
      .from("clip_jobs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select(
        (lite
          ? "status, error, render_mode, split_confidence"
          : "status, error, clips, render_mode, split_confidence") as any
      )
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();
    const updatedJob = (updatedRes.data as {
      status?: string;
      error?: string | null;
      clips?: StoredClipRow[] | null;
      render_mode?: string | null;
      split_confidence?: number | null;
    } | null) ?? null;

    // Relative path — request.nextUrl.origin is localhost behind Railway/proxy.
    const rawClips = lite
      ? ([] as StoredClipRow[])
      : ((updatedJob?.clips ?? job.clips ?? []) as StoredClipRow[]);
    const clips = rawClips.map((c, i) => mapStoredClipToItem(c, jobId, i));
    const status = updatedJob?.status ?? job.status;
    const progress =
      typeof backendProgress === "number"
        ? backendProgress
        : status === "done"
          ? 100
          : status === "error"
            ? 0
            : undefined;

    // Queue position for pending/processing (shared DB queue)
    let queue: { ahead: number; eta_minutes: number | null } | undefined;
    if (
      (status === "pending" || status === "processing") &&
      job.backend_job_id
    ) {
      try {
        const adminQ = createAdminClient();
        const { data: bj } = await adminQ
          .from("clip_backend_jobs")
          .select("created_at, status")
          .eq("backend_job_id", job.backend_job_id)
          .maybeSingle();
        if (bj?.created_at) {
          const { count: aheadPending } = await adminQ
            .from("clip_backend_jobs")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
            .lt("created_at", bj.created_at);
          const ahead =
            bj.status === "pending" ? Math.max(0, aheadPending ?? 0) : 0;
          // ~12 min median wall / job, 6 replicas → rough ETA once running starts
          const replicas = Math.max(
            1,
            Number(process.env.QUEUE_ETA_REPLICAS) || 6
          );
          const medianMin = Math.max(
            5,
            Number(process.env.QUEUE_ETA_MEDIAN_MIN) || 12
          );
          const eta_minutes =
            bj.status === "processing"
              ? null
              : Math.ceil(((ahead + 1) * medianMin) / replicas);
          queue = { ahead, eta_minutes };
        }
      } catch (qErr) {
        console.warn("[clips] queue position failed:", qErr);
      }
    }

    const jobData = updatedJob ?? job;
    const rawClipsForDerive = lite
      ? ([] as { render_mode?: string; split_confidence?: number }[])
      : (((jobData as { clips?: unknown })?.clips ?? job.clips ?? []) as {
          render_mode?: string;
          split_confidence?: number;
        }[]);
    const derivedRenderMode =
      jobData.render_mode ??
      (rawClipsForDerive.some((c) => c?.render_mode === "split_vertical")
        ? "split_vertical"
        : undefined);
    const splitClips = rawClipsForDerive.filter((c) => c?.render_mode === "split_vertical");
    const derivedSplitConf =
      jobData.split_confidence ??
      (splitClips.length > 0
        ? Math.max(...splitClips.map((c) => c?.split_confidence ?? 0))
        : undefined);

    const j = job;

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    const expiresAt = clipExpiresAt(job.created_at, profileRow?.plan ?? "free");

    const debugRequested = request.nextUrl.searchParams.get("debug") === "1";
    const jobRowMerged = {
      ...(job as Record<string, unknown>),
      status: updatedJob?.status ?? job.status,
      error: updatedJob?.error ?? job.error,
      ...(lite ? { clips: [] } : { clips: updatedJob?.clips ?? job.clips }),
      render_mode: updatedJob?.render_mode ?? job.render_mode,
      split_confidence: updatedJob?.split_confidence ?? job.split_confidence,
    };

    return NextResponse.json({
      id: job.id,
      url: job.url,
      duration: job.duration,
      created_at: job.created_at,
      expires_at: expiresAt,
      status,
      progress,
      error: updatedJob?.error ?? job.error ?? undefined,
      clips,
      lite: lite || undefined,
      ...(queue ? { queue } : {}),
      format: j.format ?? undefined,
      style: j.style ?? undefined,
      duration_min: j.duration_min ?? undefined,
      duration_max: j.duration_max ?? undefined,
      render_mode: derivedRenderMode ?? undefined,
      split_confidence: derivedSplitConf ?? undefined,
      video_title: j.video_title?.trim() ? j.video_title.trim() : undefined,
      channel_title: j.channel_title?.trim() ? j.channel_title.trim() : undefined,
      channel_thumbnail_url:
        j.channel_thumbnail_url?.trim().startsWith("http")
          ? j.channel_thumbnail_url.trim()
          : undefined,
      ...(debugRequested
        ? {
            debug: {
              fetched_at_iso: new Date().toISOString(),
              supabase_select: supabaseSelectTier,
              lite,
              job_row: jobRowMerged,
              backend_poll: backendPollDebug,
              computed: {
                progress,
                derived_render_mode: derivedRenderMode ?? null,
                derived_split_confidence: derivedSplitConf ?? null,
              },
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("Clips status error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId manquant." },
        { status: 400 }
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("clip_jobs")
      .select("id, user_id, backend_job_id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: "Job introuvable." },
        { status: 404 }
      );
    }

    const admin = createAdminClient();
    const result = await purgeClipJob(admin, {
      id: jobId,
      user_id: user.id,
      backend_job_id: job.backend_job_id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Erreur lors de la suppression." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Clips delete error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
