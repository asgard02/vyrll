import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
  isTransientBackendFetchError,
} from "@/lib/backend-fetch";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles, creditsLimitForPlan } from "@/lib/plan";
import {
  mapStoredClipToItem,
  type ClipTextSegment,
  type StoredClipRow,
} from "@/lib/clips/types";
import { emojiStyleFromRequest } from "@/lib/emoji-style";

const REBURN_TIMEOUT_MS = 180_000;

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

    let backendRes: Response;
    try {
      backendRes = await fetchBackendWithRetry(
        `${backendUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(backendJobId)}/clips/${clipIndex}/reburn-subs`,
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
            emoji_style: emojiStyleFromRequest(body, request.headers.get("user-agent")),
          }),
        },
        REBURN_TIMEOUT_MS,
        1
      );
    } catch (err) {
      await clearReburnFlag();
      if (isTransientBackendFetchError(err)) {
        return NextResponse.json(
          { error: "Connexion au serveur clips interrompue. Réessaie." },
          { status: 503 }
        );
      }
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name?: string }).name)
          : "";
      if (name === "AbortError" || name === "TimeoutError") {
        return NextResponse.json(
          { error: "La régénération a pris trop de temps. Réessaie." },
          { status: 504 }
        );
      }
      throw err;
    }

    if (!backendRes.ok) {
      await clearReburnFlag();
      const errBody = await backendRes.json().catch(() => ({}));
      const msg =
        typeof errBody?.error === "string"
          ? errBody.error
          : "Échec de la régénération des sous-titres.";
      return NextResponse.json(
        { error: msg.slice(0, 400) },
        { status: backendRes.status >= 400 && backendRes.status < 600 ? backendRes.status : 502 }
      );
    }

    const result = (await backendRes.json()) as {
      url?: string;
      clean_url?: string;
      text?: string;
      segments?: ClipTextSegment[];
    };

    if (!result?.url?.startsWith("http")) {
      await clearReburnFlag();
      return NextResponse.json(
        { error: "Réponse backend invalide." },
        { status: 502 }
      );
    }

    // Charge credits only after successful reburn (service_role — reliable vs auth.uid RPC)
    const { error: billErr } = await admin.rpc("increment_credits_used", {
      p_user_id: user.id,
      p_credits: creditsNeeded,
    });
    if (billErr) {
      console.error("[clips/regenerate] increment_credits_used failed:", billErr);
      // Clip already uploaded — still persist metadata; warn client about billing
    }

    const text =
      result.text?.trim() ||
      segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

    const reburnedAt = new Date().toISOString();
    const updatedRow: StoredClipRow = {
      ...stored,
      url: result.url,
      clean_url: result.clean_url || cleanUrl,
      text: text || null,
      segments: Array.isArray(result.segments) ? result.segments : segments,
      hook: hookForBurn || null,
      reburning: false,
      reburn_started_at: null,
      reburned_at: reburnedAt,
    };

    const nextClips = rawClips.map((c, i) => (i === clipIndex ? updatedRow : c));
    const { error: updateErr } = await writeClips(nextClips);

    if (updateErr) {
      console.error("[clips/regenerate] update clips failed:", updateErr);
      await clearReburnFlag();
      return NextResponse.json(
        { error: "Clip régénéré mais mise à jour du projet échouée." },
        { status: 500 }
      );
    }
    reburnMarked = false;

    const clip = mapStoredClipToItem(updatedRow, jobId, clipIndex);

    return NextResponse.json({
      clip,
      creditsCharged: billErr ? 0 : creditsNeeded,
      billingWarning: billErr
        ? "Clip mis à jour mais le débit de crédits a échoué."
        : undefined,
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
