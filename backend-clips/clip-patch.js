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
 * Équivalent de jsonb_set(clips, '{index}', clips->index || patch, false).
 * Un index hors du tableau est refusé. Les autres clips restent.
 */
export function jsonbSetClip(clips, index, patch) {
  const list = Array.isArray(clips)
    ? clips.map((clip) => (clip && typeof clip === "object" ? { ...clip } : clip))
    : [];
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= list.length) {
    throw new Error("invalid clip index");
  }
  const prev = list[at] && typeof list[at] === "object" && !Array.isArray(list[at]) ? list[at] : {};
  list[at] = { ...prev, ...(patch && typeof patch === "object" ? patch : {}) };
  return list;
}

export function clipPatchRpcArgs(jobId, index, patch, userId) {
  return {
    p_job_id: jobId,
    p_index: index,
    p_patch: patch,
    p_user_id: userId || null,
  };
}

/**
 * RPC d'abord. Si la fonction n'existe pas, read + jsonbSetClip + write.
 * Les autres erreurs remontent.
 */
export async function patchClipJobAtIndex(opts) {
  const args = clipPatchRpcArgs(opts.jobId, opts.index, opts.patch, opts.userId);
  const rpc = await opts.rpc(CLIP_PATCH_RPC, args);
  if (!rpc.error) {
    if (rpc.data === null) {
      return { ok: false, via: "rpc", error: new Error("clip job not updated") };
    }
    return { ok: true, via: "rpc" };
  }
  if (!isMissingRpcError(rpc.error)) {
    return { ok: false, via: "rpc", error: rpc.error };
  }
  const row = await opts.read();
  if (row.error || !Array.isArray(row.clips)) {
    return { ok: false, via: "fallback", error: row.error || new Error("clip_jobs missing") };
  }
  let clips;
  try {
    clips = jsonbSetClip(row.clips, opts.index, opts.patch);
  } catch (error) {
    return { ok: false, via: "fallback", error };
  }
  const written = await opts.write(clips);
  if (written.error) return { ok: false, via: "fallback", error: written.error };
  return { ok: true, via: "fallback" };
}
