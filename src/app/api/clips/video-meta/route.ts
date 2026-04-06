import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { resolveVideoSourceMetadata } from "@/lib/video-source-metadata";
import { canonicalizeVideoUrlForClips } from "@/lib/youtube";

/**
 * Résout titre / chaîne pour une URL (oEmbed / YouTube API).
 * Si `jobId` est fourni et que le job appartient à l’utilisateur, persiste `video_title` en base.
 */
export async function GET(req: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Authentification non configurée." },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const rawUrl = searchParams.get("url");
    const jobId = searchParams.get("jobId");

    if (!rawUrl?.trim()) {
      return NextResponse.json({ error: "Paramètre url requis." }, { status: 400 });
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    if (jobId) {
      const { data: row, error: rowErr } = await supabase
        .from("clip_jobs")
        .select("id, user_id")
        .eq("id", jobId)
        .maybeSingle();

      if (rowErr || !row || row.user_id !== user.id) {
        return NextResponse.json({ error: "Interdit." }, { status: 403 });
      }
    }

    const canonical = canonicalizeVideoUrlForClips(rawUrl) ?? rawUrl;
    const meta = await resolveVideoSourceMetadata(canonical);

    const title = meta.video_title?.trim() ?? null;
    if (jobId && title) {
      await supabase
        .from("clip_jobs")
        .update({ video_title: title })
        .eq("id", jobId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      video_title: meta.video_title,
      channel_title: meta.channel_title,
      channel_thumbnail_url: meta.channel_thumbnail_url,
    });
  } catch (err) {
    console.error("video-meta error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
