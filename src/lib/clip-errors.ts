/** Codes d’erreur renvoyés par le worker clips (backend-clips). */
export const CLIP_JOB_ERROR_LABELS: Record<string, string> = {
  VIDEO_TOO_LONG: "Vidéo trop longue.",
  INVALID_SEGMENT: "Segment invalide (début trop près de la fin).",
  DOWNLOAD_FAILED: "Téléchargement impossible.",
  /** Cookies YouTube expirés ou refusés (yt-dlp) — mettre à jour YT_DLP_COOKIES_BASE64. */
  YOUTUBE_COOKIES_EXPIRED:
    "YouTube a refusé le téléchargement (session expirée). Mets à jour les cookies dans les variables du serveur.",
  TRANSCRIPTION_FAILED: "Erreur de transcription.",
  PROCESSING_FAILED: "Erreur lors du traitement.",
};

export function clipJobErrorLabel(
  code: string | null | undefined,
  fallbackUnknown: string
): string {
  if (!code) return fallbackUnknown;
  return CLIP_JOB_ERROR_LABELS[code] ?? code;
}
