# Récap modifications — 1er août 2026

Session locale (Cursor) : cadrage 9:16 mono/split podcast, isolation file local vs Railway, cookies YouTube.

**Pour reprendre dans Claude Code** : ce fichier + diffs non commités dans `backend-clips/render_subtitles.py`, `backend-clips/server.js`, et migration `supabase/migrations/034_claim_queue_scope_local.sql` (pas encore appliquée remote).

---

## Contexte / problèmes utilisateur

1. **Cadrage mono** (1 personne à l’écran) : souvent centré, mais **saccades G/D** ; parfois personne coupée (vide / micro / chaise au centre).
2. **Split** : faux split (confiance basse), ou bascule split↔mono qui **flashe** des frames bizarres.
3. **File partagée Supabase** : jobs locaux volés / traités par **Railway** (coût + vieux code).
4. **Cookies YouTube** expirés → `YOUTUBE_COOKIES_EXPIRED`.

---

## Fichiers touchés

| Fichier | Rôle |
|---------|------|
| [`backend-clips/render_subtitles.py`](../backend-clips/render_subtitles.py) | Smart-crop mono, split, preflight yeux, anti-flash |
| [`backend-clips/server.js`](../backend-clips/server.js) | Gate split podcast, self-claim local, profil `VYLL_CLIP_PROFILE` |
| [`supabase/migrations/034_claim_queue_scope_local.sql`](../supabase/migrations/034_claim_queue_scope_local.sql) | RPC claim scoped `local` / `production` (**pas appliquée**) |
| [`backend-clips/.env`](../backend-clips/.env) | `VYLL_CLIP_PROFILE=local`, `YT_DLP_COOKIES_FILE=…` |
| Cookies | `www.youtube.com_cookies.txt` → aussi `YT_DLP_COOKIES_BASE64` sur Railway (`reasonable-luck` + `Upcut`) |

---

## 1. Isolation local vs Railway (queue)

### Comportement actuel (code)

- `VYLL_CLIP_PROFILE=local` (ou pas de `RAILWAY_ENVIRONMENT`) → profil **local**.
- `POST /jobs` en local : **self-claim** immédiat (`status=processing`, `claimed_by=mac.home-…`, `payload.queue_scope=local`) puis `processJob` tout de suite.
- Railway ne claim que les `pending` → ne peut plus voler ces jobs.
- Sans migration 034 : le worker local **ne claim pas** via RPC (évite de prendre la file prod). Log : `local scoped claim unavailable`.

### Migration 034 (à appliquer)

Fichier : `supabase/migrations/034_claim_queue_scope_local.sql`

- Étend `claim_next_clip_backend_job(p_worker_id, p_queue_scope DEFAULT NULL)`.
- `scope=local` → seulement `payload.queue_scope=local`.
- Sinon (prod / 1-arg Railway) → **ignore** les jobs `queue_scope=local`.

**État** : MCP/CLI timeout ; **pas dans le schema cache remote**. Self-claim local suffit pour les tests via `localhost:3000` + `BACKEND_URL=http://localhost:4567`.

### Règle d’or pour tester

- **localhost:3000** → backend local.
- **Site prod / vyrll.com** → Railway.

---

## 2. Gate split podcast (`server.js`)

Dans `determineRenderModeForClip` :

- Podcast : `solidVisualPodcast` plus strict.
- Chemin « séparation nette » (`dist >= 0.46`) exige aussi `multiRatio >= 0.28` et `confidence >= 0.28` (évite split sur 7/31 frames ≈ conf 0.22).

---

## 3. Cadrage mono — évolution de la session

### Détection

- MediaPipe FaceDetector (Tasks API) + keypoints **yeux** (`_eye_anchor_from_keypoints`).
- Score : aire + yeux (+4) + peau soft ; pénalité centre mort sans yeux.
- Haar **désactivé** pour le mono (`include_haar=False`) — confondait micro boom.
- `detect_face_center_scored(..., require_eyes=True)` pour le pré-pass.

### Architecture finale (important)

```
Pré-pass (avant encode)
  → scan dense (interval ~8 frames)
  → samples YEUX only
  → scene-cuts debouncés
  → fusion mini-segments < ~0.45s
  → UN lock (cx,cy) par plan (médiane top scores)
  → reject jump aberrant sur plan court
  → freeze total du plan dans cx_smooth/cy_smooth

Render
  → utilise cx_smooth figé
  → PLUS de refine runtime (c’était la source des G/D)
```

### Ce qui a été essayé puis retiré / adouci

| Idée | Effet | Statut |
|------|--------|--------|
| Freeze-per-shot + snap dur | Centre OK, G/D sur faux cuts | Remplacé par preflight |
| Deadband + `prefer_cx` agressif | A **décadré** (gardait mauvais ancre) | Retiré |
| Ease 0.45s entre plans | Mouvement visible | Retiré (freeze dur) |
| `refine_mono_crop_center` pendant render | Ping-pong G/D | **Supprimé** |
| Force split dès 1 check 2-shot | Flash split/mono 1 frame | **Supprimé** (trust mask+preflight) |
| Runtime `solo_force_mono` / `force_split_streak` | Bascule split↔mono pendant un segment | **Supprimé** |

### Anti-flash frames (mono)

Dans `collect_crop_positions` :

- `_MIN_SHOT_SEC = 0.45` : merge des mini-plans (faux cuts).
- Weak (sans yeux) seulement si **aucun** lock précédent.
- Reject si `|Δcx| >= 0.22` sur plan court.

---

## 3bis. Split hybrid — verify-before-arm + `split_clean` (1er août)

**Problème** : 1ère frame split foireuse ; bascules mid-segment ; puis faux négatifs
(2 personnes aux **extrémités de table**, face-à-face → split très propice mais refusé
parce que le check exigeait des **yeux** MediaPipe, souvent absents en profil).

**Principe** : *vérifier si le plan est propice* via un check **externalisé**
(`assess_split_clean` / `SplitClean`), pas mélangé au rendu panneaux.

### `assess_split_clean` (externalisé)

| Raison | Condition | Clean ? |
|--------|-----------|---------|
| `wide_table` | dist ≥ 0.45 + aires OK | **oui** (même sans yeux) |
| `eyes_ok` | dist ≥ 0.36 + ≥1 yeux | oui |
| `soft_sep` | dist ≥ 0.40 + aires OK | oui (profils) |
| `too_close` / `solo` / `unbalanced` | — | non |

### Pipeline

```
assess_split_clean (propice ?)
  → build_dynamic_layout_mask COMMIT-CLEAN :
      même plan clean continu → split sur TOUTE la durée (10s → 10s, pas 3s)
      gap fill ≤1.8s ; drop seulement micro-bursts
  → preflight_split_segments :
      arme si clean, lock L/R figé
      ÉTEND avant/après tant que le plan reste clean
  → Render : mask + locks only
```

Logs :

```
[LAYOUT] split_clean samples: N/M clean reasons={'wide_table': …}
[LAYOUT] dynamic mask raw: …
[LAYOUT] preflight split: armed=… dropped=… trimmed_frames=…
```

---

## 4. Cookies YouTube

- Local : `YT_DLP_COOKIES_FILE` → `www.youtube.com_cookies.txt` (Netscape).
- Railway : `YT_DLP_COOKIES_BASE64` sur service **reasonable-luck** (clips) et **Upcut**.
- Erreur UI : `YOUTUBE_COOKIES_EXPIRED` = bot / cookies invalides.
- Re-export cookies (extension Get cookies.txt LOCALLY sur youtube.com connecté) puis :
  - remplacer le fichier local + restart `backend-clips`
  - `base64` → `railway variable set YT_DLP_COOKIES_BASE64 --stdin -s reasonable-luck`

---

## 5. Env local utile

```bash
# backend-clips/.env
VYLL_CLIP_PROFILE=local
YT_DLP_USE_COOKIES=true
YT_DLP_COOKIES_FILE=/Users/.../vyrll/www.youtube.com_cookies.txt

# .env.local (Next)
BACKEND_URL=http://localhost:4567
```

Ports typiques : frontend `:3000`, backend `:4567`.

Logs à chercher :

```
[job-worker] started ... profile=local
[POST /jobs] local self-claim ... Railway cannot steal
[SMARTCROP] preflight — ...
[SMARTCROP] preflight done: ... eye_locks=... dropped=...
[LAYOUT] dynamic mask raw: ...
[LAYOUT] preflight split: armed=... dropped=... trimmed_frames=...
[determineRenderModeForClip] ... split_vertical | no split
```

---

## 6. Problèmes ouverts / suite Claude Code

1. **Appliquer migration 034** quand Supabase répond (isolation RPC propre).
2. **Valider split preflight** : 1ère frame OK, pas de bascule mid-segment, personnes figées L/R.
3. **Mono** : frames parasites — valider encore sur podcast Elon / Economist (`1X-rr1DKSbY`, `QTGCSYn0piw`, `f53Fqt2UhVE`).
4. **Speaker diarization** (qui parle → panneau haut) : pas fait.
5. **Deploy Railway** des changements `render_subtitles.py` / `server.js` : code local ≠ prod tant que pas push/deploy.
6. Backend Node **single-thread** : un gros job peut bloquer `/duration` (timeout UI 15s).

---

## 7. Prompt court pour Claude Code

```
Lis docs/MODIFS_01_AOUT_2026_CADRAGE_QUEUE.md (surtout §3 mono + §3bis split).

Objectif :
1) Mono 9:16 stable (lock yeux preflight, pas de G/D, pas de frames flash)
2) Split : vérifier AVANT d'armer ; lock L/R figé 1ère→dernière frame du segment ;
   plus de bascule runtime force_split/solo_force

État actuel (render_subtitles.py) :
- assess_split_clean / SplitClean : check propice EXTERNALISÉ (wide_table sans yeux OK)
- collect_crop_positions : preflight mono yeux + freeze par plan
- preflight_split_segments : arme sur frames clean + locks L/R
- Render trust mask+locks seulement

À faire :
1. Relancer clip test localhost (BACKEND_URL=http://localhost:4567, VYLL_CLIP_PROFILE=local)
2. Lire [LAYOUT] split_clean samples (reasons=wide_table/eyes_ok/soft_sep)
3. Si table face-à-face encore raté : baisser SPLIT_CLEAN_WIDE_SEP / enter_ratio
4. Si bascule mid-segment : NE PAS réintroduire force_split runtime
5. Optionnel : migration 034 + deploy Railway
```

---

## 8. Commandes utiles

```bash
# Backend
cd backend-clips && npm run dev

# Frontend
cd .. && npm run dev

# Probe cookies
yt-dlp --cookies www.youtube.com_cookies.txt --print "%(id)s %(duration)s" \
  "https://www.youtube.com/watch?v=VIDEO_ID" --no-download

# Push cookies Railway
base64 < www.youtube.com_cookies.txt | tr -d '\n' \
  | railway variable set YT_DLP_COOKIES_BASE64 --stdin -s reasonable-luck
```
