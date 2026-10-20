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
  const cacheHit = etape.cache === "deja_pret" && !failed && isLoaderStep(id);
  const clip = countAtLeastOne(etape.clip);
  const sur = countAtLeastOne(etape.sur);
  const shownSur = clip != null && sur != null ? Math.max(sur, clip) : null;
  const shownClip = clip != null && shownSur != null ? Math.min(clip, shownSur) : null;

  let percent = index * 25;
  if (cacheHit) {
    percent = (index + 1) * 25;
  } else if (stepId === "creation" && shownClip != null && shownSur != null) {
    percent += 25 * (shownClip / shownSur);
  }
  percent = Math.min(100, percent);

  const steps = LOADER_STEP_IDS.map((step, i): JobLoaderStep => {
    let state: LoaderStepState;
    if (failed && i === index) state = "error";
    else if (i < index || (cacheHit && i === index)) state = "done";
    else if (i === index) state = "current";
    else state = "upcoming";

    let label = labels[step];
    if (i === index && cacheHit) label = labels.deja_pret;
    else if (i === index && step === "creation" && shownClip != null && shownSur != null) {
      label = labels.clip(shownClip, shownSur);
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
  return {
    id: id as JobEtape["id"],
    cache: row.cache === "deja_pret" ? "deja_pret" : null,
    clip: typeof row.clip === "number" ? row.clip : null,
    sur: typeof row.sur === "number" ? row.sur : null,
    echec: row.echec === true,
    moments: [],
  };
}
