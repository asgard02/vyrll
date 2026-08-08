import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { FREE_CLIP_RETENTION_DAYS } from "@/lib/clips/retention";
import { cleanupExpiredFreeClips } from "@/lib/clips/purge-job";

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

/**
 * Purge les clips free expirés (rétention 2 jours).
 * Auth : Authorization: Bearer CRON_SECRET (ou x-cron-secret).
 */
export async function GET(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase non configuré." },
        { status: 503 }
      );
    }

    const admin = createAdminClient();
    const result = await cleanupExpiredFreeClips(admin, {
      retentionDays: FREE_CLIP_RETENTION_DAYS,
      batchSize: 50,
    });

    console.log(
      `[cron/cleanup-expired-clips] scanned=${result.scanned} deleted=${result.deleted} errors=${result.errors.length}`
    );

    return NextResponse.json({
      ok: true,
      retentionDays: FREE_CLIP_RETENTION_DAYS,
      ...result,
    });
  } catch (err) {
    console.error("[cron/cleanup-expired-clips]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
