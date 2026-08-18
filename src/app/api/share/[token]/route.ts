import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadSharedFolder } from "@/lib/clips/share";

function shareErrorMessage(status: 400 | 404 | 410) {
  if (status === 410) return "Ces clips ont expiré.";
  if (status === 400) return "Lien invalide.";
  return "Dossier introuvable.";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
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

    const { token } = await params;
    const result = await loadSharedFolder(createAdminClient(), token);
    if (!result.ok) {
      return NextResponse.json(
        { error: shareErrorMessage(result.status) },
        { status: result.status }
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error("Shared folder GET error:", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
