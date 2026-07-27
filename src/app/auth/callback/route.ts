import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";

function safeNextPath(raw: string | null): string {
  const next = raw ?? "/dashboard";
  if (
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\")
  ) {
    return next;
  }
  return "/dashboard";
}

const EMAIL_OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function asEmailOtpType(raw: string | null): EmailOtpType | null {
  if (!raw || !EMAIL_OTP_TYPES.has(raw)) return null;
  return raw as EmailOtpType;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = asEmailOtpType(searchParams.get("type"));
  const next = safeNextPath(searchParams.get("next"));
  const authError =
    searchParams.get("error") || searchParams.get("error_code");

  // Railway proxies to localhost internally — use NEXT_PUBLIC_SITE_URL if set
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || origin;

  // Supabase may bounce failed verify attempts back with error query params.
  if (authError) {
    return NextResponse.redirect(`${siteOrigin}/login?error=auth_callback`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(`${siteOrigin}/login?error=auth_callback`);
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(`${siteOrigin}${next}`);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // PKCE flow (default ConfirmationURL → redirect with ?code=)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return response;
    }
  }

  // Token-hash flow (custom email templates / some clients)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return response;
    }
  }

  return NextResponse.redirect(`${siteOrigin}/login?error=auth_callback`);
}
