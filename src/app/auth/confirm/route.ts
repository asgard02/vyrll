import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Endpoint for the Supabase "Confirm signup" email template (SSR / PKCE).
 *
 * Dashboard → Authentication → Email Templates → Confirm signup must use:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
 *
 * (`type=email` is also accepted.)
 */
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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const typeRaw = searchParams.get("type");
  const type =
    typeRaw && EMAIL_OTP_TYPES.has(typeRaw)
      ? (typeRaw as EmailOtpType)
      : null;
  const next = safeNextPath(searchParams.get("next"));

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || origin;
  const fail = NextResponse.redirect(`${siteOrigin}/login?error=auth_callback`);

  if (!tokenHash || !type) {
    return fail;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return fail;
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

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    return fail;
  }

  return response;
}
