import { isUuid } from "./clip-user-id.js";

/** Étapes acceptées. moments_prets est réservé, le flux ne le pose pas. */
export const JOB_ETAPES = Object.freeze([
  "telechargement",
  "transcription",
  "reperage",
  "creation",
  "moments_prets",
]);

/** Étapes réellement écrites pendant un job. */
export const FLUX_ETAPES = Object.freeze([
  "telechargement",
  "transcription",
  "reperage",
  "creation",
]);

const TIME_MATCH_SEC = 0.05;

export function emptyPipelineState() {
  return {
    etape: null,
    cache: null,
    clip: null,
    sur: null,
    echec: false,
    moments: [],
  };
}

function positiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function textField(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Fenêtres déjà construites (start/end ou sourceStart/sourceEnd)
 * vers la forme stockée (debut, fin, titre, score, pourquoi).
 */
export function momentsFromDetected(items) {
  if (!Array.isArray(items)) return [];
  const moments = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const debut = Number(item.debut ?? item.start ?? item.sourceStart);
    const fin = Number(item.fin ?? item.end ?? item.sourceEnd);
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || !(fin > debut)) continue;
    const score = Number(item.score ?? item.score_viral);
    moments.push({
      debut,
      fin,
      titre: textField(item.titre ?? item.hook),
      score: Number.isFinite(score) ? score : 0,
      pourquoi: textField(item.pourquoi ?? item.reason),
    });
  }
  return moments;
}

export function normalizePipeline(state) {
  const src = state && typeof state === "object" ? state : {};
  const etape = JOB_ETAPES.includes(src.etape) ? src.etape : null;
  return {
    etape,
    cache: src.cache === "deja_pret" ? "deja_pret" : null,
    clip: positiveInt(src.clip),
    sur: positiveInt(src.sur),
    echec: src.echec === true,
    moments: momentsFromDetected(src.moments),
  };
}

/** Fusion en mémoire. Ignore clips, même si le patch le contient. */
export function mergePipelineState(prev, patch) {
  const base = normalizePipeline(prev);
  const src = patch && typeof patch === "object" ? patch : {};
  const next = { ...base };
  if (Object.prototype.hasOwnProperty.call(src, "etape")) next.etape = src.etape;
  if (Object.prototype.hasOwnProperty.call(src, "cache")) next.cache = src.cache;
  if (Object.prototype.hasOwnProperty.call(src, "clip")) next.clip = src.clip;
  if (Object.prototype.hasOwnProperty.call(src, "sur")) next.sur = src.sur;
  if (Object.prototype.hasOwnProperty.call(src, "echec")) next.echec = src.echec === true;
  if (Object.prototype.hasOwnProperty.call(src, "moments")) next.moments = src.moments;
  return normalizePipeline(next);
}

/** Passage d'étape. creation garde clip/sur. Les autres étapes les effacent. */
export function stepPatch(etape, extra = {}) {
  const patch = {
    etape,
    cache: extra.cache === "deja_pret" ? "deja_pret" : null,
    echec: extra.echec === true,
    clip: etape === "creation" ? extra.clip : null,
    sur: etape === "creation" ? extra.sur : null,
  };
  if (Object.prototype.hasOwnProperty.call(extra, "moments")) {
    patch.moments = extra.moments;
  }
  return patch;
}

/** Objet d'UPDATE : la seule clé est pipeline. */
export function pipelineUpdate(state) {
  return { pipeline: normalizePipeline(state) };
}

export function logJobEtape(backendJobId, state) {
  const row = normalizePipeline(state);
  const bits = [`etape=${row.etape || "?"}`];
  if (row.cache === "deja_pret") bits.push("cache=deja_pret");
  if (row.clip != null && row.sur != null) bits.push(`clip=${row.clip} sur=${row.sur}`);
  if (row.echec) bits.push("echec=1");
  console.log(`[job-etape] job=${backendJobId || "?"} ${bits.join(" ")}`);
}

/**
 * UPDATE ciblé de pipeline. N'envoie jamais clips.
 * Sans frontend_job_id UUID : log, pas d'écriture.
 */
export async function writeJobPipeline(supabase, frontendJobId, state, backendJobId) {
  const patch = pipelineUpdate(state);
  logJobEtape(backendJobId, patch.pipeline);
  if (!isUuid(frontendJobId)) {
    console.log(`[job-etape] job=${backendJobId || "?"} frontend_job_id=missing`);
    return { wrote: false };
  }
  if (!supabase) return { wrote: false };
  const { error } = await supabase.from("clip_jobs").update(patch).eq("id", frontendJobId);
  if (error) {
    console.warn(
      `[job-etape] write failed job=${backendJobId || "?"}: ${error.message || error}`
    );
    return { wrote: false, error };
  }
  return { wrote: true };
}

function windowStart(item) {
  const n = Number(item?.debut ?? item?.start ?? item?.sourceStart);
  return Number.isFinite(n) ? n : null;
}

function windowEnd(item) {
  const n = Number(item?.fin ?? item?.end ?? item?.sourceEnd);
  return Number.isFinite(n) ? n : null;
}

function sameInstant(a, b) {
  return Math.abs(a - b) <= TIME_MATCH_SEC;
}

/**
 * Liste absente ou vide : le tableau détecté, même référence, même ordre.
 * Liste choisie : fenêtres qui correspondent, dans l'ordre du choix.
 * Aucune correspondance : le tableau détecté, pour ne pas vider le rendu.
 */
export function selectMomentsForRender(detected, chosen) {
  if (!Array.isArray(detected)) return [];
  if (!Array.isArray(chosen) || chosen.length === 0) return detected;
  const used = new Set();
  const picked = [];
  for (const choice of chosen) {
    const debut = windowStart(choice);
    const fin = windowEnd(choice);
    if (debut == null || fin == null) continue;
    const idx = detected.findIndex((item, i) => {
      if (used.has(i)) return false;
      const start = windowStart(item);
      const end = windowEnd(item);
      return start != null && end != null && sameInstant(start, debut) && sameInstant(end, fin);
    });
    if (idx >= 0) {
      used.add(idx);
      picked.push(detected[idx]);
    }
  }
  return picked.length > 0 ? picked : detected;
}
