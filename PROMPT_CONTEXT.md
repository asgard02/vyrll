# Vyrll — Contexte pour assistants IA

> Document de contexte pour les assistants IA et développeurs : architecture, fonctionnalités et conventions du projet.

---

## 1. Vue d’ensemble

**Vyrll** est un générateur de clips viraux alimenté par l'IA. Produit principal : création de clips au format 9:16 ou 1:1 à partir d'une URL YouTube ou Twitch. L'analyse/diagnostic YouTube est une fonctionnalité secondaire.

- **Tagline** : Turn your YouTube & Twitch videos into viral clips
- **URL** : vyrll.com (`NEXT_PUBLIC_SITE_URL`)
- **Langue** : Français
- **Thème** : Dark mode uniquement

---

## 2. Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Next.js 16 (App Router) |
| React | 19.2.3 |
| UI | Tailwind CSS 4, shadcn/ui, Base UI |
| Base de données | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| IA | OpenAI (GPT-4o-mini, Whisper) |
| APIs externes | YouTube Data API v3 |
| Charts | Recharts |

**Backend Clips (service séparé)**  
- Dossier `backend-clips/` : Node.js (ESM), Express.
- Rôle : téléchargement (yt-dlp), transcription (Whisper), détection de moments (GPT), rendu vidéo (ffmpeg + `render_subtitles.py` + `subtitles.js`), upload Supabase Storage.
- Fichiers : `server.js`, `render_subtitles.py` (Pillow, sous-titres), `subtitles.js` (styles).
- Démarrage : `npm run dev` (node --watch) → http://localhost:4567
- En local : `CLIPS_MAX_PER_JOB=1` dans `backend-clips/.env` pour une seule vidéo par génération. En prod : non défini ou `3` (défaut dans le code).

---

## 3. Structure du projet

```
vyrll/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              # Landing
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── login/
│   │   ├── register/
│   │   ├── dashboard/             # Accueil : création clips (URL, plage durée, format, style) + clips récents
│   │   ├── analyse/
│   │   │   ├── layout.tsx         # Metadata SEO (titre, description)
│   │   │   ├── [id]/              # Détail d'une analyse
│   │   │   └── new/               # Résultat temporaire (sessionStorage)
│   │   ├── projets/              # Liste analyses + onglet Clips
│   │   ├── analytics/
│   │   ├── exporter/
│   │   ├── clips/
│   │   │   ├── page.tsx          # Analyse : formulaire URL + liste analyses (ProjectSection)
│   │   │   ├── projet/[jobId]/   # Détail d'un job (grille de clips)
│   │   │   └── dev/              # Page dev only : liste aplatie de clips (NODE_ENV !== production)
│   │   ├── upgrade/
│   │   ├── plans/
│   │   ├── parametres/
│   │   └── api/
│   │       ├── analyze/           # POST — lancer analyse
│   │       ├── analyze/process/  # Pipeline analyse
│   │       ├── analyze/diagnose/
│   │       ├── history/          # GET / DELETE
│   │       ├── history/[id]/     # GET / DELETE
│   │       ├── profile/          # GET
│   │       ├── redeem-code/      # POST
│   │       ├── waitlist/         # POST
│   │       ├── debug/db/         # GET (diagnostic Supabase)
│   │       └── clips/
│   │           ├── route.ts      # GET — liste des jobs
│   │           ├── start/        # POST — démarrer génération
│   │           ├── [jobId]/      # GET (statut + clips) / DELETE
│   │           └── [jobId]/download/[index]/  # GET — stream/redirect clip
│   ├── components/
│   │   ├── layout/               # Sidebar, Header
│   │   ├── dashboard/            # ClipsRecentSection, etc.
│   │   ├── ui/                   # ConfirmDialog, composants shadcn
│   │   └── result/               # ResultView
│   └── lib/
│       ├── supabase/             # client, server, admin, middleware
│       ├── youtube.ts            # extractVideoId, isValidVideoUrl, etc.
│       ├── profile-context.tsx
│       ├── analyze-process.ts
│       ├── backend-fetch.ts      # fetchBackendWithRetry, erreurs transitoires
│       ├── clip-credits.ts       # creditsForClipJob, facturation extrait
│       ├── clip-errors.ts        # libellés codes erreur worker
│       ├── plan.ts               # isPaidPlan (creator / studio)
│       ├── r2.ts                 # R2/S3 (deleteR2Clips, isR2Configured)
│       └── utils.ts
├── backend-clips/                # Service Node séparé
│   ├── server.js                 # POST /jobs, GET /jobs/:id, GET /jobs/:id/clips/:index
│   ├── render_subtitles.py       # Rendu sous-titres (Pillow, styles)
│   ├── subtitles.js              # Styles de sous-titres
│   ├── railway.toml              # Deploy Railway (Dockerfile)
│   ├── .env                      # PORT, BACKEND_SECRET, OPENAI_API_KEY, SUPABASE_*, CLIPS_MAX_PER_JOB
│   └── .gitignore                # node_modules, .env, tmp/
├── docs/
│   └── CLIPS_ERRORS_PROMPT.md    # Explication des erreurs clips pour assistants IA
├── railway.toml                  # Deploy Next.js (node next start)
├── supabase/
│   └── migrations/
└── PROMPT_CONTEXT.md
```

---

## 4. Pages et routes

### Public (sans auth)

| Route | Description |
|-------|-------------|
| `/` | Landing : hero, exemples, features, pricing, CTA |

### Auth (redirect si non connecté)

| Route | Description |
|-------|-------------|
| `/login` | Connexion email + mot de passe |
| `/register` | Inscription + username |
| `/dashboard` | Accueil : formulaire création de clips (URL, plage durée, format 9:16/1:1, styles sous-titres, mode auto ou segment manuel) + section clips récents (`ClipsRecentSection`) |
| `/projets` | Liste analyses (onglets) + onglet Clips (jobs par carte) |
| `/analyse/[id]` | Détail d'une analyse (ResultView). Bouton « Générer clip » → dashboard avec URL pré-remplie |
| `/analyse/new` | Résultat temporaire (sessionStorage) |
| `/analytics` | Stats : score moyen, évolution, point faible récurrent |
| `/exporter` | Export rapport Markdown ou PDF |
| `/clips` | Analyse : formulaire URL YouTube pour analyser + liste des analyses (ProjectSection) |
| `/clips/projet/[jobId]` | Détail d'un job : grille de vidéos + téléchargement. Bouton « Refaire des clips » → dashboard avec URL pré-remplie |
| `/clips/dev` | **Dev only** : liste aplatie de tous les clips (pas de regroupement par projet). 404 en production. |
| `/upgrade` | Codes promo + plans |
| `/plans` | Page plans (redirige free vers ici) |
| `/parametres` | Paramètres utilisateur |

### Middleware

- Rafraîchit la session Supabase.
- Redirige vers `/login` si non connecté (sauf `/`, `/login`, `/register`).
- Redirige vers `/dashboard` si connecté sur `/`, `/login`, `/register`.
- Si Supabase non configuré : redirige vers `/login` sauf pages publiques.

---

## 5. Modèles de données

### Supabase : `profiles`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | Référence auth.users |
| email | TEXT | |
| username | TEXT | |
| plan | TEXT | `free`, `creator`, `studio` |
| status | TEXT | `active`, `suspended`, `cancelled` |
| analyses_used | INT | Compteur d'analyses |
| analyses_limit | INT | Quota (5 free, 20 creator, -1 studio illimité) |
| credits_used | INT | Crédits consommés (voir § crédits clips — basés sur la durée d’extrait facturable) |
| credits_limit | INT | Quota crédits (30 free à vie, 150 creator/mois, 400 studio/mois) |
| created_at | TIMESTAMPTZ | |

### Supabase : `analyses`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | |
| user_id | UUID | FK profiles |
| video_url | TEXT | |
| video_id | TEXT | ID YouTube |
| video_title | TEXT | |
| video_thumbnail | TEXT | |
| view_count | TEXT | |
| subscriber_count | TEXT | |
| score | NUMERIC | 1–10 |
| result | JSONB | `{ diagnosis, videoData }` |
| created_at | TIMESTAMPTZ | |

### Supabase : `clip_jobs`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | |
| user_id | UUID | FK profiles |
| url | TEXT | URL YouTube ou Twitch |
| video_title | TEXT | Optionnel, rempli par le backend |
| duration | INT | Durée max (legacy). Utiliser `duration_min`/`duration_max` pour la plage réelle. |
| duration_min | INT | Plage min (15, 30, 60, 90) — migration 013 |
| duration_max | INT | Plage max (30, 60, 90, 120) — migration 013 |
| format | TEXT | `9:16` ou `1:1` |
| style | TEXT | Voir liste des styles API (karaoke, highlight, minimal, deepdiver, …) — migration 013 |
| status | TEXT | `pending`, `processing`, `done`, `error` |
| error | TEXT | Code erreur si status = error |
| clips | JSONB | Tableau d’objets clip (url, index, évent. `render_mode`, `split_confidence`, `score_viral`, …) |
| backend_job_id | TEXT | ID job côté backend-clips |
| source_duration_seconds | INT | Durée source (yt-dlp) — migration 014 |
| render_mode | TEXT | À la création : `auto` ou `manual` (segment utilisateur). Après `done`, peut être mis à jour en `split_vertical` / `normal` selon le rendu — migration 015 |
| split_confidence | REAL | Confiance max si rendu split vertical — migration 015 |
| start_time_sec | INT | Début du segment en mode manuel — migration 015 |
| created_at | TIMESTAMPTZ | |

Plages de durée : (15–30), (30–60), (60–90), (90–120) secondes — découpe aux frontières de phrases.

**Crédits clips** (`@/lib/clip-credits`) : le coût est dérivé de la durée d’**extrait facturable** (plafonnée par `duration_max` et la durée source restante ; en mode manuel, compte à partir de `start_time_sec`). `credits = ceil(secondes_facturables / 60)`, minimum 1 à la consommation côté RPC. Vérification quota à **POST /api/clips/start** avec la même formule ; débit réel à la fin du job via `increment_credits_used` quand le statut passe à `done`.

RLS : SELECT/INSERT/UPDATE/DELETE par `auth.uid() = user_id`.  
Fonction : `increment_credits_used(p_user_id, p_credits)` (SECURITY DEFINER), remplace l’ancien `increment_clips_used` — migration 014.

### Supabase : `waitlist`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | |
| email | TEXT | UNIQUE |
| created_at | TIMESTAMPTZ | |

---

## 6. API Routes

### Analyse

- **POST /api/analyze** — Body : `{ url }`. Auth requise. Quota, YouTube API, OpenAI, insert `analyses`, incrément `analyses_used`. Réponse : `{ success, id, videoId, videoData, diagnosis }`.
- **GET /api/history** — Liste des 50 dernières analyses.
- **GET /api/history/[id]** — Une analyse par ID.
- **DELETE /api/history/[id]** — Suppression.

### Profil et promo

- **GET /api/profile** — `{ id, email, username, plan, analyses_used, analyses_limit, credits_used, credits_limit }`.
- **POST /api/redeem-code** — Body : `{ code }`. Format codes : `CODE:plan:analyses_limit` ou `CODE:plan:analyses_limit:credits_limit`. Config : `PROMO_CODES` env.

### Clips

- **GET /api/clips** — Auth. Réponse : `{ jobs }` (clip_jobs : id, url, duration, status, error, clips, created_at). Ordre `created_at` desc, limit 50.
- **POST /api/clips/start** — Body : `url` ; `duration_min` + `duration_max` ou `duration` (legacy) ; `format` ; `style` ; `mode` : `auto` (défaut) ou `manual` ; si `manual`, `start_time_sec` (s). Auth. Appelle `POST ${BACKEND_URL}/duration` (via `fetchBackendWithRetry`) puis vérifie les crédits avec `creditsForClipJob`. Plages durée : (15,30), (30,60), (60,90), (90,120). Styles acceptés côté API : entre autres `karaoke`, `highlight`, `minimal`, `deepdiver`, `podp`, `popline`, `bounce`, `beasty`, `youshaei`, `mozi`, `glitch`, `earthquake`. Crée `clip_jobs` (`source_duration_seconds`, `render_mode` = mode, `start_time_sec` si manuel), puis `POST ${BACKEND_URL}/jobs` avec les mêmes paramètres. Réponse : `{ jobId }`.
- **GET /api/clips/estimate-duration** — Query : `url`. Retourne `{ duration, credits }` pour affichage UI.
- **GET /api/clips/[jobId]** — Auth. Si job non terminal, sync avec backend `GET ${BACKEND_URL}/jobs/${backend_job_id}`, met à jour status/error/clips/source_duration_seconds, `render_mode`/`split_confidence` si rendu split vertical, puis `increment_credits_used` avec `creditsForClipJob` au premier passage à `done`. Réponse : statut, progress, clips (`downloadUrl`, `directUrl`, `renderMode`, `splitConfidence`, `scoreViral` si présents).
- **DELETE /api/clips/[jobId]** — Auth + plan. Supprime job et fichiers (R2 si configuré, puis Supabase Storage).
- **GET /api/clips/[jobId]/download/[index]** — Auth + plan. Redirige vers l’URL Supabase si clip hébergé, sinon stream depuis le backend.

### Autres

- **POST /api/waitlist** — Body : `{ email }`. Pas d’auth.
- **GET /api/debug/db** — Diagnostic Supabase (optionnel).

---

## 7. Format du diagnostic (analyses)

### DiagnosisJSON (retour OpenAI)

- `score` (1–10), `ratio_analysis`, `context`, `verdict`, `overperformed`, `performance_breakdown`, `kills`, `title_analysis`, `title_fixed`, `description_problem`, `description_fixed`, `tags_*`, `timing`, `thumbnail_tips`, `quickwins`, `next_video_idea`.

Logique du score : écart performance réelle / potentiel, ratio vues/abonnés, niche, durée, timing.

---

## 8. Design system

- **Couleurs** : fond `#080809`, accent interactif dégradé teal→violet `linear-gradient(135deg, #2dd4bf, #7c3aed)` (CTA, barre quota, badges Pro), fallback texte/bordures `#9b6dff`, succès `#4a9e6a`, danger `#ff3b3b`, surface `#0c0c0e` / `#0d0d0f`, bordures `#0f0f12` / `#1a1a1e`. Logo noir/crème (#e8e8e0) inchangé.
- **Typo** : Syne (display), DM Sans (body), JetBrains Mono (mono).
- **Layout** : Sidebar 60px (200px au hover), Header avec quota et lien Upgrade.
- **ResultView** : onglets Overview / SEO / Wins. Props optionnelles `videoUrl` + `onGenerateClip` pour afficher le bouton « Générer clip » (analyse → dashboard).

---

## 9. Variables d’environnement

### Next.js (racine, `.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Clé anonyme |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé admin |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `OPENAI_API_KEY` | OpenAI |
| `NEXT_PUBLIC_SITE_URL` | URL du site (ex. https://vyrll.com) |
| `PROMO_CODES` | Codes promo (`CODE:plan:limit` séparés par virgule) |
| `BACKEND_URL` | URL backend Clips (ex. http://localhost:4567) |
| `BACKEND_SECRET` | Secret partagé avec backend-clips |
| `ANALYZE_PROCESS_SECRET` | Secret pour le pipeline d’analyse (process) |

### backend-clips (`.env`, dans `.gitignore`)

| Variable | Description |
|----------|-------------|
| `PORT` | 4567 |
| `BACKEND_SECRET` | Même valeur que Next.js |
| `OPENAI_API_KEY` | OpenAI (Whisper + GPT) |
| `SUPABASE_URL` | URL Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role (fallback storage) |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret |
| `R2_BUCKET_NAME` | Nom du bucket R2 |
| `R2_PUBLIC_URL` | URL publique du bucket (ex. https://pub-xxx.r2.dev) |
| `CLIPS_MAX_PER_JOB` | Nombre max de clips par job (1 en local, 3 par défaut) |

### Deploy

- **Next.js** : `railway.toml` à la racine — `node node_modules/next/dist/bin/next start` (évite SIGTERM avec npm).
- **backend-clips** : `backend-clips/railway.toml` — Dockerfile, `node server.js`.

---

## 10. Conventions de code

- **Client Components** : `"use client"` en haut du fichier.
- **API routes** : `NextRequest` / `NextResponse`.
- **Supabase** : client via `@/lib/supabase/client`, server via `@/lib/supabase/server`, admin via `@/lib/supabase/admin`.
- **Types** : `HistoryItem`, `DiagnosisJSON` dans `@/components/dashboard/types.ts` ; types clips dans les pages/API.
- **YouTube** : `extractVideoId`, `isValidVideoUrl`, etc. dans `@/lib/youtube.ts`. Clips : `isValidVideoUrl` gère aussi Twitch.
- **Backend clips** : appels longs via `@/lib/backend-fetch` (`fetchBackendWithRetry`, timeouts, erreurs transitoires).
- **Erreurs clips UI** : libellés dans `@/lib/clip-errors` ; détail des codes dans `docs/CLIPS_ERRORS_PROMPT.md`.
- **Pré-remplissage clips** : `sessionStorage.vyrll_pending_clip_url` — le dashboard lit cette clé au mount et pré-remplit le champ URL (depuis analyse ou projet clips).

---

## 11. Flux utilisateur

1. Landing → CTA → `/register` → Dashboard.
2. Analyse : `/clips` → URL YouTube → POST `/api/analyze` → `/analyse/[id]`.
3. Depuis une analyse : bouton « Générer clip » → `sessionStorage.vyrll_pending_clip_url` + redirection `/dashboard` → champ URL pré-rempli.
4. Projets → Filtres → Clic → `/analyse/[id]`. Onglet Clips → cartes jobs → `/clips/projet/[jobId]`.
5. Depuis un projet clips : bouton « Refaire des clips » → même mécanisme (sessionStorage + dashboard).
6. Dashboard → URL + plage durée + format + style (+ option segment manuel) → POST `/api/clips/start` → polling GET `/api/clips/[jobId]` → vue projet ou liste récente sur le dashboard.
7. Analytics (si ≥ 3 analyses), Exporter, Upgrade (code promo), Paramètres.
8. En dev : `/clips/dev` pour voir tous les clips en liste aplatie (non exposé en prod).

**SessionStorage** : `vyrll_pending_clip_url` — URL pré-remplie au dashboard quand on arrive depuis « Générer clip » (analyse) ou « Refaire des clips » (projet).

---

## 12. Résumé pour prompts IA

- **Produit** : Vyrll — Générateur de clips viraux IA (9:16 / 1:1 depuis YouTube & Twitch). Analyse/diagnostic YouTube secondaire.
- **Stack** : Next.js 16, Supabase, OpenAI, YouTube API ; backend-clips (Node, yt-dlp, Whisper, ffmpeg).
- **Langue** : Français. **Thème** : dark, accent dégradé #2dd4bf→#7c3aed / fallback #9b6dff.
- **Auth** : Supabase Auth. **Plans** : free (30 crédits à vie, 5 analyses à vie), creator (150 crédits/mois, 20 analyses/mois), studio (400 crédits/mois, analyses illimitées). **Crédits clips** : ~1 crédit par minute d’extrait facturable (plafond `duration_max`, mode auto vs manuel) — voir `clip-credits.ts` et RPC `increment_credits_used`.
- **Codes promo** : `PROMO_CODES` env. **Clips** : Pro+ ; backend externe ; en local `CLIPS_MAX_PER_JOB=1` dans `backend-clips/.env`.
- **Page dev** : `/clips/dev` (liste brute de clips, 404 en production).
- **Liens directs clips** : Depuis `/analyse/[id]` (bouton « Générer clip ») ou `/clips/projet/[jobId]` (bouton « Refaire des clips ») → dashboard avec URL pré-remplie via `sessionStorage.vyrll_pending_clip_url`.
- **Erreurs clips** : Voir `docs/CLIPS_ERRORS_PROMPT.md` pour explication des codes (VIDEO_TOO_LONG, DOWNLOAD_FAILED, etc.) et erreurs techniques.
