import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";

const BACKEND_UPLOAD_TIMEOUT_MS = 120_000;
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Authentification non configurée." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    if (!backendUrl || !backendSecret) {
      return NextResponse.json(
        { error: "Service clips non configuré." },
        { status: 503 }
      );
    }

    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type multipart/form-data requis." },
        { status: 400 }
      );
    }

    // Buffer entier : le stream duplex vers Multer se coupe souvent (proxy / undici)
    // → « Unexpected end of form ». Content-Length explicite évite ça.
    const bodyBuf = Buffer.from(await request.arrayBuffer());
    if (bodyBuf.byteLength === 0) {
      return NextResponse.json(
        { error: "Fichier vide ou upload interrompu. Réessaie." },
        { status: 400 }
      );
    }
    if (bodyBuf.byteLength > UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: `Fichier trop volumineux (max ${UPLOAD_MAX_BYTES / 1024 / 1024} Mo).` },
        { status: 413 }
      );
    }

    const uploadRes = await fetch(
      `${backendUrl.replace(/\/$/, "")}/upload`,
      {
        method: "POST",
        headers: {
          "x-backend-secret": backendSecret,
          "content-type": contentType,
          "content-length": String(bodyBuf.byteLength),
        },
        body: bodyBuf,
        signal: AbortSignal.timeout(BACKEND_UPLOAD_TIMEOUT_MS),
      }
    );

    const data = await uploadRes.json().catch(() => ({}));

    if (!uploadRes.ok) {
      const raw = (data as { error?: string }).error || "Erreur lors de l'upload.";
      const friendly =
        /unexpected end of form/i.test(raw)
          ? "Upload incomplet (connexion coupée ou fichier trop gros pour le proxy). Réessaie — si ça continue, redémarre Next (`npm run dev`)."
          : raw;
      return NextResponse.json({ error: friendly }, { status: uploadRes.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Upload proxy error:", err);
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: string }).name)
        : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return NextResponse.json(
        { error: "Upload trop long. Vérifie ta connexion ou réduis la taille du fichier." },
        { status: 504 }
      );
    }
    const msg = err instanceof Error ? err.message : "";
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      return NextResponse.json(
        { error: "Backend clips injoignable (localhost:4567). Relance le backend." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Erreur réseau lors de l'upload." },
      { status: 500 }
    );
  }
}
