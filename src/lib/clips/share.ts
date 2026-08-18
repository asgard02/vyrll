import type { SupabaseClient } from "@supabase/supabase-js";
import { clipExpiresAt, isClipExpired } from "@/lib/clips/retention";
import { mapStoredClipToItem, type StoredClipRow } from "@/lib/clips/types";

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isShareToken(token: string): boolean {
  return JOB_ID_RE.test(token);
}

export function shareFolderPath(jobId: string) {
  return `/s/${jobId}`;
}

export function shareDownloadPath(jobId: string, index: number) {
  return `/api/share/${jobId}/download/${index}`;
}

type SharedJobRow = {
  id: string;
  status: string;
  clips: StoredClipRow[] | null;
  video_title: string | null;
  created_at: string;
  user_id: string;
};

export type SharedFolderPayload = {
  title: string | null;
  created_at: string;
  expires_at: string | null;
  clips: ReturnType<typeof mapStoredClipToItem>[];
};

export async function loadSharedFolder(
  admin: SupabaseClient,
  token: string
): Promise<
  | { ok: true; data: SharedFolderPayload }
  | { ok: false; status: 400 | 404 | 410 }
> {
  if (!isShareToken(token)) return { ok: false, status: 400 };

  const { data: job, error } = await admin
    .from("clip_jobs")
    .select("id, status, clips, video_title, created_at, user_id")
    .eq("id", token)
    .maybeSingle();

  if (error || !job) return { ok: false, status: 404 };

  const row = job as SharedJobRow;
  if (row.status !== "done") return { ok: false, status: 404 };

  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", row.user_id)
    .maybeSingle();

  if (isClipExpired(row.created_at, profile?.plan ?? "free")) {
    return { ok: false, status: 410 };
  }

  const rawClips = Array.isArray(row.clips) ? row.clips : [];
  if (rawClips.length === 0) return { ok: false, status: 404 };

  const clips = rawClips.map((c, i) =>
    mapStoredClipToItem(c, row.id, i, {
      downloadUrl: shareDownloadPath(row.id, i),
      includeCleanUrl: false,
    })
  );

  return {
    ok: true,
    data: {
      title: row.video_title?.trim() || null,
      created_at: row.created_at,
      expires_at: clipExpiresAt(row.created_at, profile?.plan ?? "free"),
      clips,
    },
  };
}
