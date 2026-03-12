import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { extractVideoId } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { processAnalysisInBackground } from "@/lib/analyze-process";
import { logRouteBeforeAfter, verifyEnvConfig } from "@/lib/analyze-diagnostics";

export type { DiagnosisJSON } from "@/lib/analysis";

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

    let { data: profile } = await supabase
      .from("profiles")
      .select("analyses_used, analyses_limit")
      .eq("id", user.id)
      .single();

    if (!profile && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        await admin.from("profiles").insert({
          id: user.id,
          email: user.email,
          username: user.user_metadata?.username ?? user.email?.split("@")[0],
          plan: "free",
          analyses_used: 0,
          analyses_limit: 3,
        });
        profile = { analyses_used: 0, analyses_limit: 3 };
      } catch {
        const { data: retry } = await supabase
          .from("profiles")
          .select("analyses_used, analyses_limit")
          .eq("id", user.id)
          .single();
        profile = retry ?? null;
      }
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profil non trouvé. Réessaie de te connecter." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const url = body?.url?.trim();

    if (!url) {
      return NextResponse.json(
        { error: "Champ vide." },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "URL invalide." },
        { status: 400 }
      );
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: "Erreur de configuration serveur." },
        { status: 500 }
      );
    }

    const envCheck = verifyEnvConfig();
    if (!envCheck.ok) {
      console.warn("[ANALYZE-DIAG] config env incomplète:", envCheck.details);
    } else {
      console.log("[ANALYZE-DIAG] config env OK:", envCheck.details.join(" | "));
    }

    const { data: existing } = await supabase
      .from("analyses")
      .select("id, updated_at, status")
      .eq("user_id", user.id)
      .eq("video_id", videoId)
      .single();

    if (existing) {
      const REANALYZE_COOLDOWN_HOURS = 24;
      const updatedAt = existing.updated_at as string | null;
      if (updatedAt && existing.status === "completed") {
        const lastUpdate = new Date(updatedAt).getTime();
        const now = Date.now();
        const hoursSince = (now - lastUpdate) / (1000 * 60 * 60);
        if (hoursSince < REANALYZE_COOLDOWN_HOURS) {
          const remaining = Math.ceil(REANALYZE_COOLDOWN_HOURS - hoursSince);
          return NextResponse.json(
            { error: `Re-analyse possible dans ${remaining}h.` },
            { status: 429 }
          );
        }
      }

      if (profile.analyses_used >= profile.analyses_limit) {
        return NextResponse.json(
          { error: "Quota d'analyses atteint. Passe à un plan supérieur." },
          { status: 403 }
        );
      }

      const { error: updateError } = await supabase
        .from("analyses")
        .update({
          video_url: url,
          status: "pending",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Supabase analyses update error:", updateError);
        return NextResponse.json(
          { error: "Erreur lors de la mise à jour." },
          { status: 500 }
        );
      }

      after(async () => {
        logRouteBeforeAfter(existing.id, videoId, user.id, "update");
        await new Promise((r) => setTimeout(r, 150));
        await processAnalysisInBackground(existing.id, {
          videoId,
          userId: user.id,
        });
      });

      return NextResponse.json({
        success: true,
        id: existing.id,
        videoId,
        status: "pending",
        updated: true,
      } as const);
    }

    if (profile.analyses_used >= profile.analyses_limit) {
      return NextResponse.json(
        { error: "Quota d'analyses atteint. Passe à un plan supérieur." },
        { status: 403 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("analyses")
      .insert({
        user_id: user.id,
        video_url: url,
        video_id: videoId,
        video_title: null,
        video_thumbnail: null,
        view_count: null,
        subscriber_count: null,
        score: null,
        result: {},
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Supabase analyses insert error:", insertError);
      return NextResponse.json(
        { error: "Erreur lors de la sauvegarde." },
        { status: 500 }
      );
    }

    after(async () => {
      logRouteBeforeAfter(inserted!.id, videoId, user.id, "insert");
      await new Promise((r) => setTimeout(r, 150));
      await processAnalysisInBackground(inserted!.id, {
        videoId,
        userId: user.id,
      });
    });

    return NextResponse.json({
      success: true,
      id: inserted?.id,
      videoId,
      status: "pending",
    } as const);
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
