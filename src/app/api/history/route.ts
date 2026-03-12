import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json([]);
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

    const { data, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase analyses fetch error:", error);
      return NextResponse.json(
        { error: "Erreur lors du chargement de l'historique." },
        { status: 500 }
      );
    }

    const items = (data ?? []).map((row) => {
      const result = (row.result as { diagnosis?: unknown; videoData?: unknown }) ?? {};
      const videoData = result.videoData as Record<string, unknown> | undefined;
      const status = (row.status as string) ?? "completed";
      return {
        id: row.id,
        video_id: row.video_id,
        video_url: row.video_url,
        video_title: row.video_title ?? (status === "pending" || status === "processing" ? "En cours..." : ""),
        channel_title: videoData?.channelTitle ?? "",
        view_count: row.view_count ?? "",
        duration: (videoData?.duration as string) ?? "",
        score: row.score ?? 0,
        diagnosis: result.diagnosis ?? {},
        video_data: videoData ?? {},
        created_at: row.created_at,
        status,
      };
    });

    return NextResponse.json(items);
  } catch (err) {
    console.error("History API error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
