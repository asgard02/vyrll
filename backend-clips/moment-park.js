import { isUuid } from "./clip-user-id.js";
import {
  MOMENTS_CAP_MS,
  defaultMomentsChoisis,
  hasMomentsChoisis,
  momentChoiceDue,
  momentsFromDetected,
  normalizePipeline,
} from "./job-pipeline.js";

/** Liste filtrée vide : le job sort, il n'attend pas le délai ni le stale. */
export const NO_MOMENTS_ERROR = "NO_MOMENTS";

/** Check de clip_backend_jobs. Aucun autre statut n'est écrit. */
export const CLIP_BACKEND_JOB_STATUSES = Object.freeze([
  "pending",
  "processing",
  "done",
  "error",
  "cancelled",
]);

/** Même filtre que le scan : jobs garés, ou déjà en phase render mais encore processing. */
export const MOMENT_SCAN_PHASE_FILTER =
  "payload->>phase.eq.moments_prets,payload->>phase.eq.render";

export const CLAIM_DEFAULT_MOMENTS_RPC = "clip_jobs_claim_default_moments";

function scopeText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function scopeOf(source) {
  if (!source || typeof source !== "object") return null;
  return scopeText(source.queue_scope);
}

/**
 * File du payload d'origine, puis celle de l'objet en mémoire.
 * "production" seulement si aucune des deux n'est posée.
 */
export function resolveQueueScope(payload, job) {
  const fromPayload = scopeOf(payload);
  if (fromPayload) return fromPayload;
  const fromJob = scopeOf(job);
  if (fromJob) return fromJob;
  return "production";
}

export function clipBackendJobStatus(value, fallback = "pending") {
  if (CLIP_BACKEND_JOB_STATUSES.includes(value)) return value;
  if (CLIP_BACKEND_JOB_STATUSES.includes(fallback)) return fallback;
  return "pending";
}

/**
 * Fenêtre d'écriture du choix par défaut.
 * Pause absente : l'écriture est permise. Pause posée : seulement après 30 min.
 * Même condition que clip_jobs_claim_default_moments.
 */
export function defaultMomentsClaimWindowOpen(pipeline, now = Date.now()) {
  const view = normalizePipeline(pipeline);
  if (!view.choix_en_cours_at) return true;
  const ready = Date.parse(view.moments_prets_at || "");
  if (!Number.isFinite(ready)) return false;
  return now >= ready + MOMENTS_CAP_MS;
}

/**
 * N'ajoute que moments_choisis. Le reste du pipeline reste.
 * Null : la condition n'est pas tenue, rien ne doit être écrit.
 */
export function applyDefaultMomentsClaim(row, chosen, now = Date.now()) {
  if (!row || row.status !== "processing") return null;
  const view = normalizePipeline(row.pipeline);
  if (view.etape !== "moments_prets") return null;
  if (hasMomentsChoisis(view)) return null;
  if (!defaultMomentsClaimWindowOpen(view, now)) return null;
  const list = momentsFromDetected(chosen);
  if (!list.length) return null;
  const raw =
    row.pipeline && typeof row.pipeline === "object" && !Array.isArray(row.pipeline)
      ? { ...row.pipeline }
      : {};
  raw.moments_choisis = list;
  return raw;
}

export async function claimDefaultMoments(supabase, row, now = Date.now()) {
  const view = normalizePipeline(row?.pipeline);
  const chosen = defaultMomentsChoisis(view.moments, view.clips_demandes);
  if (!applyDefaultMomentsClaim(row, chosen, now)) return false;
  const { data, error } = await supabase.rpc(CLAIM_DEFAULT_MOMENTS_RPC, {
    p_job_id: row.id,
    p_chosen: chosen,
  });
  if (error) {
    console.warn(`[moments] default choice failed job=${row.id}: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * Garde la file déjà stockée, pose phase moments_prets, libère le worker.
 * Le statut en base reste processing. awaitingMomentChoice est le drapeau mémoire.
 */
export async function parkJobForMomentChoice(job, jobId, io) {
  const stored = await io.readPayload(jobId);
  const base = await io.payloadFromJob(job);
  const payload = {
    ...(base && typeof base === "object" ? base : {}),
    queue_scope: resolveQueueScope(stored, job),
    phase: "moments_prets",
  };
  job.awaitingMomentChoice = true;
  await io.persist(jobId, {
    status: "processing",
    error: null,
    payload,
    claimed_by: null,
    claimed_at: null,
  });
  io.forget(jobId);
}

function payloadObject(value) {
  return value && typeof value === "object" ? value : {};
}

/**
 * Job garé sans aucun moment cochable. N'écrit pas moments_choisis et ne relance pas le rendu.
 */
async function failEmptyMomentChoice(supabase, clipId, backendJobId) {
  const { error: clipErr } = await supabase
    .from("clip_jobs")
    .update({ status: "error", error: NO_MOMENTS_ERROR })
    .eq("id", clipId)
    .eq("status", "processing");
  if (clipErr) {
    console.warn(`[moments] empty choice clip_jobs job=${clipId}: ${clipErr.message}`);
    return;
  }
  const { error: backendErr } = await supabase
    .from("clip_backend_jobs")
    .update({
      status: "error",
      error: NO_MOMENTS_ERROR,
      claimed_by: null,
      claimed_at: null,
    })
    .eq("backend_job_id", backendJobId)
    .eq("status", "processing");
  if (backendErr) {
    console.warn(`[moments] empty choice backend job=${backendJobId}: ${backendErr.message}`);
  }
}

export async function scanParkedMomentJobs(supabase, options) {
  const scope = options.scope === "local" ? "local" : "production";
  const now = options.now ?? Date.now();
  const { data: rows, error } = await supabase
    .from("clip_backend_jobs")
    .select("backend_job_id, status, claimed_by, payload")
    .eq("status", "processing")
    .is("claimed_by", null)
    .or(MOMENT_SCAN_PHASE_FILTER);
  if (error) {
    console.warn(`[moments] scan failed: ${error.message}`);
    return;
  }
  for (const backend of rows || []) {
    if (!backend?.backend_job_id) continue;
    const payload = payloadObject(backend.payload);
    const phase = payload.phase;
    if (phase !== "moments_prets" && phase !== "render") continue;
    const rowScope = payload.queue_scope === "local" ? "local" : "production";
    if (rowScope !== scope) continue;
    if (backend.status !== "processing" || backend.claimed_by) continue;
    if (phase === "render") {
      await options.release(backend.backend_job_id);
      continue;
    }
    const frontendId = payload.frontend_job_id;
    if (!isUuid(frontendId)) continue;
    const { data: clip, error: clipErr } = await supabase
      .from("clip_jobs")
      .select("id, status, pipeline")
      .eq("id", frontendId)
      .maybeSingle();
    if (clipErr || !clip) continue;
    const pipeline = normalizePipeline(clip.pipeline);
    if (pipeline.etape !== "moments_prets") continue;
    if (hasMomentsChoisis(pipeline)) {
      await options.release(backend.backend_job_id);
      continue;
    }
    if (!defaultMomentsChoisis(pipeline.moments, pipeline.clips_demandes).length) {
      if (clip.status === "processing") {
        await failEmptyMomentChoice(supabase, clip.id, backend.backend_job_id);
      }
      continue;
    }
    if (!momentChoiceDue(pipeline, now)) continue;
    const wrote = await claimDefaultMoments(supabase, clip, now);
    if (!wrote) continue;
    await options.release(backend.backend_job_id);
  }
}
