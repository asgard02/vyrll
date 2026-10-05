import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchBackendWithRetry } from "@/lib/backend-fetch";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles, creditsLimitForPlan } from "@/lib/plan";
import { clampHookBoxWidth, clampHookScale, clampHookX, clampOffset, layoutFromRenderMode, parseEditorLayout, parseLayoutBlocks, type ClipOutputFormat } from "@/lib/clips/layout";
import {
  mapStoredClipToItem,
  type ClipTextSegment,
  type StoredClipRow,
} from "@/lib/clips/types";

const RECUT_TIMEOUT_MS = 900_000;
const RECUT_START_TIMEOUT_MS = 45_000;
const RECUT_POLL_MS = 2_000;

function normalizeSegments(raw: unknown): ClipTextSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ClipTextSegment[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") return null;
    const start = Number((s as { start?: unknown }).start);
    let end = Number((s as { end?: unknown }).end);
    const text = String((s as { text?: unknown }).text ?? "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (!(end > start)) end = start + 0.08;
    out.push({ start, end, text });
  }
  return out;
}

function normalizeFormat(raw: unknown): ClipOutputFormat {
  return raw === "1:1" || raw === "16:9" ? raw : "9:16";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; index: string }> }
) {
  let revertReburn: (() => Promise<void>) | null = null;
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

    const { jobId, index: indexParam } = await params;
    const clipIndex = Number.parseInt(indexParam, 10);
    if (!jobId || !Number.isFinite(clipIndex) || clipIndex < 0) {
      return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const segments = normalizeSegments(body?.segments);
    if (!segments) {
      return NextResponse.json(
        { error: "Segments de texte invalides." },
        { status: 400 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, credits_used, credits_limit")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Profil non trouvé." }, { status: 403 });
    }

    if (!canRegenerateSubtitles(profile.plan)) {
      return NextResponse.json(
        {
          error:
            "Le recadrage et la recoupe sont réservés aux abonnés Creator et Studio.",
          code: "PREMIUM_REQUIRED",
        },
        { status: 403 }
      );
    }

    const limit =
      profile.credits_limit != null && profile.credits_limit > 0
        ? profile.credits_limit
        : creditsLimitForPlan(profile.plan);
    const used = profile.credits_used ?? 0;

    const { data: job, error: jobError } = await supabase
      .from("clip_jobs")
      .select("id, user_id, status, clips, style, format, backend_job_id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
    }

    if (job.status !== "done") {
      return NextResponse.json(
        { error: "Le projet n'est pas prêt pour un recadrage." },
        { status: 409 }
      );
    }

    const rawClips = Array.isArray(job.clips) ? (job.clips as StoredClipRow[]) : [];
    if (clipIndex >= rawClips.length) {
      return NextResponse.json({ error: "Clip introuvable." }, { status: 404 });
    }

    const stored = rawClips[clipIndex];
    const sourceUrl = stored?.source_url?.startsWith("http") ? stored.source_url : null;
    if (!sourceUrl) {
      return NextResponse.json(
        {
          error:
            "Ce clip n'a pas de source 16:9. Recadre / recoupe n'est disponible que pour les clips générés récemment.",
          code: "SOURCE_MISSING",
        },
        { status: 400 }
      );
    }
    try {
      if (new URL(sourceUrl).hostname.toLowerCase().includes("supabase")) {
        return NextResponse.json(
          {
            error:
              "Ce clip est encore stocké sur Supabase Storage. Régénérez le projet pour le migrer vers R2.",
            code: "LEGACY_SUPABASE_STORAGE",
          },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "URL source invalide.", code: "INVALID_SOURCE_URL" },
        { status: 400 }
      );
    }

    const sourceStart = Number(stored.source_start);
    const sourceEnd = Number(stored.source_end);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
      return NextResponse.json(
        { error: "Bornes source invalides.", code: "SOURCE_WINDOW_INVALID" },
        { status: 400 }
      );
    }

    const clipStart = Number(body?.start ?? stored.start);
    const clipEnd = Number(body?.end ?? stored.end);
    if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) || clipEnd <= clipStart) {
      return NextResponse.json({ error: "Plage start/end invalide." }, { status: 400 });
    }
    if (clipStart < sourceStart - 0.05 || clipEnd > sourceEnd + 0.05) {
      return NextResponse.json(
        { error: "La coupe dépasse la source gardée." },
        { status: 400 }
      );
    }

    const windowSec = clipEnd - clipStart;
    const creditsNeeded = Math.max(1, creditsForManualWindow(windowSec));

    if (used + creditsNeeded > limit) {
      return NextResponse.json(
        {
          error: "Crédits insuffisants pour recouper ce clip.",
          code: "INSUFFICIENT_CREDITS",
          creditsNeeded,
          creditsRemaining: Math.max(0, limit - used),
        },
        { status: 402 }
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

    const style = String(body?.style || job.style || "impact").trim() || "impact";
    const format = normalizeFormat(body?.format ?? stored.output_format ?? job.format);
    const layout =
      parseEditorLayout(body?.layout) ??
      parseEditorLayout(stored.layout) ??
      layoutFromRenderMode(stored.render_mode, format);
    const layoutBlocks = parseLayoutBlocks(
      body?.layout_blocks ?? stored.layout_blocks,
      layout,
      clipEnd - clipStart
    );
    const captionOffsetY = clampOffset(Number(body?.caption_offset_y ?? stored.caption_offset_y ?? 0));
    const captionOffsetX = clampHookX(Number(body?.caption_offset_x ?? stored.caption_offset_x ?? 0));
    const captionScale = clampHookScale(Number(body?.caption_scale ?? stored.caption_scale ?? 1));
    const captionBoxRaw = Number(body?.caption_box_width ?? stored.caption_box_width);
    const captionBoxWidth =
      Number.isFinite(captionBoxRaw) && captionBoxRaw > 0 ? clampHookBoxWidth(captionBoxRaw) : undefined;
    const hookOffsetY = clampOffset(Number(body?.hook_offset_y ?? stored.hook_offset_y ?? 0));
    const hookOffsetX = clampHookX(Number(body?.hook_offset_x ?? stored.hook_offset_x ?? 0));
    const hookScale = clampHookScale(Number(body?.hook_scale ?? stored.hook_scale ?? 1));
    const hookBoxRaw = Number(body?.hook_box_width ?? stored.hook_box_width);
    const hookBoxWidth =
      Number.isFinite(hookBoxRaw) && hookBoxRaw > 0 ? clampHookBoxWidth(hookBoxRaw) : undefined;
    const hookForBurn =
      body != null && Object.prototype.hasOwnProperty.call(body, "hook")
        ? String(body.hook ?? "")
            .trim()
            .slice(0, 160)
        : stored?.hook != null
          ? String(stored.hook).trim().slice(0, 160)
          : "";
    const backendJobId =
      (job.backend_job_id && String(job.backend_job_id)) || jobId;

    const admin = createAdminClient();
    let reburnMarked = false;

    const writeClips = async (clips: StoredClipRow[]) =>
      admin
        .from("clip_jobs")
        .update({ clips })
        .eq("id", jobId)
        .eq("user_id", user.id);

    const clearReburnFlag = async () => {
      if (!reburnMarked) return;
      const cleared = rawClips.map((c, i) =>
        i === clipIndex
          ? { ...c, reburning: false, reburn_started_at: null }
          : c
      );
      const { error } = await writeClips(cleared);
      if (error) {
        console.error("[clips/recut] clear reburning failed:", error);
      }
    };
    revertReburn = clearReburnFlag;

    const markedClips = rawClips.map((c, i) =>
      i === clipIndex
        ? {
            ...c,
            reburning: true,
            reburn_started_at: new Date().toISOString(),
          }
        : c
    );
    const { error: markErr } = await writeClips(markedClips);
    if (markErr) {
      console.error("[clips/recut] mark reburning failed:", markErr);
    } else {
      reburnMarked = true;
    }

    after(async () => {
      const persistSuccess = async (result: {
        url?: string;
        clean_url?: string;
        source_url?: string;
        text?: string;
        segments?: ClipTextSegment[];
        start?: number;
        end?: number;
        layout?: StoredClipRow["layout"];
        layout_blocks?: StoredClipRow["layout_blocks"];
        output_format?: ClipOutputFormat;
        caption_offset_y?: number;
        caption_offset_x?: number;
        caption_scale?: number;
        caption_box_width?: number;
        hook_offset_y?: number;
        hook_offset_x?: number;
        hook_scale?: number;
        hook_box_width?: number;
        render_mode?: string;
      }) => {
        if (!result?.url?.startsWith("http")) {
          await clearReburnFlag();
          console.error("[clips/recut] invalid backend url");
          return;
        }
        const text =
          result.text?.trim() ||
          segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
        const { data: latest, error: latestErr } = await admin
          .from("clip_jobs")
          .select("clips")
          .eq("id", jobId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (latestErr) {
          console.error("[clips/recut] re-read clips failed:", latestErr);
        }
        const baseClips = Array.isArray(latest?.clips)
          ? (latest.clips as StoredClipRow[])
          : rawClips;
        const updatedRow: StoredClipRow = {
          ...(baseClips[clipIndex] ?? stored),
          url: result.url,
          clean_url: result.clean_url || stored.clean_url,
          source_url: result.source_url || sourceUrl,
          source_start: sourceStart,
          source_end: sourceEnd,
          start: Number.isFinite(Number(result.start)) ? Number(result.start) : clipStart,
          end: Number.isFinite(Number(result.end)) ? Number(result.end) : clipEnd,
          text: text || null,
          segments: Array.isArray(result.segments) ? result.segments : segments,
          hook: hookForBurn || null,
          layout: result.layout ?? layoutBlocks[0]?.layout ?? layout,
          layout_blocks: Array.isArray(result.layout_blocks) ? result.layout_blocks : layoutBlocks,
          output_format: result.output_format ?? format,
          caption_offset_y: captionOffsetY,
          caption_offset_x: captionOffsetX,
          caption_scale: captionScale,
          ...(captionBoxWidth != null ? { caption_box_width: captionBoxWidth } : {}),
          hook_offset_y: hookOffsetY,
          hook_offset_x: hookOffsetX,
          hook_scale: hookScale,
          ...(hookBoxWidth != null ? { hook_box_width: hookBoxWidth } : {}),
          render_mode: result.render_mode || stored.render_mode,
          reburning: false,
          reburn_started_at: null,
          reburned_at: new Date().toISOString(),
          clean_origin: "render",
        };
        const nextClips = baseClips.map((c, i) => (i === clipIndex ? updatedRow : c));
        const { error: updateErr } = await writeClips(nextClips);
        if (updateErr) {
          console.error("[clips/recut] update clips failed:", updateErr);
          await clearReburnFlag();
          return;
        }
        reburnMarked = false;
      };

      try {
        const recutPath = `${backendUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(backendJobId)}/clips/${clipIndex}/recut`;
        const backendRes = await fetchBackendWithRetry(
          recutPath,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-backend-secret": backendSecret,
            },
            body: JSON.stringify({
              source_url: sourceUrl,
              source_start: sourceStart,
              source_end: sourceEnd,
              start: clipStart,
              end: clipEnd,
              segments,
              style,
              format,
              hook: hookForBurn || null,
              layout: layoutBlocks[0]?.layout ?? layout,
              layout_blocks: layoutBlocks,
              render_mode: layoutBlocks[0]?.layout?.mode || layout?.mode || stored.render_mode,
              caption_offset_y: captionOffsetY,
              caption_offset_x: captionOffsetX,
              caption_scale: captionScale,
              ...(captionBoxWidth != null ? { caption_box_width: captionBoxWidth } : {}),
              hook_offset_y: hookOffsetY,
              hook_offset_x: hookOffsetX,
              hook_scale: hookScale,
              ...(hookBoxWidth != null ? { hook_box_width: hookBoxWidth } : {}),
              frontend_job_id: jobId,
              user_id: user.id,
              credits: creditsNeeded,
            }),
          },
          RECUT_START_TIMEOUT_MS,
          1
        );

        if (backendRes.status === 202) {
          const deadline = Date.now() + RECUT_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, RECUT_POLL_MS));
            let statusRes: Response;
            try {
              statusRes = await fetchBackendWithRetry(
                recutPath,
                {
                  method: "GET",
                  cache: "no-store",
                  headers: { "x-backend-secret": backendSecret },
                },
                20_000,
                2
              );
            } catch {
              continue;
            }
            const statusBody = (await statusRes.json().catch(() => ({}))) as {
              status?: string;
              error?: string;
              url?: string;
            };
            if (statusBody.status === "done" && statusBody.url?.startsWith("http")) {
              await persistSuccess(statusBody);
              return;
            }
            if (statusBody.status === "error") {
              await clearReburnFlag();
              console.error(
                "[clips/recut] backend error:",
                typeof statusBody.error === "string" ? statusBody.error : "RECUT_FAILED"
              );
              return;
            }
          }
          console.error(
            "[clips/recut] poll timed out — leaving reburning; backend may still finish"
          );
          return;
        }

        if (!backendRes.ok) {
          await clearReburnFlag();
          const errBody = await backendRes.json().catch(() => ({}));
          console.error(
            "[clips/recut] backend failed:",
            typeof errBody?.error === "string" ? errBody.error : backendRes.status
          );
          return;
        }

        const result = (await backendRes.json()) as { url?: string };
        await persistSuccess(result);
      } catch (err) {
        console.error("[clips/recut] after:", err);
      }
    });

    const pendingRow = markedClips[clipIndex] ?? {
      ...stored,
      reburning: true,
      reburn_started_at: new Date().toISOString(),
    };
    return NextResponse.json({
      accepted: true,
      clip: mapStoredClipToItem(pendingRow, jobId, clipIndex),
    });
  } catch (err) {
    console.error("[clips/recut]", err);
    if (revertReburn) {
      await revertReburn().catch(() => {});
    }
    return NextResponse.json(
      { error: "Erreur lors du recadrage." },
      { status: 500 }
    );
  }
}
