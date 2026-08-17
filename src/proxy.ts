import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip upload : le proxy clone/buffer le body (limite 10 Mo par défaut) et casse
    // le multipart relayé vers Multer (« Unexpected end of form »).
    "/((?!_next/static|_next/image|favicon.ico|api/clips/upload|.*\\.(?:svg|png|ico|jpg|jpeg|gif|webp|mp4|webm|html)$).*)",
  ],
};
