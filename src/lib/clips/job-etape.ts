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
  /** Null quand l'échec est enregistré avant toute étape connue. */
  id: JobEtapeId | null;
  cache: "deja_pret" | null;
  clip: number | null;
  sur: number | null;
  echec: boolean;
  moments: JobEtapeMoment[];
  moments_prets_at?: string;
  clips_demandes?: number;
  choix_en_cours_at?: string;
};

function isEtapeId(value: unknown): value is JobEtapeId {
  return typeof value === "string" && (JOB_ETAPE_IDS as readonly string[]).includes(value);
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function isoField(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
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
  const id = isEtapeId(row.etape) ? row.etape : null;
  const echec = row.echec === true;
  if (!id && !echec) return null;
  const moments = Array.isArray(row.moments)
    ? row.moments.map(momentFrom).filter((item): item is JobEtapeMoment => item != null)
    : [];
  const etape: JobEtape = {
    id,
    cache: row.cache === "deja_pret" ? "deja_pret" : null,
    clip: positiveInt(row.clip),
    sur: positiveInt(row.sur),
    echec,
    moments,
  };
  const readyAt = isoField(row.moments_prets_at);
  if (readyAt) etape.moments_prets_at = readyAt;
  const demand = positiveInt(row.clips_demandes);
  if (demand) etape.clips_demandes = demand;
  const choosingAt = isoField(row.choix_en_cours_at);
  if (choosingAt) etape.choix_en_cours_at = choosingAt;
  return etape;
}
