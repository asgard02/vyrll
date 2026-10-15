/**
 * Patch d'un seul clip dans clip_jobs.clips.
 * jsonb_set sur l'index : deux rendus parallèles ne s'écrasent pas.
 * Si patch_clip_job_at_index n'est pas encore en base, le repli relit
 * puis fusionne. Il ne réécrit pas une copie périmée du tableau entier.
 */

export const CLIP_PATCH_RPC = "patch_clip_job_at_index";

export function isMissingRpcError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  if (code === "PGRST202" || code === "42883") return true;
  if (!msg.includes("function")) return false;
  return (
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("schema cache")
  );
}

/**
 * Équivalent de jsonb_set(clips, '{index}', clips->index || patch, true).
 * Les autres clips et les autres champs du clip restent.
 */
export function jsonbSetClip(clips, index, patch) {
  const list = Array.isArray(clips)
    ? clips.map((clip) => (clip && typeof clip === "object" ? { ...clip } : clip))
    : [];
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0) {
    throw new Error("invalid clip index");
  }
  while (list.length <= at) list.push({});
  const prev = list[at] && typeof list[at] === "object" && !Array.isArray(list[at]) ? list[at] : {};
  list[at] = { ...prev, ...(patch && typeof patch === "object" ? patch : {}) };
  return list;
}

export function clipPatchRpcArgs(jobId, index, patch) {
  return {
    p_job_id: jobId,
    p_index: index,
    p_patch: patch,
  };
}

/**
 * RPC d'abord. Si la fonction n'existe pas, read + jsonbSetClip + write.
 * Les autres erreurs remontent.
 */
export async function patchClipJobAtIndex(opts) {
  const args = clipPatchRpcArgs(opts.jobId, opts.index, opts.patch);
  const rpc = await opts.rpc(CLIP_PATCH_RPC, args);
  if (!rpc.error) return { ok: true, via: "rpc" };
  if (!isMissingRpcError(rpc.error)) {
    return { ok: false, via: "rpc", error: rpc.error };
  }
  const row = await opts.read();
  if (row.error || !Array.isArray(row.clips)) {
    return { ok: false, via: "fallback", error: row.error || new Error("clip_jobs missing") };
  }
  const clips = jsonbSetClip(row.clips, opts.index, opts.patch);
  const written = await opts.write(clips);
  if (written.error) return { ok: false, via: "fallback", error: written.error };
  return { ok: true, via: "fallback" };
}
