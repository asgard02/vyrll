import type { JobEtape, JobEtapeId } from "./job-etape";

export const LOADER_STEP_IDS = [
  "telechargement",
  "transcription",
  "reperage",
  "creation",
] as const;

export type LoaderStepId = (typeof LOADER_STEP_IDS)[number];
export type LoaderStepState = "done" | "current" | "upcoming" | "error";

export type JobLoaderStep = {
  id: LoaderStepId;
  label: string;
  state: LoaderStepState;
};

export type JobLoaderView = {
  percent: number;
  failed: boolean;
  stepsLabel: string;
  steps: JobLoaderStep[];
};

type LoaderLocale = "fr" | "en";

const LABELS: Record<
  LoaderLocale,
  Record<LoaderStepId, string> & {
    deja_pret: string;
    deja_pret_masc: string;
    creation_pending: string;
    steps: string;
    clip: (clip: number, sur: number) => string;
  }
> = {
  fr: {
    telechargement: "Téléchargement",
    transcription: "Transcription",
    reperage: "Repérage des moments",
    creation: "Création des clips",
    deja_pret: "Déjà prête",
    deja_pret_masc: "Déjà prêt",
    creation_pending: "Création des clips…",
    steps: "Étapes",
    clip: (clip, sur) => `Clip ${clip} sur ${sur}`,
  },
  en: {
    telechargement: "Download",
    transcription: "Transcription",
    reperage: "Finding moments",
    creation: "Creating the clips",
    deja_pret: "Already ready",
    deja_pret_masc: "Already ready",
    creation_pending: "Creating the clips…",
    steps: "Steps",
    clip: (clip, sur) => `Clip ${clip} of ${sur}`,
  },
};

export type LoaderEtapeInput = {
  id?: JobEtapeId | null;
  cache?: "deja_pret" | null;
  clip?: number | null;
  sur?: number | null;
  echec?: boolean;
} | null;

const KNOWN_IDS = new Set<string>([...LOADER_STEP_IDS, "moments_prets"]);

function localeOf(locale: string | undefined): LoaderLocale {
  return locale === "en" ? "en" : "fr";
}

function isLoaderStep(id: string | null | undefined): id is LoaderStepId {
  return id != null && (LOADER_STEP_IDS as readonly string[]).includes(id);
}

function countAtLeastOne(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** Étape du GET vers l'état du loader. Null : garder le monteur actuel. */
export function loaderFromEtape(
  etape: LoaderEtapeInput | undefined,
  locale: LoaderLocale | string = "fr"
): JobLoaderView | null {
  if (!etape) return null;
  const id = etape.id ?? null;
  if (id === "moments_prets") return null;
  const failed = etape.echec === true;
  if (!isLoaderStep(id) && !failed) return null;

  const labels = LABELS[localeOf(locale)];
  const index = isLoaderStep(id) ? LOADER_STEP_IDS.indexOf(id) : 0;
  const stepId: LoaderStepId = isLoaderStep(id) ? id : "telechargement";
  const cached = etape.cache === "deja_pret" && isLoaderStep(id);
  const clip = countAtLeastOne(etape.clip);
  const sur = countAtLeastOne(etape.sur);
  const shownSur = clip != null && sur != null ? Math.max(sur, clip) : null;
  const shownClip = clip != null && shownSur != null ? Math.min(clip, shownSur) : null;

  let percent = index * 25;
  if (cached) {
    percent = (index + 1) * 25;
  } else if (stepId === "creation" && shownClip != null && shownSur != null) {
    percent += 25 * (shownClip / shownSur);
  }
  percent = Math.min(100, percent);

  const steps = LOADER_STEP_IDS.map((step, i): JobLoaderStep => {
    let state: LoaderStepState;
    if (failed && i === index) state = "error";
    else if (i < index || (cached && i === index)) state = "done";
    else if (i === index) state = "current";
    else state = "upcoming";

    let label = labels[step];
    if (i === index && step === "creation" && shownClip != null && shownSur != null) {
      label = labels.clip(shownClip, shownSur);
    } else if (i === index && cached) {
      label = step === "telechargement" ? labels.deja_pret_masc : labels.deja_pret;
    } else if (i === index && step === "creation") {
      label = labels.creation_pending;
    }
    return { id: step, label, state };
  });

  return { percent, failed, stepsLabel: labels.steps, steps };
}

/** Clé absente ou illisible : undefined, pour effacer une étape périmée. */
export function jobEtapeFromPayload(value: unknown): JobEtape | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const id = row.id === null ? null : row.id;
  if (id !== null && (typeof id !== "string" || !KNOWN_IDS.has(id))) return undefined;
  if (id === null && row.echec !== true) return undefined;
  const etape: JobEtape = {
    id: id as JobEtape["id"],
    cache: row.cache === "deja_pret" ? "deja_pret" : null,
    clip: typeof row.clip === "number" ? row.clip : null,
    sur: typeof row.sur === "number" ? row.sur : null,
    echec: row.echec === true,
    moments: momentsFromPayload(row.moments),
  };
  if (typeof row.moments_prets_at === "string" && row.moments_prets_at.trim()) {
    etape.moments_prets_at = row.moments_prets_at;
  }
  if (
    typeof row.clips_demandes === "number" &&
    Number.isInteger(row.clips_demandes) &&
    row.clips_demandes >= 1
  ) {
    etape.clips_demandes = row.clips_demandes;
  }
  if (typeof row.choix_en_cours_at === "string" && row.choix_en_cours_at.trim()) {
    etape.choix_en_cours_at = row.choix_en_cours_at;
  }
  return etape;
}

function momentsFromPayload(value: unknown): JobEtape["moments"] {
  if (!Array.isArray(value)) return [];
  const moments: JobEtape["moments"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const debut = Number(row.debut);
    const fin = Number(row.fin);
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || !(fin > debut)) continue;
    const score = Number(row.score);
    moments.push({
      debut,
      fin,
      titre: typeof row.titre === "string" ? row.titre : "",
      score: Number.isFinite(score) ? score : 0,
      pourquoi: typeof row.pourquoi === "string" ? row.pourquoi : "",
    });
  }
  return moments;
}

/** La ligne « Clip N sur M » reste au-dessus de la grille dès qu'un clip est là. */
export function showCreationCountDuringPartial(input: {
  status: string;
  hasPartialClips: boolean;
  etape?: { id?: string | null; clip?: number | null; sur?: number | null } | null;
}): boolean {
  if (input.status !== "processing" || !input.hasPartialClips) return false;
  const etape = input.etape;
  if (etape?.id !== "creation") return false;
  const clip = etape.clip;
  const sur = etape.sur;
  return (
    typeof clip === "number" &&
    Number.isInteger(clip) &&
    clip >= 1 &&
    typeof sur === "number" &&
    Number.isInteger(sur) &&
    sur >= 1
  );
}
