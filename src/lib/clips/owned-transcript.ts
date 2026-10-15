import { videoKeyFromClipSource } from "@/lib/clip-agent/video-key";

export type OwnedJob = {
  id: string;
  url?: string | null;
  upload_id?: string | null;
};

/** Clé alignée sur l'index Whisper, calculée depuis la ligne du job. */
export function videoKeyFromJob(job: OwnedJob): string | null {
  return videoKeyFromClipSource({
    url: job.url || undefined,
    uploadId: job.upload_id,
  });
}

export type OwnedSegments<TJob extends OwnedJob, TSegment> =
  | { ok: true; job: TJob; videoKey: string | null; segments: TSegment[] }
  | { ok: false; status: 404 };

/**
 * Le job est lu filtré par l'utilisateur. Absent : 404, sans lecture des segments.
 * Présent : les segments se lisent par le video_key de cette ligne.
 */
export async function segmentsForOwnedJob<TJob extends OwnedJob, TSegment>(opts: {
  userId: string;
  jobId: string;
  readJob: (userId: string, jobId: string) => Promise<TJob | null>;
  readSegments: (videoKey: string) => Promise<TSegment[]>;
}): Promise<OwnedSegments<TJob, TSegment>> {
  const job = await opts.readJob(opts.userId, opts.jobId);
  if (!job?.id) return { ok: false, status: 404 };
  const videoKey = videoKeyFromJob(job);
  if (!videoKey) return { ok: true, job, videoKey: null, segments: [] };
  const segments = await opts.readSegments(videoKey);
  return { ok: true, job, videoKey, segments };
}
