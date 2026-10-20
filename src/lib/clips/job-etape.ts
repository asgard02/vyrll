export const JOB_ETAPE_IDS = [
  "telechargement",
  "transcription",
  "reperage",
  "creation",
  "moments_prets",
] as const;

export type JobEtapeId = (typeof JOB_ETAPE_IDS)[number];

export type JobEtapeMoment = {
  debut: number;
  fin: number;
  titre: string;
  score: number;
  pourquoi: string;
};

export type JobEtape = {
  id: JobEtapeId;
  cache: "deja_pret" | null;
  clip: number | null;
  sur: number | null;
  echec: boolean;
  moments: JobEtapeMoment[];
};

function isEtapeId(value: unknown): value is JobEtapeId {
  return typeof value === "string" && (JOB_ETAPE_IDS as readonly string[]).includes(value);
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function momentFrom(value: unknown): JobEtapeMoment | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const debut = Number(row.debut);
  const fin = Number(row.fin);
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || !(fin > debut)) return null;
  const score = Number(row.score);
  return {
    debut,
    fin,
    titre: typeof row.titre === "string" ? row.titre : "",
    score: Number.isFinite(score) ? score : 0,
    pourquoi: typeof row.pourquoi === "string" ? row.pourquoi : "",
  };
}

/** Colonne pipeline vide ou illisible : pas de clé etape dans la réponse. */
export function etapeFromPipeline(pipeline: unknown): JobEtape | null {
  if (!pipeline || typeof pipeline !== "object" || Array.isArray(pipeline)) return null;
  const row = pipeline as Record<string, unknown>;
  if (!isEtapeId(row.etape)) return null;
  const moments = Array.isArray(row.moments)
    ? row.moments.map(momentFrom).filter((item): item is JobEtapeMoment => item != null)
    : [];
  return {
    id: row.etape,
    cache: row.cache === "deja_pret" ? "deja_pret" : null,
    clip: positiveInt(row.clip),
    sur: positiveInt(row.sur),
    echec: row.echec === true,
    moments,
  };
}
