# flopcheck — Prompt Context Complet

> Document de contexte pour les assistants IA et développeurs. Décrit l'architecture, les fonctionnalités et les conventions du projet.

---

## 1. Vue d'ensemble

**flopcheck** est une application web d'analyse de vidéos YouTube par IA. Elle permet aux créateurs de comprendre pourquoi leurs vidéos ont sous-performé et d'obtenir des recommandations concrètes pour améliorer leurs prochaines publications.

- **Tagline** : « Pourquoi ta vidéo a floppé ? »
- **URL** : flopcheck.com (NEXT_PUBLIC_SITE_URL)
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
| IA | OpenAI GPT-4o-mini |
| APIs externes | YouTube Data API v3 |
| Charts | Recharts |

---

## 3. Structure du projet

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx             # Landing
│   ├── layout.tsx          # Layout racine
│   ├── globals.css
│   ├── login/
│   ├── register/
│   ├── dashboard/          # Accueil connecté
│   ├── analyse/
│   │   ├── [id]/           # Détail d'une analyse
│   │   └── new/            # Résultat temporaire (sessionStorage)
│   ├── projets/            # Liste des analyses
│   ├── analytics/          # Stats (score moyen, évolution, etc.)
│   ├── exporter/           # Export PDF / Markdown
│   ├── clips/              # Clips IA (coming soon)
│   ├── upgrade/            # Paiement / codes promo
│   └── api/
│       ├── analyze/        # POST — lancer une analyse
│       ├── history/        # GET / DELETE
│       ├── history/[id]/   # GET / DELETE
│       ├── profile/       # GET
│       ├── redeem-code/    # POST
│       ├── waitlist/       # POST
│       └── clips/
│           ├── start/      # POST
│           ├── [jobId]/    # GET
│           └── [jobId]/download/[index]/
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   ├── dashboard/
│   │   ├── ProjectSection.tsx
│   │   ├── FeatureRow.tsx
│   │   └── types.ts
│   └── result/
│       └── ResultView.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   ├── admin.ts
│   │   └── middleware.ts
│   ├── youtube.ts
│   └── utils.ts
supabase/
└── migrations/
```

---

## 4. Pages et routes

### Public (sans auth)

| Route | Description |
|-------|-------------|
| `/` | Landing page : hero, exemples, features, pricing, CTA |

### Auth (redirect si non connecté)

| Route | Description |
|-------|-------------|
| `/login` | Connexion email + mot de passe |
| `/register` | Inscription + username |
| `/dashboard` | Accueil : formulaire URL YouTube + analyses récentes |
| `/projets` | Liste des analyses avec filtres (all / flop / moyen / top) |
| `/analyse/[id]` | Détail d'une analyse (ResultView) |
| `/analyse/new` | Résultat temporaire (depuis sessionStorage) |
| `/analytics` | Stats : score moyen, évolution, point faible récurrent |
| `/exporter` | Export rapport en Markdown ou PDF |
| `/clips` | Waitlist Clips IA (coming soon) |
| `/upgrade` | Codes promo + plans (paiement bientôt) |

### Middleware

- Rafraîchit la session Supabase
- Redirige vers `/login` si non connecté (sauf `/`, `/login`, `/register`)
- Redirige vers `/dashboard` si connecté sur `/`, `/login`, `/register`
- Si Supabase non configuré : redirige vers `/login` sauf pages publiques

---

## 5. Modèles de données

### Supabase : `profiles`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | Référence auth.users |
| email | TEXT | |
| username | TEXT | |
| plan | TEXT | `free`, `pro`, `unlimited` |
| status | TEXT | `active`, `suspended`, `cancelled` |
| analyses_used | INT | Compteur d'analyses |
| analyses_limit | INT | Quota (3 free, 50 pro, 999 unlimited) |
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

### Supabase : `waitlist`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | |
| email | TEXT | UNIQUE |
| created_at | TIMESTAMPTZ | |

### RLS

- `profiles` : SELECT/UPDATE uniquement par `auth.uid() = id`
- `analyses` : SELECT/INSERT/UPDATE/DELETE uniquement par `auth.uid() = user_id`
- `waitlist` : INSERT public (anon)

---

## 6. API Routes

### `POST /api/analyze`

- **Body** : `{ url: string }`
- **Auth** : Requise
- **Flow** :
  1. Vérifier quota (analyses_used < analyses_limit)
  2. Extraire videoId via `extractVideoId(url)`
  3. Fetch YouTube Data API (titre, description, tags, vues, abonnés, durée, publishedAt)
  4. Appel OpenAI GPT-4o-mini avec prompt structuré
  5. Insert dans `analyses`, incrément `profiles.analyses_used`
- **Réponse** : `{ success, id, videoId, videoData, diagnosis }`
- **Erreurs** : QUOTA_EXCEEDED, VIDEO_NOT_FOUND, YOUTUBE_API_ERROR, etc.

### `GET /api/history`

- **Auth** : Requise
- **Réponse** : Liste des 50 dernières analyses (format `HistoryItem`)

### `GET /api/history/[id]`

- **Auth** : Requise
- **Réponse** : Une analyse par ID

### `DELETE /api/history/[id]`

- **Auth** : Requise
- **Réponse** : `{ success: true }`

### `GET /api/profile`

- **Auth** : Requise
- **Réponse** : `{ id, email, username, plan, analyses_used, analyses_limit }`

### `POST /api/redeem-code`

- **Body** : `{ code: string }`
- **Auth** : Requise
- **Format codes** : `CODE:plan:limit` (ex: `FLOPPRO:pro:50`)
- **Config** : `PROMO_CODES` env (fallback: `FLOPPRO:pro:50,FLOPUNLIMITED:unlimited:999,FLOPFREE:free:10`)

### `POST /api/waitlist`

- **Body** : `{ email: string }`
- **Auth** : Non requise
- **Réponse** : `{ success, message }`

### `POST /api/clips/start`

- **Body** : `{ url: string }`
- **Auth** : Requise
- **Plan** : Pro ou supérieur uniquement
- **Backend** : `BACKEND_URL` + `BACKEND_SECRET` → POST `/jobs`

### `GET /api/clips/[jobId]`

- **Auth** : Requise
- **Plan** : Pro ou supérieur
- **Réponse** : Statut job + URLs de téléchargement

---

## 7. Format du diagnostic

### `DiagnosisJSON` (retour OpenAI)

```ts
{
  score: number;                    // 1–10
  ratio_analysis?: { ratio, interpretation, benchmark };
  context: string;
  verdict: string;
  overperformed: boolean;
  performance_breakdown?: {
    titre: number;
    description: number;
    tags: number;
    timing: number;
    duree: number;
  };
  kills: string[];
  title_analysis: string;
  title_fixed: string;
  description_problem: string;
  description_fixed: string;
  tags_analysis?: string;
  tags_fixed: string[];
  timing: string;
  thumbnail_tips?: string;
  quickwins: string[];
  next_video_idea?: string;
}
```

### Logique du score

- Score = 1–10 : différence entre performance réelle et potentiel
- Ratio vues/abonnés : < 0.1 → sous-performance, > 2 → surperformance
- Prise en compte : niche, durée, timing, ancienneté de la vidéo

---

## 8. Design system

### Couleurs

- `--bg` : `#080809`
- `--accent` : `#00ff88` (vert principal)
- `--danger` : `#ff3b3b`
- `--surface` : `#0c0c0e`
- `--surface-alt` : `#0d0d0f`
- `--border` : `#0f0f12`
- `--border-alt` : `#1a1a1e`

### Typographie

- **Display** : Syne (font-syne)
- **Body** : DM Sans (font-dm-sans)
- **Mono** : JetBrains Mono (font-mono)

### Composants

- Sidebar : 60px collapsed, 200px sur hover
- Header : `analyses_used/analyses_limit` + lien Upgrade
- ResultView : onglets Overview / SEO / Wins

---

## 9. Variables d'environnement

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé anonyme Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé admin (création profile) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `OPENAI_API_KEY` | OpenAI |
| `NEXT_PUBLIC_SITE_URL` | URL du site (ex: https://flopcheck.com) |
| `PROMO_CODES` | Codes promo (format `CODE:plan:limit` séparés par virgule) |
| `BACKEND_URL` | URL backend Clips |
| `BACKEND_SECRET` | Secret pour backend Clips |

---

## 10. Conventions de code

- **Client Components** : `"use client"` en haut de fichier
- **API routes** : `NextRequest` / `NextResponse` pour les handlers
- **Supabase** : `createClient()` côté client, `createClient()` côté server (via `@/lib/supabase/server`)
- **Types** : `HistoryItem`, `DiagnosisJSON` dans `@/components/dashboard/types.ts`
- **YouTube** : `extractVideoId()` et `isValidYouTubeUrl()` dans `@/lib/youtube.ts`

---

## 11. Flux utilisateur

1. **Landing** → CTA « Commencer » → `/register`
2. **Inscription** → Dashboard
3. **Dashboard** → Coller URL YouTube → POST `/api/analyze` → Redirige vers `/analyse/[id]`
4. **Projets** → Liste filtrée → Clic → `/analyse/[id]`
5. **Analytics** → Visible si ≥ 3 analyses
6. **Exporter** → Sélection analyse → Copier Markdown ou Imprimer (PDF)
7. **Upgrade** → Code promo → `POST /api/redeem-code`
8. **Clips** → Waitlist (coming soon) ou backend externe (Pro+)

---

## 12. Résumé pour prompts IA

- **Nom** : flopcheck
- **Domaine** : Analyse YouTube par IA
- **Stack** : Next.js 16, Supabase, OpenAI, YouTube API
- **Langue** : Français
- **Thème** : Dark, accent #00ff88
- **Auth** : Supabase Auth
- **Plans** : free (3 analyses), pro (50), unlimited (999)
- **Codes promo** : `PROMO_CODES` env
- **Clips** : Feature Pro+ avec backend externe
