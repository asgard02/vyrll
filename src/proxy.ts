import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** Next.js RSC headers. If they ride on a real document navigation, Chrome/Safari
 *  download `text/x-component` as a file (`upgrade.html`) instead of opening the page. */
const RSC_HEADERS = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
] as const;

function isDocumentNavigation(request: NextRequest): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");
  return (
    dest === "document" ||
    dest === "iframe" ||
    dest === "frame" ||
    mode === "navigate"
  );
}

function headersForDownstream(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  if (!isDocumentNavigation(request)) return headers;
  for (const key of RSC_HEADERS) headers.delete(key);
  return headers;
}

export async function proxy(request: NextRequest) {
  const response = await updateSession(
    request,
    headersForDownstream(request)
  );

  // Cursor / some webviews omit Sec-Fetch-Dest, then treat the HTML as a file
  // (`projets.html` in ~/Downloads). Fetch() ignores Content-Disposition.
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Content-Disposition", "inline");
  }

  return response;
}

export const config = {
  matcher: [
    // Skip upload : le proxy clone/buffer le body (limite 10 Mo par défaut) et casse
    // le multipart relayé vers Multer (« Unexpected end of form »).
    "/((?!_next/static|_next/image|favicon.ico|api/clips/upload|.*\\.(?:svg|png|ico|jpg|jpeg|gif|webp|mp4|webm|html)$).*)",
  ],
};
