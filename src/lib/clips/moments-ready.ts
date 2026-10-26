import { etapeFromPipeline } from "@/lib/clips/job-etape";
import { pipelineHasChosenMoments } from "@/lib/clips/moments-choice";

export const MOMENTS_NOTIFIED_PREFIX = "trimo.moments-notified.";
export const MOMENTS_SOUND_KEY = "trimo.moments-sound";
export const MOMENTS_CHIME_PREFIX = "trimo.moments-chime.";

export type MomentsChimeAction = "none" | "mark" | "wait" | "play";

export function momentsNotifiedKey(jobId: string): string {
  return `${MOMENTS_NOTIFIED_PREFIX}${jobId}`;
}

export function momentsChimeKey(jobId: string): string {
  return `${MOMENTS_CHIME_PREFIX}${jobId}`;
}

/** Absent ou autre chose que « off » : le son est là. */
export function momentsSoundEnabled(stored: string | null): boolean {
  return stored !== "off";
}

/**
 * Son du shell, une fois par job.
 * L'écran projet qui charge encore le loader garde la main (wait).
 * L'écran de choix déjà ouvert, le premier passage, et le mute ne jouent pas.
 */
export function momentsChimeAction(input: {
  alreadyPlayed: boolean;
  soundEnabled: boolean;
  onProjectPage: boolean;
  choiceVisible: boolean;
  firstSnapshot: boolean;
}): MomentsChimeAction {
  if (input.alreadyPlayed) return "none";
  if (input.onProjectPage && input.choiceVisible) return "mark";
  if (input.onProjectPage && !input.choiceVisible) return "wait";
  if (input.firstSnapshot || !input.soundEnabled) return "mark";
  return "play";
}

/** Passage loader → choix. Déjà sur l'écran : pas de son. */
export function momentsChimeOnChoiceEdge(input: {
  alreadyPlayed: boolean;
  soundEnabled: boolean;
  becameChoice: boolean;
}): Exclude<MomentsChimeAction, "wait"> {
  if (!input.becameChoice || input.alreadyPlayed) return "none";
  if (!input.soundEnabled) return "mark";
  return "play";
}

/** Garage encore ouvert : moments listés, aucun moments_choisis. */
export function jobAwaitsMomentChoice(pipeline: unknown): boolean {
  const etape = etapeFromPipeline(pipeline);
  if (!etape || etape.id !== "moments_prets") return false;
  if (etape.moments.length === 0) return false;
  return !pipelineHasChosenMoments(pipeline);
}

/** Vrai sur l'écran de choix, pas sur l'éditeur du même projet. */
export function isMomentsChoicePath(pathname: string, jobId: string): boolean {
  const path = pathname.split("?")[0].replace(/\/$/, "");
  return path === `/clips/projet/${jobId}`;
}

export function shouldShowMomentsNotification(input: {
  permission: NotificationPermission | "unsupported";
  alreadyNotified: boolean;
  onChoiceScreen: boolean;
  documentHidden: boolean;
}): boolean {
  if (input.permission !== "granted") return false;
  if (input.alreadyNotified) return false;
  if (input.onChoiceScreen && !input.documentHidden) return false;
  return true;
}
