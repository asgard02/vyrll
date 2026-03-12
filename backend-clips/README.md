# Backend Clips flopcheck

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
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase (pour Storage) |

## Bucket Supabase Storage

Crée un bucket nommé `clips` dans Supabase :

1. Dashboard Supabase → Storage → New bucket
2. Nom : `clips`
3. Public : activé (pour les URLs de téléchargement)

## Lancement des serveurs

### Option 1 — Deux terminaux

**Terminal 1 — App Next.js :**
```bash
cd influ
npm run dev
```
→ http://localhost:3000

**Terminal 2 — Backend clips :**
```bash
cd influ/backend-clips
npm run start
```
→ http://localhost:4567

### Option 2 — Une seule commande (en arrière-plan)

```bash
cd influ && npm run dev &
cd influ/backend-clips && npm run start
```

### Commandes utiles

| Commande | Où | Effet |
|----------|-----|-------|
| `npm run dev` | `influ/` | Next.js (Turbopack) |
| `npm run start` | `influ/backend-clips` | Backend clips (sans watch) |
| `npm run dev` | `influ/backend-clips` | Backend avec redémarrage auto |

Le backend écoute sur `http://localhost:4567`.

> **Astuce** : Pour les jobs clips, préfère `npm run start` (sans watch) pour éviter les redémarrages pendant le traitement.

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
