import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ID manquant." }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Historique non configuré." }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Analyse introuvable." }, { status: 404 });
    }

    const result = (data.result as { diagnosis?: unknown; videoData?: unknown }) ?? {};
    const diagnosis = result.diagnosis;
    const videoData = result.videoData as Record<string, unknown> | undefined;
    const channelTitle = videoData?.channelTitle ?? data.video_title ?? "";
    const duration = (videoData?.duration as string) ?? "";
    const status = (data.status as string) ?? "completed";

    return NextResponse.json({
      id: data.id,
      video_id: data.video_id,
      video_url: data.video_url,
      video_title: data.video_title,
      channel_title: channelTitle,
      view_count: data.view_count,
      duration,
      score: data.score ?? 0,
      diagnosis,
      video_data: videoData ?? {},
      created_at: data.created_at,
      status,
      error_message: data.error_message ?? null,
    });
  } catch (err) {
    console.error("History [id] API error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ID manquant." }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Historique non configuré." }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { error } = await supabase
      .from("analyses")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("History delete error:", error);
      return NextResponse.json(
        { error: "Erreur lors de la suppression." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("History delete API error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
