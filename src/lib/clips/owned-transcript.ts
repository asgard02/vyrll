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
 * Job déjà vérifié. Lecture par video_key, puis par l'id de cette ligne
 * si la première ne renvoie rien. L'id passé à la seconde lecture est celui du job.
 */
export async function segmentsForVerifiedJob<TSegment>(
  job: OwnedJob,
  readSegments: (videoKey: string) => Promise<TSegment[]>,
  readSegmentsByJobId: (jobId: string) => Promise<TSegment[]>
): Promise<{ videoKey: string | null; segments: TSegment[] }> {
  const videoKey = videoKeyFromJob(job);
  if (videoKey) {
    const byVideo = await readSegments(videoKey);
    if (byVideo.length > 0) return { videoKey, segments: byVideo };
  }
  const segments = await readSegmentsByJobId(job.id);
  return { videoKey, segments };
}

/**
 * Le job est lu filtré par l'utilisateur. Absent : 404, sans lecture des segments.
 * Présent : video_key de cette ligne, puis son id si cette lecture est vide.
 */
export async function segmentsForOwnedJob<TJob extends OwnedJob, TSegment>(opts: {
  userId: string;
  jobId: string;
  readJob: (userId: string, jobId: string) => Promise<TJob | null>;
  readSegments: (videoKey: string) => Promise<TSegment[]>;
  readSegmentsByJobId: (jobId: string) => Promise<TSegment[]>;
}): Promise<OwnedSegments<TJob, TSegment>> {
  const job = await opts.readJob(opts.userId, opts.jobId);
  if (!job?.id) return { ok: false, status: 404 };
  const loaded = await segmentsForVerifiedJob(
    job,
    opts.readSegments,
    opts.readSegmentsByJobId
  );
  return { ok: true, job, videoKey: loaded.videoKey, segments: loaded.segments };
}
