import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  PASSWORD_RECOVERY_COOKIE,
  clearPasswordRecoveryCookie,
} from "@/lib/supabase/auth-callback";

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Non configuré." }, { status: 503 });
    }

    const cookieStore = await cookies();
    if (cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value !== "1") {
      return NextResponse.json(
        { error: "Session de réinitialisation introuvable." },
        { status: 403 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Le mot de passe doit faire au moins 6 caractères." },
        { status: 400 }
      );
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return NextResponse.json(
        { error: error.message || "Impossible de mettre à jour le mot de passe." },
        { status: 400 }
      );
    }

    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch {
      // Best-effort: other sessions may remain until they expire.
    }

    const response = NextResponse.json({ success: true });
    clearPasswordRecoveryCookie(response);
    return response;
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
