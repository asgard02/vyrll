import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  isEmailNotConfirmedError,
  isOtpRateLimitError,
} from "@/lib/supabase/auth-errors";
import { resolveSiteOrigin } from "@/lib/supabase/auth-callback";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

function statelessAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Vérifie le mot de passe sans ouvrir de session navigateur, puis envoie le code.
 * La session n'est créée qu'au verifyOtp côté client.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (isRateLimited(`ip:${ip}`)) {
      return NextResponse.json({ code: "rate_limited" }, { status: 429 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ code: "unavailable" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email) {
      return NextResponse.json({ code: "email_required" }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ code: "email_invalid" }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ code: "password_required" }, { status: 400 });
    }
    if (isRateLimited(`email:${email}`)) {
      return NextResponse.json({ code: "rate_limited" }, { status: 429 });
    }

    const supabase = statelessAuth();
    if (!supabase) {
      return NextResponse.json({ code: "unavailable" }, { status: 503 });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      if (isEmailNotConfirmedError(error)) {
        await supabase.auth.signOut({ scope: "local" });
        return NextResponse.json({ code: "email_not_confirmed" }, { status: 403 });
      }
      return NextResponse.json({ code: "invalid_credentials" }, { status: 401 });
    }
    if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.json({ code: "email_not_confirmed" }, { status: 403 });
    }

    const { error: revokeError } = await supabase.auth.signOut({ scope: "local" });
    if (revokeError) {
      console.error("[login-code] revoke:", revokeError.message);
      return NextResponse.json({ code: "send_failed" }, { status: 502 });
    }

    const origin = resolveSiteOrigin(new URL(request.url), request.headers);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      },
    });
    if (otpError) {
      if (isOtpRateLimitError(otpError)) {
        return NextResponse.json({ code: "rate_limited" }, { status: 429 });
      }
      console.error("[login-code] otp:", otpError.message);
      return NextResponse.json({ code: "send_failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login-code]", err);
    return NextResponse.json({ code: "send_failed" }, { status: 500 });
  }
}
