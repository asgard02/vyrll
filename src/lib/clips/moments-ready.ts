import { etapeFromPipeline } from "@/lib/clips/job-etape";
import { pipelineHasChosenMoments } from "@/lib/clips/moments-choice";

export const MOMENTS_NOTIFIED_PREFIX = "trimo.moments-notified.";

export function momentsNotifiedKey(jobId: string): string {
  return `${MOMENTS_NOTIFIED_PREFIX}${jobId}`;
}

export const MOMENTS_TOAST_ID_PREFIX = "moments-ready:";

/** Session : la notif in-app a déjà été montrée pour ce job. */
export function momentsToastPresentedKey(jobId: string): string {
  return `trimo.moments-toast.${jobId}`;
}

export function momentsToastId(jobId: string): string {
  return `${MOMENTS_TOAST_ID_PREFIX}${jobId}`;
}

/** Id du job sur l'écran de choix. L'éditeur du même projet ne compte pas. */
export function momentsChoiceJobFromPath(pathname: string): string | null {
  const path = pathname.split("?")[0].replace(/\/$/, "");
  const prefix = "/clips/projet/";
  if (!path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length);
  if (!id || id.includes("/")) return null;
  return id;
}

/** Une seule notif in-app par job, et pas pendant l'écran de choix. */
export function shouldPresentMomentsToast(input: {
  onChoiceScreen: boolean;
  alreadyPresented: boolean;
}): boolean {
  if (input.onChoiceScreen) return false;
  if (input.alreadyPresented) return false;
  return true;
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
