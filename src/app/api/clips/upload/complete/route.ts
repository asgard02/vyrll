import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchBackendWithRetry } from "@/lib/backend-fetch";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Authentification non configurée." }, { status: 503 });
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const backendUrl = process.env.BACKEND_URL;
    const backendSecret = process.env.BACKEND_SECRET;
    if (!backendUrl || !backendSecret) {
      return NextResponse.json({ error: "Service clips non configuré." }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const uploadId = typeof body?.upload_id === "string" ? body.upload_id.trim() : "";
    if (!UUID_RE.test(uploadId)) {
      return NextResponse.json({ error: "upload_id invalide." }, { status: 400 });
    }

    const completeRes = await fetchBackendWithRetry(
      `${backendUrl.replace(/\/$/, "")}/upload-complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-backend-secret": backendSecret,
        },
        body: JSON.stringify({ upload_id: uploadId }),
      },
      60_000,
      2
    );
    const data = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      return NextResponse.json(
        { error: (data as { error?: string }).error || "Impossible de finaliser l'upload." },
        { status: completeRes.status >= 500 ? 503 : completeRes.status }
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("Upload complete error:", err);
    return NextResponse.json({ error: "Erreur réseau lors de la finalisation." }, { status: 500 });
  }
}
