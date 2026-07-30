# Backend Clips Vyrll

Backend pour la génération de clips viraux (yt-dlp, Whisper, FFmpeg).

## Prérequis

- **Node.js** 18+
- **Python 3.9+** avec Pillow, OpenCV, NumPy
- **yt-dlp** : `brew install yt-dlp`
- **FFmpeg** : `brew install ffmpeg`
- **OpenAI API key** (Whisper + GPT-4o-mini)

## Installation

```bash
cd backend-clips
npm install
pip install -r requirements.txt
```

La police Anton est incluse dans `fonts/Anton-Regular.ttf`.

## Configuration

Copie `.env.example` vers `.env` :

```bash
cp .env.example .env
```

Remplis les variables :

| Variable | Description |
|----------|-------------|
| `PORT` | Port du serveur (défaut: 4567) |
| `FFMPEG_PATH` | Chemin vers ffmpeg (optionnel) |
| `BACKEND_SECRET` | Même secret que dans le `.env.local` de l'app Next.js |
| `OPENAI_API_KEY` | Clé API OpenAI |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase (Postgres / file jobs — pas le stockage clips) |
| `R2_ACCOUNT_ID` | Cloudflare Account ID (R2) — **obligatoire** pour les clips |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key — **obligatoire** |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret — **obligatoire** |
| `R2_BUCKET_NAME` | Nom du bucket R2 — **obligatoire** |
| `R2_PUBLIC_URL` | URL publique du bucket (ex: `https://pub-xxx.r2.dev`) — **obligatoire** |

## Stockage des clips (Cloudflare R2 uniquement)

Tous les MP4 clips sont uploadés exclusivement sur R2. Pas de fallback Supabase Storage.

1. Crée un bucket R2 dans Cloudflare Dashboard → R2 → Create bucket
2. Active "Public access" → "Allow public access" → R2.dev subdomain (ou custom domain)
3. Crée un API Token : R2 → Manage R2 API Tokens → Create API Token
4. Récupère l’URL publique : bucket → Settings → Public bucket URL
5. Définis les 5 variables `R2_*` sur le service backend (Railway) et `R2_*` côté Next pour la suppression

## Lancement des serveurs

### Option 1 — Deux terminaux

**Terminal 1 — App Next.js :**
```bash
cd vyrll
npm run dev
```
→ http://localhost:3000

**Terminal 2 — Backend clips :**
```bash
cd vyrll/backend-clips
npm run start
```
→ http://localhost:4567

### Option 2 — Une seule commande (en arrière-plan)

```bash
cd vyrll && npm run dev &
cd vyrll/backend-clips && npm run start
```

### Commandes utiles

| Commande | Où | Effet |
|----------|-----|-------|
| `npm run dev` | `vyrll/` | Next.js (Turbopack) |
| `npm run start` | `vyrll/backend-clips` | Backend clips (sans watch) |
| `npm run dev` | `vyrll/backend-clips` | Backend avec redémarrage auto |

Le backend écoute sur `http://localhost:4567`.

> **Astuce** : Pour les jobs clips, préfère `npm run start` (sans watch) pour éviter les redémarrages pendant le traitement.

## Déploiement (Railway / production)

Les jobs sont **enqueued** dans `clip_backend_jobs` (Supabase). Chaque replica Railway claim via `claim_next_clip_backend_job` avec `MAX_CONCURRENT_JOBS=1`.

- **Multi-replicas OK** (file partagée). Ne pas monter `MAX_CONCURRENT_JOBS>1` sur Hobby.
- État durable = DB ; la `Map` RAM ne sert qu’au process en cours. `GET /jobs/:id` lit aussi la DB.
- Heartbeat `updated_at` ; reclaim si idle > 40 min. Triggers `030`/`031` protègent le sync FE.

Voir `docs/MODIFS_28-29_JUILLET_2026.md` pour le détail des fixes file / STALE / downgrade.

Corrélation des logs : `[clips/start] … backend_job=<uuid>` ↔ `[job-worker] claimed job=<uuid>` sur **n’importe quelle** replica.

## Lien avec l'app Next.js

Dans `.env.local` de l'app Next.js :

```
BACKEND_URL=http://localhost:4567
BACKEND_SECRET=ton-secret-identique
```

## Crop intelligent (format 9:16)

Pour les vidéos 16:9 (landscape), le format vertical 9:16 utilise un **crop intelligent** basé sur la détection de visages (OpenCV Haar cascade). Le crop suit le visage principal pour garder la personne à l’écran. Sans visage détecté, fallback sur un crop centré.

## API

- `POST /jobs` — Body: `{ url, duration: 15|30|45|60|90|120, format: "9:16"|"1:1" }` — Header: `x-backend-secret`
- `GET /jobs/:id` — Statut du job
- `GET /jobs/:id/clips/:index` — Télécharger un clip
