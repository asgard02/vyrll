import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteR2Clips, isR2Configured } from "@/lib/r2";

export type PurgeClipJobInput = {
  id: string;
  user_id?: string | null;
  backend_job_id?: string | null;
};

export type PurgeClipJobResult = {
  ok: boolean;
  error?: string;
};

/**
 * Annule le worker, purge R2, puis supprime clip_jobs (+ clip_backend_jobs).
 * Best-effort sur cancel / R2 : la ligne DB est quand même supprimée si possible.
 */
export async function purgeClipJob(
  admin: SupabaseClient,
  job: PurgeClipJobInput
): Promise<PurgeClipJobResult> {
  const jobId = job.id;
  const backendJobId = job.backend_job_id ?? null;
  const storageFolder = backendJobId ?? jobId;

  const backendUrl = process.env.BACKEND_URL;
  const backendSecret = process.env.BACKEND_SECRET;
  if (backendUrl && backendSecret && backendJobId) {
    try {
      const cancelRes = await fetch(
        `${backendUrl.replace(/\/$/, "")}/jobs/${backendJobId}`,
        {
          method: "DELETE",
          headers: { "x-backend-secret": backendSecret },
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (!cancelRes.ok) {
        console.warn(
          `[clips/purge] backend cancel ${backendJobId} → ${cancelRes.status}`
        );
      }
    } catch (cancelErr) {
      console.warn(
        "[clips/purge] backend cancel failed:",
        cancelErr instanceof Error ? cancelErr.message : cancelErr
      );
    }
  }

  if (isR2Configured()) {
    try {
      await deleteR2Clips(storageFolder);
    } catch (r2Err) {
      console.error("[clips/purge] R2 delete error:", r2Err);
    }
  } else {
    console.warn(
      "[clips/purge] R2 non configuré — fichiers non supprimés du stockage objet"
    );
  }

  if (backendJobId) {
    const { error: backendDelErr } = await admin
      .from("clip_backend_jobs")
      .delete()
      .eq("backend_job_id", backendJobId);
    if (backendDelErr) {
      console.warn(
        `[clips/purge] clip_backend_jobs delete ${backendJobId}:`,
        backendDelErr.message
      );
    }
  }

  let delQuery = admin.from("clip_jobs").delete().eq("id", jobId);
  if (job.user_id) {
    delQuery = delQuery.eq("user_id", job.user_id);
  }
  const { error: deleteError } = await delQuery;

  if (deleteError) {
    console.error("[clips/purge] clip_jobs delete error:", deleteError);
    return { ok: false, error: deleteError.message };
  }

  return { ok: true };
}

export type CleanupExpiredResult = {
  scanned: number;
  deleted: number;
  errors: string[];
};

/**
 * Purge les clip_jobs des comptes free plus vieux que retentionDays.
 */
export async function cleanupExpiredFreeClips(
  admin: SupabaseClient,
  options: { retentionDays: number; batchSize?: number } = {
    retentionDays: 2,
  }
): Promise<CleanupExpiredResult> {
  const batchSize = Math.min(100, Math.max(1, options.batchSize ?? 50));
  const cutoff = new Date(
    Date.now() - options.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: freeProfiles, error: profilesError } = await admin
    .from("profiles")
    .select("id")
    .eq("plan", "free");

  if (profilesError) {
    return {
      scanned: 0,
      deleted: 0,
      errors: [`profiles: ${profilesError.message}`],
    };
  }

  const freeIds = (freeProfiles ?? []).map((p) => p.id as string);
  if (freeIds.length === 0) {
    return { scanned: 0, deleted: 0, errors: [] };
  }

  // PostgREST .in() a une limite pratique ; batcher les user ids.
  const errors: string[] = [];
  const jobs: PurgeClipJobInput[] = [];
  const USER_CHUNK = 100;

  for (let i = 0; i < freeIds.length; i += USER_CHUNK) {
    const chunk = freeIds.slice(i, i + USER_CHUNK);
    const { data, error } = await admin
      .from("clip_jobs")
      .select("id, user_id, backend_job_id")
      .in("user_id", chunk)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (error) {
      errors.push(`clip_jobs: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      jobs.push({
        id: row.id,
        user_id: row.user_id,
        backend_job_id: row.backend_job_id,
      });
      if (jobs.length >= batchSize) break;
    }
    if (jobs.length >= batchSize) break;
  }

  let deleted = 0;
  for (const job of jobs) {
    const result = await purgeClipJob(admin, job);
    if (result.ok) deleted += 1;
    else errors.push(`${job.id}: ${result.error ?? "purge failed"}`);
  }

  return { scanned: jobs.length, deleted, errors };
}
