import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  applyPasswordRecoveryCookie,
  createAuthRouteClient,
  isPasswordRecoveryFlow,
  parseEmailOtpType,
  resolveAuthRedirectPath,
  resolveSiteOrigin,
  safeNextPath,
} from "@/lib/supabase/auth-callback";

/**
 * Handles redirects from Supabase Auth (OAuth + email confirmation).
 *
 * Supports:
 * - PKCE `?code=` (Google OAuth + email ConfirmationURL flow)
 * - `?token_hash=&type=` (SSR-safe email confirm; works across browsers)
 *
 * Failure modes that previously looked like "link does nothing":
 * - PKCE code_verifier missing (email opened in Gmail in-app browser ≠ signup browser)
 * - Token already consumed by corporate Safe Links prefetch
 * - Existing session left intact → middleware bounced /login → /dashboard on another account
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = parseEmailOtpType(searchParams.get("type"));
  const requestedNext = safeNextPath(searchParams.get("next"));
  const next = resolveAuthRedirectPath(otpType, requestedNext);
  const recovery = isPasswordRecoveryFlow(otpType, requestedNext);
  const siteOrigin = resolveSiteOrigin(requestUrl, request.headers);

  const cookieStore = await cookies();
  const successRedirect = NextResponse.redirect(`${siteOrigin}${next}`);
  const supabase = createAuthRouteClient(cookieStore, successRedirect);

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (recovery) applyPasswordRecoveryCookie(successRedirect);
      return successRedirect;
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (!error) {
      if (recovery) applyPasswordRecoveryCookie(successRedirect);
      return successRedirect;
    }
    console.error("[auth/callback] verifyOtp failed:", error.message);
  } else {
    console.error(
      "[auth/callback] missing code/token_hash. params:",
      Object.fromEntries(searchParams.entries())
    );
  }

  // Drop any leftover session so middleware cannot hide the error behind another account.
  const failureRedirect = NextResponse.redirect(
    recovery
      ? `${siteOrigin}/forgot-password?error=invalid_link`
      : `${siteOrigin}/login?error=auth_callback`
  );
  const supabaseFail = createAuthRouteClient(cookieStore, failureRedirect);
  await supabaseFail.auth.signOut();
  return failureRedirect;
}
