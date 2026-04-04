import { NextRequest, NextResponse } from "next/server";
import { canonicalizeVideoUrlForClips, isValidVideoUrl } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchBackendWithRetry,
  isTransientBackendFetchError,
} from "@/lib/backend-fetch";
import { creditsForClipJob } from "@/lib/clip-credits";

const BACKEND_DURATION_TIMEOUT_MS = 60_000;

/** GET /api/clips/estimate-duration?url=... — retourne durée (s) et crédits estimés pour l'UI */
export async function GET(request: NextRequest) {
  try {
    const t0 = Date.now();
    const rawUrl = request.nextUrl.searchParams.get("url")?.trim();
    if (!rawUrl || !isValidVideoUrl(rawUrl)) {
      return NextResponse.json({ error: "URL invalide" }, { status: 400 });
    }
    const url = canonicalizeVideoUrlForClips(rawUrl) ?? rawUrl;

    const durationMaxParam = request.nextUrl.searchParams.get("duration_max");
    const durationMaxSec = Math.max(1, Math.round(Number(durationMaxParam) || 60));
    const modeParam = request.nextUrl.searchParams.get("mode");
    const mode: "auto" | "manual" = modeParam === "manual" ? "manual" : "auto";
    const startSecRaw = request.nextUrl.searchParams.get("start_sec");
    const startTimeSec =
      mode === "manual" && startSecRaw != null && startSecRaw !== ""
        ? Math.max(0, Math.round(Number(startSecRaw)))
        : null;

    if (!isSupabaseConfigured()) {
      return NextResponse.json(null);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    console.log(`[estimate-duration] auth ${Date.now() - t0}ms`);

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    if (!backendUrl || !backendSecret) {
      return NextResponse.json(null);
    }

    const t1 = Date.now();
    const res = await fetchBackendWithRetry(
      `${backendUrl.replace(/\/$/, "")}/duration`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-backend-secret": backendSecret,
        },
        body: JSON.stringify({ url }),
      },
      BACKEND_DURATION_TIMEOUT_MS,
      1
    );
    console.log(`[estimate-duration] backend ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Erreur" }, { status: res.status });
    }

    const durationSec = Math.round(Number(data.duration) || 0);
    const credits = creditsForClipJob({
      sourceDurationSec: durationSec,
      durationMaxSec: durationMaxSec,
      mode,
      startTimeSec,
    });

    return NextResponse.json({ duration: durationSec, credits });
  } catch (err: unknown) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return NextResponse.json(
        { error: "Délai dépassé en récupérant la durée. Réessaie ou vérifie le backend." },
        { status: 504 }
      );
    }
    if (isTransientBackendFetchError(err)) {
      return NextResponse.json(
        { error: "Connexion au serveur clips interrompue. Réessaie dans quelques secondes." },
        { status: 503 }
      );
    }
    return NextResponse.json(null);
  }
}
