import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/waitlist" || pathname === "/api/debug/db";
}

function isPublicPagePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/register";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    if (isVerifyEmailPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (isAuthPage || isPublicPage) {
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // --- Session mais email non vérifié ---
  if (!emailVerified) {
    if (
      isVerifyEmailPath(pathname) ||
      isAuthCallbackPath(pathname)
    ) {
      return response;
    }
    if (isAuthPage || isPublicPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/verify-email";
      return NextResponse.redirect(url);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    return NextResponse.redirect(url);
  }

  // --- Email vérifié ---
  if (isAuthPage || isVerifyEmailPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
