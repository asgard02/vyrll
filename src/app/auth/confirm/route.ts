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
 * SSR-safe email confirmation endpoint (recommended by Supabase).
 *
 * Point the Confirm signup template at:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard
 *
 * Unlike the PKCE `code` flow, this works when the user opens the email on a
 * different device/browser than the one used for signup.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const tokenHash = searchParams.get("token_hash");
  const otpType = parseEmailOtpType(searchParams.get("type"));
  const requestedNext = safeNextPath(searchParams.get("next"));
  const next = resolveAuthRedirectPath(otpType, requestedNext);
  const recovery = isPasswordRecoveryFlow(otpType, requestedNext);
  const siteOrigin = resolveSiteOrigin(requestUrl, request.headers);

  const cookieStore = await cookies();
  const successRedirect = NextResponse.redirect(`${siteOrigin}${next}`);

  if (tokenHash && otpType) {
    const supabase = createAuthRouteClient(cookieStore, successRedirect);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (!error) {
      if (recovery) applyPasswordRecoveryCookie(successRedirect);
      return successRedirect;
    }
    console.error("[auth/confirm] verifyOtp failed:", error.message);
  } else {
    console.error(
      "[auth/confirm] missing token_hash/type. params:",
      Object.fromEntries(searchParams.entries())
    );
  }

  const failureRedirect = NextResponse.redirect(
    recovery
      ? `${siteOrigin}/forgot-password?error=invalid_link`
      : `${siteOrigin}/login?error=auth_callback`
  );
  const supabaseFail = createAuthRouteClient(cookieStore, failureRedirect);
  await supabaseFail.auth.signOut();
  return failureRedirect;
}
