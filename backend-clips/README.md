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
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase (fallback Storage) |
| `R2_ACCOUNT_ID` | Cloudflare Account ID (R2) |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret |
| `R2_BUCKET_NAME` | Nom du bucket R2 |
| `R2_PUBLIC_URL` | URL publique du bucket (ex: `https://pub-xxx.r2.dev`) |

## Stockage des clips (Cloudflare R2 — prioritaire)

1. Crée un bucket R2 dans Cloudflare Dashboard → R2 → Create bucket
2. Active "Public access" → "Allow public access" → R2.dev subdomain (ou custom domain)
3. Crée un API Token : R2 → Manage R2 API Tokens → Create API Token
4. Récupère l’URL publique : bucket → Settings → Public bucket URL

## Fallback : Supabase Storage

Si R2 n’est pas configuré, le backend utilise Supabase Storage. Crée un bucket `clips` (public) dans Supabase.

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

Les jobs sont stockés **en mémoire** dans le processus Node (`jobs` dans `server.js`). Pour que `POST /jobs` et les polls `GET /jobs/:id` voient le même état :

- **Un seul conteneur / une seule réplica** pour le service **backend-clips** (pas de scale horizontal sans refonte : Redis, base partagée, etc.).
- Après un **redémarrage** du worker, les anciens `backend_job_id` renvoient **404** ; l’app Next enregistre alors l’erreur `BACKEND_JOB_LOST` (message utilisateur dédié).

Corrélation des logs : côté Next, `[clips/start] POST /jobs OK … backend_job=<uuid>` doit correspondre aux lignes `[processJob]` sur **le même** worker.

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
