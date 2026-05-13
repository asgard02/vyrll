import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
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

    // Lister les clips pour tout utilisateur authentifié (RLS limite à ses propres jobs)
    // Tolère l'absence de la colonne video_title si la migration 012 n'est pas appliquée.
    let jobs = null;
    let error = null as unknown;

    const { data: jobsV13, error: errV13 } = await supabase
      .from("clip_jobs")
      .select("id, url, video_title, channel_title, duration, status, error, clips, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!errV13) {
      jobs = jobsV13;
    } else if ((errV13 as { code?: string }).code === "42703") {
      // video_title n'existe pas encore → fallback sans cette colonne
      const { data: jobsLegacy, error: errLegacy } = await supabase
        .from("clip_jobs")
        .select("id, url, duration, status, error, clips, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      jobs = jobsLegacy;
      error = errLegacy;
    } else {
      error = errV13;
    }

    if (error) {
      console.error("Clips list error:", error);
      return NextResponse.json(
        { error: "Erreur." },
        { status: 500 }
      );
    }

    return NextResponse.json({ jobs: jobs ?? [] });
  } catch (err) {
    console.error("Clips list error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
