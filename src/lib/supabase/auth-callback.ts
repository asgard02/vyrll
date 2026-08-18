import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth-next-path";

export { safeNextPath };

export function resolveSiteOrigin(
  requestUrl: URL,
  headers?: Headers
): string {
  // Prefer the public host the browser actually hit (Railway/proxy → localhost).
  const forwardedHost = headers?.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    const proto =
      headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost}`.replace(/\/$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return requestUrl.origin;
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function createAuthRouteClient(
  cookieStore: { getAll: () => { name: string; value: string }[] },
  response: NextResponse
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

const OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  if (!raw || !OTP_TYPES.has(raw)) return null;
  return raw as EmailOtpType;
}
