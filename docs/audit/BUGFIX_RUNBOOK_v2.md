# BUGFIX_RUNBOOK — Vyrll
> **Philosophie** : avant de toucher du code, comprendre *pourquoi* le problème existe à son niveau le plus fondamental. Un patch sans diagnostic de cause racine ne fait que déplacer le bug.

---

## Comment utiliser ce document

1. **Identifier le symptôme** dans l'index rapide ci-dessous
2. **Lire le diagnostic first principles** — demander "pourquoi ?" jusqu'à la cause racine, pas juste la cause de surface
3. **Appliquer le fix dans l'ordre indiqué** — ops d'abord, code ensuite
4. **Respecter les contraintes** listées pour chaque section

---

## Règles fondamentales (invariants du système)

Ces règles ne doivent jamais être remises en question lors d'un fix — elles sont les axiomes du projet.

| Invariant | Pourquoi c'est non-négociable |
|-----------|-------------------------------|
| 1 seul réplica Railway pour `backend-clips` | Les jobs vivent en RAM. Plusieurs réplicas = état distribué non cohérent = jobs perdus. |
| Patches chirurgicaux uniquement | Un fichier reécrit entier = régressions invisibles sur du code non ciblé. |
| Ne jamais modifier `render_subtitles.py` + `server.js` dans le même prompt | Ces deux fichiers sont couplés par un pipe stdin. Une modif de l'un change les attentes de l'autre. |
| Ne jamais toucher `clip-credits.ts` ni la RPC `increment_credits_used` | La facturation est le contrat financier avec l'utilisateur. Un bug ici = perte d'argent ou dette crédit silencieuse. |
| `CLIPS_MAX_PER_JOB=1` en local | yt-dlp + Whisper sur une connexion résidentielle = timeout garanti. Tout test de volume = Railway. |
| Migrations numérotées dans `supabase/migrations/` | Toute colonne ajoutée directement en prod sans migration = état de base de données non reproductible. |

---

## INDEX RAPIDE

| Symptôme | Section |
|----------|---------|
| UI « Erreur lors du traitement » / job disparu | [§1](#1--job-perdu-en-mémoire) |
| YouTube 429 / bot / cookies invalides | [§2](#2--youtube--yt-dlp) |
| Erreur Supabase `42703` colonne manquante | [§3](#3--migration-supabase-manquante) |
| Variable Railway > 32 768 chars | [§4](#4--variable-env-trop-longue) |
| Clips livrés sans sous-titres | [§5](#5--brokenpipe--fallback-sans-sous-titres) |
| Jobs très lents (> 15 min) | [§6](#6--performance) |
| Clips coupés en plein milieu de phrase | [§7](#7--frontières-de-phrase) |
| Moments détectés sans intérêt viral | [§8](#8--pertinence-gpt) |
| Split vertical déclenché à tort (monologue) | [§9](#9--split-vertical-faux-positifs) |
| Score viral incohérent (8 affiché au lieu de 80) | [§10](#10--score-viral) |
| Poll frontend en boucle infinie | [§11](#11--poll-404-infini) |

---

## §1 — Job perdu en mémoire

### Diagnostic first principles

**Pourquoi le job disparaît ?**
→ Les jobs sont stockés dans une `Map` JavaScript en RAM dans `server.js`.

**Pourquoi c'est un problème ?**
→ La RAM est volatile : un redémarrage du processus ou un second réplica Railway détruit la Map. Le poll du frontend reçoit alors 404 sur un job qui a pourtant existé.

**Pourquoi ne pas persister immédiatement ?**
→ Persister les jobs (Redis, Postgres) est un refactoring profond. La cause opérationnelle (redémarrage intempestif) est plus rapide à éliminer que de refondre le stockage.

**Cause racine** : architecture stateless simulée comme stateful. Le vrai fix long terme = persistence. Le fix immédiat = stabiliser le processus.

### Fix

**Ops en priorité** :
- Railway : vérifier que `backend-clips` a exactement **1 réplica**.
- Vérifier que le watcher Node est restreint à `--watch-path=./server.js` — les fichiers temporaires yt-dlp dans le même dossier déclenchent des redémarrages parasites.

**Code si ça persiste** :
- `src/app/api/clips/[jobId]/route.ts` — la logique `res.status === 404 → BACKEND_JOB_LOST` est déjà en place. Vérifier qu'elle est évaluée *avant* le parse de `backendData`.
- `src/lib/clip-errors.ts` — libellé `BACKEND_JOB_LOST` existe déjà.

**Ne pas faire** : implémenter Redis ou Postgres maintenant. C'est le bon fix architectural, mais c'est un chantier de 1-2 jours. Stabiliser d'abord.

---

## §2 — YouTube / yt-dlp

### Diagnostic first principles

**Pourquoi yt-dlp échoue ?**
→ YouTube authentifie les téléchargements. Depuis une IP datacenter (Railway), les requêtes sans session authentifiée sont bloquées ou rate-limitées agressivement.

**Pourquoi les cookies expirent ?**
→ YouTube invalide les sessions exportées si elles sont utilisées depuis une IP différente de celle d'export, ou après un certain temps.

**Cause racine** : le modèle de téléchargement côté serveur viole les ToS YouTube et repose sur une session utilisateur empruntée — intrinsèquement fragile. Le vrai fix = upload direct par l'utilisateur (hors scope à court terme).

### Fix

**Dans l'ordre** :
1. Exporter un nouveau `cookies.txt` depuis un navigateur connecté à YouTube (extension "Get cookies.txt LOCALLY").
2. Encoder en base64, mettre à jour `YT_DLP_COOKIES_BASE64` dans Railway (ou variables multi-part → §4 si trop long).
3. Forcer la mise à jour de yt-dlp dans le Dockerfile/nixpacks si l'erreur est extracteur et non cookies.

**Fichiers** :
- `backend-clips/server.js` — logique d'appel yt-dlp, variable `YT_DLP_COOKIES_FILE`
- `src/lib/clip-errors.ts` — libellé `YOUTUBE_COOKIES_EXPIRED` existe déjà

**Ne pas faire** : modifier la logique d'appel yt-dlp sans avoir d'abord vérifié que les cookies sont frais. 90 % des erreurs de cette catégorie sont des cookies périmés.

---

## §3 — Migration Supabase manquante

### Diagnostic first principles

**Pourquoi la colonne n'existe pas ?**
→ Le code a évolué (nouvelle colonne dans `server.js` ou les routes Next.js), mais la migration correspondante n'a pas été appliquée en production.

**Pourquoi ça n'est pas détecté avant ?**
→ Supabase ne valide pas le schéma au démarrage de l'app — l'erreur `42703` n'apparaît qu'à la première requête qui touche la colonne.

**Cause racine** : désynchronisation entre l'état du code et l'état de la base. Le fix est toujours dans la base, jamais dans le code (sauf fallback défensif temporaire).

### Fix

**Ops** : appliquer les migrations manquantes dans l'ordre dans le SQL Editor Supabase.

Migrations clés :
- `013_clip_jobs_params.sql` → `style`, `duration_min`, `duration_max`
- `014_*` → `source_duration_seconds`, RPC `increment_credits_used`
- `015_*` → `render_mode`, `split_confidence`, `start_time_sec`

**Code défensif si nécessaire** : `src/app/api/clips/[jobId]/route.ts` — si `selectFull` échoue avec code `42703`, basculer sur `selectMinimal`. La logique existe déjà — vérifier que `jobError` est remis à `null` après le fallback réussi.

**Ne pas faire** : ajouter des colonnes directement en SQL sans créer une migration numérotée dans `supabase/migrations/`.

---

## §4 — Variable env trop longue

### Diagnostic first principles

**Pourquoi la limite est atteinte ?**
→ `cookies.txt` contient toutes les cookies de session YouTube — un fichier volumineux. Encodé en base64 (ratio ~1.33×), il dépasse facilement la limite Railway de 32 768 caractères par variable.

**Cause racine** : Railway impose une contrainte de taille sur les variables d'environnement. La solution est de fractionner le payload, pas de le compresser (pertes d'information).

### Fix

- Découper le base64 en plusieurs variables : `YT_DLP_COOKIES_BASE64_1`, `YT_DLP_COOKIES_BASE64_2`, etc.
- `backend-clips/server.js` — la fonction `gatherYtDlpCookiesBase64FromEnv` doit concaténer ces parties dans l'ordre avant d'écrire le fichier temporaire.
- Voir `backend-clips/.env.example` pour le format attendu.

---

## §5 — BrokenPipe / fallback sans sous-titres

### Diagnostic first principles

**Pourquoi ffmpeg ferme le pipe avant la fin ?**
→ ffmpeg manque de RAM (OOM) ou le processus est tué par Railway. Il ferme son stdin, mais Python continue d'écrire des frames → `BrokenPipeError`.

**Pourquoi les clips sont quand même livrés ?**
→ Node attrape l'exception et lance `cutAndReformatNoSubtitles` — un second encodage sans karaoké. Le fallback est intentionnel mais invisible pour l'utilisateur.

**Pourquoi c'est difficile à debugger ?**
→ Sans log du stderr ffmpeg au moment du crash, on ne sait pas si c'est un OOM, un timeout, ou un bug d'encodage.

**Cause racine** : surcharge mémoire/CPU sur Railway. Le fix primaire est opérationnel, le fix code secondaire améliore l'observabilité.

### Fix

**Ops en priorité** : `RENDER_CONCURRENCY=1` dans les variables Railway de `backend-clips`.

**Code Python** : `backend-clips/render_subtitles.py`, boucle pass 2 (~lignes 1012–1083)
- Wrapper `proc.stdin.write(frame.tobytes())` dans un `try/except BrokenPipeError` qui loggue `FFMPEG_STDERR` et raise.
- Bloc `finally` : fermer `proc.stdin`, appeler `proc.wait()`, joindre le thread stderr, appeler `cap.release()`.
- **Contrainte** : ne pas dupliquer `cap.release()` — vérifier que le `finally` est le seul endroit qui l'appelle dans ce bloc.

**Code Node** : `backend-clips/server.js`, `renderOneClip`
- Le fallback `cutAndReformatNoSubtitles` est intentionnel — ne pas le supprimer.
- Ajouter uniquement un log plus détaillé (stderr Python) pour faciliter le debug.

---

## §6 — Performance

### Diagnostic first principles

**Pourquoi les jobs sont lents ?**
→ Railway = CPU-only. Le rendu pass 2 (décodage 1080p → Pillow → pipe rawvideo → x264) tourne à ~0.2–0.35× la vitesse réelle. C'est intrinsèquement lent sans GPU.

**Pourquoi ne pas augmenter la concurrence ?**
→ Sur une instance Railway hobby, plus de concurrence = plus de RAM consommée simultanément = risque d'OOM = BrokenPipe (§5). Contre-productif.

**Cause racine** : contrainte matérielle. Le levier principal est la configuration d'encodage, pas l'architecture.

### Fix

Variables Railway `backend-clips` :
```
RENDER_CONCURRENCY=1
RENDER_MAX_OUTPUT_FPS=24
RENDER_LIBX264_PRESET=veryfast
RENDER_LIBX264_CRF=28
```

**Ne pas faire** : augmenter `RENDER_CONCURRENCY` sans avoir vérifié la RAM disponible. Ne pas toucher la logique `generateProxy` — le proxy est calculé une seule fois par job, c'est déjà optimal.

---

## §7 — Frontières de phrase

### Diagnostic first principles

**Pourquoi les clips commencent ou finissent en plein milieu d'une phrase ?**
→ `isCleanSentenceEnd()` repose sur la ponctuation Whisper. Or Whisper en mode transcription orale omet souvent les points et virgules — notamment en français.

**Pourquoi `enforceCleanEnd/Start` ne corrige pas ?**
→ Si aucun segment "propre" n'est trouvé dans un rayon de ±3, le moment est retourné tel quel. Le rayon est trop petit et le signal de propreté trop restrictif.

**Cause racine** : dépendance excessive à la ponctuation d'un modèle de transcription qui n'est pas fiable sur ce point. Le signal de frontière doit être élargi (pause inter-mots) et le rayon de recherche augmenté.

### Fix

Fichier : `backend-clips/server.js`

1. Créer `isCleanBoundary(segments, index, words)` combinant : ponctuation Whisper **OU** pause inter-mots ≥ 0.35s (ajusté français oral) **OU** mot naturel de fin. Les `words` sont déjà disponibles depuis `transcribeWithWhisper`.
2. Élargir le rayon de recherche de ±3 à **±5** dans `enforceCleanEnd/Start`.
3. Si aucun boundary propre après ±5 : garder le moment mais baisser `score_viral` de 2 points. Ne jamais rejeter un moment uniquement pour cette raison.

**Contrainte absolue** : ne jamais raccourcir un clip sous `durationMin` pour trouver une fin propre. Si le compromis est impossible, garder la fin originale.

---

## §8 — Pertinence GPT

### Diagnostic first principles

**Pourquoi GPT détecte de mauvais moments ?**
→ Un seul appel GPT-4o-mini doit simultanément comprendre la structure narrative ET sélectionner des moments précis avec timestamps. C'est deux tâches cognitives distinctes mélangées dans un seul prompt surchargé.

**Pourquoi GPT-4o-mini spécifiquement ?**
→ Il fait des erreurs d'arithmétique sur les timestamps (durée = fin - début) et n'a pas assez de "espace de raisonnement" pour la compréhension narrative dans un prompt aussi dense.

**Cause racine** : mauvaise séparation des responsabilités dans le pipeline IA. Un modèle ne peut pas bien faire deux choses à la fois dans un seul prompt.

### Fix

Fichier : `backend-clips/server.js`, `detectMoments()`

Pipeline 2 passes :
1. **Passe 1** — `preAnalyzeTranscript(segments, ctx)` : appel GPT-4o (pas mini) uniquement pour la compréhension narrative. Output : `{ summary, narrative_structure, key_moments }`. Déclencher seulement si vidéo > 5 min.
2. **Passe 2** — `detectMoments()` existant enrichi du contexte passe 1. GPT-4o-mini garde la sélection structurée.
3. **Quality gate** dans `processJob()` : rejeter les moments avec `score_viral < 5`. Si < 3 moments passent, relancer passe 2 avec prompt élargi.

**Contraintes** :
- La passe 1 est un *hint*, pas une contrainte dure — la passe 2 reste souveraine.
- Toujours pré-calculer `duree_calculee` et l'inclure dans le JSON demandé. GPT-4o-mini ne fait pas d'arithmétique fiable sur les timestamps.
- Loguer les moments rejetés (score < 5) pour analyse.

---

## §9 — Split vertical faux positifs

### Diagnostic first principles

**Pourquoi le split se déclenche sur un monologue ?**
→ MediaPipe détecte des visages dans l'arrière-plan ou le public. Le filtre `min_area_ratio=0.20` laisse passer des visages trop petits pour être des locuteurs actifs.

**Pourquoi le seuil de confidence est insuffisant ?**
→ `confidence >= 0.6` avec un seul signal (visuel) active le split dans des cas ambigus. La confiance doit être plus haute ET requérir un signal secondaire (pattern dialogue ou tag GPT).

**Cause racine** : les seuils de détection ont été calibrés trop bas, privilégiant la sensibilité (ne pas rater une vraie interview) au détriment de la précision (ne pas créer de faux splits). Le brief actuel inverse cette priorité : un faux négatif (vraie interview traitée en mono) est préférable à un faux positif.

### Fix

`backend-clips/render_subtitles.py` — `analyze_face_count_for_clip()` :
- `min_area_ratio` : 0.20 → **0.35**
- `multi_face_threshold` : 0.60 → **0.70**
- Ajouter filtre distance : `|cx1 - cx2| >= 0.25` entre les deux faces détectées, sinon ignorer.

`backend-clips/server.js` — `determineSplitMode()` :
- Seuil confidence : 0.6 → **0.7**
- Condition : `confidence >= 0.8 AND (dialogueOk OR gptOk)` (au lieu de `confidence >= 0.8` seul)
- Vérifier `|cx1 - cx2| > 0.3` entre les deux `median_positions`.

**Contrainte** : tester sur 3 vidéos minimum (1 monologue, 1 interview, 1 groupe) avant de merger. Ne pas implémenter de speaker diarization — hors scope.

---

## §10 — Score viral

### Diagnostic first principles

**Pourquoi le score est incohérent ?**
→ GPT reçoit l'instruction "note de 1 à 10" mais retourne parfois 85/100 ou 8.5. Il n'y a pas de normalisation backend — le score brut est stocké tel quel.

**Pourquoi le hack frontend ne suffit pas ?**
→ `clip.scoreViral >= 10 ? clip.scoreViral : Math.round(clip.scoreViral * 10)` traite 85 (GPT sur 100) comme déjà normalisé et le laisse à 85. Mais il traite 8 (GPT sur 10) en le multipliant par 10 → 80. Le hack dépend du fait que GPT reste en dessous de 10, ce qui n'est pas garanti.

**Cause racine** : absence de normalisation à la source (backend). La règle est simple : normaliser une fois, côté backend, au moment du stockage. Le frontend ne doit jamais décider du format des données.

### Fix

`backend-clips/server.js` — ajouter `normalizeScoreViral(raw)` et l'appliquer dans `processJob()` :
```
≤ 10  → × 10        (8 → 80, 8.5 → 85)
≤ 100 → arrondir    (85 → 85)
> 100 → ÷ 10        (850 → 85, sécurité)
NaN / ≤ 0 → null
```

`src/app/clips/projet/[jobId]/page.tsx` :
- Supprimer le hack `score100 = ...`
- Utiliser directement `clip.scoreViral` (déjà normalisé sur 100 depuis le backend)
- Garder une normalisation défensive pour les anciens clips en base : même logique, appliquée à l'affichage uniquement

Badge couleur : ≥ 80 → emerald, ≥ 60 → amber, < 60 → gris.

---

## §11 — Poll 404 infini

### Diagnostic first principles

**Pourquoi le poll ne s'arrête pas ?**
→ Le frontend interprète 404 comme "job pas encore crété" et continue de poller. Mais un 404 sur un job existant signifie en réalité "job perdu" (redémarrage backend → §1). Le frontend ne distingue pas ces deux cas.

**Pourquoi le backend redémarre en cours de job ?**
→ Node `--watch` surveille le dossier entier `backend-clips/`. yt-dlp crée des fichiers temporaires dans ce dossier → déclenche un rechargement du module → le job en RAM disparaît.

**Cause racine** : périmètre du watcher trop large + sémantique 404 ambiguë côté frontend.

### Fix

**Ops** : restreindre le watcher à `--watch-path=./server.js` dans `backend-clips/package.json`.

**Code frontend** : `src/app/clips/projet/[jobId]/page.tsx`
- Si le poll reçoit `status === 'error'` avec code `BACKEND_JOB_LOST` → **arrêter immédiatement le poll** et afficher le message d'erreur.
- Ne jamais continuer à poller sur un 404 backend.

---

## Référence des fichiers clés

| Fichier | Responsabilité |
|---------|---------------|
| `backend-clips/server.js` | Cœur du pipeline : yt-dlp, Whisper, GPT, rendu, upload |
| `backend-clips/render_subtitles.py` | Smart crop (2 passes) + Pillow karaoké + pipe ffmpeg |
| `backend-clips/subtitles.js` | Styles de sous-titres (couleurs, polices) — ne pas modifier les couleurs |
| `src/app/api/clips/[jobId]/route.ts` | Poll Supabase ↔ backend, mapping erreurs |
| `src/app/api/clips/start/route.ts` | Création job, vérification crédits, insert Supabase |
| `src/app/clips/projet/[jobId]/page.tsx` | UI détail job : grille clips, scores, téléchargement |
| `src/lib/clip-credits.ts` | Logique crédits — **ne pas modifier** |
| `src/lib/clip-errors.ts` | Libellés codes erreur UI |
| `src/lib/backend-fetch.ts` | `fetchBackendWithRetry`, timeouts |
| `supabase/migrations/` | Toutes les migrations — appliquer dans l'ordre numérique |

---

## Variables Railway à vérifier en premier

```dotenv
# backend-clips
RENDER_CONCURRENCY=1           # toujours 1 sur Railway CPU-only
RENDER_MAX_OUTPUT_FPS=24
RENDER_LIBX264_PRESET=veryfast
YT_DLP_COOKIES_BASE64          # ou _1 + _2 si trop long
CLIPS_MAX_PER_JOB=3            # 1 uniquement en local

# Next.js
BACKEND_URL                    # doit pointer vers le bon service Railway
BACKEND_SECRET                 # doit matcher backend-clips
```

---

*Maintenir ce fichier à chaque nouveau bug résolu. Format à respecter : symptôme → "pourquoi ?" jusqu'à la cause racine → fix dans l'ordre → contraintes.*
