import { NextRequest, NextResponse } from "next/server";
import { canonicalizeVideoUrlForClips, isValidVideoUrl } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
  isTransientBackendFetchError,
} from "@/lib/backend-fetch";
import { creditsForAutoMode, creditsForClipJob } from "@/lib/clip-credits";

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

    const url = canonicalizeVideoUrlForClips(urlRaw) ?? urlRaw;

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
    const startTimeSec: number | null =
      mode === "manual" && typeof body?.start_time_sec === "number"
        ? Math.max(0, Math.round(body.start_time_sec))
        : null;

    const t1 = Date.now();
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
    const durationSec = Math.round(Number(durationData.duration) || 0);

    if (!durationRes.ok) {
      return NextResponse.json(
        {
          error:
            typeof durationData.error === "string" && durationData.error.length > 0
              ? durationData.error
              : "Impossible de récupérer la durée de la vidéo.",
        },
        { status: durationRes.status }
      );
    }
    if (durationSec <= 0) {
      return NextResponse.json(
        { error: "Impossible de récupérer la durée de la vidéo." },
        { status: 400 }
      );
    }

    const creditsNeeded =
      mode === "auto"
        ? creditsForAutoMode(durationSec)
        : creditsForClipJob({
            sourceDurationSec: durationSec,
            durationMaxSec: durationMax,
            mode,
            startTimeSec: mode === "manual" ? startTimeSec : null,
          });

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
      if (mode === "auto") {
        return NextResponse.json(
          {
            error: `Crédits insuffisants pour le mode automatique : la transcription couvre toute la vidéo (environ ${creditsNeeded} crédit${creditsNeeded > 1 ? "s" : ""}, ≈ 1 crédit / min). Tu as ${used}/${limit} crédits. Ajoute des crédits ou passe en mode manuel pour ne facturer que l’extrait choisi.`,
          },
          { status: 402 }
        );
      }
      return NextResponse.json(
        {
          error: `Crédits insuffisants. Ce clip consomme environ ${creditsNeeded} crédit${creditsNeeded > 1 ? "s" : ""} (durée d’extrait). Tu as ${used}/${limit} crédits.`,
        },
        { status: 403 }
      );
    }

    const styleRaw = body?.style;
    const ALLOWED_STYLES = [
      "karaoke", "highlight", "minimal", "deepdiver", "podp", "popline",
      "bounce", "beasty", "youshaei", "mozi", "glitch", "earthquake",
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
      ...(startTimeSec != null ? { start_time_sec: startTimeSec } : {}),
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
            url,
            duration_min: durationMin,
            duration_max: durationMax,
            format,
            style,
            mode,
            ...(startTimeSec != null ? { start_time_sec: startTimeSec } : {}),
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
