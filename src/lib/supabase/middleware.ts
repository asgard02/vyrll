import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerUser } from "@/lib/supabase/server-user";

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/waitlist" ||
    pathname === "/api/webhooks/lemonsqueezy" ||
    pathname === "/api/webhooks/stripe"
  );
}

function isPublicPagePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/mentions-legales" ||
    pathname === "/confidentialite" ||
    pathname === "/cgu" ||
    pathname === "/plans" ||
    pathname === "/newsletter" ||
    pathname.startsWith("/newsletter/")
  );
}

function isVerifyEmailPath(pathname: string): boolean {
  return pathname === "/verify-email" || pathname.startsWith("/verify-email/");
}

function isAuthCallbackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/confirm")
  );
}

/** Cookies de session Supabase SSR (y compris chunks `sb-*-auth-token.0`). */
function isSupabaseAuthCookie(name: string): boolean {
  return (
    name.startsWith("sb-") &&
    (name.includes("-auth-token") || name.includes("-auth-code-verifier"))
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  // Les redirections / JSON d’erreur doivent reprendre les cookies posés sur
  // `response` (purge de session, refresh) sinon le navigateur garde des
  // cookies périmés et rejoue refresh_token_not_found à chaque requête.
  const copySessionCookies = (target: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    return copySessionCookies(NextResponse.redirect(url));
  };

  const jsonWithSessionCookies = (body: unknown, init: { status: number }) =>
    copySessionCookies(NextResponse.json(body, init));

  /** Filet de sécurité si signOut local n’a pas tout effacé (tokens chunkés). */
  const forceClearAuthCookies = () => {
    for (const { name } of request.cookies.getAll()) {
      if (!isSupabaseAuthCookie(name)) continue;
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  const pathname = request.nextUrl.pathname;
  const method = request.method;

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const isPublicPage = isPublicPagePath(pathname);

  if (!supabaseUrl || !supabaseAnonKey) {
    if (!isAuthPage && !isPublicPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { user, purgedInvalidSession } = await getServerUser(supabase);
  if (purgedInvalidSession) {
    forceClearAuthCookies();
  }
  const emailVerified = Boolean(user?.email_confirmed_at);

  // --- API : routes publiques sans session ---
  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      return response;
    }
    if (!user) {
      return jsonWithSessionCookies(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }
    if (!emailVerified) {
      if (pathname === "/api/profile" && method === "GET") {
        return response;
      }
      return jsonWithSessionCookies(
        { error: "Adresse email non vérifiée." },
        { status: 403 }
      );
    }
    return response;
  }

  // --- Pas de session ---
  if (!user) {
    if (isAuthCallbackPath(pathname) || isVerifyEmailPath(pathname)) {
      return response;
    }
    if (isAuthPage || isPublicPage) {
      return response;
    }
    return redirectTo("/login");
  }

  // --- Session mais email non vérifié ---
  if (!emailVerified) {
    if (
      isVerifyEmailPath(pathname) ||
      isAuthCallbackPath(pathname)
    ) {
      return response;
    }
    return redirectTo("/verify-email");
  }

  // --- Email vérifié ---
  // Keep /login?error=auth_callback visible (failed email link). Otherwise a
  // leftover session hides the failure by bouncing straight to /dashboard.
  if (isAuthPage || isVerifyEmailPath(pathname)) {
    const authError = request.nextUrl.searchParams.get("error");
    if (pathname === "/login" && authError === "auth_callback") {
      return response;
    }
    return redirectTo("/dashboard");
  }

  // Connecté : seule la landing redirige vers le dashboard. Les autres pages
  // publiques (/plans, CGU, mentions légales…) restent consultables.
  if (pathname === "/") {
    return redirectTo("/dashboard");
  }

  return response;
}
