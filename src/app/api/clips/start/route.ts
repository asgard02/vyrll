import { NextRequest, NextResponse } from "next/server";
import { isValidVideoUrl } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

const CLIPS_LIMIT_BY_PLAN: Record<string, number> = {
  free: 0,
  pro: 10,
  unlimited: 50,
};

// Plages (min, max) en secondes — découpe aux frontières de phrases, pas à la seconde fixe
const ALLOWED_DURATION_RANGES = [
  [15, 30],
  [30, 60],
  [60, 90],
  [90, 120],
] as const;

export async function POST(request: NextRequest) {
  try {
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
      .select("plan, clips_used, clips_limit")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profil non trouvé." },
        { status: 403 }
      );
    }

    if (profile.plan === "free") {
      return NextResponse.json(
        { error: "Les clips sont réservés aux plans Pro et supérieurs. Passe à l'upgrade." },
        { status: 403 }
      );
    }

    const limit =
      profile.clips_limit != null && profile.clips_limit > 0
        ? profile.clips_limit
        : CLIPS_LIMIT_BY_PLAN[profile.plan] ?? 0;
    const used = profile.clips_used ?? 0;
    if (used >= limit) {
      return NextResponse.json(
        { error: "Quota clips épuisé. Passe à l'upgrade pour en avoir plus." },
        { status: 403 }
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

    const body = await request.json();
    const url = body?.url?.trim();
    const durationMinRaw = body?.duration_min;
    const durationMaxRaw = body?.duration_max;
    const durationRaw = body?.duration;
    const styleRaw = body?.style;
    const ALLOWED_STYLES = [
      "karaoke", "highlight", "minimal", "deepdiver", "podp", "popline",
      "bounce", "beasty", "youshaei", "mozi", "glitch", "earthquake",
    ];
    const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "karaoke";

    if (!url) {
      return NextResponse.json(
        { error: "URL vidéo requise." },
        { status: 400 }
      );
    }

    if (!isValidVideoUrl(url)) {
      return NextResponse.json(
        { error: "URL YouTube ou Twitch invalide." },
        { status: 400 }
      );
    }

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
      ALLOWED_DURATION_RANGES.some(([, b]) => b === durationRaw)
    ) {
      const range = ALLOWED_DURATION_RANGES.find(([, b]) => b === durationRaw);
      if (range) {
        durationMin = range[0];
        durationMax = range[1];
      }
    }

    const formatRaw = body?.format;
    const format = formatRaw === "1:1" ? "1:1" : "9:16";

    const basePayload = {
      user_id: user.id,
      url,
      duration: durationMax,
      status: "pending",
      format,
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
      // Colonnes manquantes : migration 013 pas appliquée, fallback sans style/duration_min/max
      const fallbackPayload: Record<string, unknown> = {
        user_id: user.id,
        url,
        duration: durationMax,
        status: "pending",
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
        // format aussi absent (migration 010 pas appliquée), fallback strict
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

    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/jobs`, {
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
      }),
    });

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
