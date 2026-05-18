import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Échange le code PKCE après clic sur le lien de confirmation email (redirect Supabase).
 * À configurer dans Supabase : Authentication → URL de redirection → inclure /auth/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const url = new URL("/login", origin);
  url.searchParams.set("error", "auth_callback");
  return NextResponse.redirect(url);
}
