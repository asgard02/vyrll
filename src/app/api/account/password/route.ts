import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";

function createAnonAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
  if (!url || !anon) {
    throw new Error("Supabase anon key missing");
  }
  return createSupabaseJsClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Non configuré." }, { status: 503 });
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const currentPassword =
      typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body?.newPassword === "string" ? body.newPassword : "";

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Le mot de passe doit faire au moins 6 caractères." },
        { status: 400 }
      );
    }

    const hasEmailIdentity = (user.identities ?? []).some(
      (i) => i.provider === "email"
    );
    const email = user.email?.trim();

    if (hasEmailIdentity) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Mot de passe actuel requis." },
          { status: 400 }
        );
      }
      if (!email) {
        return NextResponse.json(
          { error: "Email manquant sur le compte." },
          { status: 400 }
        );
      }

      const verifier = createAnonAuthClient();
      const { error: verifyError } = await verifier.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyError) {
        return NextResponse.json(
          { error: "Mot de passe actuel incorrect." },
          { status: 403 }
        );
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return NextResponse.json(
        { error: error.message || "Impossible de changer le mot de passe." },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[account password]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}
