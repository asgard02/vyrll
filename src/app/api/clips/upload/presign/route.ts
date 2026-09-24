import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isR2Configured, presignUploadPut } from "@/lib/r2";

const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const PRESIGN_TTL_SEC = 30 * 60;

const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
]);

function mimeFromFilename(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "avi") return "video/x-msvideo";
  return null;
}

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

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: "Stockage non configuré.", direct: false },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => null);
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const size = Number(body?.size);
    const rawType = typeof body?.content_type === "string" ? body.content_type.trim().toLowerCase() : "";
    const contentType = ALLOWED_VIDEO_MIMES.has(rawType) ? rawType : mimeFromFilename(filename);

    if (!filename || !contentType) {
      return NextResponse.json({ error: "Format vidéo non supporté." }, { status: 400 });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Fichier vide." }, { status: 400 });
    }
    if (size > UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: `Fichier trop volumineux (max ${UPLOAD_MAX_BYTES / 1024 / 1024} Mo).` },
        { status: 413 }
      );
    }

    const uploadId = randomUUID();
    const key = `uploads/${uploadId}/video.mp4`;
    const uploadUrl = await presignUploadPut({
      key,
      contentType,
      expiresIn: PRESIGN_TTL_SEC,
    });
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Stockage non configuré.", direct: false },
        { status: 503 }
      );
    }

    return NextResponse.json({
      upload_id: uploadId,
      upload_url: uploadUrl,
      content_type: contentType,
      direct: true,
    });
  } catch (err) {
    console.error("Upload presign error:", err);
    return NextResponse.json({ error: "Erreur lors de la préparation de l'upload." }, { status: 500 });
  }
}
