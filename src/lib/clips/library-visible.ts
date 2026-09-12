/** A clip job belongs in /projets and dashboard recents. */

export function clipJobClipsCount(job: {
  clips_count?: number | null;
  clips?: unknown;
}): number {
  if (typeof job.clips_count === "number" && Number.isFinite(job.clips_count)) {
    return Math.max(0, Math.round(job.clips_count));
  }
  return Array.isArray(job.clips) ? job.clips.length : 0;
}

export function isLibraryVisibleClipJob(job: {
  status?: string | null;
  clips_count?: number | null;
  clips?: unknown;
  credits_quoted?: number | null;
  analyze_only?: boolean | null;
}): boolean {
  if (job.analyze_only === true) return false;
  const count = clipJobClipsCount(job);
  if (count > 0) return true;
  if (job.credits_quoted === 0) return false;
  const status = job.status ?? "";
  if (status === "done") return false;
  return status === "pending" || status === "processing" || status === "error";
}
