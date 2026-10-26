import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { jobAwaitsMomentChoice } from "@/lib/clips/moments-ready";

export const dynamic = "force-dynamic";

type ReadyRow = {
  id?: string;
  video_title?: string | null;
  pipeline?: unknown;
  analyze_only?: boolean | null;
};

function readyTitle(row: ReadyRow): string {
  return typeof row.video_title === "string" ? row.video_title.trim() : "";
}

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
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const listed = await supabase
      .from("clip_jobs")
      .select("id, video_title, pipeline, analyze_only")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(20);

    const result =
      listed.error && (listed.error as { code?: string }).code === "42703"
        ? await supabase
            .from("clip_jobs")
            .select("id, video_title, pipeline")
            .eq("user_id", user.id)
            .in("status", ["pending", "processing"])
            .order("created_at", { ascending: false })
            .limit(20)
        : listed;

    if (result.error) {
      console.error("[moments-prets]", result.error);
      return NextResponse.json({ error: "Erreur." }, { status: 500 });
    }

    const jobs = ((result.data ?? []) as ReadyRow[])
      .filter(
        (row) =>
          row.analyze_only !== true &&
          typeof row.id === "string" &&
          jobAwaitsMomentChoice(row.pipeline)
      )
      .map((row) => ({
        id: row.id as string,
        title: readyTitle(row),
      }));

    return NextResponse.json(
      { jobs },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[moments-prets]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
