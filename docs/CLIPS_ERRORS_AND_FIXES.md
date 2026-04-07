# Clips : inventaire des erreurs, causes et pistes de correction

Ce document regroupe les erreurs observées sur le flux **génération de clips** (Next.js ↔ Supabase ↔ `backend-clips`), les modifications possibles, et des **extraits de code** « avant / après » à titre de référence (à adapter lors d’une implémentation réelle).

---

## Table des matières

1. [Erreur UI « Erreur lors du traitement » / job perdu](#1-backend--job-perdu--erreur-lors-du-traitement)
2. [YouTube : 429, cookies, « Sign in to confirm you’re not a bot »](#2-youtube--yt-dlp)
3. [Supabase `42703` : colonne `clip_jobs.style` (ou autre) absente](#3-supabase--colonne-manquante)
4. [Railway : limite 32 768 caractères sur `YT_DLP_COOKIES_BASE64`](#4-variables-denvironnement--cookies)
5. [Python `BrokenPipeError` + fallback sans sous-titres](#5-rendu-pillow--brokenpipe--fallback)
6. [Performance (temps de job élevé)](#6-performance)
7. [Synthèse : priorisation](#7-synthèse)

---

## 1. Backend / job perdu (« Erreur lors du traitement »)

### Symptômes

- Durée OK au départ, puis échec avec code **`PROCESSING_FAILED`** ou **`BACKEND_JOB_LOST`**.
- Côté API : poll du backend qui renvoie **404** sur `GET /jobs/:backend_job_id`.

### Cause

- Dans `backend-clips`, les jobs sont stockés **en mémoire** (`Map`). Un **redémarrage** du conteneur ou **plusieurs réplicas** Railway ⇒ l’instance qui répond au poll n’a pas le job ⇒ **404**.

### Fichiers concernés

- `backend-clips/server.js` — stockage des jobs
- `src/app/api/clips/[jobId]/route.ts` — mapping 404 → `BACKEND_JOB_LOST`
- `src/lib/clip-errors.ts` — libellé utilisateur

### Modifications possibles (ops + code)

| Action | Type |
|--------|------|
| **1 seul réplica** pour le service `backend-clips` sur Railway | Ops |
| Éviter les redémarrages pendant un gros job (plan RAM/CPU) | Ops |
| Persister les jobs (Redis / Postgres) — refonte | Code lourd |

### Code déjà en place (référence)

**`src/app/api/clips/[jobId]/route.ts`** — extrait (logique 404 → erreur dédiée) :

```typescript
// Backend 404 = job absent en mémoire (redémarrage, autre réplica, etc.) → code dédié
const backendGone = res.status === 404;
const backendError = backendGone
  ? "BACKEND_JOB_LOST"
  : backendData.error ?? (res.ok ? null : backendData.message ?? "PROCESSING_FAILED");
```

**`src/lib/clip-errors.ts`** :

```typescript
BACKEND_JOB_LOST:
  "Le traitement a été interrompu côté serveur (redémarrage ou charge). Relance la génération.",
```

---

## 2. YouTube / yt-dlp

### Symptômes

- `HTTP Error 429: Too Many Requests`
- `The provided YouTube account cookies are no longer valid`
- `Sign in to confirm you're not a bot`

### Cause

- **Limitation de débit** (429), **cookies** expirés ou **invalidés** après export, **IP datacenter** souvent plus contrainte.

### Fichiers concernés

- `backend-clips/server.js` — appels `yt-dlp`, message d’erreur `YOUTUBE_COOKIES_EXPIRED`
- Variables : `YT_DLP_COOKIES_BASE64`, `YT_DLP_COOKIES_BASE64_1`…, `YT_DLP_COOKIES_FILE`, etc.

### Modifications possibles

| Action | Détail |
|--------|--------|
| Renouveler `cookies.txt` | Export frais depuis un navigateur connecté à YouTube |
| Mettre à jour **yt-dlp** dans l’image Docker / build | Réduit les échecs extracteur |
| Multi-part base64 | Voir [§4](#4-variables-denvironnement--cookies) |
| Proxy résidentiel / autre réseau | Hors scope code applicatif |

### Code déjà en place (référence)

Message utilisateur dans `src/lib/clip-errors.ts` :

```typescript
YOUTUBE_COOKIES_EXPIRED:
  "YouTube a refusé le téléchargement (session expirée). Mets à jour les cookies dans les variables du serveur.",
```

---

## 3. Supabase : colonne manquante

### Symptômes

- `42703 column clip_jobs.style does not exist` (ou autre colonne listée dans le `select`).

### Cause

- Les **migrations** du dépôt ne sont pas toutes appliquées sur la base Supabase **production** / **staging**.

### Fichiers concernés

- `supabase/migrations/013_clip_jobs_params.sql` (entre autres)
- `src/app/api/clips/[jobId]/route.ts` — `selectFull` inclut `style`, `duration_min`, etc.
- `src/app/api/clips/start/route.ts` — `insert` avec `style`, `duration_min`, `duration_max` + fallbacks `PGRST204`

### Modification recommandée (ops)

Appliquer la migration sur Supabase (SQL Editor ou `supabase db push`).

**Contenu actuel de `013_clip_jobs_params.sql` :**

```sql
-- Paramètres de génération des clips (pour affichage détail, ex. en dev)
ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS style TEXT DEFAULT 'karaoke';

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS duration_min INT;

ALTER TABLE public.clip_jobs
  ADD COLUMN IF NOT EXISTS duration_max INT;
```

### Modification code optionnelle

Si tu veux **éviter tout bruit** quand une colonne manque encore : interroger d’abord un `select` minimal, ou attraper `42703` et enchaîner sur le fallback (le route `[jobId]` tente déjà un `selectMinimal` si le premier `select` échoue — vérifier que le fallback reçoit bien `data` et que `jobError` est bien remis à `null`).

**Exemple de renfort explicite (pseudo-diff)** — `src/app/api/clips/[jobId]/route.ts` :

```diff
     let { data: job, error: jobError } = await supabase
       .from("clip_jobs")
       .select(selectFull)
       .eq("id", jobId)
       .eq("user_id", user.id)
       .single();

-    if (jobError && !job) {
+    const missingColumn =
+      jobError && (jobError as { code?: string }).code === "42703";
+    if ((jobError && !job) || missingColumn) {
       const fallback = await supabase
         .from("clip_jobs")
         .select(selectMinimal)
```

> À valider : le client Supabase renvoie bien `code: "42703"` pour « colonne inexistante » sur le `select` initial.

---

## 4. Variables d’environnement / cookies

### Symptômes

- Railway : `Variable value exceeds maximum length of 32768`.

### Cause

- Un seul secret **base64** trop gros pour une variable d’env.

### Modification déjà prévue dans le dépôt

- Découper en `YT_DLP_COOKIES_BASE64_1`, `YT_DLP_COOKIES_BASE64_2`, … et concaténation côté `backend-clips/server.js` (`gatherYtDlpCookiesBase64FromEnv` ou équivalent).

### Documentation

- Voir `backend-clips/.env.example` pour les commentaires sur les parties multiples.

---

## 5. Rendu Pillow : `BrokenPipe` + fallback

### Symptômes

- Python : `BrokenPipeError: [Errno 32] Broken pipe` sur `proc.stdin.write(frame.tobytes())`.
- Node : `Rendu Pillow échoué, fallback sans sous-titres:` puis `FFMPEG_CMD (no-subs): ...`

### Cause

- **ffmpeg** ferme l’entrée standard avant la fin des frames (souvent **OOM**, crash ffmpeg, ou charge excessive avec **plusieurs** rendus en parallèle).
- Le handler Node attrape l’erreur et lance un **second** encodage **sans** karaoké.

### Fichiers concernés

- `backend-clips/render_subtitles.py` — boucle pass 2, ~lignes 1012–1083
- `backend-clips/server.js` — `renderClipWithSubtitles`, `renderOneClip` try/catch + `cutAndReformatNoSubtitles`

### Code actuel (référence)

**`render_subtitles.py`** — extrait critique :

```python
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
# ...
for i in range(clip_frames_out):
    # ...
    proc.stdin.write(frame.tobytes())
# ...
proc.stdin.close()
proc.wait()
```

**`server.js`** — extrait :

```javascript
try {
  await renderClipWithSubtitles(/* ... */);
} catch (pyErr) {
  console.warn("Rendu Pillow échoué, fallback sans sous-titres:", pyErr.message);
  await cutAndReformatNoSubtitles(videoPath, start, end, outPath, format);
}
```

### Modifications possibles

| Priorité | Action |
|----------|--------|
| Ops | `RENDER_CONCURRENCY=1` ou `2` sur une petite instance pour limiter OOM |
| Code Python | `try` / `finally` : en cas d’exception, `proc.stdin.close()`, `proc.kill()` si besoin, **joindre** le thread stderr et **imprimer** `FFMPEG_STDERR` (même si exception avant `wait`) |
| Code Python | `proc.stdin.write(...)` dans un `try` : capturer `BrokenPipeError`, relire stderr, `sys.exit(1)` avec message clair |
| Code Node | Optionnel : **ne pas** lancer le fallback si tu préfères marquer le clip en erreur (produit plus strict) |

### Exemple de patch Python (proposition)

**Objectif** : toujours logguer stderr ffmpeg si le pipe casse.

```python
def _ffmpeg_stderr_tail(chunks: list[bytes], max_chars: int = 8000) -> str:
    raw = b"".join(chunks).decode("utf-8", errors="replace")
    return raw[-max_chars:] if len(raw) > max_chars else raw


# Dans main(), remplacer le bloc pass2 nu par une structure du type :
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
stderr_chunks: list[bytes] = []
stderr_thread = threading.Thread(
    target=_drain_subprocess_stderr,
    args=(proc, stderr_chunks),
    daemon=True,
)
stderr_thread.start()

try:
    for i in range(clip_frames_out):
        # ... même corps qu'aujourd'hui ...
        try:
            proc.stdin.write(frame.tobytes())
        except BrokenPipeError:
            print("[RENDER] BrokenPipeError while writing frame", i, flush=True)
            print("FFMPEG_STDERR:", _ffmpeg_stderr_tail(stderr_chunks), flush=True)
            raise
finally:
    try:
        if proc.stdin:
            proc.stdin.close()
    except Exception:
        pass
    proc.wait(timeout=600)
    stderr_thread.join(timeout=120)
    print("FFMPEG_STDERR:", _ffmpeg_stderr_tail(stderr_chunks), flush=True)
    cap.release()
```

> À intégrer proprement avec la structure **existante** (timings `t_pass2`, `returncode`, etc.) pour ne pas dupliquer `cap.release()`.

---

## 6. Performance

### Symptômes

- Jobs longs (ex. ~20–25 min pour une vidéo source ~30 min + plusieurs clips).

### Causes principales

- **Proxy** `generateProxy` : coût **une fois par job**.
- **Pass 2** : décodage 1080p + Pillow + pipe rawvideo → **x264** (souvent **~0.2–0.35×** « speed » dans les logs ffmpeg).
- **`RENDER_CONCURRENCY` > 1** : peut accélérer le **mur du temps** ou au contraire saturer CPU / RAM.

### Variables (déjà documentées dans `backend-clips/.env.example`)

- `RENDER_CONCURRENCY`
- `RENDER_MAX_OUTPUT_FPS`
- `RENDER_LIBX264_PRESET`, `RENDER_LIBX264_CRF`, `RENDER_LIBX264_THREADS`

### Modification type

```dotenv
RENDER_CONCURRENCY=1
RENDER_MAX_OUTPUT_FPS=24
RENDER_LIBX264_PRESET=veryfast
```

Ajustement **Railway** : plus de vCPU/RAM si tu veux garder qualité + un peu de parallélisme.

---

## 7. Synthèse

| Erreur | Fix principal | Secondaire |
|--------|----------------|------------|
| Job perdu / 404 backend | 1 réplica, stabilité conteneur | Persistance jobs (gros chantier) |
| YouTube 429 / bot / cookies | Cookies frais, yt-dlp à jour | Multi-part env, espacer les jobs |
| `42703` `style` | Appliquer migration `013` (+ suivantes) | Renforcer fallback `select` si besoin |
| Var env trop longue | `YT_DLP_COOKIES_BASE64_N` | Fichier monté (volume) si un jour |
| `BrokenPipe` | Réduire parallélisme / RAM | try/finally + log stderr dans Python |
| Temps de job | FPS, preset, CPU | Proxy déjà là ; éviter double encodage (réparer pass 2) |

---

## Fichiers du dépôt cités

| Fichier | Rôle |
|---------|------|
| `backend-clips/server.js` | Jobs, yt-dlp, rendu, upload |
| `backend-clips/render_subtitles.py` | Smart crop + Pillow + pipe ffmpeg |
| `backend-clips/.env.example` | Variables perf + cookies |
| `src/app/api/clips/[jobId]/route.ts` | Poll Supabase + backend |
| `src/app/api/clips/start/route.ts` | Création job + insert `clip_jobs` |
| `src/app/api/clips/route.ts` | Liste jobs ; fallback `42703` pour `video_title` |
| `src/lib/clip-errors.ts` | Libellés codes erreur |
| `supabase/migrations/013_clip_jobs_params.sql` | Colonnes `style`, `duration_min`, `duration_max` |

---

*Document généré pour le dépôt **vyrll** — à maintenir quand le pipeline clips évolue.*
