import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
} from "@/lib/backend-fetch";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles, creditsLimitForPlan } from "@/lib/plan";
import {
  mapStoredClipToItem,
  type ClipTextSegment,
  type StoredClipRow,
} from "@/lib/clips/types";

const REBURN_TIMEOUT_MS = 900_000;
const REBURN_START_TIMEOUT_MS = 45_000;
const REBURN_POLL_MS = 2_000;

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
            "La régénération des sous-titres est réservée aux abonnés Creator et Studio.",
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
      .select(
        "id, user_id, status, clips, style, format, backend_job_id"
      )
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
    }

    if (job.status !== "done") {
      return NextResponse.json(
        { error: "Le projet n'est pas prêt pour une régénération." },
        { status: 409 }
      );
    }

    const rawClips = Array.isArray(job.clips) ? (job.clips as StoredClipRow[]) : [];
    if (clipIndex >= rawClips.length) {
      return NextResponse.json({ error: "Clip introuvable." }, { status: 404 });
    }

    const stored = rawClips[clipIndex];
    const cleanUrl = stored?.clean_url?.startsWith("http") ? stored.clean_url : null;
    if (!cleanUrl) {
      return NextResponse.json(
        {
          error:
            "Ce clip n'a pas de base vidéo sans sous-titres. La régénération n'est disponible que pour les clips générés récemment.",
          code: "CLEAN_BASE_MISSING",
        },
        { status: 400 }
      );
    }
    // Legacy Supabase Storage — ne plus télécharger (egress). Migrer le clip vers R2.
    try {
      if (new URL(cleanUrl).hostname.toLowerCase().includes("supabase")) {
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
        { error: "URL clean invalide.", code: "INVALID_CLEAN_URL" },
        { status: 400 }
      );
    }

    const clipStart = Number(stored.start);
    const clipEnd = Number(stored.end);
    const windowSec =
      Number.isFinite(clipStart) && Number.isFinite(clipEnd) && clipEnd > clipStart
        ? clipEnd - clipStart
        : Math.max(
            0,
            ...segments.map((s) => s.end)
          );
    const creditsNeeded = Math.max(1, creditsForManualWindow(windowSec));

    if (used + creditsNeeded > limit) {
      return NextResponse.json(
        {
          error: "Crédits insuffisants pour régénérer ce clip.",
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
    const format = job.format === "1:1" ? "1:1" : "9:16";
    // Client may send an edited banner title; otherwise keep the stored hook.
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
        console.error("[clips/regenerate] clear reburning failed:", error);
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
      console.error("[clips/regenerate] mark reburning failed:", markErr);
    } else {
      reburnMarked = true;
    }

    after(async () => {
      const persistSuccess = async (
        result: {
          url?: string;
          clean_url?: string;
          text?: string;
          segments?: ClipTextSegment[];
        },
        bill: boolean
      ) => {
        if (!result?.url?.startsWith("http")) {
          await clearReburnFlag();
          console.error("[clips/regenerate] invalid backend url");
          return;
        }
        if (bill) {
          const { error: billErr } = await admin.rpc("increment_credits_used", {
            p_user_id: user.id,
            p_credits: creditsNeeded,
          });
          if (billErr) {
            console.error("[clips/regenerate] increment_credits_used failed:", billErr);
          }
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
          console.error("[clips/regenerate] re-read clips failed:", latestErr);
        }
        const baseClips = Array.isArray(latest?.clips)
          ? (latest.clips as StoredClipRow[])
          : rawClips;
        const updatedRow: StoredClipRow = {
          ...(baseClips[clipIndex] ?? stored),
          url: result.url,
          clean_url: result.clean_url || cleanUrl,
          text: text || null,
          segments: Array.isArray(result.segments) ? result.segments : segments,
          hook: hookForBurn || null,
          reburning: false,
          reburn_started_at: null,
          reburned_at: new Date().toISOString(),
        };
        const nextClips = baseClips.map((c, i) => (i === clipIndex ? updatedRow : c));
        const { error: updateErr } = await writeClips(nextClips);
        if (updateErr) {
          console.error("[clips/regenerate] update clips failed:", updateErr);
          await clearReburnFlag();
          return;
        }
        reburnMarked = false;
      };

      try {
        const reburnPath = `${backendUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(backendJobId)}/clips/${clipIndex}/reburn-subs`;
        const backendRes = await fetchBackendWithRetry(
          reburnPath,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-backend-secret": backendSecret,
            },
            body: JSON.stringify({
              clean_url: cleanUrl,
              segments,
              style,
              format,
              hook: hookForBurn || null,
              duration: windowSec,
              frontend_job_id: jobId,
              user_id: user.id,
              credits: creditsNeeded,
            }),
          },
          REBURN_START_TIMEOUT_MS,
          1
        );

        if (backendRes.status === 202) {
          const deadline = Date.now() + REBURN_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, REBURN_POLL_MS));
            let statusRes: Response;
            try {
              statusRes = await fetchBackendWithRetry(
                reburnPath,
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
            const body = (await statusRes.json().catch(() => ({}))) as {
              status?: string;
              error?: string;
              url?: string;
              clean_url?: string;
              text?: string;
              segments?: ClipTextSegment[];
            };
            if (body.status === "done" && body.url?.startsWith("http")) {
              await persistSuccess(body, false);
              return;
            }
            if (body.status === "error") {
              await clearReburnFlag();
              console.error(
                "[clips/regenerate] backend error:",
                typeof body.error === "string" ? body.error : "REBURN_FAILED"
              );
              return;
            }
          }
          console.error(
            "[clips/regenerate] poll timed out — leaving reburning; backend may still finish"
          );
          return;
        }

        if (!backendRes.ok) {
          await clearReburnFlag();
          const errBody = await backendRes.json().catch(() => ({}));
          console.error(
            "[clips/regenerate] backend failed:",
            typeof errBody?.error === "string" ? errBody.error : backendRes.status
          );
          return;
        }

        const result = (await backendRes.json()) as {
          url?: string;
          clean_url?: string;
          text?: string;
          segments?: ClipTextSegment[];
        };
        await persistSuccess(result, true);
      } catch (err) {
        console.error("[clips/regenerate] after:", err);
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
    console.error("[clips/regenerate]", err);
    if (revertReburn) {
      await revertReburn().catch(() => {});
    }
    return NextResponse.json(
      { error: "Erreur lors de la régénération." },
      { status: 500 }
    );
  }
}
