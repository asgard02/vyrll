# Explication des erreurs — backend-clips

Prompt à donner à Claude pour qu’il comprenne et explique les erreurs du système de génération de clips.

---

## Contexte

Le système génère des clips à partir de vidéos YouTube/Twitch. Pipeline : téléchargement (yt-dlp) → extraction audio (ffmpeg) → transcription (Whisper) → détection des moments viraux (GPT) → rendu des clips (ffmpeg + Python).

Limites : vidéos max 50 min ; Whisper accepte max 25 Mo par fichier audio.

---

## Erreurs métier (ce que l’utilisateur voit)

### VIDEO_TOO_LONG — « Vidéo trop longue »

La vidéo dépasse 50 minutes. L’API Whisper et le traitement ne sont pas prévus pour des durées plus longues. La limite est définie côté backend.

---

### DOWNLOAD_FAILED — « Téléchargement impossible »

Le téléchargement de la vidéo (yt-dlp) ou l’extraction de l’audio (ffmpeg) a échoué. Causes possibles : vidéo privée/supprimée, URL invalide, problème réseau, quota YouTube dépassé, ou ffmpeg/yt-dlp non installés.

---

### YOUTUBE_COOKIES_EXPIRED — « YouTube a refusé le téléchargement »

YouTube renvoie « Sign in to confirm you’re not a bot » : les cookies passés à yt-dlp sont expirés ou invalides, ou l’IP du serveur est bloquée. **Correctif opérateur** : exporter un `cookies.txt` frais depuis le navigateur (connecté sur youtube.com), l’encoder en base64, mettre à jour la variable `YT_DLP_COOKIES_BASE64` sur le déploiement (ex. Railway), puis redéployer.

---

### TRANSCRIPTION_FAILED — « Erreur de transcription »

L’API Whisper n’a pas pu transcrire l’audio, ou n’a renvoyé aucun segment exploitable. Causes possibles : fichier audio corrompu, format non supporté, ou erreur côté OpenAI (quota, timeout).

---

### PROCESSING_FAILED — « Erreur lors du traitement »

Erreur générique après la transcription. Peut venir de : GPT qui ne trouve aucun moment viral, erreur ffmpeg lors du rendu, ou erreur Python (render_subtitles). Toute exception non mappée (413, timeout, etc.) est aussi renvoyée sous ce code.

---

## Erreurs techniques (dans les logs)

### 413 — Maximum content size limit (26214400) exceeded

L’API Whisper limite les fichiers à 25 Mo. L’audio extrait est trop gros (souvent parce qu’il est encodé en haute qualité). L’audio doit être encodé en 64 kbps, 16 kHz, mono pour rester sous la limite.

---

### getaddrinfo ENOTFOUND *.supabase.co

Impossible de résoudre l’adresse Supabase. Problème DNS ou réseau : connexion internet, VPN, pare-feu, ou Supabase temporairement indisponible.

---

### read ETIMEDOUT

La connexion a expiré avant la fin de la requête. Connexion lente, serveur surchargé, ou timeout trop court pour une opération longue (ex. transcription d’une vidéo de 50 min).

---

### 401 Unauthorized

Authentification refusée. Soit la session utilisateur a expiré (re-login), soit le `x-backend-secret` envoyé au backend clips est invalide ou manquant.

---

### 404 Job introuvable

Le job n’existe plus ou l’ID est incorrect. Peut arriver si le job a été supprimé pendant le traitement, ou si le `backend_job_id` en base ne correspond pas au job en mémoire côté backend.

---

## Progression bloquée (ex. 15 % pendant 5+ min)

La barre de progression reflète les étapes du pipeline. Si elle reste longtemps à 15 % : soit le téléchargement est encore en cours (vidéo longue = plusieurs minutes), soit on est déjà en transcription Whisper (5–15 min pour une vidéo longue). La transcription est l’étape la plus lente ; ce n’est pas forcément un blocage.
