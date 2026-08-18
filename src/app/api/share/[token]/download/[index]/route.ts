import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadSharedFolder } from "@/lib/clips/share";
import {
  clipAttachmentName,
  isAllowedClipUrl,
  streamClipFromUrl,
} from "@/lib/clips/proxy-clip";

export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; index: string }> }
) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Service non configuré." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { token, index } = await params;
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) {
      return NextResponse.json({ error: "Index invalide." }, { status: 400 });
    }

    const result = await loadSharedFolder(createAdminClient(), token);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.status === 410 ? "Ces clips ont expiré." : "Dossier introuvable." },
        { status: result.status }
      );
    }

    const clip = result.data.clips[idx];
    const clipUrl = clip?.directUrl;
    if (!clipUrl?.startsWith("http") || !isAllowedClipUrl(clipUrl)) {
      return NextResponse.json(
        { error: "Fichier clip introuvable." },
        { status: 404 }
      );
    }

    return streamClipFromUrl(clipUrl, request, {
      filename: clipAttachmentName(idx),
      disposition: "attachment",
    });
  } catch (err) {
    console.error("Shared clip download error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
