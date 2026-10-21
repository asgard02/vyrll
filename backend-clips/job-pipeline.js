import { isUuid } from "./clip-user-id.js";

/** Étapes acceptées. moments_prets est posé après le repérage, avant le rendu. */
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
  "moments_prets",
  "creation",
]);

const TIME_MATCH_SEC = 0.05;
export const MOMENTS_SOFT_MS = 10 * 60 * 1000;
export const MOMENTS_CAP_MS = 30 * 60 * 1000;

const PIPELINE_EXTRAS = [
  "moments",
  "moments_choisis",
  "moments_prets_at",
  "clips_demandes",
  "choix_en_cours_at",
];

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

function isoField(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
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
  const row = {
    etape,
    cache: src.cache === "deja_pret" ? "deja_pret" : null,
    clip: positiveInt(src.clip),
    sur: positiveInt(src.sur),
    echec: src.echec === true,
    moments: momentsFromDetected(src.moments),
  };
  const chosen = momentsFromDetected(src.moments_choisis);
  if (chosen.length) row.moments_choisis = chosen;
  const readyAt = isoField(src.moments_prets_at);
  if (readyAt) row.moments_prets_at = readyAt;
  const demand = positiveInt(src.clips_demandes);
  if (demand) row.clips_demandes = demand;
  const choosingAt = isoField(src.choix_en_cours_at);
  if (choosingAt) row.choix_en_cours_at = choosingAt;
  return row;
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
  for (const key of PIPELINE_EXTRAS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) next[key] = src[key];
  }
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
  for (const key of PIPELINE_EXTRAS) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) patch[key] = extra[key];
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
  return Math.abs(a - b) <= TIME_MATCH_SEC + 1e-6;
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

export function momentsMatch(a, b) {
  const a0 = windowStart(a);
  const a1 = windowEnd(a);
  const b0 = windowStart(b);
  const b1 = windowEnd(b);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return sameInstant(a0, b0) && sameInstant(a1, b1);
}

/** Sans choix : tout remplacement reste permis. Avec choix : seulement un moment choisi. */
export function replacementMatchesChoice(win, chosen) {
  const list = momentsFromDetected(chosen);
  if (!list.length) return true;
  return list.some((choice) => momentsMatch(win, choice));
}

/** Meilleurs scores d'abord, à égalité l'ordre d'origine, dans la limite demandée. */
export function defaultMomentsChoisis(moments, count) {
  const list = momentsFromDetected(moments);
  const ranked = list
    .map((moment, index) => ({ moment, index }))
    .sort((a, b) => b.moment.score - a.moment.score || a.index - b.index);
  const n = positiveInt(count);
  const take = n == null ? ranked.length : Math.min(n, ranked.length);
  return ranked.slice(0, take).map((row) => row.moment);
}

export function hasMomentsChoisis(pipeline) {
  return momentsFromDetected(pipeline?.moments_choisis).length > 0;
}

/** 10 min, ou 30 min dès que choix_en_cours_at est posé. Null si l'horodatage manque. */
export function renderDeadlineMs(pipeline, _now = Date.now()) {
  const ready = Date.parse(pipeline?.moments_prets_at || "");
  if (!Number.isFinite(ready)) return null;
  if (isoField(pipeline?.choix_en_cours_at)) return ready + MOMENTS_CAP_MS;
  return ready + MOMENTS_SOFT_MS;
}

/** Avec un choix : sur est le nombre retenu. Sans choix : le plafond demandé. */
export function renderTotalForChoice(matchedCount, wantCount, chosen) {
  const matched = Math.max(0, Math.floor(Number(matchedCount) || 0));
  if (hasMomentsChoisis({ moments_choisis: chosen })) return matched;
  const want = Math.max(0, Math.floor(Number(wantCount) || 0));
  return Math.min(want, matched);
}

/** Un second passage ne part que si la ligne est encore garée, ou coincée en phase render. */
export function parkedRenderEnqueueAllowed(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const phase = payload.phase;
  return (
    row?.status === "processing" &&
    !row?.claimed_by &&
    (phase === "moments_prets" || phase === "render")
  );
}

export function momentChoiceDue(pipeline, now = Date.now()) {
  const deadline = renderDeadlineMs(pipeline, now);
  if (deadline == null) return false;
  return now >= deadline;
}
