/** Codes d’erreur renvoyés par le worker clips (backend-clips). */
export const CLIP_JOB_ERROR_LABELS: Record<string, string> = {
  VIDEO_TOO_LONG: "Vidéo trop longue.",
  INVALID_SEGMENT: "Segment invalide (début trop près de la fin).",
  DOWNLOAD_FAILED: "Téléchargement impossible.",
  /** Source YouTube trop basse par rapport au seuil (ex. 1080p) — flux HD indisponible ou cookies / PO Token. */
  LOW_SOURCE_QUALITY:
    "La vidéo récupérée est trop basse en définition pour nos clips (YouTube n’a pas fourni assez de pixels). Réessaie avec des cookies à jour, ou passe par l’upload d’un fichier HD.",
  /** Cookies YouTube expirés ou refusés (yt-dlp) — mettre à jour YT_DLP_COOKIES_BASE64. */
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
  BACKEND_TIMEOUT:
    "Le traitement a dépassé le délai côté serveur. Réessaie.",
  BACKEND_SOCKET:
    "Connexion interrompue avec le serveur de clips. Réessaie.",
  BACKEND_ERROR:
    "Le serveur clips a renvoyé une erreur inattendue.",
  /** Worker a redémarré, autre instance, ou mauvais routage — jobs stockés en mémoire sur le backend. */
  BACKEND_JOB_LOST:
    "Le traitement a été interrompu côté serveur (redémarrage ou charge). Relance la génération.",
};

export function clipJobErrorLabel(
  code: string | null | undefined,
  fallbackUnknown: string
): string {
  if (!code) return fallbackUnknown;
  return CLIP_JOB_ERROR_LABELS[code] ?? code;
}
