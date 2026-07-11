import { useTranslations } from "next-intl";

/** Stable error codes returned by the clips worker (backend-clips). */
export const CLIP_JOB_ERROR_CODES = [
  "VIDEO_TOO_LONG",
  "INVALID_SEGMENT",
  "DOWNLOAD_FAILED",
  "LOW_SOURCE_QUALITY",
  "YOUTUBE_COOKIES_EXPIRED",
  "TRANSCRIPTION_FAILED",
  "RENDER_FAILED",
  "PROCESSING_FAILED",
  "UPLOAD_FAILED",
  "UPLOAD_EXPIRED",
  "NO_SEGMENTS_IN_WINDOW",
  "BACKEND_TIMEOUT",
  "BACKEND_SOCKET",
  "BACKEND_ERROR",
  "BACKEND_JOB_LOST",
] as const;

/** @deprecated Use clipJobErrorLabel with locale or useClipJobErrorLabel hook */
export const CLIP_JOB_ERROR_LABELS: Record<string, string> = {
  VIDEO_TOO_LONG: "Vidéo trop longue.",
  INVALID_SEGMENT: "Segment invalide (début trop près de la fin).",
  DOWNLOAD_FAILED: "Téléchargement impossible.",
  LOW_SOURCE_QUALITY:
    "La vidéo récupérée est trop basse en définition pour nos clips (YouTube n'a pas fourni assez de pixels). Réessaie avec des cookies à jour, ou passe par l'upload d'un fichier HD.",
  YOUTUBE_COOKIES_EXPIRED:
    "YouTube a refusé le téléchargement (session expirée). Mets à jour les cookies dans les variables du serveur.",
  TRANSCRIPTION_FAILED: "Erreur de transcription.",
  RENDER_FAILED:
    "Le rendu du clip a échoué (format vidéo non supporté ou flux audio incompatible). Réessaie ou uploade la vidéo dans un autre format.",
  PROCESSING_FAILED: "Erreur lors du traitement.",
  UPLOAD_FAILED:
    "Le rendu est terminé mais l'upload du clip a échoué. Réessaie dans quelques instants.",
  UPLOAD_EXPIRED:
    "Ton upload a expiré avant le démarrage du traitement. Réimporte la vidéo puis relance.",
  NO_SEGMENTS_IN_WINDOW:
    "Aucun segment valide dans la zone choisie. Essaie une plage plus longue ou différente.",
  BACKEND_TIMEOUT: "Le traitement a dépassé le délai côté serveur. Réessaie.",
  BACKEND_SOCKET: "Connexion interrompue avec le serveur de clips. Réessaie.",
  BACKEND_ERROR: "Le serveur clips a renvoyé une erreur inattendue.",
  BACKEND_JOB_LOST:
    "Le traitement a été interrompu côté serveur (redémarrage ou charge). Relance la génération.",
};

export function clipJobErrorLabel(
  code: string | null | undefined,
  fallbackUnknown: string,
  locale?: string
): string {
  if (!code) return fallbackUnknown;
  if (locale === "en") {
    const enLabels: Record<string, string> = {
      VIDEO_TOO_LONG: "Video too long.",
      INVALID_SEGMENT: "Invalid segment (start too close to the end).",
      DOWNLOAD_FAILED: "Download failed.",
      LOW_SOURCE_QUALITY:
        "The retrieved video resolution is too low for our clips (YouTube didn't provide enough pixels). Try with updated cookies, or upload an HD file.",
      YOUTUBE_COOKIES_EXPIRED:
        "YouTube refused the download (session expired). Update cookies in server environment variables.",
      TRANSCRIPTION_FAILED: "Transcription error.",
      RENDER_FAILED:
        "Clip rendering failed (unsupported video format or incompatible audio stream). Try again or upload the video in another format.",
      PROCESSING_FAILED: "Processing error.",
      UPLOAD_FAILED:
        "Rendering completed but clip upload failed. Try again in a few moments.",
      UPLOAD_EXPIRED:
        "Your upload expired before processing started. Re-import the video and try again.",
      NO_SEGMENTS_IN_WINDOW:
        "No valid segment in the selected range. Try a longer or different range.",
      BACKEND_TIMEOUT: "Processing exceeded server timeout. Try again.",
      BACKEND_SOCKET: "Connection to clip server interrupted. Try again.",
      BACKEND_ERROR: "Clip server returned an unexpected error.",
      BACKEND_JOB_LOST:
        "Processing was interrupted on the server (restart or load). Restart generation.",
    };
    return enLabels[code] ?? code;
  }
  return CLIP_JOB_ERROR_LABELS[code] ?? code;
}

export function useClipJobErrorLabel() {
  const t = useTranslations("errors.clips");
  return (code: string | null | undefined) => {
    if (!code) return t("unknown");
    try {
      return t(code as Parameters<typeof t>[0]);
    } catch {
      return code;
    }
  };
}
