import { etapeFromPipeline } from "@/lib/clips/job-etape";
import { pipelineHasChosenMoments } from "@/lib/clips/moments-choice";

export const MOMENTS_NOTIFIED_PREFIX = "trimo.moments-notified.";

export function momentsNotifiedKey(jobId: string): string {
  return `${MOMENTS_NOTIFIED_PREFIX}${jobId}`;
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
