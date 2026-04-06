import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";

const BACKEND_UPLOAD_TIMEOUT_MS = 120_000;

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

    const uploadRes = await fetch(
      `${backendUrl.replace(/\/$/, "")}/upload`,
      {
        method: "POST",
        headers: {
          "x-backend-secret": backendSecret,
          "content-type": contentType,
        },
        body: request.body,
        // @ts-expect-error duplex needed for streaming request body
        duplex: "half",
        signal: AbortSignal.timeout(BACKEND_UPLOAD_TIMEOUT_MS),
      }
    );

    const data = await uploadRes.json().catch(() => ({}));

    if (!uploadRes.ok) {
      return NextResponse.json(
        { error: (data as { error?: string }).error || "Erreur lors de l'upload." },
        { status: uploadRes.status }
      );
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
    return NextResponse.json(
      { error: "Erreur réseau lors de l'upload." },
      { status: 500 }
    );
  }
}
