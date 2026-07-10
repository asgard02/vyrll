import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerUser } from "@/lib/supabase/server-user";

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/waitlist" || pathname === "/api/debug/db";
}

function isPublicPagePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/mentions-legales" ||
    pathname === "/confidentialite" ||
    pathname === "/cgu" ||
    pathname === "/plans"
  );
}

function isVerifyEmailPath(pathname: string): boolean {
  return pathname === "/verify-email" || pathname.startsWith("/verify-email/");
}

function isAuthCallbackPath(pathname: string): boolean {
  return pathname.startsWith("/auth/callback");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  // Les redirections doivent reprendre les cookies posés sur `response`
  // (purge de session, refresh) sinon le navigateur garde des cookies périmés.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
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

  const { user } = await getServerUser(supabase);
  const emailVerified = Boolean(user?.email_confirmed_at);

  // --- API : routes publiques sans session ---
  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      return response;
    }
    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }
    if (!emailVerified) {
      if (pathname === "/api/profile" && method === "GET") {
        return response;
      }
      return NextResponse.json(
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
  if (isAuthPage || isVerifyEmailPath(pathname)) {
    return redirectTo("/dashboard");
  }

  // Connecté : seule la landing redirige vers le dashboard. Les autres pages
  // publiques (/plans, CGU, mentions légales…) restent consultables.
  if (pathname === "/") {
    return redirectTo("/dashboard");
  }

  return response;
}
