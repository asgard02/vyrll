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

    const { data: job, error: insertError } = await supabase
      .from("clip_jobs")
      .insert({
        user_id: user.id,
        url,
        duration: durationMax,
        status: "pending",
      })
      .select("id")
      .single();

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
