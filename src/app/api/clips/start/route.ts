import { NextRequest, NextResponse } from "next/server";
import { canonicalizeVideoUrlForClips, isValidVideoUrl } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
  isTransientBackendFetchError,
} from "@/lib/backend-fetch";
import { creditsForAutoMode, creditsForManualWindow } from "@/lib/clip-credits";
import { resolveVideoSourceMetadata } from "@/lib/video-source-metadata";

const CREDITS_LIMIT_BY_PLAN: Record<string, number> = {
  free: 30,
  creator: 150,
  studio: 400,
};

// Plages (min, max) en secondes — découpe aux frontières de phrases, pas à la seconde fixe
const ALLOWED_DURATION_RANGES = [
  [15, 30],
  [30, 60],
  [60, 90],
  [90, 120],
] as const;

const BACKEND_DURATION_TIMEOUT_MS = 45_000;
const BACKEND_JOBS_TIMEOUT_MS = 30_000;

export async function POST(request: NextRequest) {
  try {
    const t0 = Date.now();
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Authentification non configurée." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, credits_used, credits_limit")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profil non trouvé." },
        { status: 403 }
      );
    }
    console.log(`[clips/start] auth+profile ${Date.now() - t0}ms`);

    const limit =
      profile.credits_limit != null && profile.credits_limit > 0
        ? profile.credits_limit
        : CREDITS_LIMIT_BY_PLAN[profile.plan] ?? 30;
    const used = profile.credits_used ?? 0;

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    if (!backendUrl || !backendSecret) {
      return NextResponse.json(
        { error: "Service clips non configuré." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const urlRaw = body?.url?.trim();
    const uploadId: string | null =
      typeof body?.upload_id === "string" && body.upload_id.trim()
        ? body.upload_id.trim()
        : null;
    const uploadFilename: string =
      typeof body?.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : "upload.mp4";

    const isUpload = !!uploadId;

    if (!isUpload) {
      if (!urlRaw) {
        return NextResponse.json(
          { error: "URL vidéo requise." },
          { status: 400 }
        );
      }
      if (!isValidVideoUrl(urlRaw)) {
        return NextResponse.json(
          { error: "URL YouTube ou Twitch invalide." },
          { status: 400 }
        );
      }
    }

    const url = isUpload
      ? `upload://${uploadFilename}`
      : (canonicalizeVideoUrlForClips(urlRaw!) ?? urlRaw!);

    const durationMinRaw = body?.duration_min;
    const durationMaxRaw = body?.duration_max;
    const durationRaw = body?.duration;
    let durationMin = 30;
    let durationMax = 60;
    if (
      typeof durationMinRaw === "number" &&
      typeof durationMaxRaw === "number" &&
      ALLOWED_DURATION_RANGES.some(([a, b]) => a === durationMinRaw && b === durationMaxRaw)
    ) {
      durationMin = durationMinRaw;
      durationMax = durationMaxRaw;
    } else if (
      typeof durationRaw === "number" &&
      ALLOWED_DURATION_RANGES.some(([, b]) => b === Number(durationRaw))
    ) {
      const range = ALLOWED_DURATION_RANGES.find(([, b]) => b === Number(durationRaw));
      if (range) {
        durationMin = range[0];
        durationMax = range[1];
      }
    }

    const modeRaw = body?.mode;
    const mode: "auto" | "manual" = modeRaw === "manual" ? "manual" : "auto";
    const searchWindowStartSec: number | null =
      mode === "manual" && typeof body?.search_window_start_sec === "number"
        ? Math.max(0, Math.round(body.search_window_start_sec))
        : null;
    const searchWindowEndSec: number | null =
      mode === "manual" && typeof body?.search_window_end_sec === "number"
        ? Math.max(0, Math.round(body.search_window_end_sec))
        : null;

    let durationSec = 0;
    const t1 = Date.now();

    if (isUpload) {
      // Duration from backend upload-info
      try {
        const infoRes = await fetchBackendWithRetry(
          `${backendUrl.replace(/\/$/, "")}/upload-info/${uploadId}`,
          {
            method: "GET",
            headers: { "x-backend-secret": backendSecret },
          },
          10_000
        );
        const infoData = await infoRes.json().catch(() => ({}));
        if (!infoRes.ok) {
          return NextResponse.json(
            { error: (infoData as { error?: string }).error ?? "Upload introuvable ou expiré." },
            { status: infoRes.status === 404 ? 400 : infoRes.status }
          );
        }
        durationSec = Math.round(
          Number((infoData as { duration_seconds?: number }).duration_seconds) || 0
        );
      } catch {
        return NextResponse.json(
          { error: "Impossible de vérifier l'upload. Réessaie." },
          { status: 503 }
        );
      }
    } else {
      let durationRes: Response;
      try {
        durationRes = await fetchBackendWithRetry(
          `${backendUrl.replace(/\/$/, "")}/duration`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-backend-secret": backendSecret,
            },
            body: JSON.stringify({ url }),
          },
          BACKEND_DURATION_TIMEOUT_MS
        );
        console.log(`[clips/start] duration ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`);
      } catch (err: unknown) {
        const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
        if (name === "AbortError" || name === "TimeoutError") {
          return NextResponse.json(
            { error: "Délai dépassé en récupérant la durée de la vidéo. Réessaie." },
            { status: 504 }
          );
        }
        if (isTransientBackendFetchError(err)) {
          return NextResponse.json(
            {
              error:
                "Connexion au serveur clips interrompue (redémarrage ou surcharge). Réessaie dans quelques secondes.",
            },
            { status: 503 }
          );
        }
        throw err;
      }
      const durationData = await durationRes.json().catch(() => ({}));
      durationSec = Math.round(Number((durationData as { duration?: number }).duration) || 0);

      if (!durationRes.ok) {
        return NextResponse.json(
          {
            error:
              typeof (durationData as { error?: string }).error === "string" &&
              ((durationData as { error: string }).error).length > 0
                ? (durationData as { error: string }).error
                : "Impossible de récupérer la durée de la vidéo.",
          },
          { status: durationRes.status }
        );
      }
    }

    if (durationSec <= 0) {
      return NextResponse.json(
        { error: "Impossible de récupérer la durée de la vidéo." },
        { status: 400 }
      );
    }

    if (mode === "manual") {
      if (searchWindowStartSec == null || searchWindowEndSec == null) {
        return NextResponse.json(
          { error: "Indique le début et la fin de la zone sur la timeline (mode manuel)." },
          { status: 400 }
        );
      }
      if (searchWindowEndSec <= searchWindowStartSec) {
        return NextResponse.json(
          { error: "La fin de la zone doit être après le début." },
          { status: 400 }
        );
      }
      if (searchWindowEndSec > durationSec) {
        return NextResponse.json(
          { error: "La zone dépasse la durée de la vidéo." },
          { status: 400 }
        );
      }
      const minWindowSec = Math.min(durationMax, durationSec);
      if (searchWindowEndSec - searchWindowStartSec < minWindowSec) {
        return NextResponse.json(
          {
            error: `La zone doit couvrir au moins ${minWindowSec} s (pour permettre au moins un clip dans la plage choisie).`,
          },
          { status: 400 }
        );
      }
    }

    const searchWindowLenSec =
      mode === "manual" &&
      searchWindowStartSec != null &&
      searchWindowEndSec != null
        ? Math.max(0, searchWindowEndSec - searchWindowStartSec)
        : 0;
    const creditsNeeded =
      mode === "manual"
        ? creditsForManualWindow(searchWindowLenSec)
        : creditsForAutoMode(durationSec);

    if (creditsNeeded <= 0) {
      return NextResponse.json(
        {
          error:
            "Segment trop court : le début choisi est trop proche de la fin de la vidéo (ou la vidéo est trop courte).",
        },
        { status: 400 }
      );
    }

    if (used + creditsNeeded > limit) {
      const quotaDetail =
        mode === "manual"
          ? `la plage sur la timeline représente environ ${creditsNeeded} crédit${creditsNeeded > 1 ? "s" : ""} (≈ 1 crédit / min de plage, pas toute la vidéo)`
          : `la transcription couvre toute la vidéo (environ ${creditsNeeded} crédit${creditsNeeded > 1 ? "s" : ""}, ≈ 1 crédit / min)`;
      return NextResponse.json(
        {
          error: `Crédits insuffisants : ${quotaDetail}. Tu as ${used}/${limit} crédits.`,
        },
        { status: 402 }
      );
    }

    const styleRaw = body?.style;
    const ALLOWED_STYLES = [
      "karaoke",
      "highlight",
      "minimal",
      "neon",
      "ocean",
      "sunset",
      "slate",
      "berry",
      "deepdiver",
      "podp",
      "popline",
      "bounce",
      "beasty",
      "youshaei",
      "mozi",
      "glitch",
      "earthquake",
    ];
    const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "karaoke";

    const formatRaw = body?.format;
    const format = formatRaw === "1:1" ? "1:1" : "9:16";

    const basePayload: Record<string, unknown> = {
      user_id: user.id,
      url,
      duration: durationMax,
      status: "pending",
      format,
      source_duration_seconds: durationSec,
      render_mode: mode,
      ...(mode === "manual" &&
      searchWindowStartSec != null &&
      searchWindowEndSec != null
        ? {
            search_window_start_sec: searchWindowStartSec,
            search_window_end_sec: searchWindowEndSec,
          }
        : {}),
    };
    let job: { id: string } | null = null;
    let insertError: unknown = null;

    const { data: d1, error: e1 } = await supabase
      .from("clip_jobs")
      .insert({ ...basePayload, style, duration_min: durationMin, duration_max: durationMax })
      .select("id")
      .single();

    if (!e1 && d1) {
      job = d1;
    } else if (e1?.code === "PGRST204") {
      // Colonnes manquantes : migration 013/014 pas appliquée, fallback sans style/duration_min/max/source_duration
      const fallbackPayload: Record<string, unknown> = {
        user_id: user.id,
        url,
        duration: durationMax,
        status: "pending",
        source_duration_seconds: durationSec,
      };
      if (basePayload.format) fallbackPayload.format = basePayload.format;
      const { data: d2, error: e2 } = await supabase
        .from("clip_jobs")
        .insert(fallbackPayload)
        .select("id")
        .single();
      if (!e2 && d2) {
        job = d2;
      } else if (e2?.code === "PGRST204") {
        // format/source_duration_seconds absent (migration 010/014 pas appliquée), fallback strict
        const { data: d3, error: e3 } = await supabase
          .from("clip_jobs")
          .insert({ user_id: user.id, url, duration: durationMax, status: "pending" })
          .select("id")
          .single();
        job = d3;
        insertError = e3;
      } else {
        job = d2;
        insertError = e2;
      }
    } else {
      insertError = e1;
    }

    if (insertError || !job) {
      console.error("Clip job insert error:", insertError);
      return NextResponse.json(
        { error: "Erreur lors de la création du job." },
        { status: 500 }
      );
    }

    if (
      mode === "manual" &&
      searchWindowStartSec != null &&
      searchWindowEndSec != null
    ) {
      void supabase
        .from("clip_jobs")
        .update({
          search_window_start_sec: searchWindowStartSec,
          search_window_end_sec: searchWindowEndSec,
        })
        .eq("id", job.id)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) {
            console.warn("[clips/start] search_window columns missing or update failed:", error.message);
          }
        });
    }

    if (!isUpload) {
      void resolveVideoSourceMetadata(url)
        .then(async (meta) => {
          const payload: Record<string, string> = {};
          if (meta.video_title) payload.video_title = meta.video_title;
          if (meta.channel_title) payload.channel_title = meta.channel_title;
          if (meta.channel_thumbnail_url) payload.channel_thumbnail_url = meta.channel_thumbnail_url;
          if (Object.keys(payload).length === 0) return;
          const { error } = await supabase
            .from("clip_jobs")
            .update(payload)
            .eq("id", job.id)
            .eq("user_id", user.id);
          if (error && meta.video_title && (payload.channel_title || payload.channel_thumbnail_url)) {
            await supabase
              .from("clip_jobs")
              .update({ video_title: meta.video_title })
              .eq("id", job.id)
              .eq("user_id", user.id);
          }
        })
        .catch(() => {});
    }

    let res: Response;
    try {
      res = await fetchBackendWithRetry(
        `${backendUrl.replace(/\/$/, "")}/jobs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-backend-secret": backendSecret,
          },
          body: JSON.stringify({
            ...(isUpload ? { upload_id: uploadId } : { url }),
            duration_min: durationMin,
            duration_max: durationMax,
            format,
            style,
            mode,
            ...(mode === "manual" &&
            searchWindowStartSec != null &&
            searchWindowEndSec != null
              ? {
                  search_window_start_sec: searchWindowStartSec,
                  search_window_end_sec: searchWindowEndSec,
                }
              : {}),
          }),
        },
        BACKEND_JOBS_TIMEOUT_MS
      );
    } catch (err: unknown) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
      if (name === "AbortError" || name === "TimeoutError") {
        await supabase
          .from("clip_jobs")
          .update({ status: "error", error: "BACKEND_TIMEOUT" })
          .eq("id", job.id)
          .eq("user_id", user.id);
        return NextResponse.json(
          { error: "Le serveur clips ne répond pas à temps. Réessaie." },
          { status: 504 }
        );
      }
      if (isTransientBackendFetchError(err)) {
        await supabase
          .from("clip_jobs")
          .update({ status: "error", error: "BACKEND_SOCKET" })
          .eq("id", job.id)
          .eq("user_id", user.id);
        return NextResponse.json(
          {
            error:
              "Connexion au serveur clips interrompue. Réessaie (le backend a peut‑être redémarré).",
          },
          { status: 503 }
        );
      }
      throw err;
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await supabase
        .from("clip_jobs")
        .update({ status: "error", error: data.error ?? "BACKEND_ERROR" })
        .eq("id", job.id)
        .eq("user_id", user.id);
      return NextResponse.json(
        { error: data.error || "Erreur backend." },
        { status: res.status >= 500 ? 503 : res.status }
      );
    }

    const backendJobId = data.jobId ?? data.job_id ?? null;
    if (backendJobId) {
      await supabase
        .from("clip_jobs")
        .update({ backend_job_id: backendJobId })
        .eq("id", job.id)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error("Clips start error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
