# Analyse des coûts de production — Clips

Résumé des coûts par **job** (1 vidéo → 3 clips générés) et en **mensuel** selon le volume.

---

## 1. Par job : ce qui consomme

| Poste | Détail | Coût unitaire (ordre de grandeur) |
|-------|--------|------------------------------------|
| **OpenAI Whisper** | Transcription de **toute** la vidéo (limite 20 min). Facturation à la minute. | **~0,006 $/min** → vidéo 10 min ≈ **0,06 $** / job |
| **OpenAI GPT-4o-mini** | 1 appel pour détecter les 3 moments (transcription + prompt système + JSON). | Input ~0,15 $/1M tokens, output ~0,60 $/1M → **~0,001–0,003 $** / job |
| **Supabase Storage** | 3 MP4 par job (bucket `clips`). ~10–25 Mo par clip selon durée/qualité → ~30–75 Mo/job. | Inclus dans le quota Pro (100 Go) ; au-delà **~0,024 $/Go/mois** |
| **Backend (CPU/ram)** | yt-dlp + ffmpeg + script Python (Pillow). Pas d’API payante. | Dépend de l’hébergeur (Railway, Render, VPS, etc.) |
| **Bande passante** | Téléchargement vidéo (yt-dlp) + upload des 3 clips vers Supabase. | Souvent inclus ou facturé au Go par l’hébergeur |

**Coût OpenAI par job (ordre de grandeur)**  
- Vidéo courte (5 min) : Whisper ~0,03 $ + GPT ~0,002 $ ≈ **0,032 $**  
- Vidéo moyenne (10 min) : Whisper ~0,06 $ + GPT ~0,002 $ ≈ **0,062 $**  
- Vidéo longue (20 min) : Whisper ~0,12 $ + GPT ~0,003 $ ≈ **0,123 $**

En pratique : **~0,05–0,10 $ par job** selon la durée des vidéos.

---

## 2. Exemples mensuels (OpenAI uniquement)

| Volume | Hypothèse durée moyenne | Coût Whisper | Coût GPT-4o-mini | Total OpenAI / mois |
|--------|-------------------------|--------------|-------------------|----------------------|
| 50 jobs | 10 min | ~30 $ | ~0,10 $ | **~30 $** |
| 200 jobs | 10 min | ~120 $ | ~0,40 $ | **~120 $** |
| 500 jobs | 10 min | ~300 $ | ~1 $ | **~300 $** |

Le poste dominant est **Whisper** (transcription de la vidéo entière), pas GPT-4o-mini.

---

## 3. Supabase Storage (bucket `clips`)

- **Pro** : 100 Go inclus. Au-delà : ~0,024 $/Go/mois.
- Ordre de grandeur : ~50 Mo/job → 100 Go ≈ **~2 000 jobs** de clips stockés.
- Si vous supprimez ou purgez les anciens clips, le stockage reste maîtrisé.

---

## 4. Où sont les coûts dans le code

| Coût | Fichier | Fonction / usage |
|------|---------|-------------------|
| Whisper | `backend-clips/server.js` | `transcribeWithWhisper()` → `openai.audio.transcriptions.create` (modèle `whisper-1`) |
| GPT-4o-mini | `backend-clips/server.js` | `detectMoments()` → `openai.chat.completions.create` (modèle `gpt-4o-mini`) |
| Stockage | `backend-clips/server.js` | `uploadToSupabase()` → bucket `clips` |

---

## 5. Pistes pour réduire les coûts

### Fait (compression qualité-safe — août 2026)

1. **Skip `-clean.mp4` pour free**  
   L’export subtitled (qualité produit) est **identique** free/paid. Le clean n’est utile que pour le reburn Creator/Studio — free ne le génère / n’upload plus.

2. **Cache Whisper R2** (`transcriptions/v1/…`)  
   Même URL (ou upload) + même fenêtre manuelle → réutilise la transcription. Désactiver : `WHISPER_CACHE=0`.

3. **AAC défaut 192k** (tous les plans, avec `-ar 48000 -ac 2`)  
   Override : `RENDER_AUDIO_BITRATE`.

4. **Vieillissement du stockage**  
   Comptes **free** — purge auto des projets clips (`clip_jobs` + R2) **2 jours** après `created_at`. Creator / Studio : pas d’expiration.  
   Reaper horaire (`reapExpiredFreeClips`) + `GET /api/cron/cleanup-expired-clips`.

### Autres pistes (non implémentées)

- Réduire la durée transcrite (plafond minutes / extraits).
- Modèle Whisper alternatif si tarif/qualité OK.
- Pousser le mode manuel (fenêtres courtes) côté produit.
- **Ne pas** monter CRF / baisser FPS / résolution si on veut le même rendu.

---

## 6. Résumé

- **Coût principal** : **OpenAI Whisper** (transcription de la vidéo entière, jusqu’à 20 min).
- **Ordre de grandeur** : **~0,05–0,10 $ par job** (1 job = 3 clips).
- **Storage** : gérable avec 100 Go Pro tant que le nombre de clips stockés reste raisonnable.
- Pour analyser ta prod réelle : suivre dans le dashboard OpenAI l’usage **Whisper** (minutes) et **GPT-4o-mini** (tokens) par période.

Si tu veux, on peut ajouter un petit script ou une route admin qui estime le coût des N derniers jobs (durée vidéo × 0,006 + 1 appel GPT) à partir de la table `clip_jobs` et des métadonnées stockées.
