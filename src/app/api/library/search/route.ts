import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { clampK, searchLibraryMoments } from "@/lib/library-search";

export async function POST(request: NextRequest) {
  const t0 = Date.now();
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
    }
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const query = typeof rec.query === "string" ? rec.query.trim() : "";
    if (!query) {
      return NextResponse.json({ error: "query requis." }, { status: 400 });
    }
    const k = clampK(rec.k);
    const scope = rec.scope === "library" || rec.scope == null ? "library" : String(rec.scope);
    if (scope !== "library") {
      return NextResponse.json({ error: "scope non supporté." }, { status: 400 });
    }

    const { moments, took_ms, fts_hits } = await searchLibraryMoments(supabase, {
      query,
      k,
      scope,
    });

    const ms = Date.now() - t0;
    console.log(
      `[library-search] user=${user.id} q="${query.slice(0, 80)}" k=${k} ` +
        `hits=${fts_hits} moments=${moments.length} search_ms=${took_ms} ` +
        `total_ms=${ms} embedding_tokens=0`
    );

    const res = NextResponse.json({ moments });
    res.headers.set("X-Library-Search-Ms", String(took_ms));
    return res;
  } catch (err) {
    console.error("library/search error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
