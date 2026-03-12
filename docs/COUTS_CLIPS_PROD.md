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

1. **Réduire la durée transcrite**  
   Au lieu de transcrire toute la vidéo (jusqu’à 20 min), tu pourrais :
   - limiter à N premières minutes (ex. 10 min), ou  
   - utiliser un découpage préalable (extraits) puis ne transcrire que ces extraits.  
   → Réduction directe du coût Whisper.

2. **Modèle Whisper moins cher**  
   Si l’API le propose (ex. “whisper-1” vs “gpt-4o-mini transcribe”), comparer les tarifs et la qualité pour ton usage.

3. **Cache / déduplication**  
   Si la même URL est retraitée (même vidéo, autre style/durée), éviter de retranscrire : stocker la transcription par `url` (ou hash) et ne rappeler Whisper que si nouvelle vidéo.

4. **Quotas par plan**  
   Tu limites déjà (Pro 10, Unlimited 50 jobs). Tu peux aligner ces limites sur ton coût cible (ex. 10 jobs ≈ 0,50–1 $ de plus par user actif).

5. **Vieillissement du stockage**  
   Politique de suppression ou archivage des clips après X jours pour garder le bucket `clips` sous le quota Pro.

---

## 6. Résumé

- **Coût principal** : **OpenAI Whisper** (transcription de la vidéo entière, jusqu’à 20 min).
- **Ordre de grandeur** : **~0,05–0,10 $ par job** (1 job = 3 clips).
- **Storage** : gérable avec 100 Go Pro tant que le nombre de clips stockés reste raisonnable.
- Pour analyser ta prod réelle : suivre dans le dashboard OpenAI l’usage **Whisper** (minutes) et **GPT-4o-mini** (tokens) par période.

Si tu veux, on peut ajouter un petit script ou une route admin qui estime le coût des N derniers jobs (durée vidéo × 0,006 + 1 appel GPT) à partir de la table `clip_jobs` et des métadonnées stockées.
